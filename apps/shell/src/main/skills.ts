import { randomUUID } from 'node:crypto'
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
  const requestedId = values.get('id')?.trim() ?? ''
  const id = validId(requestedId) ? requestedId : fallbackName
  const name = values.get('name')?.trim() || firstHeading || fallbackName
  const description = values.get('description')?.trim() || ''
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
  ): Promise<{ summary: SkillSummary; content: string }> {
    if (!validId(id)) throw new CapabilityError('validation_error', 'Invalid skill ID')
    const { records } = await this.load()
    const record = records.find(
      (candidate) => candidate.id === id && (includeDisabled || candidate.enabled),
    )
    if (!record) throw new CapabilityError('not_found', 'Skill is unavailable')
    return {
      summary: this.summary(record),
      content: assertMarkdown(await readFile(record.path), record.name),
    }
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

  private summary(record: SkillRecord): SkillSummary {
    const { path: _path, ...summary } = record
    return summary
  }
}
