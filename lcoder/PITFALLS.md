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
- **处理**：`git restore --source=HEAD --worktree -- packages/ vendor/`（必须带 `vendor/`：`vendor/cordis` 是所有包 import 的对象，漏了它 typecheck 与 `build:artifacts` 照样起不来）→ `pnpm install` 重接 136 个包的 workspace 软链 → `pnpm typecheck` + `pnpm exec vitest run packages/lcoder` 复核。普通 `pnpm install` 不够：它按 lockfile 判定「已是最新」，不会补 node_modules 里被一起删掉的包根文件（实测 `node-pty` 只剩目录骨架，缺 `package.json` 与 `index.js`，`subprocess-local` 的 postinstall 与 `build:artifacts` 都因此 `ERR_MODULE_NOT_FOUND`），要 `pnpm install --force` 从 store 重新落地。第三层是共享环境根：同波删除把 `~/.dsh` 也扫了——`profiles/web` 整个没了，`profiles/desktop` 只剩 `cordis.yml` 与模板 `cordis.patch.yml`，`package.json`、`node_modules`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 连同两份 `.bak` 备份全没，`sessions`、`attachments`、`telemetry` 也没了；`.credentials.yaml` 与 `.anonymous-user-id` 是删除时刻重新生成的，登录态按丢失处理，需用户重新登录。重建以 worktree 的 `development/home/profiles/desktop` 为模板，只搬 LCoder 段，用户偏好条目留空由客户端重设；外部 link 目标先逐个确认（`I:/Temp/test/readonly-preset` 目录存在但 0 条目，那份预设也被扫了，先不挂）。第五层是桌面运行时缓存：`pnpm run clean` 会把 `apps/desktop/.desktop-build/` 的 `downloads`（15 个资源）与 `targets/win-x64`（268MB 已就绪载荷）一并清掉，之后 `dev:desktop` 与 `start:desktop` 都要走 `preparePrimaryRuntime` 联网重下，本机代理未开时直接 `fetch failed` 起不来；这次是从并行 worktree 的同一目录拷回才恢复。第四层是包内标记文件：`electron` 只剩 `dist/` 与 `index.js`，缺 `path.txt`，`require('electron')` 于是联网重下并卡住；pnpm 未批准 electron 的 install 脚本，`pnpm install --force` 不会补它。
- **预防**：清理类命令一律写仓库根绝对路径；禁止在共享检出里用相对 pathspec 做递归删除；跨检出操作前先确认 cwd；恢复后先确认 `git status --porcelain | grep -c '^ D'` 为 0，再按层核对且每层给出可核的数字：跟踪文件（`^ D` 计数为 0）→ `node_modules` 包根文件与标记（跑一次 postinstall 脚本、查 `electron/path.txt` 这类）→ 构建产物（`pnpm run clean` 后全量重建）→ 共享环境根（`~/.dsh` 的 profile、凭据、外部 link 目标）→ 桌面运行时缓存（`apps/desktop/.desktop-build/downloads` 与 `targets`），最后才跑门禁；`pnpm run clean` 会连桌面运行时缓存一起清，离线机器上清之前先确认有可拷的副本；共享检出里挂着 `MERGE_HEAD` 会让别的窗口下一次提交变成合并提交，冲突时优先 abort 再报告。

## W-07 自造 RPC 帧把上游正常路径判成挂死，并行实例的残留连接又被误读成监听

- **现象**：为定位「打开仓库不返回」，在页面里直发 typert 客户端帧，`api/session/list` 秒回、`api/workspace/create` 与 `initializeDefault` 15 到 60 秒无应答，据此判「上游 workspace 服务在全新 home 首启动即挂」；后来在纯净 master 检出上重跑同一帧形得到同样结果，看似复现。与此同时用户此前的人工点击确实成功建出过工作区，两边对不上。
- **原因**：手搓帧只带 rpcId 与 method，缺真实客户端在建连时协商的流与会话上下文，服务端等一个永不到来的东西，无应答是必然，与被测服务健康度无关；同一帧形在桌面与 web 两种宿主里都无应答，只证明帧形不可信。第二个坑是状态误读：`Stop-Process` 之后 `netstat` 仍打印 `TIME_WAIT` 与浏览器侧 `SYN_SENT` 重试行，不按 `LISTENING` 过滤就会读成「还在监听」，既会误指别人的实例没关，也会让自己写出的「已关」无法自证。
- **处理**：判挂死前先立三条环境判据——渲染进程 reload 后采集 22 秒得零 `net::ERR` 与零控制台报错，`plugins/events` 只有 request 与 HTTP 200 两条事件且没有 closed 或 failed，electron 主进程唯一且宿主子进程存活、日志里有 ready URL 行。然后走真路径取证：桌面侧由用户手点，上游对照用上游自己的原生 UI（纯净 worktree 里 添加工作区 → 路径编辑器 → 打开）。结论一律拿落盘数字当证据，即 `storages/workspace.json` 的 mtime、字节数与 workspaceIds 前后值；UI 的 busy 态与 toast 只作旁证。
- **预防**：任何「服务端无应答」的结论都必须出自产品路径，协议帧探针只能用来判别通道通不通，不能定性缺陷。测前先按父进程数一遍确认实例唯一，并确认 events 流保持打开。报「已关」或「在监听」要附 `netstat -ano | grep <端口> | grep LISTENING` 的过滤后原文，无行即已关，`SYN_SENT` 与 `TIME_WAIT` 是客户端残留而非监听。新建 worktree 只 `pnpm install` 不够：`lib/` 产物不存在会让 `dsh web` 以 typert-loader 二十多个 contributor `ERR_MODULE_NOT_FOUND` 启动失败，必须先 `pnpm run build:artifacts`。驱动页面若需要 `--patch`，只能取上游自带的测试覆盖，并在结论里写明它替换了哪一段 UI。测宿主内部行为不能拿 shell 里直接跑同一条命令代替——本机 Git Bash 取文档目录 0.17 秒返回，不代表 Electron 宿主子进程里的同一条命令；也不能靠宿主 inspector 的 `Runtime.evaluate` 调模块，那个 realm 里 `require` 与动态 `import` 都不可用。可行的两条是观察宿主持有的子进程树与活动资源，或改配置后拿落盘数字反推。判别用的配置一律写在仓内隔离 home 里：本线真的发生过一次越界——把 `DSH_HOME` 指到 `~/.dsh` 起桌面实例并往 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加了一个 `workspace-controller` 条目，还留了 `.bak-workspacecfg` 备份；虽按备份原样还原（还原后该关键字命中数为 0、字节数回到 3264）并删了备份，但那轮数据因此不可复用，因为无法证明配置命中过——`--dump-config` 能证明 id 定向覆盖生效，可 CLI 拒绝 profile 名 `desktop`，所以只有仓内 home 才能自证命中。

## W-08 本机 OS 文档目录查询挂死，把「打开仓库」拖成永久无应答

- **现象**：全新 home 首启动后，`workspace/initializeDefault` 与随后的 `workspace/create` 都没有应答，桌面按钮停在「正在打开…」，外壳 15 秒后报超时；宿主日志零报错，其它 RPC（`session/list`、`agentPresets/list`、`account` 等）全部秒回，`plugins/events` 保持 200 打开。
- **原因**：根因是这台机器上宿主「向操作系统要文档目录」那一步挂住——`packages/api/workspace-controller/src/default-directory.ts` 的 win32 分支用 `runNativeCommand` 起 `powershell.exe` 取 `MyDocuments`，同一条命令在 Git Bash 里 0.17 秒返回，在宿主链路里却不 settle。把它放大成整条链不可用的是两点机制，按 T-16 的收口都不算上游缺陷：一是失败不发声也不释放——`enqueueOperation` 的 tail 只在 promise settle 时释放，一条永不 settle 的操作会占死注册表队列，把后面的 `create` 一起拖住，且 `packages/api/workspace-controller/src/commands.ts` 里 `timeout`、`AbortSignal`、`deadline` 三个关键字命中数为 0，队头挂住后该命名空间不会自愈，这属设计特征；二是「`documentsLookupTimeoutMs` 的 10 秒上限没兜住这次等待」未经证实、已降级，实际只观察到 60 秒仍无应答，异步栈两次抓取都是 0 条。不是「上游产品不可用」：同一份上游代码配上正确目录后全链路跑通。
- **处理**：在该 home 的 profile patch 里给 `workspace-controller` 配 `documentsDirectory` 指向一个真实存在的目录，跳过问 OS 那一步。单变量实测（同一份代码、同一个仓内 home、只改这一行）：不配时两个 workspace 调用都无应答、`storages/workspace.json` 停在 227 字节且 `workspaceIds` 为空；配上后 22 个请求全部应答、文件涨到 758 字节、登记出 `default-workspace` 并真的建出目录。
- **预防**：桌面与 web 都按这条配；`lcoder/RUN.md` 的桌面章节有现成写法。判断新环境是否中招，只看两个数——`initializeDefault` 是否应答、`workspace.json` 的 `workspaceIds` 与 mtime 是否变化，别看 UI 有没有转圈。换机器的处置口径：再遇到首启动「打开仓库」挂死，先给仓内桌面 profile 配 `documentsDirectory`，仍然挂再考虑抓栈；不要把这类现象默认归给上游。

## W-09 新 worktree 的 pnpm 补丁未应用，把上游代码判成类型错误

- **现象**：`.worktrees/t23-empty-intake`（与 baseline 同一提交）跑 `pnpm run typecheck` 报 `packages/experimental/subagent-oar/src/run.ts(253,54): error TS2554: Expected 0 arguments, but got 1`；`build:artifacts` 的 host compiler 退出 1，其后 host bundle、desktop bundle、client compiler、client bundle、web 五步全部跳过，桌面产物链断在这里；起实例时 `apps/desktop` 报解析不到 `@deepseek-ai/dsh-app-boot/lib/index.js`。同一份代码在 baseline 里 `pnpm run typecheck` 五关全绿。
- **原因**：不是上游代码，也不是版本漂移。`pnpm-workspace.yaml:110` 的 `patchedDependencies` 给 `@botiverse/oar@0.67.0` 打了补丁，补丁把 `InstallationProbe` 从 `() => ...` 扩成 `(options?: { env }) => ...`，而 run.ts:253 传的就是这个 options。新 worktree 的首次 `pnpm install` 静默没应用补丁：`.pnpm` 目录名带着同一个 `patch_41e5621b…` 哈希，目录里的 `dist/contracts/installation.d.ts` 却是未打补丁的原件。两边 pnpm 同为 11.28.5，`patches/@botiverse__oar@0.67.0.patch` 的 git 哈希相同。
- **处理**：在该 worktree 里 `pnpm install --force`。重跑后四处 tree 的 `installation.d.ts` 都带 `options?:`，本 worktree `pnpm run typecheck` 为 5 passed、0 failed（148.53 秒）。没有改任何源码，也没有在 baseline 落修复。
- **预防**：新 worktree 装完先核这一条再判门禁——`grep -o "InstallationProbe = .*" node_modules/.pnpm/@botiverse+oar@0.67.0_patch_*/node_modules/@botiverse/oar/dist/contracts/installation.d.ts`，带 `options?` 才算补丁落地。只看到 TS2554 就写「上游类型错误」，会把环境事实记成代码事实并让三条并行线一起等一个不存在的缺陷。同类症状（干净 tree 红、baseline 绿，差异落在 `node_modules/.pnpm/*_patch_*`）一律先 `pnpm install --force` 再判定。

## W-10 kernel 是 Agent 作用域懒装载，注册行在桌面日志里采不到

- **现象**：三条并行线各自起桌面实例后，`dev:desktop` 的日志里 `[lcoder] 已注册 …` 与 `[lcoder] 规格根 …` 出现 **0 次**，而同一实例确实建出了会话、宿主 RPC 有应答，真点「签署契约」也落了盘。按 `lcoder/RUN.md` 原来的「日志三件事」，这会被读成 kernel 没挂上。
- **原因**：两件事叠加。一是 kernel 挂在 Agent preset 作用域内，`apply()` 属**懒装载**——只有起回合时那棵 profile 树才被装载，没有 `DEEPSEEK_API_KEY` 的实例永远不触发它；二是宿主子进程的 stdout 与 stderr 不并入 `dev:desktop` 日志（与 W-07 同源）。两条都不等于装配失败。
- **处理**：判 kernel 死活改看**会话头 `agentPreset`**（`home/sessions/<仓库目录名>/session-*/` 的头一行，不需要钥匙，已实测可采），判落盘改看目标仓库里 `.spec/tasks/` 是否出现；要数注册计数就另起一份同码 web 判别器读那一行。`lcoder/RUN.md` 的桌面判据已按此改写。
- **预防**：新 worktree 只把 kernel 挂在角色 preset 内，不要再保留全局 `lcoder-kernel` 行——历史上「同一行出现两次」正是全局行与 preset 行各装载一遍，现在按构造消除。任何「日志里没有 `[lcoder]`」的判断，先确认那个实例起过回合再下结论。

## W-11 会话日志是多帧 zstd，整文件一次解只拿到首帧

- **现象**：按 W-10 的口径解 `home/sessions/<仓库目录名>/session-*/session.v4.jsonl.zstd` 取证时，`zlib.zstdDecompressSync(fs.readFileSync(p))` 对一个 73,472 字节的文件只吐出 215 个字符、1 行（会话头），于是七条会话全部读成「只有一行＝没起过回合」，差点把用户 2026-11-05 在主窗口亲手走完的 7 问立项（`E:/Projects/LCoder-multi-demo/docs/.spec` 三件产物的落盘时刻就在这些会话之间）判成没有实测，并把 T-10、T-23 的验收重新挂回未验。
- **原因**：持久化按 flush 追加**互相独立的 zstd 帧**，不是单帧流。`zstdDecompressSync` 解到第一个帧结束就返回，剩下的帧静默丢弃，既不报错也不留痕迹。同一文件里帧魔数 `28 B5 2F FD` 出现 89 次，逐帧解完是 175 行事件。
- **处理**：取证按帧切分再拼——找出所有偏移（魔数按小端写成 `28 B5 2F FD`），`buf.subarray(pos[i], pos[i+1] ?? buf.length)` 逐段 `zstdDecompressSync`，拼起来 `split('\n')`。要权威解码就用 `packages/session/session-persistence-jsonl` 的读盘路径，别用手搓单帧。
- **预防**：凡以会话日志为证据，先做一次量级核对——文件字节数与解压字符数差两个数量级即多帧，不得直接下「没有回合」的结论。判「有没有起过回合」还要交叉两条独立来源：目标仓库 `.spec` 的落盘时间戳，以及工作区名册里该会话的 `blank` 位。

## W-12 Windows 上 git worktree remove 报 Filename too long，注册表删了目录还在

- **现象**：`git worktree remove .worktrees/<线名>`（含 `--force`）对并行线的 worktree 报 `error: failed to delete '...': Filename too long`，退出码非零；`git worktree list` 里这一条已经消失（元数据注销成功），但目录还在磁盘上占着 GB 级 `node_modules`。`cmd /c rd /s /q \\?\E:\...` 换一种写法又报「文件名、目录名或卷标语法不正确」——Git Bash 会把 `\\?\` 前缀吃掉。
- **原因**：pnpm 的 `.pnpm/<pkg>@<ver>/node_modules/<pkg>/...` 嵌套深度超过 `MAX_PATH`（260）。Cordis 仓的 worktree 里再叠一层 `apps/desktop/.desktop-build` 就必然越界。`git worktree remove` 的注销与删除是两步，注销不受长路径限制、删除受；本机不改全局 `core.longpaths`（属机器状态，不在授权范围）。
- **处理**：`node lcoder/scripts/rm-longpath.mjs E:/Projects/LCoder/.worktrees/<线名>`——脚本自己拼 `\\?\` 前缀并 `fs.rmSync(..., { recursive: true, maxRetries: 5 })`，绕开 MAX_PATH 也绕开 shell 的引号处理。已实测删掉 t25 与 t30 两个 worktree 的残留目录。注销失败的（还在 `git worktree list` 里）先 `git worktree prune` 再删目录。
- **预防**：清理并行线按三步走，别指望一条命令到底——一 `git worktree list` 与 `git rev-list --count lcoder/main..<分支>` 双核（脏的、还有未合提交的、有活进程的都不动）；二 `git worktree remove`（预期它会失败，只看元数据是否注销）；三 `rm-longpath.mjs` 删目录，最后 `git branch -d`（合完的分支用安全的 `-d`，不用 `-D`）。起过桌面实例的 worktree 要先确认窗口已关：进程还活着就保留，不杀别人的进程。

## W-13 启动器 ps1 上有两个 BOM，PowerShell 把注释当命令、把 300 塞给 switch 参数

- **现象**：跑 `lcoder\scripts\start-desktop.cmd` 先在 console 里冒一串乱码的 `'...' is not recognized`，接着在 ps1 第 1 行报 `?# 无法识别为 cmdlet`，紧接着第 14 行报「无法将 System.Int32 的 300 值转换为 System.Management.Automation.SwitchParameter 类型」。窗口里什么都没启动。
- **原因**：`start-desktop.ps1` 开头有**两个** UTF-8 BOM（字节 `ef bb bf ef bb bf`）。PowerShell 5.1 只剥掉第一个，剩下的 U+FEFF 粘在首行 `#` 前面，于是那条注释被当成命令 `?#` 执行；而 `param(...)` 必须是最靠前的语句，首行一坏它就不再被当成参数块，整块被当函数调用执行，`[int]$ReadyTimeoutSec = 300` 里的 `300` 作为位置参数去绑 `[switch]$KeepRunning`——那条类型转换错误就是这么来的。另一个叠加因素是 `.cmd` 包原本是 LF + 中文 `rem`，`chcp 65001` 下 cmd.exe 会把中文行读成乱码行去执行。
- **处理**：ps1 只留一个 BOM（读字节、循环剥到只剩一个再写回）；`.cmd` 包改成**纯 ASCII + CRLF**，中文文档只留在 ps1 头部，并加 `exit /b %ERRORLEVEL%` 透传退出码。实测 `start-desktop.cmd -ListOnly` 输出「没有正在运行的 LCoder 桌面实例。」、退出码 0。
- **预防**：写带 BOM 的文件前先读字节判断，写盘工具可能给已有 BOM 的文件**再加一个**。一行判据：`head -c 6 file | od -An -tx1`，出现两次 `ef bb bf` 就是双 BOM。cmd 包装层一律不写中文、不用 LF。见到「注释行被当命令」或「300 绑不进 switch」这类怪错，先查 BOM 再查语法。

## W-14 新 worktree 的 electron 包没有二进制，桌面实例要么失败要么联网重下

- **现象**：新 worktree 跑完 `pnpm install`（含 `--force`）后，`node_modules/.pnpm/electron@44.7.0_*/node_modules/electron/` 里只有 `package.json`、`index.js` 这类源码文件，没有 `dist/` 与 `path.txt`。
- **原因**：pnpm 未批准 electron 的 install 脚本（与 W-06 第四层同一件事），`pnpm install` 不会替它跑 postinstall。`index.js` 的 `getElectronPath()` 读不到 `path.txt` 时会调 `install.js`，即联网重下；下载失败就抛 `Electron failed to install correctly`。桌面入口 `dev.ts` 用 `createRequire(import.meta.url)('electron')` 取可执行文件，所以这一步缺失会表现成「桌面实例起不来」，与 LCoder 源码无关。
- **处理**：从已有检出对拷同版本的 `dist/` 与 `path.txt` 到本 worktree 的 electron 目录（T-49 线按 44.7.0 这么做过，`dist/electron.exe` 与 `path.txt` 两件齐了才继续），或在本 tree 批准 electron 构建脚本后重装。不要把这件事记成上游缺陷，也不要手改 `path.txt` 内容以外的任何东西。
- **预防**：新 worktree 起桌面实例前三件一起核——`node_modules/.pnpm/electron@*/node_modules/electron/path.txt` 存在、`dist/electron.exe` 存在、`pnpm install` 后的 `InstallationProbe` 带 `options?`（W-09）。缺电子二进制时直接对拷，比等联网下载快得多；对拷后核对版本号与本 tree 的 lockfile 一致。

## W-15 preset 直接挂 compaction-basic 报 isolate realms

- **现象**：桌面里打开仓库或新建会话失败，回执是 `session create failed: agent-preset/invalid: Preset services require isolate realms: compaction`；已存在的会话列表还在，但新建不出会话。
- **原因**：web-app 在宿主面把 `compaction-basic` 禁用了，只有 preset 自己挂；而 `compaction` 是 isolate 服务，直接作为 preset 的普通插件子项会被拒绝。原 LCoder 七个 preset 都没有挂它，所以长会话根本没有压缩。
- **处理**：按上游 `standard` preset 的写法放进隔离组——`id: compaction`、`name: cordis:group`、`group: true`、`isolate: { compaction: true }`，再在 `config` 下挂 `compaction-basic` 与阈值。九个 preset 都要挂。
- **预防**：改完装配源先读 preset 声明原文，确认里面有 isolate 组；重拷运行副本后必须重启实例，旧进程不会热读这份 patch。

## W-16 相对路径追加写进了主检出

- **现象**：worktree 里改完 CSS 并重新 bundle，界面元素的 class 却出现字面量 `undefined`，面板没有样式。
- **原因**：Bash 的工作目录会跨命令保留；一条 `cd .worktrees/...` 之后又回到主检出执行 `cat >> packages/...`，内容落进主检出的同名文件，worktree 的 CSS 根本没变。
- **处理**：先 `git -C <主检出> restore --source=HEAD --worktree -- <文件>` 还原主检出，再用 worktree 的绝对路径重做并重新 bundle。
- **预防**：写文件前先 `pwd`；跨检出操作一律用绝对路径；bundle 后 `grep` 新类名，界面里再核一次 `css.<新类>` 不是 undefined。

## W-17 客户端调 `ctx.remote.<ns>` 没写进 inject，运行时才报错

- **现象**：浮层里选好图片与文件后，图片能加进列表，文件项却显示「上传失败（cannot get property "remote.fileUploads" without inject）」，发送按钮被这条失败附件禁用。
- **原因**：客户端 Cordis 的 `ctx.remote` 命名空间按 inject 惰性解析；`@lcoder/workspace` 的 inject 列表当时只有 workspaceFiles、commands、session、llm、settings、credentials、agentPresets，没有 fileUploads。类型面能编译，是因为远程类型声明与 inject 列表是两套东西。
- **处理**：把 `remote.fileUploads` 加进 `packages/lcoder/workspace/src/client/index.ts` 的 inject，重打 `pnpm --filter @lcoder/workspace run bundle`，刷新渲染进程后文件项变 ready、发送恢复。
- **预防**：新增任何 `ctx.remote.<ns>` 调用前先把同名命名空间加进 inject；附件、上传、设置这类跨命名空间功能必须用真实文件在桌面里走一遍，单测里的远程替身不会触发注入解析。

## W-18 同时写 backdrop-filter 与 -webkit-backdrop-filter，打包后标准属性被挤掉

- **现象**：新客户端主题层写了 `backdrop-filter: blur(36px) saturate(190%)` 与带 `-webkit-` 的同名声明；打包后 computed style 读出来是 `none`，玻璃面一点模糊都没有，而同一规则里的圆角、渐变填充、内高光阴影全部正常。
- **原因**：Vite 8 的 CSS 压缩把同一条规则里的前缀写法当成同一属性去重，只保留最后一条。标准属性在前、`-webkit-` 在后，产物里就只剩 `-webkit-backdrop-filter`；本机 Electron 的 Chromium 不认这个前缀（`CSS.supports('-webkit-backdrop-filter', 'blur(10px)')` 为 false），计算值回落成 `none`。反过来只写标准属性时，压缩器会自动补一条前缀并把标准属性放在最后，两个都在。
- **处理**：主题层只写标准 `backdrop-filter`，不手写 `-webkit-` 前缀；改完重新 `pnpm --filter @lcoder/client run build`，在 `lib/dist/assets/*.css` 里 grep `backdrop-filter:` 确认标准属性存在，再用 CDP 读 computed style 核实（T-188 的取证方式：`getComputedStyle(el).backdropFilter`）。
- **预防**：CSS 里凡是需要前缀的属性（backdrop-filter、mask、text-stroke 等）一律只写标准形式，让打包器决定前缀。"样式写了但界面没效果"的排查顺序固定为：先读打包后的 CSS，再读 computed style；两步都过才算生效，只看源码会被压缩去重骗过去。

## W-19 旧 API 进程不带 .env，502 在客户端完全不可见

- **现象**：客户端发消息后只有提问、没有任何回答，界面也没有错误；同一时刻云端网关对 `chat/completions` 返回 502。
- **原因**：5081 上的 API 是更早的进程，没有读到当前 `.env`，上游凭据/模型配置缺失；网关把上游 400/5xx 统一折成 `502 upstream_unavailable`。客户端此前忽略 `llm/retry` 与带 `error` 原因的 `turn/end`，既看不到重试也看不到最终失败。
- **处理**：改过云端 `.env` 后必须重启 5081 的 API 再验；旧进程会一直用启动时的环境。排查时两侧各开一个开关——云端 `OPENCODE_DEBUG_UPSTREAM=true` 看 `lcoder/logs/cloud-api.log` 里的上游状态与响应体，桌面 `LCODER_DEBUG=1` 看 `lcoder/logs/model-debug.log` 里的事件、请求号与状态；客户端最终失败行会显示「请求号：req_…」，可用来对齐两侧日志。
- **预防**：看见「只有提问没有回答且无报错」先核 API 的启动时刻与环境，再核上游状态；不要先怀疑模型。云端 `.env` 的值不进任何提交，日志只记状态码与截断脱敏文本，不记请求头与密钥。
