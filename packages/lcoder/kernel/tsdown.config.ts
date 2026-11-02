import { defineConfig } from 'tsdown'

/**
 * 与上游 host 包同形的打包：入口是 `tsc -b` 编出的 `lib/types/index.js`，
 * tsdown 只把它打成 js。类型声明不重复生成——tsc 已经出过了。
 */
export default defineConfig({
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
