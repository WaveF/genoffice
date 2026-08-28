import { describe, expect, it } from 'vitest'
import { McpRevisionTracker } from '../src/renderer/mcp-revision'

describe('McpRevisionTracker', () => {
  it('advances for every document mutation while the document remains dirty', () => {
    const tracker = new McpRevisionTracker()
    expect(tracker.advance()).toBe(1)
    expect(tracker.advance()).toBe(2)
    expect(tracker.current).toBe(2)
  })
})
