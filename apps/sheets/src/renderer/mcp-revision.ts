/** Monotonic renderer-side revision source used by MCP compare-and-set. */
export class McpRevisionTracker {
  private revision = 0

  get current(): number {
    return this.revision
  }

  set(revision: number): number {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('MCP revision must be non-negative')
    this.revision = revision
    return revision
  }

  advance(): number {
    return this.set(this.revision + 1)
  }
}
