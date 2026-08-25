import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CapabilityError } from '@genoffice/capabilities'
import { LocalMcpBridge } from '../src/main/mcp/bridge'

function request(endpoint: string, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: endpoint })
    socket.setEncoding('utf8')
    let buffer = ''
    socket.once('error', reject)
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      socket.end()
      resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>)
    })
    socket.once('connect', () => socket.write(`${JSON.stringify(payload)}\n`))
  })
}

describe('LocalMcpBridge', () => {
  it('writes a private discovery file and authenticates requests', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'genoffice-mcp-'))
    const bridge = new LocalMcpBridge({
      userDataPath,
      gateway: {
        handle: async (request) => ({ method: request.method, clientId: request.clientId }),
      },
    })
    await bridge.start()
    try {
      const discovery = JSON.parse(await readFile(bridge.discoveryPath, 'utf8')) as Record<string, string>
      expect(discovery.endpoint).toBe(bridge.discovery.endpoint)
      expect((await stat(bridge.discoveryPath)).mode & 0o077).toBe(0)
      const ok = await request(bridge.discovery.endpoint, {
        id: '1',
        token: discovery.token,
        clientId: 'test-client',
        method: 'tools/list',
        params: {},
      })
      expect(ok).toEqual({
        id: '1',
        ok: true,
        result: { method: 'tools/list', clientId: expect.any(String) },
      })
      expect((ok.result as { clientId: string }).clientId).not.toBe('test-client')
      const denied = await request(bridge.discovery.endpoint, {
        id: '2',
        token: 'not-the-token',
        clientId: 'test-client',
        method: 'tools/list',
        params: {},
      })
      expect(denied).toEqual(
        expect.objectContaining({ id: '2', ok: false, error: expect.objectContaining({ code: 'unauthorized' }) }),
      )
    } finally {
      await bridge.stop()
    }
  })

  it('maps gateway capability failures without exposing arbitrary errors', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'genoffice-mcp-'))
    const bridge = new LocalMcpBridge({
      userDataPath,
      gateway: { handle: async () => Promise.reject(new CapabilityError('conflict', 'Document changed')) },
    })
    await bridge.start()
    try {
      const response = await request(bridge.discovery.endpoint, {
        id: '3',
        token: bridge.discovery.token,
        clientId: 'test-client',
        method: 'tools/call',
        params: {},
      })
      expect(response).toEqual(
        expect.objectContaining({
          ok: false,
          error: { code: 'conflict', message: 'Document changed' },
        }),
      )
    } finally {
      await bridge.stop()
    }
  })
})
