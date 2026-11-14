import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { outDir: 'lib/dist', emptyOutDir: true, target: 'es2022' },
})
