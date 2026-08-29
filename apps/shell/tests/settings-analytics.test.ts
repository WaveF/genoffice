/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

describe('Settings MCP setup', () => {
  it('shows General, MCP, Skills, and About, and copies the local MCP prompt', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    window.aiOffice = {
      getTheme: async () => 'system',
      getDefaultSaveDir: async () => '',
      getAppVersion: async () => '1.0.0',
      getMcpConnectionInfo: async () => ({
        available: true,
        discoveryPath: '/tmp/GenOffice/mcp/bridge.json',
        adapterPath: '/tmp/GenOffice/genoffice-mcp.mjs',
      }),
    } as unknown as HomeApi

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(SettingsModal, { onClose: vi.fn() }),
        ),
      )
      await Promise.resolve()
    })
    const labels = Array.from(host.querySelectorAll('.set-nav-item')).map(
      (node) => node.textContent,
    )
    expect(labels).toEqual(['General', 'MCP', '技能', 'About'])
    await click(
      Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).find(
        (button) => button.textContent === 'MCP',
      )!,
    )
    const copy = Array.from(host.querySelectorAll<HTMLButtonElement>('.set-btn')).find(
      (button) => button.textContent === '复制给 AI 使用',
    )
    expect(copy).toBeDefined()
    await click(copy!)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('media.stage_image'))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/GenOffice/mcp/bridge.json'),
    )
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('不要要求用户提供 documentId'))
    expect(host.querySelector('.set-mcp-prompt')).toBeNull()
    expect(host.querySelector('.set-mcp-status-dot.online')).not.toBeNull()
  })
})
