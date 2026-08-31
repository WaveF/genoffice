import { CapabilityError } from '@nexoffice/capabilities'

/**
 * Serializes mutations per document. A disconnected client can cancel work
 * that has not begun; already-running main-process transactions finish
 * atomically and report their normal result.
 */
export class DocumentWriteQueue {
  private readonly tails = new Map<string, Promise<void>>()

  enqueue<T>(documentId: string, signal: AbortSignal, work: () => Promise<T> | T): Promise<T> {
    if (signal.aborted)
      return Promise.reject(new CapabilityError('cancelled', 'MCP request was cancelled'))
    const previous = this.tails.get(documentId) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        if (signal.aborted) throw new CapabilityError('cancelled', 'MCP request was cancelled')
        return work()
      }) as Promise<T>
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(documentId, settled)
    void settled.finally(() => {
      if (this.tails.get(documentId) === settled) this.tails.delete(documentId)
    })
    return run
  }
}
