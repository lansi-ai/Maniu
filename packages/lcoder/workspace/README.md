# @lcoder/workspace

LCoder 的三栏工作台，作为 **DSH 的 client UI 插件**存在。

## 现状

**骨架。** 只验证一件事：我们的 client 插件能被 client 组合加载。还没有注册页签。

分两步走的理由：页签要同时接 `slots` / `store` / `locale` 三套东西，一次性写进去，
写歪了很难判断是"挂载失败"还是"组件报错"。先把挂载打通，再填内容。

## 怎么挂上去（不改上游文件）

上游的 client 插件清单在 `packages/bundle/web-app/cordis.patch.yml` 里，长这样：

```yaml
- insert:
    - id: ui-sidebar-files
      name: '@deepseek-ai/dsh-client-ui-sidebar-files'
```

我们要做的只是**在自己的 patch 层里加一行**：

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

<small>写法已核实，见 `packages/bundle/web-app/cordis.patch.yml:298`。</small>

这意味着：**挂载不需要改任何上游文件**，`contact-surface.txt` 里不会多出条目。

## 第二步要做的事

1. 声明 `inject: ['slots', 'locale', 'sidebarRightTabs']`
2. 注册侧栏页签类型（`SidebarRightTabDefinition`）
3. 三栏布局：左任务 / 中规格-代码对照 / 右对话
4. 数据来自 host 侧的 Remote 命名空间（待建），由 `@lcoder/kernel` 提供

## 参考实现

写页签时照这两个包抄，别自己发明：

- `packages/client/ui-sidebar-files` —— 页签定义 + store + 组件，最完整的范例
- `packages/client/ui-agent-preset` —— 设置页形态，与我们的"规格台"最接近
