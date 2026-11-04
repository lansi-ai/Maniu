# 让工作台跑起来

三步：Node 版本 → 把两个包接进 profile → 起服务。

**全程用仓库内的隔离环境。** `DSH_HOME` 一律指向仓内目录，不指向 `~/.dsh`；开发与验证既不依赖本机装没装桌面版 / `dsh`，也不改变本机已装的那些应用（不写 `AppData`、不动注册表、不装卸应用、不杀不是本次拉起的进程）。仓根的 `.dsh-home/` 已被 `.gitignore` 忽略，worktree 用各自仓内的 home。下面所有命令都按这个前提写。

## 1. Node 版本

仓库要求 `>=24.9.0`（`package.json` 的 `engines`）。本机若是 22，用 pnpm 自带的版本管理装一个，不要动系统 Node：

```sh
pnpm setup                 # 第一次：把 ~/.pnpm/bin 加进 PATH（需重开终端）
pnpm env use --global 24   # 装 Node 24，链接到 ~/.pnpm/bin/node.exe
```

之后每条命令都要让这个 Node 走在最前面：

```sh
export PATH="$HOME/.pnpm/bin:$PATH"   # Git Bash
node -v                               # 期望 v24.x
```

## 2. 把 `@lcoder/*` 接进 profile

插件行是按**包名**解析的，解析基准是 profile 目录（`<DSH_HOME>/profiles/web/`），不是仓库。
仓库里的 workspace 包在那儿看不见，所以两行都会 "failed to import"。
用 `link:` 接进去（上游 `docs/user/develop/basic/publish.md` 的做法）。先给仓内 home 起个名，
下面都用它：

```sh
DSH_HOME='E:\Projects\LCoder\.dsh-home'        # Windows 形式；Git Bash 里 $HOME 展开的路径会让 profile 静默起不来
mkdir -p "$DSH_HOME"
cd "E:/Projects/LCoder/.dsh-home/profiles/web"   # 第一次启动后 dsh 会自动建出这个目录
pnpm add "link:E:/Projects/LCoder/packages/lcoder/kernel" \
         "link:E:/Projects/LCoder/packages/lcoder/workspace"
```

profile 目录不存在时先空跑一次（`DSH_HOME=… pnpm dsh web --no-open --port 3080` 起来后 Ctrl+C），
或者用 `--from-default-profile web` 让 dsh 从出厂模板建一份。重建 home 目录后，这一步要重做。

> 警告里会提到 `@lcoder/workspace` 的 peer 依赖 `@deepseek-ai/cordis` 不解析——
> 无妨：cordis 由宿主提供，浏览器侧插件不自己解析它。

## 3. 起服务

```sh
cd E:/Projects/LCoder
DSH_HOME='E:\Projects\LCoder\.dsh-home' pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080
```

首次要构建前端产物（`pnpm run build:artifacts`，几分钟）。之后可以用
`DSH_HOME='E:\Projects\LCoder\.dsh-home' pnpm dev:web --poll --patch lcoder/cordis.patch.yml` 起带 watch 的开发循环。
注意 `--patch` 这类 launcher 参数要紧跟在 `dsh web` 之后、其它 app 参数之前，放到后面会被当成转发给应用而被拒。

改了 `packages/lcoder/*/src` 后，重打一次产物即可（服务会 stat-poll 到并广播 reload）：

```sh
pnpm --filter @lcoder/workspace bundle
pnpm --filter @lcoder/kernel bundle
```

## 怎么确认真的起来了

按顺序看四件事：

1. **服务活着**：日志里有 `dsh web: http://127.0.0.1:3080/?token=…`
2. **kernel 挂上了**：日志里有 `[lcoder] 已注册 9 个工具；无会话 cwd 时规格根 …`
   —— 这一行是 kernel 的 selfCheck 打的，说明宿主侧工具真注册了
3. **规格根对着目标仓库**：会话里第一次求值工具面时日志出现 `[lcoder] 规格根：<仓库>/.spec`
   —— 有会话时它必须是目标仓库，而不是 profile 目录
4. **没有激活失败**：不应该出现 `N entries did not activate`
5. **工作台进了浏览器清单**：带会话取首页，插件组合 URL 里要有
   `@lcoder/workspace/client.js`

```sh
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" lcoder/web.log | head -1 | cut -d= -f2)
curl -s -c /tmp/cj -b /tmp/cj -L "http://127.0.0.1:3080/?token=$TOKEN" | grep -o "@lcoder/workspace/client.js"
```

浏览器里打开 `http://127.0.0.1:3080/?token=…`（token 从日志取），右侧栏的
页签列表里应该多出「工作台」。三栏要出数据，会话还得绑定一个工作区目录——
仓库根有一份示例 `.spec/`（`DR-01`/`DR-02` 两条规则、`DEMO-01` 一个任务），
可以直接选仓库根。它是产品示例数据，不是开发台账；开发进度见 `docs/tasks.yaml`。

## 规格根从哪来

kernel 按下面的顺序确定 `.spec` 目录：

1. 有会话时：`session.header.cwd/.spec`，即会话创建时绑定的仓库；
2. 没有会话 cwd（headless、启动自检）：`LCODER_SPEC_ROOT` 或 patch 里的 `root`；
3. 都没有：`process.cwd()/.spec`。

桌面端宿主子进程的 cwd 是 profile 目录，不是目标仓库，所以只能靠会话工作区定位真实规格库。`LCODER_SPEC_ROOT` 通过 `lcoder/cordis.patch.yml` 的 `!!js` 注入，只作兜底或显式覆盖。

## 桌面端

验收只认桌面端实例，web 实例只当判别器用。

```sh
cd E:/Projects/LCoder
pnpm run dev:desktop > lcoder/desktop.log 2>&1     # 不要接管道；也不要设 DSH_HOME
```

不设 `DSH_HOME` 是关键：`apps/desktop/scripts/dev.ts:66` 会把它默认到
`apps/desktop/.desktop-build/development/home`，`userData` 默认到同级 `electron-user-data`，
两者都在仓内、都被忽略。显式设成 `~/.dsh` 会让这次验证直接写本机安装态，禁止。

LCoder 的挂载写进那份仓内 home 的 profile（`apps/desktop/.desktop-build/development/home/profiles/desktop/`）：
`cordis.patch.yml` 放 LCoder 段，`package.json` 里用 `link:` 指向**当前检出**的
`packages/lcoder/kernel` 与 `packages/lcoder/workspace`（worktree 里就跑 worktree 的包，别指回主仓）。

```sh
pnpm run dev:desktop          # 构建产物后启动（改过 src 用这个）
pnpm run start:desktop        # 同上但跳过重建
pnpm --filter @lcoder/workspace bundle   # 只重打外壳产物；start:desktop 不会替你做
```

启动日志里按顺序确认三件事：`desktop development: DSH_HOME=<仓内路径>` 与
`inspectors main=9229, renderer=9222, host=9230`、`dsh web: http://127.0.0.1:<port>/?token=…`
的 ready 行、`[lcoder] 已注册 10 个工具`。三条都齐才算宿主活着。
一条桌面线一个 worktree：feature worktree 用 `DSH_DESKTOP_MAIN_INSPECT_PORT` /
`DSH_DESKTOP_RENDERER_DEBUG_PORT` / `DSH_DESKTOP_HOST_INSPECT_PORT` 换一组预留端口，
端口号写进该任务的台账备注；主窗保留默认 9229/9222/9230。

## 并联工作树

并行窗口用独立 worktree 时，web 用 worktree 自己的仓内 home（`DSH_HOME='<worktree>\.dsh-home'`），桌面用 worktree 自带的 `apps/desktop/.desktop-build/development/home`；两者都不碰主窗口共用的目录。smoke 的端口换 3081，桌面按上一节的三件套换一组预留 inspector。首次先 `pnpm install`、`pnpm run build:artifacts`（新 worktree 只 `pnpm install` 会因缺 `lib/` 产物而起不来），再按第 2 节把 worktree 的两个包 `link:` 进 worktree 自己的 profile。

## 踩过的坑

- **kill 掉 dev:web 不会带走子进程**（Windows）。`TaskStop` / Ctrl+C 只杀到 shell，
  tsc / tsdown / vite 那几个还在跑，会和下一个实例抢写 `lib/`。换实例前先按
  进程树清干净，再确认端口没人占。
- **`dev:web` 的输出别接管道**（`| tail`）。管道会缓冲到进程结束，而 serve 不会
  结束——你会整整十分钟看不到任何日志。直接 `> lcoder/web.log 2>&1` 再读文件。
- **插件路径不是 `plugins/<name>/client.js`**，是批量 combo URL
  （`plugins/??a/client.js,b/client.js&rev=…`），单独请求那个路径只会 404。
- **别把 `DSH_HOME` 指到 `~/.dsh`。** 指过去之后，宿主会往本机安装态写 profile、
  凭据与 storage，验证就跑在一台“有副作用”的机器上，结论分不清是产品行为还是本机状态。
  要判别也用仓内 home，桌面端保持 `dev.ts` 的默认值。
