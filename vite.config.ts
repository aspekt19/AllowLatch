import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'web',
  resolve: {
    alias: {
      '@policy': path.resolve(rootDir, 'src/policy'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: path.resolve(rootDir, 'web-dist'),
    emptyOutDir: true,
  },
})
