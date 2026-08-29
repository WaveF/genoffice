import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'

export const FONT_CATALOG_CHANNELS = {
  get: 'font-catalog:get',
  refresh: 'font-catalog:refresh',
  updated: 'font-catalog:updated',
} as const

const CACHE_VERSION = 1
const CACHE_MAX_BYTES = 512 * 1024
const CACHE_MAX_FAMILIES = 4096
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type FontCatalogSource = 'cache' | 'scan' | 'none'
export type FontCatalogState = 'ready' | 'loading' | 'unavailable'

export interface FontCatalogSnapshot {
  readonly families: readonly string[]
  /** normalized alternate family label -> canonical display family */
  readonly aliases: Readonly<Record<string, string>>
  readonly source: FontCatalogSource
  readonly state: FontCatalogState
  readonly stale: boolean
  readonly refreshedAt: number | null
}

interface CacheFile {
  readonly version: number
  readonly refreshedAt: number
  readonly families: string[]
  readonly aliases: Record<string, string>
}

export interface FontCatalogEntry {
  readonly family: string
  readonly aliases?: readonly string[]
}

export interface FontCatalogWorker {
  enumerate(): Promise<readonly FontCatalogEntry[]>
}

export class ThreadedFontCatalogWorker implements FontCatalogWorker {
  constructor(private readonly workerPath: string) {}

  enumerate(): Promise<readonly FontCatalogEntry[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerPath)
      worker.once('message', (message: unknown) => {
        void worker.terminate()
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { ok?: unknown }).ok === true &&
          Array.isArray((message as { entries?: unknown }).entries)
        ) {
          resolve(
            (message as { entries: unknown[] }).entries.flatMap((entry) =>
              typeof entry === 'object' && entry !== null && isFamilyName((entry as FontCatalogEntry).family)
                ? [{ family: (entry as FontCatalogEntry).family, aliases: Array.isArray((entry as FontCatalogEntry).aliases) ? (entry as FontCatalogEntry).aliases?.filter(isFamilyName) : [] }]
                : [],
            ),
          )
          return
        }
        reject(new Error('Font catalog worker returned an invalid response.'))
      })
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`Font catalog worker exited with code ${code}.`))
      })
    })
  }
}

function isFamilyName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function normalizeEntries(values: readonly FontCatalogEntry[]): { families: string[]; aliases: Record<string, string> } {
  const seen = new Set<string>()
  const canonicalByKey = new Map<string, string>()
  const families: string[] = []
  const aliases: Record<string, string> = {}
  for (const value of values) {
    const family = value.family.trim()
    const key = family.normalize('NFKC').toLocaleLowerCase()
    if (!isFamilyName(family) || !key) continue
    const canonical = canonicalByKey.get(key) ?? family
    if (!seen.has(key)) {
      seen.add(key)
      canonicalByKey.set(key, canonical)
      families.push(canonical)
    }
    for (const alias of value.aliases ?? []) {
      const aliasKey = alias.trim().normalize('NFKC').toLocaleLowerCase()
      if (isFamilyName(alias) && aliasKey && aliasKey !== key) aliases[aliasKey] = canonical
    }
    if (families.length === CACHE_MAX_FAMILIES) break
  }
  return { families: families.sort((a, b) => a.localeCompare(b)), aliases }
}

function parseCache(input: unknown): CacheFile | null {
  if (typeof input !== 'object' || input === null) return null
  const value = input as Partial<CacheFile>
  if (
    value.version !== CACHE_VERSION ||
    !Number.isSafeInteger(value.refreshedAt) ||
    !Array.isArray(value.families) ||
    value.families.length > CACHE_MAX_FAMILIES ||
    !value.families.every(isFamilyName)
  )
    return null
  return {
    version: CACHE_VERSION,
    refreshedAt: value.refreshedAt as number,
    families: normalizeEntries((value.families as string[]).map((family) => ({ family }))).families,
    aliases: typeof value.aliases === 'object' && value.aliases !== null ? value.aliases as Record<string, string> : {},
  }
}

/** Shell-owned, path-free font family cache. Enumeration is always delegated to a worker. */
export class FontCatalogService {
  private snapshot: FontCatalogSnapshot = {
    families: [],
    aliases: {},
    source: 'none',
    state: 'loading',
    stale: true,
    refreshedAt: null,
  }
  private loadPromise: Promise<void> | null = null
  private refreshPromise: Promise<FontCatalogSnapshot> | null = null

  constructor(
    private readonly cachePath: string,
    private readonly worker: FontCatalogWorker,
    private readonly now: () => number = Date.now,
    private readonly onUpdated?: (snapshot: FontCatalogSnapshot) => void,
  ) {}

  async getSnapshot(): Promise<FontCatalogSnapshot> {
    await this.loadCache()
    return this.snapshot
  }

  /** Starts one background scan. A cache is returned to renderers before it completes. */
  refresh(): Promise<FontCatalogSnapshot> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async loadCache(): Promise<void> {
    this.loadPromise ??= this.doLoadCache()
    await this.loadPromise
  }

  private async doLoadCache(): Promise<void> {
    try {
      const info = await stat(this.cachePath)
      if (info.size > CACHE_MAX_BYTES) throw new Error('Font catalog cache is too large.')
      const cache = parseCache(JSON.parse(await readFile(this.cachePath, 'utf8')))
      if (!cache) return
      this.snapshot = {
        families: cache.families,
        aliases: cache.aliases,
        source: 'cache',
        state: 'ready',
        stale: this.now() - cache.refreshedAt > CACHE_TTL_MS,
        refreshedAt: cache.refreshedAt,
      }
    } catch {
      // A missing/corrupt cache is equivalent to a cold start; never block editing.
    }
  }

  private async doRefresh(): Promise<FontCatalogSnapshot> {
    await this.loadCache()
    this.snapshot = { ...this.snapshot, state: 'loading' }
    this.publish()
    try {
      const refreshedAt = this.now()
      const catalog = normalizeEntries(await this.worker.enumerate())
      const cache: CacheFile = { version: CACHE_VERSION, refreshedAt, ...catalog }
      await this.writeCache(cache)
      this.snapshot = { ...catalog, source: 'scan', state: 'ready', stale: false, refreshedAt }
    } catch {
      this.snapshot = {
        ...this.snapshot,
        state: this.snapshot.families.length > 0 ? 'ready' : 'unavailable',
        stale: true,
      }
    }
    this.publish()
    return this.snapshot
  }

  private async writeCache(cache: CacheFile): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const tempPath = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, this.cachePath)
  }

  private publish(): void {
    this.onUpdated?.(this.snapshot)
  }
}

export const fontCatalogCachePath = (userDataPath: string) => join(userDataPath, 'font-catalog-v1.json')
