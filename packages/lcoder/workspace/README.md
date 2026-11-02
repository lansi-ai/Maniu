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

数据面**还没接**：三栏各有一句"接线后显示"的占位。宿主侧的 Remote 命名空间
（由 `@lcoder/kernel` 提供）还没建，所以正文里没有 store、没有跨栏状态，
唯一的实时输入是会话的工作区目录（表头那行路径）。

## 怎么挂上去（不改上游 patch 文件）

上游的浏览器插件清单在 `packages/bundle/web-app/cordis.patch.yml`，我们**不碰它**。
自己的 patch 层是仓库根的 `lcoder/cordis.patch.yml`：

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

在仓库根启动时把它叠上去：

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

1. 宿主侧 Remote 命名空间：任务状态机、规格库的只读投影
2. 正文接数据：左栏任务列表 + 状态、中栏规格条目到代码位置的对照
3. 一个按会话的 store（那时才需要），三栏共享当前选中项
4. 右栏：与对话的逐条对齐（对话本身仍由会话渲染，不重复画）

## 参考实现

写页签时照这两个包抄，别自己发明：

- `packages/client/ui-sidebar-files` —— 页签定义 + store + 组件，最完整的范例
- `packages/client/ui-agent-preset` —— 设置页形态，与我们的"规格台"最接近
