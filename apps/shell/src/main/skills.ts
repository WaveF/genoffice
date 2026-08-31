import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { CapabilityError } from '@nexoffice/capabilities'

const MAX_SKILL_BYTES = 256 * 1024
const MAX_SKILLS = 100
const USER_SKILLS_DIRECTORY = 'skills'
const STATE_FILENAME = 'skills-state.json'
const LEGACY_STATE_FILENAME = 'state.json'

export type SkillSource = 'builtin' | 'custom'

export interface SkillSummary {
  id: string
  name: string
  description: string
  appliesTo: string[]
  source: SkillSource
  enabled: boolean
}

interface SkillRecord extends SkillSummary {
  path: string
}

export interface SkillContent {
  summary: SkillSummary
  content: string
  revision: string
}

interface SkillState {
  version: 1
  disabled: string[]
}

function validId(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value)
}

function normalizedLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function stringList(value: string): string[] {
  const bracketed = value.match(/^\[(.*)]$/)
  if (bracketed)
    return bracketed[1]!
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  return value ? [value.trim()] : []
}

function scalarValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

function metadata(source: string, fallbackName: string): Omit<SkillSummary, 'source' | 'enabled'> {
  const text = normalizedLineEndings(source)
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const values = new Map<string, string>()
  if (frontmatter) {
    for (const line of frontmatter[1]!.split('\n')) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
      if (match) values.set(match[1]!.toLowerCase(), match[2]!)
    }
  }
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const requestedId = scalarValue(values.get('id') ?? '')
  const id = validId(requestedId) ? requestedId : fallbackName
  const name = scalarValue(values.get('name') ?? '') || firstHeading || fallbackName
  const description = scalarValue(values.get('description') ?? '') || ''
  return {
    id,
    name: name.slice(0, 120),
    description: description.slice(0, 280),
    appliesTo: stringList(values.get('appliesto') ?? '').slice(0, 12),
  }
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function validateNewSkillName(value: string): string {
  const name = normalizedName(value)
  if (!name) throw new CapabilityError('validation_error', 'Skill name is required')
  if (name.length > 120) throw new CapabilityError('validation_error', 'Skill name must be 120 characters or fewer')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name))
    throw new CapabilityError('validation_error', 'Skill name contains unsupported characters')
  return name
}

function skillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: \nappliesTo: []\n---\n\n# ${name}\n\n## 何时使用\n\n<!-- 待补充：说明 AI 在何种任务中应读取此技能。 -->\n\n## 操作步骤\n\n<!-- 待补充：给出清晰、可执行的步骤。 -->\n\n## 注意事项\n\n<!-- 待补充：记录限制、安全边界或验证要求。 -->\n`
}

function revisionFor(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function declaredFrontmatterName(content: string): string | null {
  const frontmatter = normalizedLineEndings(content).match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const match = frontmatter?.[1].match(/^name:\s*(.*?)\s*$/m)
  return match?.[1] ? scalarValue(match[1]) || null : null
}

function assertMarkdown(source: Buffer, displayName: string): string {
  if (source.byteLength === 0 || source.byteLength > MAX_SKILL_BYTES)
    throw new CapabilityError(
      'validation_error',
      `${displayName} must be between 1 and ${MAX_SKILL_BYTES} bytes`,
    )
  const text = source.toString('utf8')
  if (Buffer.compare(Buffer.from(text, 'utf8'), source) !== 0)
    throw new CapabilityError('validation_error', `${displayName} must be UTF-8 text`)
  return text
}

/**
 * Owns single-file Markdown skills. Imported files are copied into userData;
 * neither the renderer nor MCP clients receive the directory or source path.
 */
export class NexOfficeSkillStore {
  private readonly userDirectory: string
  private readonly statePath: string
  private readonly legacyStatePath: string
  private readonly changeListeners = new Set<() => void>()

  constructor(
    userDataPath: string,
    private readonly bundledDirectory: string,
  ) {
    this.userDirectory = join(userDataPath, USER_SKILLS_DIRECTORY)
    this.statePath = join(userDataPath, STATE_FILENAME)
    this.legacyStatePath = join(this.userDirectory, LEGACY_STATE_FILENAME)
  }

  async list(includeDisabled = true): Promise<SkillSummary[]> {
    const { records } = await this.load()
    return records
      .filter((record) => includeDisabled || record.enabled)
      .map(({ path: _path, ...summary }) => summary)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async read(
    id: string,
    includeDisabled = false,
  ): Promise<SkillContent> {
    if (!validId(id)) throw new CapabilityError('validation_error', 'Invalid skill ID')
    const { records } = await this.load()
    const record = records.find(
      (candidate) => candidate.id === id && (includeDisabled || candidate.enabled),
    )
    if (!record) throw new CapabilityError('not_found', 'Skill is unavailable')
    const content = assertMarkdown(await readFile(record.path), record.name)
    return { summary: this.summary(record), content, revision: revisionFor(content) }
  }

  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  async importFromPath(sourcePath: string): Promise<SkillSummary> {
    if (extname(sourcePath).toLowerCase() !== '.md')
      throw new CapabilityError('validation_error', 'Only .md skill files can be imported')
    const info = await lstat(sourcePath).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink())
      throw new CapabilityError('validation_error', 'Skill import must be a regular Markdown file')
    const content = assertMarkdown(await readFile(sourcePath), basename(sourcePath))
    const fallback = `skill-${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const parsed = metadata(content, fallback)
    const { records, state } = await this.load()
    if (records.length >= MAX_SKILLS)
      throw new CapabilityError('validation_error', `A maximum of ${MAX_SKILLS} skills is allowed`)
    if (records.some((record) => record.id === parsed.id))
      throw new CapabilityError('validation_error', 'A skill with this ID already exists')
    await this.ensureUserDirectory()
    const destination = join(this.userDirectory, `${parsed.id}.md`)
    await copyFile(sourcePath, destination)
    const next: SkillRecord = {
      ...parsed,
      source: 'custom',
      enabled: !state.disabled.includes(parsed.id),
      path: destination,
    }
    this.notifyChanged()
    return this.summary(next)
  }

  /** Creates a locally managed skill whose opaque ID is derived from its file name. */
  async create(nameInput: string): Promise<SkillSummary> {
    const name = validateNewSkillName(nameInput)
    const { records, state } = await this.load()
    if (records.length >= MAX_SKILLS)
      throw new CapabilityError('validation_error', `A maximum of ${MAX_SKILLS} skills is allowed`)
    if (records.some((record) => normalizedName(record.name).toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new CapabilityError('validation_error', 'A skill with this name already exists')

    const id = `skill-${randomUUID()}`
    const path = join(this.userDirectory, `${id}.md`)
    await this.ensureUserDirectory()
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, skillTemplate(name), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, path)
    this.notifyChanged()
    return this.summary({
      id,
      name,
      description: '',
      appliesTo: [],
      source: 'custom',
      enabled: !state.disabled.includes(id),
      path,
    })
  }

  /** Returns the managed custom file without disclosing user-data paths to renderer callers. */
  async customPath(id: string): Promise<string> {
    if (!validId(id)) throw new CapabilityError('validation_error', 'Invalid skill ID')
    const { records } = await this.load()
    const record = records.find((candidate) => candidate.id === id)
    if (!record || record.source !== 'custom')
      throw new CapabilityError('validation_error', 'Only custom skills can be edited')
    return record.path
  }

  async ensureUserDirectory(): Promise<string> {
    await mkdir(this.userDirectory, { recursive: true, mode: 0o700 })
    const legacyState = await readFile(this.legacyStatePath).catch(() => null)
    if (legacyState) {
      const currentState = await readFile(this.statePath).catch(() => null)
      if (!currentState) await writeFile(this.statePath, legacyState, { mode: 0o600 })
      await rm(this.legacyStatePath, { force: true })
    }
    return this.userDirectory
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!validId(id)) throw new CapabilityError('validation_error', 'Invalid skill ID')
    const { records, state } = await this.load()
    if (!records.some((record) => record.id === id))
      throw new CapabilityError('not_found', 'Skill is unavailable')
    const disabled = new Set(state.disabled)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    await this.writeState({ version: 1, disabled: [...disabled].sort() })
    this.notifyChanged()
  }

  async remove(id: string): Promise<void> {
    const { records } = await this.load()
    const record = records.find((candidate) => candidate.id === id)
    if (!record) throw new CapabilityError('not_found', 'Skill is unavailable')
    if (record.source !== 'custom')
      throw new CapabilityError('validation_error', 'Built-in skills cannot be deleted')
    await rm(record.path, { force: true })
    const { state } = await this.load()
    await this.writeState({
      version: 1,
      disabled: state.disabled.filter((candidate) => candidate !== id),
    })
    this.notifyChanged()
  }

  /** Creates an enabled custom skill from complete MCP-provided Markdown. */
  async createFromMcp(nameInput: string, contentInput: string): Promise<SkillContent> {
    const name = validateNewSkillName(nameInput)
    const content = this.validateMcpContent(contentInput, name)
    const { records, state } = await this.load()
    if (records.length >= MAX_SKILLS)
      throw new CapabilityError('validation_error', `A maximum of ${MAX_SKILLS} skills is allowed`)
    this.assertAvailableName(records, name)
    const id = `skill-${randomUUID()}`
    const path = join(this.userDirectory, `${id}.md`)
    await this.ensureUserDirectory()
    await this.writeContent(path, content)
    const summary: SkillSummary = {
      id,
      name,
      description: metadata(content, id).description,
      appliesTo: metadata(content, id).appliesTo,
      source: 'custom',
      enabled: !state.disabled.includes(id),
    }
    this.notifyChanged()
    return { summary, content, revision: revisionFor(content) }
  }

  /** Replaces one custom skill only when the caller's content revision still matches. */
  async replaceContent(
    id: string,
    expectedRevision: string,
    contentInput: string,
  ): Promise<SkillContent> {
    if (!validId(id)) throw new CapabilityError('validation_error', 'Invalid skill ID')
    if (!/^[a-f0-9]{64}$/.test(expectedRevision))
      throw new CapabilityError('validation_error', 'expectedRevision must be a SHA-256 revision')
    const { records } = await this.load()
    const record = records.find((candidate) => candidate.id === id)
    if (!record || record.source !== 'custom')
      throw new CapabilityError('not_found', 'Custom skill is unavailable')
    const current = assertMarkdown(await readFile(record.path), record.name)
    if (revisionFor(current) !== expectedRevision)
      throw new CapabilityError('conflict', 'Skill changed; read it again before replacing content')
    const candidate = this.validateMcpContent(contentInput)
    const parsed = metadata(candidate, id)
    const name = validateNewSkillName(parsed.name)
    this.assertAvailableName(records.filter((item) => item.id !== id), name)
    await this.writeContent(record.path, candidate)
    const summary: SkillSummary = {
      id,
      name,
      description: parsed.description,
      appliesTo: parsed.appliesTo,
      source: 'custom',
      enabled: record.enabled,
    }
    this.notifyChanged()
    return { summary, content: candidate, revision: revisionFor(candidate) }
  }

  async exportToPath(id: string, destination: string): Promise<void> {
    const { content } = await this.read(id, true)
    const temp = `${destination}.${randomUUID()}.tmp`
    await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, destination)
  }

  private async load(): Promise<{ records: SkillRecord[]; state: SkillState }> {
    const state = await this.readState()
    const disabled = new Set(state.disabled)
    const records = [
      ...(await this.loadDirectory(this.bundledDirectory, 'builtin', disabled)),
      ...(await this.loadDirectory(this.userDirectory, 'custom', disabled)),
    ]
    const ids = new Set<string>()
    return { records: records.filter((record) => !ids.has(record.id) && ids.add(record.id)), state }
  }

  private async loadDirectory(
    directory: string,
    source: SkillSource,
    disabled: Set<string>,
  ): Promise<SkillRecord[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const records: SkillRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || extname(entry.name).toLowerCase() !== '.md')
        continue
      const fallback = entry.name
        .slice(0, -3)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
      if (!validId(fallback)) continue
      try {
        const path = join(directory, entry.name)
        const parsed = metadata(assertMarkdown(await readFile(path), entry.name), fallback)
        // The managed filename is canonical. Frontmatter is user-editable and must not
        // be allowed to silently change the opaque ID exposed to MCP clients.
        records.push({ ...parsed, id: fallback, source, enabled: !disabled.has(fallback), path })
      } catch {
        // One malformed optional skill must never prevent NexOffice from starting.
      }
    }
    return records
  }

  private async readState(): Promise<SkillState> {
    for (const path of [this.statePath, this.legacyStatePath]) {
      try {
        const value = JSON.parse(await readFile(path, 'utf8')) as Partial<SkillState>
        if (value.version === 1 && Array.isArray(value.disabled))
          return {
            version: 1,
            disabled: value.disabled.filter(
              (id): id is string => typeof id === 'string' && validId(id),
            ),
          }
      } catch {}
    }
    return { version: 1, disabled: [] }
  }

  private async writeState(state: SkillState): Promise<void> {
    await mkdir(this.userDirectory, { recursive: true, mode: 0o700 })
    const temp = `${this.statePath}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.statePath)
  }

  private assertAvailableName(records: SkillRecord[], name: string): void {
    if (records.some((record) => normalizedName(record.name).toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new CapabilityError('validation_error', 'A skill with this name already exists')
  }

  private validateMcpContent(contentInput: string, expectedName?: string): string {
    if (typeof contentInput !== 'string')
      throw new CapabilityError('validation_error', 'content must be a UTF-8 Markdown string')
    const content = assertMarkdown(Buffer.from(contentInput, 'utf8'), expectedName ?? 'skill')
    const declaredName = declaredFrontmatterName(content)
    if (!declaredName)
      throw new CapabilityError('validation_error', 'content must include a frontmatter name')
    const parsedName = validateNewSkillName(declaredName)
    if (expectedName && parsedName !== expectedName)
      throw new CapabilityError('validation_error', 'content frontmatter name must match name')
    return content
  }

  private async writeContent(path: string, content: string): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, path)
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) listener()
  }

  private summary(record: SkillRecord): SkillSummary {
    const { path: _path, ...summary } = record
    return summary
  }
}
