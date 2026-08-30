import type { DocumentTarget, ToolRisk } from '@nexoffice/capabilities'

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
 * The LocalMcpBridge validates a fresh, per-application-session secret before
 * it forwards a request to the gateway. The bridge discovery file is limited
 * to the current OS user, so a successfully authenticated bridge request is
 * the authorization boundary for every MCP risk level.
 *
 * This class deliberately has no Electron dialog: MCP clients should be able
 * to perform a sequence of edits without requiring repeated UI interaction.
 */
export class AuthenticatedMcpPermissionGate implements McpPermissionGate {
  async authorize(_request: McpPermissionRequest): Promise<void> {
    // Authentication is enforced by LocalMcpBridge before the gateway is called.
  }
}
