# LCoder 坑档（PITFALLS）

> 四段式：现象 → 原因 → 处理 → 预防。编号只顺延，不重编号。

## W-01 Windows 上 kill `dev:web` 不带走子进程

- **现象**：停止 `dev:web` 后端口仍被占用，下一次启动与旧进程抢写 `lib/`，症状随机。
- **原因**：Windows 上停止命令只结束 shell，tsc / tsdown / vite 子进程仍在运行。
- **处理**：按进程树清理，确认 3080 端口空闲后再启动新实例。
- **预防**：换实例前固定做一次进程树检查。

## W-02 `dev:web` 输出接管道会看不到日志

- **现象**：`pnpm dev:web | tail` 十分钟没有任何输出。
- **原因**：管道缓冲到进程结束，而 serve 进程不会结束。
- **处理**：改为 `> lcoder/web.log 2>&1`，再读文件。
- **预防**：启动日志一律重定向到文件。

## W-03 插件路径不是 `plugins/<name>/client.js`

- **现象**：单独请求 `plugins/lcoder-workspace/client.js` 返回 404。
- **原因**：上游按批量 combo URL 提供客户端插件（`plugins/??a/client.js,b/client.js&rev=…`）。
- **处理**：检查 combo URL 里是否包含目标插件，不要按单文件路径探测。
- **预防**：启动自检按 combo URL 匹配。

## W-04 包 README 缺 frontmatter 导致 `test:docs` 红

- **现象**：`pnpm exec vitest run scripts/doc-standard.spec.ts` 报缺少 `Summary` / `Table of Contents` / `Dev Note`。
- **原因**：`packages/*/*/README.md` 被上游文档标准扫描，要求 `kind` / `description` frontmatter 与固定骨架。
- **处理**：按 `packages/todo/tool-todo/README.md` 的结构补齐。
- **预防**：新增包 README 时先对照上游模板，再提交。

## W-05 产品任务收口被 P3/P4 拦住

- **现象**：`task_close` 返回契约未签署或缺少证据，状态不变。
- **原因**：`scope.irreversible` 非空时必须有 `by: human` 的契约；`evidence_required` 的每一项都要有非空日志。
- **处理**：先补 `.spec/contracts/<任务>.contract.yaml` 并由人签署，再跑命令把输出写进 `.spec/evidence/<任务>/`。
- **预防**：开 A 级任务时同时开契约与证据目录。
