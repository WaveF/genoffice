import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CapabilityError } from '@genoffice/capabilities'
import { StdioMcpServer } from '../src/server'

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('StdioMcpServer', () => {
  it('serves initialize, tools/list and tools/call over newline-delimited JSON-RPC', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.setEncoding('utf8')
    let response = ''
    output.on('data', (chunk: string) => {
      response += chunk
    })
    const server = new StdioMcpServer({
      input,
      output,
      backend: {
        listTools: async () => [
          { name: 'slides.read_slide', description: 'Read one slide', inputSchema: { type: 'object' } },
        ],
        callTool: async (name, input) => ({
          content: `${name}:${String(input.slideId)}`,
          mutated: false,
          revision: 3,
        }),
      },
    })
    server.start()
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"test-client"}}}\n')
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n')
    input.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"slides.read_slide","arguments":{"slideId":"s1"}}}\n')
    await tick()
    const responses = response.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(responses).toHaveLength(3)
    expect((responses[0]!.result as Record<string, unknown>).protocolVersion).toBe('2025-06-18')
    expect(((responses[1]!.result as Record<string, unknown>).tools as Array<unknown>)[0]).toEqual(
      expect.objectContaining({ name: 'slides.read_slide' }),
    )
    expect(responses[2]!.result).toEqual(
      expect.objectContaining({
        content: [{ type: 'text', text: 'slides.read_slide:s1' }],
        structuredContent: { mutated: false, revision: 3 },
      }),
    )
  })

  it('returns a tool error instead of crashing the stdio protocol', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.setEncoding('utf8')
    let response = ''
    output.on('data', (chunk: string) => {
      response += chunk
    })
    const server = new StdioMcpServer({
      input,
      output,
      backend: {
        listTools: async () => [],
        callTool: async () => {
          throw new CapabilityError('conflict', 'Document changed')
        },
      },
    })
    server.start()
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n')
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"slides.apply_ops"}}\n')
    await tick()
    const result = JSON.parse(response.trim().split('\n')[1]!).result as Record<string, unknown>
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ code: 'conflict', message: 'Document changed' }) },
    ])
  })
})
