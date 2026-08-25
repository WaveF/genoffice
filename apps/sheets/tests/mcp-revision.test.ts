import { describe, expect, it } from 'vitest'
import { McpRevisionTracker } from '../src/renderer/mcp-revision'

describe('McpRevisionTracker', () => {
  it('advances monotonically and permits an explicit workbook-session reset', () => {
    const tracker = new McpRevisionTracker()
    expect(tracker.advance()).toBe(1)
    expect(tracker.advance()).toBe(2)
    expect(tracker.set(0)).toBe(0)
    expect(tracker.current).toBe(0)
  })

  it('rejects invalid revisions before they can reach the MCP bridge', () => {
    const tracker = new McpRevisionTracker()
    expect(() => tracker.set(-1)).toThrow('non-negative')
    expect(() => tracker.set(1.5)).toThrow('non-negative')
  })
})
