---
description: "LCoder 自研 Electron 壳的 T-187 S1、T-190 M3 与 T-191 M1 骨架：带最大化状态同步与拖拽区的 frameless 窗口、受监督的宿主 profile 子进程、自写的 token→cookie/一元 POST/WS mux/$events 与 waterfall 回执适配层、本地化菜单与托盘，以及渲染端的窄 IPC 面。"
kind: "package-reference"
---

# @maniu/desktop

[English](README.md) | 中文

<a id="summary"></a>
## 概述

主进程内的 S1 竖切，只覆盖「起宿主 → 登录门禁 → 列会话 → 发一条 → 流式正文 → 重启读历史」：

- `src/host-entry.ts` / `src/profile.ts`：用 `runProfile` 跑 `<DSH_HOME>/profiles/lcoder`；profile 由四层发布补丁拼成，发布态把 `resources/dsh/node_modules` 接进 profile，用户 home 里的插件行才解析得到包名。
- `src/host-supervisor.ts`：拉起/关停宿主子进程，读 `ready`/`fatal` IPC。
- `src/link.ts`：主进程内协议适配层——launch token 换 cookie（`interactions=answer`）、一元 `POST /api/<ns>/<method>`、WS `/api/remote.mux`、`$events`；流白名单含 `session/follow`、`session/control`、`workspace/follow`；waterfall 请求与撤回都转发给渲染端。
- `src/preload.ts` / `src/ipc.ts`：只暴露 call/stream/events/waterfall/window 的窄 IPC；审批与提问的回执经 `lcoder:event-result` 原样带回宿主。
- `src/main.ts` / `src/window.ts`：单实例、frameless 主窗口（最小 520×600）、渲染产物加载、最大化/全屏状态推送。
- `src/menu.ts` / `src/tray.ts` / `src/desktop-locale.ts` / `src/preferences.ts`：本地化应用菜单（含缩放与全屏快捷键）、托盘打开/退出；皮肤、字体与语言由渲染端经 `lcoder:preferences-write` 交给主进程同步写入 userData 的 `lcoder-preferences.json`，启动时由 `lcoder:preferences-read` 下发。用户选择的落盘不依赖退出流程，确定性退出的 SIGKILL 不会丢偏好。
- `src/home.ts`：宿主 home 解析——发布态固定 `~/.dsh`，开发态用仓内 `.dsh-home`；显式 `DSH_HOME` 优先，启动器与探针不受影响。
- 关窗即退出；主进程按 `api-session/status` 维护在跑会话，空闲直接退出，有回合在跑时经 `lcoder:close-request` 交给渲染端确认，确认后同一条关窗再放行。托盘只在运行期提供「回到窗口 / 退出」；关停有 12 秒硬上限，超时先杀宿主再强制退出，绝不静默驻留。

<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 会话传输

#### 模型看到什么

本包自己不加任何内容：外壳只把 `session.prompt` 的文本送进宿主，并把 `session.follow` 的帧画回界面；工具与提示词全部来自宿主 profile。

#### Token 影响

只有经 `session.prompt` 提交的文本进入请求；窗口、IPC 与链路层不增加 token。

#### KV Cache 影响

每个选中会话只保留一条 follow 流，因此连续提示在 preset 或工具集变化前复用宿主的请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 更新尚未接入 `electron-updater`；设置页与菜单只给「当前版本 + 手动下载说明」，安装入口不可用。
- 托盘只提供打开与退出；关闭窗口仍直接退出，没有「最小化到托盘」。
- 运行中关窗确认只在渲染端可用时生效；渲染进程异常时关窗被拒绝，需要强制结束进程。
- Windows 首版只产未签名安装包，不含自动更新、安装期锁与深链处理；签名与 feed 步骤见 [lcoder/windows-packaging.md](../../../lcoder/windows-packaging.md)。

### 开发备注

<a id="dev-note"></a>

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)；Windows 打包见 [lcoder/windows-packaging.md](../../../lcoder/windows-packaging.md)。

浏览按钮的目录选择走主进程 `lcoder:pick-directory` 与 `dialog.showOpenDialog`（取消返回 null，打不开回带原因）；起始目录优先用当前项目路径，不可用时退到最近的已存在祖先，再退到上次成功选择的目录，成功选择写进桌面偏好。宿主 `directory-picker` 在发布 profile 中保持禁用，两者不要混用。
