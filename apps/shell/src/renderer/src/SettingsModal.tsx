import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from '@genoffice/ui'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type { McpConnectionInfo, SkillContent, SkillSummary, UiTheme } from '../../shared/home-api'
import './settings.css'

const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

type SectionId = 'general' | 'mcp' | 'skills' | 'about'
const SECTIONS: readonly { id: SectionId; label?: string; labelKey?: StringKey }[] = [
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: '技能' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'general')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  if (id === 'mcp')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="2.2"
          y="3"
          width="11.6"
          height="10"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="m5.4 6.3-1.5 1.7 1.5 1.7M10.6 6.3l1.5 1.7-1.5 1.7M6.9 10.3l2.2-4.6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  if (id === 'skills')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 3.4h6.5a2 2 0 0 1 2 2v7.2H5a2 2 0 0 0-2 .9V3.4Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M5.2 6.2h4.2M5.2 8.6h3.2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

function connectionPrompt(info: McpConnectionInfo): string {
  const adapter = info.adapterPath
    ? `node "${info.adapterPath}" --discovery "${info.discoveryPath}"`
    : `genoffice-mcp --discovery "${info.discoveryPath}"`
  return `请连接正在运行的 GenOffice 本地 MCP，并只操作其明确公开的工具。\n\n1. 使用以下 stdio 命令配置 MCP：\n${adapter}\n\n2. discovery 文件：${info.discoveryPath}\n其中包含本机会话 token；不要在回复、日志或仓库中泄露、复制或提交它。\n\n3. 连接后先调用 tools/list，以实时 schema 为准。不要要求用户提供 documentId：先调用 list_open_documents，根据用户所说的文档标题或当前上下文选择目标；若用户要求新建，直接调用 create_document(kind)。若有多个候选且无法判断，向用户展示标题/类型并请其选择，不要展示或索要 documentId。\n\n4. 复杂任务开始前，调用 skills.list，并按任务类型读取适用的 skills.read(skillId) 指导；技能仅是操作建议，不会授予额外文件、网络或写入权限。\n\n5. 除 create_document、media.stage_image 和 activate_document 等例外外，文档写操作必须携带 documentId 和 expectedRevision；发生 conflict 时先重新读取再重试。\n\n6. 编写完整结构化 Markdown 时，优先调用 markdown.set_source，以 source 传入整篇 Markdown；它会解析标题、列表、引用、表格和任务列表，并整体覆盖文档。markdown.insert_content 只追加字面文本，传入 # 标题 不会创建标题。\n\n7. Markdown 插图：先把 PNG/JPEG/GIF 写入 discovery 中的 mediaImportDirectory，再调用 media.stage_image，然后用返回的 mediaHandle 调用 markdown.insert_image。不要传任意路径、URL、base64 或图片 bytes；不要把 mediaImportDirectory 写入共享日志或云端记忆。`
}

export function SettingsModal({ onClose }: { onClose: () => void; [key: string]: unknown }) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>('general')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [saveDir, setSaveDir] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [mcp, setMcp] = useState<McpConnectionInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillContent | null>(null)
  const prompt = useMemo(() => (mcp ? connectionPrompt(mcp) : ''), [mcp])

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((value) => alive && setTheme(value))
    void window.aiOffice.getDefaultSaveDir?.().then((value) => alive && value && setSaveDir(value))
    void window.aiOffice.getAppVersion?.().then((value) => alive && value && setAppVersion(value))
    void window.aiOffice.getMcpConnectionInfo?.().then((value) => alive && setMcp(value))
    void window.aiOffice.listSkills?.().then((value) => alive && setSkills(value))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }
  const copyPrompt = () =>
    void navigator.clipboard
      .writeText(prompt)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  const refreshSkills = () =>
    void window.aiOffice.listSkills?.().then((value) => setSkills(value ?? []))
  const selectSkill = (id: string) =>
    void window.aiOffice.readSkill?.(id).then((value) => setSelectedSkill(value ?? null))
  const importSkill = () =>
    void window.aiOffice.importSkill?.().then((value) => {
      if (!value) return
      refreshSkills()
      selectSkill(value.id)
    })
  const setSkillEnabled = (skill: SkillSummary, enabled: boolean) =>
    void window.aiOffice.setSkillEnabled?.(skill.id, enabled).then(() => {
      setSkills((current) =>
        current.map((item) => (item.id === skill.id ? { ...item, enabled } : item)),
      )
      setSelectedSkill((current) =>
        current?.summary.id === skill.id
          ? { ...current, summary: { ...current.summary, enabled } }
          : current,
      )
    })
  const deleteSkill = (skill: SkillSummary) =>
    void window.aiOffice.deleteSkill?.(skill.id).then(() => {
      setSkills((current) => current.filter((item) => item.id !== skill.id))
      setSelectedSkill((current) => (current?.summary.id === skill.id ? null : current))
    })

  return (
    <div
      className="set-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            ×
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                className={`set-nav-item${section === item.id ? ' active' : ''}`}
                aria-current={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <SectionIcon id={item.id} />
                {item.labelKey ? t(item.labelKey) : item.label}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('language')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                    onPick={(value) => setLang(value as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('theme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((item) => ({
                      value: item.value,
                      label: t(item.labelKey),
                    }))}
                    onPick={(value) => applyTheme(value as UiTheme)}
                  />
                </div>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button
                      className="set-btn"
                      onClick={() =>
                        void window.aiOffice
                          .pickDefaultSaveDir?.()
                          .then((value) => value && setSaveDir(value))
                      }
                    >
                      {t('setChange')}
                    </button>
                  }
                />
              </>
            )}
            {section === 'mcp' && (
              <>
                <h3 className="set-pane-title">MCP</h3>
                <Field
                  label="连接状态"
                  value={mcp?.available ? '本地 bridge 已运行' : '本地 bridge 未运行'}
                  action={
                    <span
                      className={`set-mcp-status-dot${mcp?.available ? ' online' : ''}`}
                      aria-label={mcp?.available ? '运行中' : '未运行'}
                    />
                  }
                />
                <div className="set-mcp-actions">
                  <button
                    className="set-btn primary"
                    disabled={!mcp?.available}
                    onClick={copyPrompt}
                  >
                    {copied ? '已复制' : '复制给 AI 使用'}
                  </button>
                </div>
                <textarea
                  className="set-mcp-prompt"
                  aria-label="MCP 连接提示词"
                  value={prompt}
                  readOnly
                  spellCheck={false}
                  rows={12}
                />
              </>
            )}
            {section === 'skills' && (
              <>
                <div className="set-skills-head">
                  <div>
                    <h3 className="set-pane-title">技能</h3>
                    <p className="set-skills-desc">供已连接 AI 阅读的 Markdown 操作指导。</p>
                  </div>
                  <button className="set-btn primary" onClick={importSkill}>
                    导入
                  </button>
                </div>
                <div className="set-skills-list">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      className={`set-skill${selectedSkill?.summary.id === skill.id ? ' selected' : ''}`}
                    >
                      <button className="set-skill-main" onClick={() => selectSkill(skill.id)}>
                        <span className="set-skill-name">{skill.name}</span>
                        <span className="set-skill-meta">
                          {skill.source === 'builtin' ? '内置' : '自定义'}
                          {skill.appliesTo.length ? ` · ${skill.appliesTo.join(', ')}` : ''}
                        </span>
                        {skill.description && (
                          <span className="set-skill-description">{skill.description}</span>
                        )}
                      </button>
                      <div className="set-skill-actions">
                        <button
                          className="set-switch"
                          role="switch"
                          aria-checked={skill.enabled}
                          aria-label={`${skill.name} 已启用`}
                          onClick={() => setSkillEnabled(skill, !skill.enabled)}
                        />
                        <button
                          className="set-btn"
                          onClick={() => void window.aiOffice.exportSkill?.(skill.id)}
                        >
                          导出
                        </button>
                        {skill.source === 'custom' && (
                          <button className="set-btn danger" onClick={() => deleteSkill(skill)}>
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {skills.length === 0 && <p className="set-skills-empty">没有可用技能。</p>}
                </div>
                {selectedSkill && (
                  <div className="set-skill-preview">
                    <div className="set-skill-preview-title">{selectedSkill.summary.name}</div>
                    <pre>{selectedSkill.content}</pre>
                  </div>
                )}
              </>
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                <Field label={t('updateChannel')} value="不可用（此构建未配置更新源）" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
