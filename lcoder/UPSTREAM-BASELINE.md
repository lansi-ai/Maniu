# 上游基线

LCoder 是 **DeepSeek Harness（DSH）的二开**。本文件记录我们跟踪的基线，以及我们改动了上游的哪些地方。

跟踪上游的唯一目的：任何时候都能回答两个问题——
1. 我们现在基于上游哪个版本？
2. 上游升级时，会不会撞到我们改过的地方？

---

## 1. 当前基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/deepseek-ai/deepseek-harness` |
| 版本 | `0.2.2-alpha.2` |
| 提交时间 | 2026-10-30 00:13:15 +0800 |
| 提交标题 | `Merge pull request #7552 from deepseek-harness/fix/webworker-live-import-bindings` |
| Node 要求 | `>=24.9.0` |
| 登记日期 | 2026-11-02 |

升级基线 = 改这张表 + 走一遍第 4 节的演练。不写「大概」「差不多」，只写可复核的版本标识。

---

## 2. 远端与分支

```
origin   = 我们自己的仓库（暂未配置，等第一个可运行产物出现后再建）
upstream = deepseek-ai/deepseek-harness
```

| 分支 | 用途 | 规则 |
|---|---|---|
| `master` | 上游镜像，只读 | 只允许 `git pull upstream master`，永不提交 |
| `lcoder/main` | 我们的主线 | 所有工作在这里；永不 rebase，保证历史可追溯 |
| `sync/upstream-<版本>` | 同步上游时的临时分支 | 合并、解决冲突、跑门禁，然后合回 `lcoder/main` |

---

## 3. 接触面清单

规则：**能新增就不修改。** 新增包永不冲突；每改一个上游文件，都要在这里登记一行，并说明为什么非改不可。

### 新增物（不冲突）

| 路径 | 内容 |
|---|---|
| `lcoder/` | 本目录：基线登记、接触面清单、脚本、我们自己的说明 |
| `lcoder/cordis.patch.yml` | 我们的 patch 层：只往浏览器插件清单里插一行工作台，不改上游 patch |
| `packages/lcoder/kernel/` | 规格库、任务状态机、检查器、工具实现（原 LCoder 项目迁入） |
| `packages/lcoder/workspace/` | 三栏工作台的 client UI 插件 |

> 目录必须放在 `packages/<组>/<包>` 两级下——`pnpm-workspace.yaml` 的 glob 是 `packages/*/*`。

### 修改的上游文件（冲突点）

| 文件 | 改什么 | 为什么必须改 |
|---|---|---|
| `pnpm-lock.yaml` | 加依赖后由 `pnpm install` 重写 | 引入 workspace 外的包（`yaml`）必然改动 lock；不提交 lock 会让安装不可复现 |
| `tsconfig.client.json` | 两行：`references` 里加 `./packages/lcoder/workspace`，`include` 里加 `packages/lcoder/*/src/css-modules.d.ts` | client 聚合编译只扫被 reference 的工程。不加这两行，`pnpm typecheck` 根本看不到我们的 client 代码和测试，等于把验收门禁关掉一半；CSS 的模块声明也必须显式进 include，否则聚合程序读我们的 `.module.css` 导入会报错 |
| `tsconfig.host.json` | 一行：`references` 里加 `./packages/lcoder/kernel` | 同理，host 聚合编译靠 references 把包划进工程边界。kernel 的测试被 `packages/*/*/tests/**/*.ts` 收进了 host 聚合，但 kernel 的 src 不在任何工程里，编译直接报 TS6307 |
| `AGENTS.md` | 顶部新增「LCoder 二次开发入口」两行：规则、看板、产品文档指针 | 上游根入口是任何 AI 工具的第一落点；没有这段，工具不会自动读到 LCoder 的治理文件 |
| `apps/desktop/src/locale.ts` | 用户可见品牌串：welcomeTitle / welcomeBrand / welcomeTaglineBrand（加载与欢迎页）、关于菜单、隐藏/退出/打开应用、退出确认、启动失败、更新标题，`DeepSeek Harness` 全部改为 `LCoder`；中英的 welcomeKeyDescription 改成中性说法 | 这是产品品牌面：桌面端欢迎页与系统菜单直接显示上游产品名。该文件是桌面壳文案的单源，没有配置覆盖入口；欢迎页在主进程里先于插件树渲染，装配层换不掉 |
| `apps/desktop/tests/main-startup.spec.ts`、`quit-confirmation.spec.ts`、`tray.spec.ts` 与 `tests/expected/*.json` | 菜单、关于、退出确认、托盘文案与命令清单的期望从 DeepSeek Harness 改为 LCoder | 文案单源改名后，行为期望与夹具必须跟着改，否则测试与产品不一致 |
| `apps/desktop/src/main.ts` | Windows 主窗改 `frame: false`，去掉原生 caption 与 `titleBarOverlay`；新增窗口最小化/最大化/关闭与状态查询 IPC，并在 maximize/unmaximize/fullscreen 时推状态；新增项目目录选择 IPC（`properties: ['openDirectory']`）；窗口创建补 `icon`（取 `applicationIconPath()`，关于面板与安装向导同源）；新增 `windowAttention` 处理器，按渲染端报来的等待数与自身焦点状态决定 `flashFrame`；窗口创建补 `icon`（取新的 `applicationIconPath()`，关于面板与安装向导同源） | LCoder 要求自绘标题栏与项目目录选择。装配层（cordis patch / 插件配置）只能挂插件，改不了 `BrowserWindow` 选项；页面 CSS 也隐藏不了原生 caption。frameless 保留 `thickFrame`，拖边缩放与 Win+方向键不变。不显式给窗口 icon，Windows 任务栏与 Alt-Tab 就显示 Electron 默认图标 |
| `apps/desktop/src/ipc.ts` | 增加 windowCommand / windowState / windowStateChanged / windowAttention / projectDirectoryPick 五个私有通道与 DesktopWindowBridge 类型 | 窗口按钮、最大化态与目录选择需要 `ipcMain` 与 `BrowserWindow`；装配层拿不到这两样，必须由 Desktop 主进程提供通道 |
| `apps/desktop/src/preload-app.ts` | Windows app 文档下暴露 `dshDesktop.window`、标记 `data-lcoder-custom-chrome`，并停用 `syncWindowsAppearance` 的挂载；目录桥增加 `pickProjectDirectory`，窗口桥增加 `attention(awaiting)` | 该能力在隔离的 preload 上下文；profile/插件层无法向渲染进程注入 `contextBridge`，也卸不掉上游注入的 HTML menubar 与 40px 标题栏占位 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 读取 `data-lcoder-custom-chrome`，把侧栏折叠宽度从 56px 收成 0 | 自绘标题栏后不再有 caption rail；不收起会留一条空轨道，外壳无法占满窗口 |
| `apps/desktop/tests/main-startup.spec.ts` | 窗口创建断言从 `titleBarOverlay` 改为 `frame: false`，补窗口命令/状态用例 | 行为变更必须由测试钉住 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 自绘标题栏生效时（`data-lcoder-custom-chrome`）把左侧栏 rail 宽度归零、不再进 drawer 判定 | 壳自己画窗口按钮与顶部条后，上游那套 Windows caption 与图标 rail 的占位会让主面板缩进去；这是装配层无法覆盖的布局分支 |
| `packages/client/modules/src/assets.ts` | 资源 MIME 表增加 `.woff2` / `.woff` | 客户端资源路由原先只服务图片；LCoder 自托管的 Inter 字体必须由同一路由发出并带字体 MIME，插件/装配层改不了这张路由表 |
| `packages/client/modules/tests/assets.client.spec.ts` | 覆盖 `.woff2` / `.woff` 的 MIME 判定 | 新增字体资源类型必须有门禁钉住，防止路由回退 |
| `scripts/gen-third-party-notices.ts` | 生成物新增「Bundled font assets」段，登记 Inter 4.66、SIL OFL 1.1、来源与许可文件 | 生成器只扫 npm workspace 依赖，非 npm 的自托管字体不会被自动列出；装配层无法改仓库级声明生成器，字体又随包分发，必须在声明中体现 |
| `apps/desktop/tests/preload-app.spec.ts` | 删除 Windows appearance 挂载断言 | 该挂载已停用 |
| `apps/desktop/scripts/dev.ts` | 一行：`preparePrimaryRuntime()` 改成按 `DSH_DESKTOP_SKIP_RUNTIME_SMOKE=1` 传 `deferSmoke` | 运行时冒烟（打包 python 三条检查加 Office 往返）是发布验收口径，每次开发启动跑一遍要 100 到 143 秒；产物没变时的日常开窗需要一条跳过它的通道，装配层与 profile 都够不到 dev 脚本 |
| `apps/desktop/resources/icon.svg`、`icon-windows.svg`、`icon-macos.svg` 与对应 `icon.png`、`icon-windows.png`、`icon-macos.png`、`tray-windows.ico` | 上游鲸标整组换成 LCoder 标记（靛蓝渐变板 + 白色 L + 右上圆点）。`icon.svg` 保持 1104 画布、图块仍在 `translate(40 32)` 的 1024 位（web 侧 `apps/web/scripts/render-app-icons.ts` 按这套常量裁影）；`icon-windows.svg` 保持 1024 画布包 1104 空间并保留 `id="tray-glyph"` 组（托盘管线靠它注入放大） | 这是操作系统层面的产品品牌面：EXE 与任务栏图标、安装向导关于页、Windows 托盘 ICO、macOS dock 全部来自这几个文件。装配层与插件改不了 Electron 打包图标，也没有配置项能覆盖 |
| `apps/desktop/scripts/render-tray-icon.ts` | 只改措辞：文件头与一行注释里的 whale 改为 LCoder mark；管线、`TRAY_ICON_SIZES`、`tray-glyph` 注入与 1.2 倍放大全部不变 | 美术换掉后原措辞会误导下一次改图标的人去找鲸标 |
规矩：改动写在文件里的 `lcoder:` 前缀注释下，方便 grep 定位，也方便升级时用 `git diff upstream/master...HEAD -- <文件>` 一眼看清。

---

## 4. 升级演练（每次上游有新版本时执行）

```sh
git fetch upstream
git checkout -b sync/upstream-<新版本> lcoder/main
git merge upstream/master
```

冲突处理顺序：

1. 先看冲突是否落在外面的接触面清单里。**不在清单里的冲突 = 有人偷偷改了上游，必须先评审再加进清单。**
2. 只保留我们那段（`lcoder:` 注释标记过的），其余全部接受上游。
3. 解决完跑门禁：

```sh
pnpm install
pnpm build
pnpm exec vitest run packages/lcoder
./lcoder/scripts/upstream-diff.sh
```

4. 全绿后合回 `lcoder/main`，更新第 1 节的基线与第 5 节的演练记录。

门禁没全绿，不许合并。半绿的合并会让"我们改了哪"这件事从此说不清。

---

## 5. 演练记录

| 日期 | 从 → 到 | 上游动了几个我们碰过的文件 | 冲突 | 处理 |
|---|---|---|---|---|
| 2026-11-02 | — | — | — | 初始化，尚未同步过 |

---

## 6. 防漂移的三条硬约束

1. **不直接 import 上游内部路径。** 只用 `@deepseek-ai/*` 的包导出。中间隔一层 `lcoder-kernel` 自己的 adapter——上游重构时只改 adapter，不动业务代码。
2. **改上游只改装配层。** 例如在 `apps/desktop` 的 client 组合里加一行挂载，而不是改它组件的内部实现。
3. **新增接触点必须人工评审。** `upstream-diff.sh` 只能告诉你"上游动了你碰过的东西"，判断不了"你这次是不是改深了"。
