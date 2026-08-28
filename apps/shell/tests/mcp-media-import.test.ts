import { existsSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpMediaImportStore } from '../src/main/mcp/media-import'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('McpMediaImportStore', () => {
  it('stages one private PNG and consumes its handle only once for the same client', () => {
    const store = new McpMediaImportStore()
    try {
      writeFileSync(join(store.directory, 'generated.png'), PNG_1PX)
      const staged = store.stage('client-a', 'generated.png')
      expect(staged).toMatchObject({ fileName: 'generated.png', mimeType: 'image/png' })
      expect(existsSync(join(store.directory, 'generated.png'))).toBe(false)
      const consumed = store.consume('client-a', staged.handle)
      expect(consumed.bytes).toEqual(PNG_1PX)
      expect(() => store.consume('client-a', staged.handle)).toThrow('Media handle is unavailable')
    } finally {
      store.stop()
    }
  })

  it('rejects paths outside the session directory, symlinks, and another client handle use', () => {
    const store = new McpMediaImportStore()
    try {
      writeFileSync(join(store.directory, 'generated.png'), PNG_1PX)
      expect(() => store.stage('client-a', '../generated.png')).toThrow('safe file name')
      symlinkSync(join(store.directory, 'generated.png'), join(store.directory, 'link.png'))
      expect(() => store.stage('client-a', 'link.png')).toThrow('non-symlink')
      const staged = store.stage('client-a', 'generated.png')
      expect(() => store.consume('client-b', staged.handle)).toThrow(
        'unavailable for this MCP client',
      )
    } finally {
      const directory = store.directory
      store.stop()
      expect(existsSync(directory)).toBe(false)
    }
  })
})
