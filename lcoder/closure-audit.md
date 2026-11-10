# 包闭包审计（T-109）

审计对象是 LCoder 当前检出（分支 `lcoder/t109-closure-audit`，从 `lcoder/main` 顶端切出，pnpm 工作区 397 个包加根清单，共 398 个工程）。脚本只读，未删除任何包、未改依赖与锁文件。

## 结论

- 严格候选为 0 个包。397 个 workspace 包全部可达于运行时、构建或测试三闭包之一，没有任何一个包同时脱离三者。
- 安装包不会因为删除源码而变小。发布物走 core package set，只从 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-desktop-host` 的 dependencies、peerDependencies、optionalDependencies 求闭包，本检出这里是 333 个包、9,962 个受控文件、68.17 MiB。删除不进这个闭包的源码，安装包字节不变。
- 运行时不发布但有源码的包是 59 个，合计 1,695 个受控文件、10.53 MiB，占全部包源码的 13.2% 文件、12.1% 字节。它们仍被构建或测试锚定，不是可删候选；55 个包还带自己的测试。
- 建议不动上游源码。要减小本机检出或 install 占用，优先用稀疏检出与 `clean`（T-106 已有能力）；`lite` 工作区或维护删除补丁的收益只有约 10.53 MiB 受控源码，代价是持续改 tsconfig、tsdown、测试与门禁，且安装包收益为 0。

## 口径

三个闭包按以下根集合计算，分类优先级为运行时 > 构建 > 测试。

运行时根包括 Desktop profile 的两个 bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）、core package set 根（`@deepseek-ai/dsh`、`@deepseek-ai/dsh-desktop-host`）、`apps/desktop` 与 `apps/desktop-host` 声明的 dependencies 和 devDependencies、profile 里的 `@lcoder/kernel` 与 `@lcoder/workspace`、`lcoder/desktop-profile.patch.yml` 中的插件名，再沿 dependencies、peerDependencies、optionalDependencies 与包内 `cordis*.yml` 的插件名递归。ON_DEMAND 插件只从 npm 现装，不计入运行时。

构建根包括根 `tsconfig.host.json` 与 `tsconfig.client.json` 的 references 与 include、根 `tsdown.config.ts` 的 workspace 通配（`packages/*/*` 与 `vendor/*`）、`scripts/build.ts`、`scripts/run-gates.ts`、Typert 生成器、根 tsdown 与打包驱动脚本、`apps/desktop/scripts` 下的 electron-builder 与 prepare 脚本所 import 的 workspace 包，以及 `native/system` 的原生构建包。

测试根包括包内 `tests` 下的 spec 文件、被测试文件导入的包、`snapshots`、`website`、`benchmarks`、`python/sdk-runtime`。测试闭包只沿运行时依赖递归，避免把各包 devDependencies 全量拖进来。

文件数与字节数只统计 `git ls-files` 的受控文件，不含 `node_modules`、`lib`、`dist` 与构建产物。根清单单独列出，不计入 397 个包的文件与字节合计。

## 分类结果

| 分类 | 包数 | 受控文件 | 受控字节 | 运行时边 | dev 边 | workspace 边 | workspace 入边 | 实测入链 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 运行时 | 338 | 11,110 | 76.50 MiB | 1,960 | 3,388 | 5,348 | 6,029 | 4,621 |
| 构建 | 56 | 1,599 | 9.98 MiB | 368 | 573 | 941 | 494 | 474 |
| 测试 | 3 | 96 | 558.56 KiB | 157 | 40 | 197 | 0 | 0 |
| 候选 | 0 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 |
| 合计 | 397 | 12,805 | 87.03 MiB | 2,485 | 4,001 | 6,486 | 6,523 | 5,095 |

表中的运行时行不含根清单；根清单自身另有仓库根文件，未计入 397 个包。

core package set 单独按打包脚本的依赖口径计算为 333 个包、9,962 个受控文件、68.17 MiB。运行时分类比它多 5 个包，分别是 `apps/desktop`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-util-file-drag`、`@lcoder/kernel`、`@lcoder/workspace`，它们来自 Desktop 壳的 devDependencies 与 profile 的 link 依赖，不属于上游 core package set。

重叠情况如下。

- 运行时与构建重叠 338 个包，即全部运行时包也被根 tsconfig 或 tsdown workspace 覆盖。
- 运行时与测试重叠 338 个包，构建与测试重叠 392 个包，三者同时命中 338 个包。
- 只运行时 0 个，只构建 2 个，只测试 3 个。只构建的两个是 `@deepseek-ai/node-addon-system-workspace` 与 `@deepseek-ai/cordis-plugin-logger-console`；只测试的三个是 `@deepseek-ai/dsh-benchmarks`、`@deepseek-ai/website`、`dsh-python-runtime-closure`。

这也是严格候选为 0 的直接原因。根 tsconfig 聚合与根 tsdown workspace 把 `packages/*` 与 `vendor/*` 全部纳入构建面，任何剩下的包又会被包内测试或 benchmarks、website、python 兜住。

## 候选包清单

严格口径的候选包为 0 个，清单为空。也就是说，按用户提出的三闭包定义，没有可以只删源码就安全移除的上游包。

为了让“删源码能省多少”可判断，下面给出次口径清单，即运行时闭包之外、但仍被构建或测试锚定的 59 个包。它们不是可删候选；列在这里是为了说明这部分源码确实不进入安装包，同时展示删除会牵动哪些构建与测试配置。

| 包名 | 路径 | 类 | 文件 | 字节 | 最后变更 |
| --- | --- | --- | ---: | ---: | --- |
| @deepseek-ai/dsh-experimental-webworker-runtime | packages/experimental/webworker-runtime | build | 164 | 1,267.7 KiB | 2026-10-30 |
| @deepseek-ai/dsh-experimental-cua-macos | packages/experimental/cua-macos | build | 115 | 1,032.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-typert-generator | packages/typert/generator | build | 61 | 910.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-ptc-runtime-python | packages/experimental/ptc-runtime-python | build | 27 | 709.0 KiB | 2026-10-28 |
| @deepseek-ai/dsh-session-snapshot | packages/test-support/session-snapshot | build | 113 | 532.2 KiB | 2026-10-29 |
| @deepseek-ai/dsh-client-ui-dockkit | packages/client/ui-dockkit | build | 45 | 489.0 KiB | 2026-10-28 |
| @deepseek-ai/dsh-cua | packages/experimental/cua | build | 56 | 422.2 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-claude-code-mods | packages/experimental/claude-code-mods | build | 70 | 395.2 KiB | 2026-10-28 |
| @deepseek-ai/dsh-benchmarks | benchmarks | test | 48 | 313.3 KiB | 2026-10-29 |
| @deepseek-ai/dsh-client-test-runtime | packages/test-support/client-runtime | build | 40 | 286.1 KiB | 2026-10-28 |
| @deepseek-ai/dsh-ssh | packages/ssh/ssh | build | 43 | 253.2 KiB | 2026-10-29 |
| @deepseek-ai/dsh-subagent-codex | packages/subagent/subagent-codex | build | 29 | 218.0 KiB | 2026-10-28 |
| @deepseek-ai/dsh-sdk-client | packages/sdk/client | build | 21 | 207.6 KiB | 2026-10-29 |
| @deepseek-ai/dsh-cua-bundle | packages/experimental/cua-bundle | build | 21 | 203.4 KiB | 2026-10-28 |
| @deepseek-ai/dsh-lsp-stdio | packages/lsp/lsp-stdio | build | 31 | 202.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-llm-replay | packages/test-support/llm-replay | build | 9 | 192.7 KiB | 2026-10-28 |
| @deepseek-ai/website | website | test | 37 | 188.0 KiB | 2026-10-23 |
| @deepseek-ai/dsh-subagent-claude-code | packages/subagent/subagent-claude-code | build | 26 | 165.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-subagent-acp | packages/subagent/subagent-acp | build | 23 | 151.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-hooks-claude-code | packages/experimental/hooks-claude-code | build | 22 | 144.5 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-browser-use-stagehand-native | packages/experimental/browser-use-stagehand-native | build | 34 | 136.5 KiB | 2026-10-28 |
| @deepseek-ai/dsh-plugin-market-generator | apps/plugin-market-generator | build | 18 | 136.4 KiB | 2026-10-28 |
| @deepseek-ai/dsh-client-ui-slots | packages/client/ui-slots | build | 12 | 136.3 KiB | 2026-10-28 |
| @deepseek-ai/node-addon-system-workspace | native/system | build | 43 | 127.1 KiB | 2026-10-07 |
| @deepseek-ai/dsh-experimental-webworker-packer | packages/experimental/webworker-packer | build | 21 | 126.1 KiB | 2026-10-28 |
| @deepseek-ai/dsh-subagent-dsh-sdk | packages/subagent/subagent-dsh-sdk | build | 25 | 121.6 KiB | 2026-10-28 |
| @deepseek-ai/dsh-hooks-codex | packages/experimental/hooks-codex | build | 21 | 118.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-remote-mock | packages/test-support/remote-mock | build | 16 | 111.6 KiB | 2026-10-28 |
| @deepseek-ai/dsh-client-web | packages/client/web | build | 27 | 106.4 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-browser-use-runtime | packages/experimental/browser-use-runtime | build | 14 | 104.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-subagent-oar | packages/experimental/subagent-oar | build | 33 | 104.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-hook-protocol | packages/experimental/hook-protocol | build | 19 | 90.3 KiB | 2026-10-28 |
| @deepseek-ai/dsh-llm-mock-server | packages/test-support/llm-mock-server | build | 11 | 78.0 KiB | 2026-10-28 |
| @deepseek-ai/dsh-subprocess-ssh | packages/ssh/subprocess-ssh | build | 19 | 69.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-tool-lsp | packages/lsp/tool-lsp | build | 19 | 68.2 KiB | 2026-10-28 |
| @deepseek-ai/dsh-storage-sqlite | packages/storage/storage-sqlite | build | 17 | 63.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-loader-smoke | packages/test-support/loader-smoke | build | 16 | 62.1 KiB | 2026-10-28 |
| dsh-python-runtime-closure | python/sdk-runtime | test | 11 | 57.3 KiB | 2026-10-27 |
| @deepseek-ai/dsh-webhook | packages/experimental/webhook | build | 20 | 56.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-computer-use-cua-driver-native | packages/experimental/computer-use-cua-driver-native | build | 19 | 54.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-web-search-perplexity | packages/web/web-search-perplexity | build | 19 | 49.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-web-search-exa | packages/web/web-search-exa | build | 19 | 45.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-client-ui-claude-code-mods | packages/experimental/client-ui-claude-code-mods | build | 23 | 44.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-webhook-github | packages/experimental/webhook-github | build | 23 | 44.5 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp | packages/experimental/computer-use-cua-driver-mcp | build | 18 | 43.1 KiB | 2026-10-28 |
| @deepseek-ai/dsh-lsp | packages/lsp/lsp | build | 17 | 42.3 KiB | 2026-10-28 |
| @deepseek-ai/dsh-agent-loop-testkit | packages/test-support/agent-loop-testkit | build | 10 | 33.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-ssh-helper-runtime | packages/ssh/ssh-helper-runtime | build | 11 | 33.0 KiB | 2026-10-28 |
| @deepseek-ai/dsh-client-store | packages/client/store | build | 9 | 32.1 KiB | 2026-10-28 |
| @deepseek-ai/dsh-fs-ssh | packages/ssh/fs-ssh | build | 15 | 31.9 KiB | 2026-10-29 |
| @deepseek-ai/dsh-experimental-tool-subagent-oar | packages/experimental/tool-subagent-oar | build | 15 | 26.7 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-browser-use-playwright-mcp | packages/experimental/browser-use-playwright-mcp | build | 16 | 22.9 KiB | 2026-10-28 |
| @deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp | packages/experimental/browser-use-chrome-devtools-mcp | build | 16 | 22.8 KiB | 2026-10-28 |
| @deepseek-ai/cordis-plugin-hmr | vendor/hmr | build | 6 | 19.2 KiB | 2026-10-27 |
| @deepseek-ai/dsh-sandbox-ssh | packages/ssh/sandbox-ssh | build | 15 | 16.5 KiB | 2026-10-28 |
| @deepseek-ai/dsh-tool-testkit | packages/test-support/tool-testkit | build | 7 | 14.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-computer-use | packages/computer-use/computer-use | build | 16 | 14.8 KiB | 2026-10-28 |
| @deepseek-ai/dsh-browser-use | packages/browser-use/browser-use | build | 16 | 14.2 KiB | 2026-10-28 |
| @deepseek-ai/cordis-plugin-logger-console | vendor/logger-console | build | 8 | 8.6 KiB | 2026-10-27 |

## 收益与链接关系

严格候选为 0，删除收益为 0 个文件、0 字节、0 条 install 链接，安装包体积变化为 0。

次口径的 59 个包合计 1,695 个受控文件、10.53 MiB，占 397 个包受控文件的 13.2%、受控字节的 12.1%。它们持有 494 条 workspace 入边，本机实测有 474 条符号链接指向它们。删除它们会减少这些链接与源码，但仍不会让安装包变小，因为 core package set 的 333 个包不包含它们。它们按分组分布如下。

| 分组 | 包数 | 文件 | 字节 |
| --- | ---: | ---: | ---: |
| experimental | 21 | 767 | 5.05 MiB |
| test-support | 8 | 222 | 1.28 MiB |
| typert | 1 | 61 | 0.89 MiB |
| client | 4 | 93 | 0.75 MiB |
| subagent | 4 | 103 | 0.64 MiB |
| ssh | 5 | 103 | 0.39 MiB |
| lsp | 3 | 67 | 0.31 MiB |
| benchmarks | 1 | 48 | 0.31 MiB |
| sdk | 1 | 21 | 0.20 MiB |
| website | 1 | 37 | 0.18 MiB |
| apps | 1 | 18 | 0.13 MiB |
| native | 1 | 43 | 0.12 MiB |
| web | 2 | 38 | 0.09 MiB |
| storage | 1 | 17 | 0.06 MiB |
| python | 1 | 11 | 0.06 MiB |
| vendor | 2 | 14 | 0.03 MiB |
| computer-use | 1 | 16 | 0.01 MiB |
| browser-use | 1 | 16 | 0.01 MiB |

pnpm install 链接口径如下。所有 397 个包加根清单的 package.json 中，指向 workspace 包的依赖边共 6,523 条，其中 dependencies 1,045 条、peerDependencies 1,435 条、optionalDependencies 5 条、devDependencies 4,038 条。本机 node_modules 实测有 5,095 条符号链接指向 workspace 包。非 peer 的三类合计 5,088 条，与实测 5,095 条基本吻合，差 7 条来自 profile 的 link 依赖等安装期条目。peerDependencies 的 1,435 条大多由直接依赖处满足，不额外落链接，因此实测与 manifest 总边数的比值是 0.781。

工作树体积这里只统计受控源码，12,805 个文件、87.03 MiB，不含 node_modules、lib、dist、.git 与安装产物。本机完整工作树远大于此，不能把这 12,805 个文件当作磁盘占用全貌。

## 风险

- 上游同步。删包会让本仓与 DeepSeek Harness 的差异持续扩大，`upstream-sync-check` 与后续合并冲突成本上升。
- 类型检查聚合。根 `tsconfig.host.json` 与 `tsconfig.client.json` 的 references 覆盖 388 个包，include 还覆盖 `apps/web`、`website`、`benchmarks` 的测试文件。删包必须同步改 references、include、`tsconfig.base.json` 的 paths 与根 tsdown workspace 通配，否则聚合 typecheck 与 build 直接失败。
- 测试覆盖。59 个包里有 55 个带自己的测试；`test:coverage` 的 per-file 100% 门槛按 `packages/*/*/src` 统计，删包要同步改测试发现、覆盖率与 snapshot 归属。
- 客户端 UI 打包。ui-slots、ui-dockkit 等包通过 devDependencies 被客户端 bundle 内联，删除会断构建或丢 UI；它们不在 core package set，但确实进入浏览器产物，不能按“运行时不发布”当成可删。
- 后续功能。59 个包里 21 个是 experimental，合计 5.05 MiB，涵盖 webworker、CUA、browser-use、webhook、hooks、OAR、Python PTC 等能力；ON_DEMAND 插件与平台原生包删掉后，对应功能无法再通过插件安装恢复。
- vendor 与门禁。`vendor/*` 是固定上游副本，`rescope` 与 vendoring 流程依赖其存在；多个 `verify-*` 生成器会遍历全部包元数据，删包需要同步维护这些生成物。

## 建议方案

方案 A，不动上游源码，推荐。严格收益为 0，风险最低；安装包本来就不含这 59 个包。

方案 B，本机检出瘦身，推荐给“只想省磁盘”的场景。用 T-106 已落地的 worktree 稀疏排除与 `clean` 分批能力，不删源码、不改依赖与锁文件；需要时可随时恢复完整检出。

方案 C，维护 `lite` 工作区。只检出 core package set 与必要构建面，能省下约 10.53 MiB 受控源码以及对应 node_modules 链接；代价是 tsconfig、tsdown、测试发现与门禁脚本都要维护两套映射，且跟上游同步更难。不建议合入主线。

方案 D，维护删除补丁。把 59 个包从工作区删掉并同步修改所有构建与测试配置。预计只减少 1,695 个受控文件、10.53 MiB 源码与 474 条本机链接，安装包收益仍为 0，维护成本高，不建议。

如果目标是安装包体积，应动 core package set 的组成、客户端 bundle 与随包资源，按功能开关裁剪，而不是删上游源码。当前 core set 已有 333 个包，继续压缩会触碰运行时闭包，需要单独的产品级方案。

## 复跑

脚本位于 `lcoder/scripts/audit-package-closure.mjs`，只读；唯一写操作是显式传入 `--json` 时的输出文件。

```sh
node lcoder/scripts/audit-package-closure.mjs
node lcoder/scripts/audit-package-closure.mjs --check
node lcoder/scripts/audit-package-closure.mjs --json <输出路径>
```

`--check` 自测输出如下。

```text
自测通过：分类互斥、合计等于包数、根清单单列、两次运行结果逐字节一致。
```

`--check` 退出码为 0；默认运行最近一次的关键数字为工作区 397 个包加根清单，运行时 338、构建 56、测试 3、候选 0，core package set 333 个包，manifest workspace 边 6,523 条，实测链接 5,095 条。

`pnpm run test:docs` 最近一次结果为 21 passed、0 failed，退出码 0。首次运行遇到 `scripts/doc-standard.spec.ts` 的单测 5 秒超时，单独重跑该文件 22/22 通过，整组重跑也通过，判为门禁并发下的时序抖动。

## 未验项

- 本轮检出中没有 `desktop-packages.json`。该文件在打包阶段生成，所以 core package set 的 333 个包是按 `apps/desktop/scripts/prepare-package-set.ts` 的依赖口径等价计算，不是解包真实安装包得到的结果。
- 未运行 electron-builder 真实打包，安装包体积差为静态推导，不是称重结果。
- 未统计 node_modules、.git 与构建产物的磁盘占用；工作树体积只覆盖受控源码。
- 未删除任何包，未改依赖与锁文件，审计结论只描述本次检出的状态。
