import { join } from 'node:path'
import { build } from 'vite'
import { clientLibrary } from '../../client/tsdown.client.ts'

const base = clientLibrary(import.meta.dirname, ['lib/types/index.js'])

/**
 * 浏览器产物由 Vite 产出；这个 Node 入口只导出与主进程共用的 IPC 契约。
 * Host 面跳过：客户端类型要等 Host 编译完成后才生成。
 * Vite 挂在 Node 入口的 onSuccess 上，这样根 `build:artifacts` 的 Client
 * bundle 一次就同时产出 IPC 入口与 `lib/dist`，干净检出不必再手工补构建。
 */
export default (inlineConfig: Parameters<typeof base>[0]) => base(inlineConfig).map(config => {
  if (config.entry === '' || config.entry === undefined) return config
  return {
    ...config,
    onSuccess: async () => {
      await build({ configFile: join(import.meta.dirname, 'vite.config.ts'), root: import.meta.dirname })
    },
  }
})
