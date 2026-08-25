import { describe, expect, it } from 'vitest'
import { DocumentWriteQueue } from '../src/main/mcp/write-queue'

describe('DocumentWriteQueue', () => {
  it('runs writes for one document in submission order', async () => {
    const queue = new DocumentWriteQueue()
    const order: string[] = []
    let releaseFirst!: () => void
    const first = queue.enqueue('doc-1', new AbortController().signal, async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })
    const second = queue.enqueue('doc-1', new AbortController().signal, () => {
      order.push('second')
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('cancels queued work before it begins', async () => {
    const queue = new DocumentWriteQueue()
    let releaseFirst!: () => void
    const first = queue.enqueue('doc-1', new AbortController().signal, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
    })
    const controller = new AbortController()
    const queued = queue.enqueue('doc-1', controller.signal, () => 'must not run')
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort()
    releaseFirst()
    await first
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' })
  })
})
