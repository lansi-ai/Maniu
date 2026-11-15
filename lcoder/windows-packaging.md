# Windows 打包链（T-197 C3）

状态：首版**未签名** Windows 打包链已落地；产物是 NSIS per-user 安装包与 `win-unpacked`。首版**不带自动更新**：`publish` 为 `null`，未引入 `electron-updater`，也不是可发布 feed 的产物。

## 1. 产出与命令

```sh
export pnpm_config_verify_deps_before_run=false
pnpm --filter @lcoder/desktop run build
pnpm --filter @lcoder/client run build
node packages/lcoder/desktop/scripts/package-win.mjs
```

- 版本由 `LCODER_RELEASE_VERSION` 决定（默认 `0.1.0`）；不改上游 `0.2.2-alpha.2`，也不改本包 `0.0.0`。
- 宿主依赖树由 `pnpm --filter @lcoder/desktop deploy --prod --legacy` 产出；`LCODER_SKIP_DEPLOY=1` 复用已有树。
- 产物在 `packages/lcoder/desktop/.desktop-build/artifacts/`：`maniu-<version>-win-x64-unsigned.exe` 与 `win-unpacked/`。
- 称重写到 `lcoder/logs/t197-package-weight.json`（安装包、`win-unpacked`、`app.asar`、宿主依赖树、运行时载荷）。

## 2. 产物布局

| 位置 | 内容 |
| --- | --- |
| `app.asar` | 壳的 `lib/`（主进程、preload）与 `package.json`（约 6.6 MB） |
| `resources/dsh/` | `pnpm deploy` 出来的宿主依赖树（含 `host-entry.js` 与 `@lcoder/kernel`） |
| `resources/profile/` | 发布 profile 的四层装配源；运行时拼成 `<DSH_HOME>/profiles/lcoder` |
| `resources/client-dist/` | 新客户端 Vite 产物 |
| `resources/runtime/` | T-183 node-only 运行时载荷（`primary-runtime/` 与 `runtime/bin/node.exe`） |
| `resources/tray.ico`、`icon.png` | 托盘与 EXE 图标（图标源来自 `apps/desktop/resources`，只读引用） |

发布态 home 是 `~/.dsh`；开发态仍是本树 `.dsh-home`。壳不解析仓库相对路径：`app.isPackaged` 时客户端、profile、宿主入口、托盘与运行时全部走 `process.resourcesPath`。

### 2.1 依赖收敛与称重

`pnpm deploy` 的 hoisted 树会挂上共享 lockfile 里的全部 workspace 项目，并把它们的链接留在 `node_modules`；这些链接在安装包里不存在，NSIS 的 7z 也会失败。打包脚本因此做三件事：

1. 只保留 `@lcoder/desktop` 依赖闭包里的 workspace 链接并复制成实体目录，其余链接删除。
2. 删除发布 profile 永远不 import 的载荷：`dsh-client-ui-*`、`dsh-client-modules`、`client-hmr`、`locale`、`shortcuts`、`resources`、`office-to-pdf`、`libreoffice-kit*`、上游 `dsh-desktop`、实验包与 Python 运行时闭包。
3. 从仓内源码刷新 `@lcoder/kernel` 与 `@lcoder/desktop`（pnpm 按 `files` 拷的快照可能漏掉代码分块）。

硬断言在 `assertDeployClean`：出现 `libreoffice-kit*`、`dsh-desktop`、实验包、任何符号链接，或部署树内出现 `node.exe` / `electron.exe`，打包直接失败并打印路径。

| 项 | 收敛前 | 收敛后（2026-11-15 本树实测） |
| --- | ---: | ---: |
| 宿主依赖树 | 803,464,611 B | 264,974,028 B |
| win-unpacked | 1,405,675,142 B | 867,184,778 B |
| 安装包 | 441,893,637 B | 235,168,904 B |

目标区间是部署树 200–300 MB；收敛后落在 253 MB。剩余大头是 Electron 本体（约 400 MB，地板）、Node 运行时 115 MB、宿主依赖树 253 MB 与客户端产物。宿主依赖树里主要是 CLI 与 provider 的真实依赖（`openai`、`node-pty`、`sherpa-onnx` 等），它们仍在 manifest 闭包里，未逐包裁剪。

`@deepseek-ai/dsh`（CLI）与 `@deepseek-ai/dsh-web-app` 仍留在 `@lcoder/desktop` 依赖里：`host-entry` 的 `runProfile` 只从 `@deepseek-ai/dsh/profile-boot` 导入，而 `web-startup`/`web-runtime`/`connection`/`file-upload`/`api-remotes` 等宿主行来自 `dsh-web-app`。把两者拆成独立 host 包需要把这些行和 profile-boot 一起搬成新包，本轮未做；本轮用上面的裁剪把它们的无关载荷排除掉。

发布 profile 把 `agent-default-model` 指回 `lcoder-cloud`（`host-workbench.patch.yml`）：新客户端先登录云端再进工作台，默认模型跟云端令牌走；官方 provider 仍可在设置页切换。旧壳的官方默认不受影响。

同一层把 `agent-preset-registry.selectedDefault` 设为 `standard`：新客户端「新建会话」不带 preset，普通对话需要上游标准工具面（`pwsh`、`bash`、`fs`、`subagent`、`workflow` 等）；工作台作用域会话仍显式用 `lcoder-workbench`，十个慢牛角色仍作为可选 preset 保留。旧壳的 `selectedDefault=lcoder` 不受影响。

## 3. 安装与启动验证

安装包（per-user，`oneClick:false`、`allowToChangeInstallationDirectory:false`）：

```powershell
.\maniu-0.1.0-win-x64-unsigned.exe /S
```

静默安装落到 `%LOCALAPPDATA%\Programs\Maniu\Maniu.exe`。不装也能直接起 `win-unpacked\Maniu.exe`。本树实测：安装成功，`Maniu.exe` 的 `FileVersion=0.1.0`、`ProductName=Maniu`，`resources/profile` 与 `resources/dsh` 都在；用安装态 exe 跑 t187 六项 PASS。

在 Git Bash 里调用安装包要用 `//S`：`/S` 会被 MSYS 路径转换改写成 `S:/`，安装器会长时间占用 CPU 而不是静默结束。

打包态探针（窗口、门禁、会话、流式、重启历史）：

```sh
export DSH_HOME='E:\Projects\LCoder\.worktrees\pool-slot-1\.dsh-home-pkg'
export LCODER_PROBE_EXECUTABLE='E:\Projects\LCoder\.worktrees\pool-slot-1\packages\lcoder\desktop\.desktop-build\artifacts\win-unpacked\Maniu.exe'
export LCODER_PROBE_PACKAGED=1
node lcoder/scripts/t187-s1-probe.mjs
node lcoder/scripts/t189-m2-probe.mjs
```

`LCODER_PROBE_PACKAGED=1` 只去掉开发启动特有的“应用目录”参数；`LCODER_PROBE_EXECUTABLE` 换掉 Electron 路径。探针仍用本机 mock 云端（5091）与仓内 home，不写 `%APPDATA%`。

## 4. 必须人工执行的环节

以下步骤不能由本机脚本代替；未签名产物不得进生产 feed。

| # | 环节 | 交付物 |
| ---: | --- | --- |
| 1 | 插 SafeNet EV USB 令牌、输入 PIN | 签名成功的安装包 |
| 2 | 填 `DSH_DESKTOP_WINDOWS_{CER_FILE,SIGNTOOL,KEY_CONTAINER,TOKEN_PIN}`，证书的 `publisherName` 要与包一致 | 可签名环境 |
| 3 | 在生产机跑签名打包，核对**签名时间戳**与 `publisherName` | 归档包与校验记录 |
| 4 | 配置下载前缀与 feed（`lcoder-desk/...`）；首版未接 feed，接之前不要上传 | feed 对象与固定下载名 |
| 5 | GitHub workflow dispatch 与发布审批 | 发布记录 |
| 6 | 安装 → 起窗 → 登录 → 发一条 → 重启读历史，在**签名包**上重做一次 | 人工验收记录 |

安装器自定义件（`installer.nsh`、8 语言自定义文案、侧边图）尚未迁入新壳；当前 8 种语言走 electron-builder 内置翻译。需要旧壳的安装目录切换与品牌文案时，按 `lcoder/client-cutover-plan.md` §6.1 补。

## 5. 已知限制

- 宿主依赖树按系统 Node 构建（N-API 模块与 Electron 44 的 Node 24 共用 ABI）；如出现 ABI 报错，按旧壳方式用 Electron 二进制跑 `pnpm deploy` 重建。
- 运行时载荷来自旧壳 T-183 的 `win-x64` 准备结果，`runtime.json` 仍写 `0.2.2-alpha.2`；新壳不校验该版本字段，正式发布前应改为本产品版本。
- 自动更新、安装期锁、退出确认的宿主侧控制面仍未移植（对应 C1 剩余项）；首版关窗即退出。
- macOS 未打包；本轮只发 Windows。
