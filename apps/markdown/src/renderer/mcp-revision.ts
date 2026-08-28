/** Monotonic renderer-side revision source used by MCP compare-and-set. */
export class McpRevisionTracker {
  private revision = 0

  get current(): number {
    return this.revision
  }

  advance(): number {
    this.revision += 1
    return this.revision
  }
}
