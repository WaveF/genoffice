import { describe, expect, it } from 'vitest'
import { mcpOpsRisk, validateMcpOps } from '../src/main/mcp-op-guard'

describe('validateMcpOps', () => {
  it('permits registered, JSON-only canonical operations', () => {
    expect(
      validateMcpOps([{ op: 'setFill', target: { slide: 0, el: 'shape-1' }, fill: '#112233' }]),
    ).toHaveLength(1)
  })

  it('rejects unregistered operations and archive/file/script escape hatches', () => {
    expect(() => validateMcpOps([{ op: 'runShell', command: 'open /' }])).toThrow('registered')
    expect(() => validateMcpOps([{ op: 'addPicture', bytes: 'base64-data' }])).toThrow('restricted')
    expect(() =>
      validateMcpOps([{ op: 'setImageFill', source: { mediaPath: '/tmp/a.png' } }]),
    ).toThrow('restricted')
  })

  it('marks delete operations as destructive', () => {
    expect(
      mcpOpsRisk([{ op: 'setFill', target: { slide: 0, el: 'shape-1' }, fill: '#112233' }]),
    ).toBe('write')
    expect(mcpOpsRisk([{ op: 'deleteSlide', target: { slide: 0 } }])).toBe('destructive')
  })
})
