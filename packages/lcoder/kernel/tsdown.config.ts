import { defineConfig } from 'tsdown'

/**
 * 与上游 host 包同形的打包：入口是 `tsc -b` 编出的 `lib/types/*.js`，
 * tsdown 只把它们打成 js。类型声明不重复生成——tsc 已经出过了。
 *
 * `cloud` 是全局云端插件入口；它与角色 preset 内的 kernel 入口同包不同行，
 * 起会话之前就能提供令牌供应器。
 */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    cloud: 'lib/types/cloud/plugin.js',
    prototype: 'lib/types/prototype/plugin.js',
    talents: 'lib/types/talents/plugin.js',
    'talents-policy': 'lib/types/talents/policy.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
