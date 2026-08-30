import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

/** One self-contained Node ESM adapter, suitable for npm and app resources. */
export default defineConfig({
  resolve: {
    alias: {
      '@nexoffice/capabilities': resolve(here, '../nexoffice-capabilities/src/index.ts'),
    },
  },
  build: {
    ssr: resolve(here, 'src/cli.ts'),
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'nexoffice-mcp.mjs', format: 'es' },
    },
  },
})
