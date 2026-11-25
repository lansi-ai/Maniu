/**
 * LCoder client 快车道专用 vitest 配置：继承仓库根配置，仅追加 jsdom polyfill。
 * 不修改上游根 vitest.config.ts。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../vitest.config.ts'

const setup = fileURLToPath(new URL('../../packages/lcoder/client/tests/setup-jsdom.ts', import.meta.url))

export default mergeConfig(
  base,
  defineConfig({
    setupFiles: [setup],
  }),
)
