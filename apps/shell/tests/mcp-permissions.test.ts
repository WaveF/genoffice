import { describe, expect, it, vi } from 'vitest'
import type { DocumentTarget } from '@genoffice/capabilities'

const showMessageBox = vi.fn()
vi.mock('electron', () => ({ dialog: { showMessageBox } }))

import { SessionMcpPermissionGate } from '../src/main/mcp/permissions'

const document: DocumentTarget = {
  documentId: 'doc-1',
  kind: 'slides',
  title: 'Quarterly review',
  revision: 0,
  dirty: false,
  active: true,
  webContentsId: 1,
}

describe('SessionMcpPermissionGate', () => {
  it('caches an accepted write grant only for the same bridge connection and document', async () => {
    showMessageBox.mockResolvedValue({ response: 1 })
    const gate = new SessionMcpPermissionGate()
    const request = { clientId: 'bridge-1', toolName: 'slides.apply_ops', risk: 'write' as const, document }

    await gate.authorize(request)
    await gate.authorize(request)
    await gate.authorize({ ...request, clientId: 'bridge-2' })

    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('rejects a denied operation without granting it', async () => {
    showMessageBox.mockResolvedValue({ response: 0 })
    const gate = new SessionMcpPermissionGate()
    await expect(
      gate.authorize({ clientId: 'bridge-1', toolName: 'slides.apply_ops', risk: 'write', document }),
    ).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('always asks again for destructive operations', async () => {
    showMessageBox.mockClear()
    showMessageBox.mockResolvedValue({ response: 1 })
    const gate = new SessionMcpPermissionGate()
    const request = { clientId: 'bridge-1', toolName: 'slides.apply_ops', risk: 'destructive' as const, document }
    await gate.authorize(request)
    await gate.authorize(request)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })
})
