import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Standalone dev-harness build (this repo's own `neu run`/`vite dev`), kept
// distinct from vite.lib.config.mjs's dist/ (the actual package shipped to
// the hub) -- mirrors FileConverterApp/vite.config.mjs's pattern exactly,
// see that file's comments for the neutralino.js <script src> reasoning.
function copyNeutralinoClient() {
  return {
    name: 'copy-neutralino-client',
    closeBundle() {
      const src = resolve(__dirname, 'resources/js/neutralino.js')
      const dest = resolve(__dirname, 'web-dist/js/neutralino.js')
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyNeutralinoClient()],
  build: {
    outDir: 'web-dist',
    emptyOutDir: true,
  },
})
