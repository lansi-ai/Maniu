# @lcoder/workspace

LCoder 的三栏工作台，作为 **DSH 的 client UI 插件**存在。

## 现状

**页签已注册，正文是三栏骨架。** 两步走的第一步（挂载）和第二步的结构部分都完成了：

| 注册项 | 位置 | 说明 |
|---|---|---|
| 页签类型 | `src/client/definition.ts` | kind `lcoder-workspace`，`priority: extension`，不认领任何 `dsh-resource://` 地址 |
| 引导页入口 | 同上 `guide` | `order: 20`，点开就是本 kind |
| 词典 | `src/client/locales.ts` | 命名空间 `lcoderWorkspace`，zh / en |
| 正文 | `src/client/WorkspaceBody.tsx` | 三栏：任务 / 规格-代码 / 对话 |

数据面已接，走**文件投影**（`src/client/projection.ts`）：任务与规格本来就是
kernel 落在 `.spec/` 里的 YAML（`.spec/tasks/*..yaml`、`.spec/spec/rules.yaml`），
是唯一事实源，UI 直接读文件画出来。读文件用上游现成的 `workspaceFiles` 远程
命名空间——**没有自建 Remote、没有 typert 生成器**。状态机判断不进 UI，
仍归 kernel；投影面经槽位 `inject` 工厂按会话注入，没绑面或没工作区时
三栏保持骨架态。

> 路径必须与 kernel 的落盘一致（`task-store.taskPath` 与 `spec-store.saveRules`
> 都以 `.spec` 为 root）。`projection.client.spec.ts` 里有一条断言专门锁这个，
> 因为分叉不会有任何类型错误，只会画出错的数据。

## 怎么挂上去（不改上游 patch 文件）

上游的浏览器插件清单在 `packages/bundle/web-app/cordis.patch.yml`，我们**不碰它**。
自己的 patch 层是仓库根的 `lcoder/cordis.patch.yml`，一次插两行——宿主侧的
kernel（agent 工具）和浏览器侧的工作台（页签）：

```yaml
- insert:
    - id: lcoder-kernel
      name: '@lcoder/kernel'

    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

在仓库根启动时把它叠上去（工作目录就是规格库所在的仓库，`.spec` 的父目录）：

```sh
pnpm dsh web --patch lcoder/cordis.patch.yml
```

patch 层是叠加的，我们这层在 bundle 层之后应用，所以只是往清单末尾追加一行。
`contact-surface.txt` 里不会因此多出条目——**挂载不改任何上游文件**。

<small>写法已核实，见 `packages/bundle/web-app/cordis.patch.yml:298` 的 `ui-sidebar-files` 行。</small>

## 上下文与产物

- 浏览器侧依赖：`slots` / `locale` / `sidebarRightTabs`（`src/client/index.ts` 的 `inject`）
- 打包走上游预设 `clientBundle`（`tsdown.config.ts`），产物是 `lib/client.js` 的闭包工厂格式
- `tsc -b` 的入口在根 `tsconfig.client.json` 的 `references` 里，所以 `pnpm typecheck` 会覆盖本包
- 改完跑：`pnpm typecheck` · `pnpm exec vitest run packages/lcoder/workspace` · `pnpm --filter @lcoder/workspace run bundle`

## 下一步

1. 一个按会话的 store：三栏共享当前选中项（点任务看它的契约与证据）
2. 右栏：与对话的逐条对齐（对话本身仍由会话渲染，不重复画）
3. 数据刷新：现在进入页签时拉一次；之后可用 `workspaceFiles.changes`
   监听 `tasks/` 目录做增量刷新
4. 宿主侧：kernel 目前还没有挂载进宿主组合，agent 侧工具要真正跑起来
   还差这一步（到时再定挂载方式，尽量仍走 patch 层）

## 参考实现

写页签时照这两个包抄，别自己发明：

- `packages/client/ui-sidebar-files` —— 页签定义 + store + 组件，最完整的范例
- `packages/client/ui-agent-preset` —— 设置页形态，与我们的"规格台"最接近
