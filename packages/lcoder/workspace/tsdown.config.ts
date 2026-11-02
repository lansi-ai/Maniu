import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * 与上游 client 插件同一套打包预设：宿主侧入口 `lib/index.js` 由 `tsc -b`
 * 编出来（见 tsconfig.json 的 references），浏览器侧产物 `lib/client.js`
 * 由这里按 `clientBundle` 的闭包工厂格式产出——CSS 也一并在这里编进去。
 *
 * 用上游预设而不是自己写一份 `defineConfig`：网页端的加载器只认这一种
 * 产物形状（`__ModuleLoader__.load`），自己拼一份迟早对不上。
 */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
