import { useCallback, useEffect, useState } from 'react'

import { BUILTIN_FONT_FAMILIES } from './font-list'

let cached: readonly string[] = []
let pending: Promise<readonly string[]> | null = null

function normalize(families: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  return families.filter((family) => {
    const key = family.normalize('NFKC').toLocaleLowerCase()
    if (!family || BUILTIN_FONT_FAMILIES.includes(family) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readCatalog(): Promise<readonly string[]> {
  try {
    const snapshot = await window.desktop.getSystemFontCatalog()
    cached = normalize(snapshot.families)
  } catch {
    // Standalone editor builds do not host the Shell catalog service.
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
    const subscribe = window.desktop?.onSystemFontCatalogUpdated
    if (!subscribe) return
    return subscribe((snapshot) => {
      cached = normalize(snapshot.families)
      setFamilies(cached)
    })
  }, [])
  return { families, load }
}
