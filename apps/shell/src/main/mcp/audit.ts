import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MAX_AUDIT_BYTES = 1024 * 1024

export interface McpAuditEvent {
  at: string
  clientId: string
  toolName: string
  documentId?: string
  outcome: 'success' | 'error'
  mutated?: boolean
  revision?: number
  errorCode?: string
}

export interface McpAuditLogger {
  record(event: McpAuditEvent): Promise<void>
}

/** JSONL audit trail deliberately excludes tool arguments and generated document content. */
export class FileMcpAuditLogger implements McpAuditLogger {
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'mcp', 'audit.jsonl')
  }

  async record(event: McpAuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try {
      if ((await stat(this.path)).size >= MAX_AUDIT_BYTES) {
        await rename(this.path, `${this.path}.1`)
      }
    } catch {
      // A missing log is created by appendFile; audit availability must not block editing.
    }
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}
