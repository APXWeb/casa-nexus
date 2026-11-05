import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        gate: resolve(import.meta.dirname, 'gate.html'),
      },
    },
  },
  server: { port: 5290 },
})
