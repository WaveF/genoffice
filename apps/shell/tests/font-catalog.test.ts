import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FontCatalogService, type FontCatalogWorker } from '../src/main/font-catalog'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'font-catalog-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function worker(result: readonly string[]): FontCatalogWorker {
  return { enumerate: vi.fn(async () => result) }
}

describe('FontCatalogService', () => {
  it('uses a cache immediately and refreshes it with de-duplicated families', async () => {
    const cachePath = join(dir, 'font-catalog-v1.json')
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 1, refreshedAt: 100, families: ['Arial', 'PingFang SC'] }),
    )
    const scan = worker(['Arial', 'Arial ', 'PingFang SC', 'Noto Sans CJK SC'])
    const service = new FontCatalogService(cachePath, scan, () => 200)

    await expect(service.getSnapshot()).resolves.toMatchObject({
      families: ['Arial', 'PingFang SC'],
      source: 'cache',
      state: 'ready',
      stale: false,
    })
    await expect(service.refresh()).resolves.toMatchObject({
      families: ['Arial', 'Noto Sans CJK SC', 'PingFang SC'],
      source: 'scan',
      state: 'ready',
      stale: false,
    })
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toMatchObject({ version: 1, refreshedAt: 200 })
  })

  it('deduplicates concurrent refreshes and preserves a usable cache on scan failure', async () => {
    const cachePath = join(dir, 'font-catalog-v1.json')
    writeFileSync(cachePath, JSON.stringify({ version: 1, refreshedAt: 100, families: ['Arial'] }))
    const enumerate = vi.fn(async () => {
      throw new Error('scan unavailable')
    })
    const service = new FontCatalogService(cachePath, { enumerate }, () => 200)

    const [first, second] = await Promise.all([service.refresh(), service.refresh()])
    expect(enumerate).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ families: ['Arial'], state: 'ready', stale: true })
  })

  it('treats a malformed cache as a cold start', async () => {
    const cachePath = join(dir, 'font-catalog-v1.json')
    writeFileSync(cachePath, '{broken')
    const service = new FontCatalogService(cachePath, worker([]), () => 200)

    await expect(service.getSnapshot()).resolves.toMatchObject({
      families: [],
      source: 'none',
      state: 'loading',
      stale: true,
    })
  })
})
