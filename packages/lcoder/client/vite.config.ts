import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// HeroUI v3 的 @apply 依赖 Tailwind 展开；不注册这个插件时样式不会生效。
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: { outDir: 'lib/dist', emptyOutDir: true, target: 'es2022' },
})
