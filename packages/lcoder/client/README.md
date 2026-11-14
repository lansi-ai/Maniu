# @lcoder/client

LCoder 自研渲染端（React 18 + Vite）的 S1 骨架（T-187）。

- `src/app.tsx`：登录门禁、会话列表、发消息、流式正文。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；入口 `session.list` + `api-session/*` 事件。
- `src/contract.ts`：`window.lcoder` 窄 IPC 契约，与主进程同名同形。
- 渲染端无 Node、无 `fetch`、无宿主 cookie；所有宿主访问经 preload 暴露的 IPC。

构建与启动见 `lcoder/s1.md`。

## Known Limitations and Deferred Work

- 流式正文只画 assistant 文本；工具卡、审批/提问卡片、附件与 Markdown 阅读器在 M1/M2 实现。
