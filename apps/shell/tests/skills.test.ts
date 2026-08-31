import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NexOfficeSkillStore } from '../src/main/skills'

const directories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('NexOfficeSkillStore', () => {
  it('lists built-ins and imports a copied single Markdown file', async () => {
    const root = await temporaryDirectory('nexoffice-skills-')
    const bundled = join(root, 'bundled')
    const imported = join(root, 'community.md')
    await mkdir(bundled, { recursive: true })
    await writeFile(
      join(bundled, 'built-in.md'),
      '---\nid: built-in\nname: Built-in\ndescription: Safe defaults\nappliesTo: [slides]\n---\n\n# Built-in',
      { encoding: 'utf8' },
    )
    await writeFile(
      imported,
      '---\nid: community-guide\nname: Community guide\n---\n\n# Guide',
      'utf8',
    )
    const store = new NexOfficeSkillStore(join(root, 'user'), bundled)

    expect(await store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'built-in', source: 'builtin', enabled: true }),
      ]),
    )
    await store.importFromPath(imported)
    await writeFile(imported, '# Changed after import', 'utf8')

    const importedSkill = await store.read('community-guide')
    expect(importedSkill.summary).toMatchObject({ source: 'custom', enabled: true })
    expect(importedSkill.content).toContain('# Guide')
  })

  it('uses enabled state for MCP visibility and exports the original Markdown', async () => {
    const root = await temporaryDirectory('nexoffice-skills-state-')
    const bundled = join(root, 'bundled')
    const source = join(root, 'source.md')
    const exported = join(root, 'exported.md')
    await mkdir(bundled, { recursive: true })
    await writeFile(
      source,
      '---\nid: portable-guide\nname: Portable guide\n---\n\n# Portable',
      'utf8',
    )
    const store = new NexOfficeSkillStore(join(root, 'user'), bundled)
    await store.importFromPath(source)
    await store.setEnabled('portable-guide', false)

    expect(await store.list(false)).toEqual([])
    await expect(store.read('portable-guide')).rejects.toMatchObject({ code: 'not_found' })
    await store.exportToPath('portable-guide', exported)
    expect(existsSync(exported)).toBe(true)
    expect(await readFile(exported, 'utf8')).toContain('# Portable')
  })

  it('rejects non-Markdown imports before copying them into the managed directory', async () => {
    const root = await temporaryDirectory('nexoffice-skills-invalid-')
    const source = join(root, 'not-a-skill.txt')
    await writeFile(source, 'not markdown', 'utf8')
    const store = new NexOfficeSkillStore(join(root, 'user'), join(root, 'bundled'))

    await expect(store.importFromPath(source)).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('creates a custom skill with an opaque file ID and display name metadata', async () => {
    const root = await temporaryDirectory('nexoffice-skills-create-')
    const userData = join(root, 'user')
    const store = new NexOfficeSkillStore(userData, join(root, 'bundled'))

    const created = await store.create('Webflow 建站助手')

    expect(created).toMatchObject({
      id: expect.stringMatching(/^skill-[a-f0-9-]{36}$/),
      name: 'Webflow 建站助手',
      source: 'custom',
      enabled: true,
    })
    const files = await readdir(join(userData, 'skills'))
    expect(files).toContain(`${created.id}.md`)
    expect(files).not.toContain('state.json')
    await expect(store.read(created.id)).resolves.toMatchObject({
      content: expect.stringContaining('# Webflow 建站助手'),
    })
    await expect(store.create(' Webflow  建站助手 ')).rejects.toMatchObject({
      code: 'validation_error',
    })
    await expect(store.create('bad/name')).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('uses a managed filename as the canonical ID when frontmatter is edited', async () => {
    const root = await temporaryDirectory('nexoffice-skills-canonical-id-')
    const userData = join(root, 'user')
    const skillsDirectory = join(userData, 'skills')
    await mkdir(skillsDirectory, { recursive: true })
    await writeFile(
      join(skillsDirectory, 'stable-id.md'),
      '---\nid: changed-id\nname: Stable name\n---\n\n# Stable name',
      'utf8',
    )
    const store = new NexOfficeSkillStore(userData, join(root, 'bundled'))

    expect(await store.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'stable-id', name: 'Stable name' })]),
    )
    await expect(store.read('changed-id')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('creates and replaces complete MCP skills with content revisions', async () => {
    const root = await temporaryDirectory('nexoffice-skills-mcp-write-')
    const store = new NexOfficeSkillStore(join(root, 'user'), join(root, 'bundled'))
    const initial = '---\nname: "Agent writing guide"\ndescription: Initial\nappliesTo: [markdown]\n---\n\n# Agent writing guide\n'
    const created = await store.createFromMcp('Agent writing guide', initial)

    expect(created.summary).toMatchObject({
      id: expect.stringMatching(/^skill-[a-f0-9-]{36}$/),
      name: 'Agent writing guide',
      enabled: true,
      source: 'custom',
    })
    expect(created.revision).toMatch(/^[a-f0-9]{64}$/)

    const updatedContent = '---\nname: Agent writing guide\ndescription: Updated\nappliesTo: [docs]\n---\n\n# Agent writing guide\n\nUse native operations.\n'
    const updated = await store.replaceContent(created.summary.id, created.revision, updatedContent)
    expect(updated.summary).toMatchObject({ description: 'Updated', appliesTo: ['docs'] })
    expect(updated.revision).not.toBe(created.revision)
    await expect(store.replaceContent(created.summary.id, created.revision, updatedContent)).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(
      store.createFromMcp('Broken skill', '# Broken skill'),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })
})
