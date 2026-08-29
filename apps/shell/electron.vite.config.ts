import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  // Bundle everything into the shell main (same policy as apps/docs): the
  // imported docs/sheets main modules are TS source with no build artifacts,
  // so externalizing them would break Node ESM resolution at runtime.
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'font-catalog-worker': resolve(__dirname, 'src/main/font-catalog-worker.ts'),
        },
      },
    },
    // Shell bundles the Slides main-process bridge. Preserve its low-level
    // HarfBuzz factory and wasm imports without relying on package deep exports.
    resolve: {
      alias: {
        'harfbuzzjs/dist/harfbuzz.js': resolve(
          __dirname,
          '../../node_modules/harfbuzzjs/dist/harfbuzz.js',
        ),
        'harfbuzzjs/dist/harfbuzz.wasm': resolve(
          __dirname,
          '../../node_modules/harfbuzzjs/dist/harfbuzz.wasm',
        ),
        'harfbuzzjs/dist/harfbuzz.wasm?url': `${resolve(
          __dirname,
          '../../node_modules/harfbuzzjs/dist/harfbuzz.wasm',
        )}?url`,
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // dedicated preload for the auto-update window
          update: resolve(__dirname, 'src/preload/update.ts'),
          // dedicated preload for the PDF password prompt window
          'pdf-password': resolve(__dirname, 'src/preload/pdf-password.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // strong-guidance update window (see src/main/update-window.ts)
          update: resolve(__dirname, 'src/renderer/update.html'),
          // PDF password prompt window (see src/main/pdf-password-dialog.ts)
          'pdf-password': resolve(__dirname, 'src/renderer/pdf-password.html'),
        },
      },
    },
    server: {
      port: Number(process.env.SHELL_DEV_PORT) || 5199,
      strictPort: Boolean(process.env.SHELL_DEV_PORT),
    },
  },
})
