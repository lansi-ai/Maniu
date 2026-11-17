import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * 与上游 client 插件同一套打包预设：宿主侧入口 `lib/index.js` 由 `tsc -b`
 * 编出来（见 tsconfig.json 的 references），浏览器侧产物 `lib/client.js`
 * 由这里按 `clientBundle` 的闭包工厂格式产出——CSS 也一并在这里编进去。
 *
 * 用上游预设而不是自己写一份 `defineConfig`：网页端的加载器只认这一种
 * 产物形状（`__ModuleLoader__.load`），自己拼一份迟早对不上。
 *
 * `yaml` 必须显式别名到它的 browser 入口：打包器按 CJS 解析时选中了
 * `yaml/dist` 的 Node 构建，产物里留下 `require("process")`，浏览器模块表
 * 无法回答，客户端插件启动即失败。这个别名只影响本包的浏览器半，宿主半
 * 仍用 `yaml` 的 Node 入口。
 */
const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'])
const require = createRequire(import.meta.url)
const yamlBrowser = join(dirname(require.resolve('yaml/package.json')), 'browser', 'index.js')

export default (inlineConfig: Parameters<typeof bundle>[0]) => bundle(inlineConfig).map(config => {
  if (config.name !== '@maniu/workspace/client') return config
  return {
    ...config,
    inputOptions: {
      ...config.inputOptions,
      resolve: {
        ...config.inputOptions?.resolve,
        alias: { yaml: yamlBrowser },
      },
    },
  }
})
