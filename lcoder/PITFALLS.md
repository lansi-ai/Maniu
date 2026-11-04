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

## W-06 主仓工作树被递归删除，门禁因读不到文件而红

- **现象**：`git status` 出现 3847 条未暂存 ` D`（`packages/` 3785 + `vendor/` 62，涉及 136 个包目录），索引与 HEAD 完好；pre-commit 的 translation pairing 因要读的成对文件已不存在而失败，合并停在未提交状态。
- **原因**：一次不经过任何 git 操作的递归文件删除落在主仓工作目录，同时波及 `packages/` 与 `vendor/`。删除时刻落在目录 mtime 09:53:32–09:53:38，reflog 在该时刻没有任何操作，`git log --all --diff-filter=D -- packages` 为空，`.worktrees/` 检出条目为 0，因此不是分支动作也不是任何窗口的裁包改动；`packages/lcoder` 只剩一半是随后 `git merge --abort` 写回所致。本线可回看的命令记录里不存在对 `packages/` 或 `vendor/` 的删除动作：09:48:41 台账提交到 09:57:58 abort 之间对主仓只有只读检查（`git status`、`ls`、`tail`、`grep`、`python -c` 读 JSON），写操作只落在 `docs/` 与 worktree 的 `.desktop-build`；前台命令没有逐条时间戳，所以这是按记录内容排除，不是按时间戳证明。
- **处理**：`git restore --source=HEAD --worktree -- packages/ vendor/`（必须带 `vendor/`：`vendor/cordis` 是所有包 import 的对象，漏了它 typecheck 与 `build:artifacts` 照样起不来）→ `pnpm install` 重接 136 个包的 workspace 软链 → `pnpm typecheck` + `pnpm exec vitest run packages/lcoder` 复核。普通 `pnpm install` 不够：它按 lockfile 判定「已是最新」，不会补 node_modules 里被一起删掉的包根文件（实测 `node-pty` 只剩目录骨架，缺 `package.json` 与 `index.js`，`subprocess-local` 的 postinstall 与 `build:artifacts` 都因此 `ERR_MODULE_NOT_FOUND`），要 `pnpm install --force` 从 store 重新落地。
- **预防**：清理类命令一律写仓库根绝对路径；禁止在共享检出里用相对 pathspec 做递归删除；跨检出操作前先确认 cwd；恢复后先确认 `git status --porcelain | grep -c '^ D'` 为 0，再确认 `node_modules` 也完整（跑一次 postinstall 脚本或直接 `pnpm install --force`），然后才跑门禁；共享检出里挂着 `MERGE_HEAD` 会让别的窗口下一次提交变成合并提交，冲突时优先 abort 再报告。
