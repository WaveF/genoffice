import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
})
