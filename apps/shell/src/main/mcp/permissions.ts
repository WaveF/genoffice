import { dialog } from 'electron'
import { CapabilityError, type DocumentTarget, type ToolRisk } from '@genoffice/capabilities'

export interface McpPermissionRequest {
  clientId: string
  toolName: string
  risk: ToolRisk
  document: DocumentTarget
}

export interface McpPermissionGate {
  authorize(request: McpPermissionRequest): Promise<void>
}

/**
 * Main-process, connection-scoped consent for MCP mutations. Read tools skip
 * this gate. A new bridge connection asks again, even when it reports the
 * same MCP client name.
 */
export class SessionMcpPermissionGate implements McpPermissionGate {
  private readonly writeGrants = new Set<string>()

  async authorize(request: McpPermissionRequest): Promise<void> {
    if (request.risk === 'read') return
    const key = `${request.clientId}:${request.document.documentId}`
    if (request.risk === 'write' && this.writeGrants.has(key)) return
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Deny', request.risk === 'write' ? 'Allow for this session' : 'Allow once'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'Allow an external AI to modify this document?',
      detail: `${request.toolName} requests ${request.risk} access to “${request.document.title}”.`,
    })
    if (result.response !== 1) {
      throw new CapabilityError('permission_denied', 'User did not allow this MCP operation')
    }
    if (request.risk === 'write') this.writeGrants.add(key)
  }
}
