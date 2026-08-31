import { describe, expect, it } from 'vitest'
import type { DocumentTarget } from '@nexoffice/capabilities'

import { AuthenticatedMcpPermissionGate } from '../src/main/mcp/permissions'

const document: DocumentTarget = {
  documentId: 'doc-1',
  kind: 'slides',
  title: 'Quarterly review',
  revision: 0,
  dirty: false,
  active: true,
  webContentsId: 1,
}

describe('AuthenticatedMcpPermissionGate', () => {
  it('allows every risk level once LocalMcpBridge authenticated the request', async () => {
    const gate = new AuthenticatedMcpPermissionGate()

    await expect(
      gate.authorize({
        clientId: 'bridge-1',
        toolName: 'slides.apply_ops',
        risk: 'write',
        document,
      }),
    ).resolves.toBeUndefined()
    await expect(
      gate.authorize({
        clientId: 'bridge-1',
        toolName: 'slides.delete_slide',
        risk: 'destructive',
        document,
      }),
    ).resolves.toBeUndefined()
    await expect(
      gate.authorize({ clientId: 'bridge-1', toolName: 'save_document', risk: 'file', document }),
    ).resolves.toBeUndefined()
  })
})
