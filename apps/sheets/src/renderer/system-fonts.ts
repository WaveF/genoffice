import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_FONT_FAMILIES: readonly string[] = [
  'Aptos',
  'Arial',
  'Calibri',
  'Times New Roman',
  '微软雅黑',
  '宋体',
]

let cached: readonly string[] = []
let pending: Promise<readonly string[]> | null = null

function normalize(families: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  return families.filter((family) => {
    const key = family.normalize('NFKC').toLocaleLowerCase()
    if (!family || DEFAULT_FONT_FAMILIES.includes(family) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readCatalog(): Promise<readonly string[]> {
  try {
    const snapshot = await window.desktopApi.getSystemFontCatalog()
    cached = normalize(snapshot.families)
  } catch {
    cached = []
  }
  return cached
}

function loadSystemFontFamilies(): Promise<readonly string[]> {
  pending ??= readCatalog().finally(() => {
    pending = null
  })
  return pending
}

/** Shell-cached system family names. The renderer never scans local fonts directly. */
export function useSystemFontFamilies(): {
  readonly families: readonly string[]
  readonly load: () => void
} {
  const [families, setFamilies] = useState<readonly string[]>(cached)
  const load = useCallback(() => {
    void loadSystemFontFamilies().then(setFamilies)
  }, [])
  useEffect(() => {
    const subscribe = window.desktopApi?.onSystemFontCatalogUpdated
    if (!subscribe) return
    return subscribe((snapshot) => {
      cached = normalize(snapshot.families)
      setFamilies(cached)
    })
  }, [])
  return { families, load }
}

/// The echoed value stays listed even when uninstalled (document echo).
export function fontFamilyGroups(
  systemFamilies: readonly string[],
  echoFamily: string | null | undefined,
): { readonly common: readonly string[]; readonly system: readonly string[] } {
  const known =
    !echoFamily || DEFAULT_FONT_FAMILIES.includes(echoFamily) || systemFamilies.includes(echoFamily)
  return {
    common: known ? DEFAULT_FONT_FAMILIES : [echoFamily, ...DEFAULT_FONT_FAMILIES],
    system: systemFamilies,
  }
}
