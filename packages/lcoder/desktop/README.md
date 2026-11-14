# @lcoder/desktop

LCoder 自研 Electron 壳的 S1 切片（T-187）。

- `src/host-entry.ts`：最小宿主进程，用 `runProfile` 跑 `<DSH_HOME>/profiles/s1`，把 ready URL 报回主进程。
- `src/host-supervisor.ts`：拉起/关停宿主子进程，读 `ready`/`fatal` IPC。
- `src/link.ts`：主进程内协议适配层——launch token 换 cookie（`interactions=answer`）、一元 `POST /api/<ns>/<method>`、WS `/api/remote.mux`、`$events` 与 `$events/result`。
- `src/preload.ts` / `src/ipc.ts`：只暴露 call/stream/events/window 的窄 IPC；命名空间与方法白名单在 `link.ts`。
- `src/main.ts` / `src/window.ts`：单实例、frameless 主窗口（最小 520×600）、渲染产物加载。

构建与启动见 `lcoder/s1.md`。

## Known Limitations and Deferred Work

- S1 只服务一条端到端竖切：登录门禁、会话列表、发消息与流式正文；审批/提问回执、附件、工具卡、工作台五页在 M1/M2 实现。
