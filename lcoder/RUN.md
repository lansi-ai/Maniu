# 让工作台跑起来

三步：Node 版本 → 把两个包接进 profile → 起服务。

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

插件行是按**包名**解析的，解析基准是 profile 目录（`~/.dsh/profiles/web/`），不是仓库。
仓库里的 workspace 包在那儿看不见，所以两行都会 "failed to import"。
用 `link:` 接进去（上游 `docs/user/develop/basic/publish.md` 的做法）：

```sh
cd ~/.dsh/profiles/web
pnpm add "link:E:/Projects/LCoder/packages/lcoder/kernel" \
         "link:E:/Projects/LCoder/packages/lcoder/workspace"
```

换机器、或 `~/.dsh` 被重建后，这一步要重做。

> 警告里会提到 `@lcoder/workspace` 的 peer 依赖 `@deepseek-ai/cordis` 不解析——
> 无妨：cordis 由宿主提供，浏览器侧插件不自己解析它。

## 3. 起服务

```sh
cd E:/Projects/LCoder
pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080
```

首次要构建前端产物（`pnpm run build:artifacts`，几分钟）。之后可以用
`pnpm dev:web --poll --patch lcoder/cordis.patch.yml` 起带 watch 的开发循环。

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

## 并联工作树

并行窗口用独立 worktree 时，给 smoke 单独的 `DSH_HOME`，不要改主窗口共用的 `~/.dsh/profiles/web`；端口换 3081。首次先 `pnpm install`、`pnpm run build:artifacts`，再按第 2 节把 worktree 的两个包 `link:` 进 worktree 自己的 profile。

## 踩过的坑

- **kill 掉 dev:web 不会带走子进程**（Windows）。`TaskStop` / Ctrl+C 只杀到 shell，
  tsc / tsdown / vite 那几个还在跑，会和下一个实例抢写 `lib/`。换实例前先按
  进程树清干净，再确认端口没人占。
- **`dev:web` 的输出别接管道**（`| tail`）。管道会缓冲到进程结束，而 serve 不会
  结束——你会整整十分钟看不到任何日志。直接 `> lcoder/web.log 2>&1` 再读文件。
- **插件路径不是 `plugins/<name>/client.js`**，是批量 combo URL
  （`plugins/??a/client.js,b/client.js&rev=…`），单独请求那个路径只会 404。
