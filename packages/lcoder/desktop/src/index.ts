/**
 * 包入口：只重导出与渲染端共用的 IPC 契约。
 * Electron 主进程入口仍是 `lib/types/main.js`；这里的入口让工作区包分类器
 * 有一个可读的 `src/index.ts`，包本身没有插件默认导出或 `apply`。
 */

export * from './contract.ts'
