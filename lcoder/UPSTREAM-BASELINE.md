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
| 基线 commit | `ce7073d51254c26cd63b22a60835b8f948deb447` |
| 提交时间 | 2026-10-30 00:13:15 +0800 |
| 提交标题 | `Merge pull request #7552 from deepseek-harness/fix/webworker-live-import-bindings` |
| Node 要求 | `>=24.9.0` |
| 登记日期 | 2026-11-02 |

升级基线 = 改这张表 + 走一遍第 4 节的演练。不写"大概""差不多"，只写 commit sha。

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
| `lcoder/` | 本目录：基线登记、脚本、我们自己的说明 |
| `packages/lcoder-kernel/` | 规格库、任务状态机、检查器、工具实现（原 LCoder 项目代码迁入） |
| `packages/lcoder-workspace/` | 三栏工作台的 client UI 插件 |

### 修改的上游文件（冲突点）

| 文件 | 改什么 | 为什么必须改 |
|---|---|---|
| （暂无） | | |

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
pnpm --filter lcoder-kernel test
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
