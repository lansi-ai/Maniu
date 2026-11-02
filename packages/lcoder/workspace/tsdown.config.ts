import { defineConfig } from 'tsdown'

/**
 * 与上游 client 包一致的打包方式：产出 lib/index.js（宿主侧入口）
 * 与 lib/client.js（浏览器侧入口）。
 *
 * 目前两边共用同一个空入口；第二步接入页签时，
 * client 侧会被真正用上，index 侧保持为空即可。
 */
export default defineConfig({
  entry: {
    index: 'src/client/index.ts',
    client: 'src/client/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  clean: true,
})
