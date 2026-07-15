import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Library-mode build consumed by the sorai-toolkit hub as a git dependency
// (see package.json's "prepare" script) -- mirrors sorai-toolkit-converter's
// vite.lib.config.mjs exactly, same reasoning: ship pre-transpiled plain
// ESM (not raw .jsx) so the hub treats this like any other prebuilt npm
// package, no special Vite config needed on that side.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // Peer, not bundled -- the hub provides its own React instance.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
