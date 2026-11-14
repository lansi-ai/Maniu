import { clientLibrary } from '../../client/tsdown.client.ts'

/**
 * 浏览器产物由 Vite 产出；这个 Node 入口只导出与主进程共用的 IPC 契约。
 * Host 面跳过：客户端类型要等 Host 编译完成后才生成。
 */
export default clientLibrary(import.meta.dirname, ['lib/types/index.js'])
