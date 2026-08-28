import { describe, expect, it } from 'vitest'
import { assertSafeMcpInput } from '../src/main/mcp/input-guard'

describe('assertSafeMcpInput', () => {
  it('accepts bounded JSON input', () => {
    expect(() =>
      assertSafeMcpInput({ documentId: 'doc-1', ops: [{ op: 'setFill' }] }),
    ).not.toThrow()
  })

  it('rejects excessive nesting, arrays, and strings before a tool executes', () => {
    let nested: Record<string, unknown> = {}
    const root = nested
    for (let i = 0; i < 13; i++) {
      const next: Record<string, unknown> = {}
      nested.next = next
      nested = next
    }
    expect(() => assertSafeMcpInput(root)).toThrow('nesting')
    expect(() => assertSafeMcpInput({ items: Array.from({ length: 51 }) })).toThrow('array')
    expect(() => assertSafeMcpInput({ text: 'x'.repeat(64 * 1024 + 1) })).toThrow('string')
    expect(() =>
      assertSafeMcpInput({
        fields: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`f${i}`, i])),
      }),
    ).toThrow('fields')
    expect(() =>
      assertSafeMcpInput({ chunks: Array.from({ length: 50 }, () => 'x'.repeat(6000)) }),
    ).toThrow('maximum size')
  })
})
