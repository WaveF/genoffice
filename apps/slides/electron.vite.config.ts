import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const here = dirname(fileURLToPath(import.meta.url))

// Pin resolution to this repo's workspace sources (matches tsconfig paths;
// avoids bundling stale implementations when node_modules links point elsewhere)
const workspaceAlias = {
  // harfbuzzjs intentionally exports only its ESM wrapper. The main process needs
  // its low-level CJS factory, so resolve those bundled files explicitly instead
  // of relying on a brittle workspace-relative node_modules path.
  'harfbuzzjs/dist/harfbuzz.js': resolve(here, '../../node_modules/harfbuzzjs/dist/harfbuzz.js'),
  'harfbuzzjs/dist/harfbuzz.wasm': resolve(
    here,
    '../../node_modules/harfbuzzjs/dist/harfbuzz.wasm',
  ),
  // Subpath before the bare name: string aliases are prefix replacements
  '@nexoffice/pptx-engine/table-grid': resolve(
    here,
    '../../packages/pptx-engine/src/table-grid.ts',
  ),
  '@nexoffice/pptx-engine/identity': resolve(here, '../../packages/pptx-engine/src/identity.ts'),
  '@nexoffice/pptx-engine/custgeom': resolve(here, '../../packages/pptx-engine/src/custgeom.ts'),
  '@nexoffice/pptx-engine/background-promote': resolve(
    here,
    '../../packages/pptx-engine/src/background-promote.ts',
  ),
  '@nexoffice/pptx-engine': resolve(here, '../../packages/pptx-engine/src/index.ts'),
  '@nexoffice/pptx-render/preset-geometry': resolve(
    here,
    '../../packages/pptx-render/src/preset-geometry.ts',
  ),
  '@nexoffice/pptx-render': resolve(here, '../../packages/pptx-render/src/index.ts'),
  // Metafile (EMF/WMF) rasterizer shared with the docs engine (renderer-only: needs canvas)
  '@nexoffice/docx-engine/metafile': resolve(here, '../../packages/docx-engine/src/metafile.ts'),
}

export default defineConfig({
  // Main process/preload must bundle @nexoffice/* sources (they are pulled in as TS
  // source with extensionless relative imports; externalizing them under Node
  // yields ERR_MODULE_NOT_FOUND).
  main: {
    resolve: { alias: workspaceAlias },
    // Bundle opentype.js too (the packaged app ships only out/**, so external deps are unresolvable at runtime)
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@nexoffice/pptx-engine',
          '@nexoffice/pptx-render',
          '@nexoffice/ai-search',
          '@nexoffice/file-parse',
          '@nexoffice/electron-utils',
          'opentype.js',
        ],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: { alias: workspaceAlias },
    plugins: [react()],
    server: {
      port: Number(process.env.SLIDES_DEV_PORT) || 5175,
      strictPort: Boolean(process.env.SLIDES_DEV_PORT),
    },
  },
})
