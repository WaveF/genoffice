import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileMcpAuditLogger } from '../src/main/mcp/audit'

describe('FileMcpAuditLogger', () => {
  it('records metadata only, without document content or arbitrary inputs', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'genoffice-mcp-audit-'))
    const logger = new FileMcpAuditLogger(userDataPath)
    await logger.record({
      at: '2026-08-25T00:00:00.000Z',
      clientId: 'connection-id',
      toolName: 'slides.apply_ops',
      documentId: 'doc-1',
      outcome: 'success',
      mutated: true,
      revision: 2,
    })
    const log = await readFile(join(userDataPath, 'mcp', 'audit.jsonl'), 'utf8')
    expect(log).toContain('slides.apply_ops')
    expect(log).not.toContain('base64')
    expect(log).not.toContain('document content')
  })

  it('rotates an oversized log before appending', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'genoffice-mcp-audit-'))
    const auditDir = join(userDataPath, 'mcp')
    await mkdir(auditDir)
    await writeFile(join(auditDir, 'audit.jsonl'), 'x'.repeat(1024 * 1024))
    await writeFile(join(auditDir, 'audit.jsonl.1'), 'older retained event')
    const logger = new FileMcpAuditLogger(userDataPath)
    await logger.record({ at: 'now', clientId: 'c', toolName: 'ping', outcome: 'success' })
    expect(await readFile(join(auditDir, 'audit.jsonl.1'), 'utf8')).toHaveLength(1024 * 1024)
    expect(await readFile(join(auditDir, 'audit.jsonl.1'), 'utf8')).not.toContain(
      'older retained event',
    )
  })
})
