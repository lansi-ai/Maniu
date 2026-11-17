# 决策适配器 spike：岗位分配建议层（2026-11-08）

> 范围：只回答「某个任务该由哪个岗位来干」这一层能否接决策模型。交付是接口草案、供应商核查、本地规则基线三件；所有产出都是建议，不改产品代码、不写 `.spec`、不提交 git。
>
> 权威边界：岗位分配的唯一写入口仍是人机命令 `/task_assign`（[task-assign.ts](../packages/lcoder/kernel/src/commands/task-assign.ts) 第 45–52 行与第 93–112 行），调度硬闸仍是 [scheduling.ts](../packages/lcoder/workspace/src/client/scheduling.ts) 第 100–106 行与第 289–298 行。本报告设计的适配器只返回候选与理由，不调用命令、不写 `Task.role`、不参与调度判定。
>
> 代码基线：分析对象是工作树 `.worktrees/t90-decision-spike` 的基线提交「feat(lcoder): 岗位名册与任务分配数据面」（2026-11-08，T-89 数据面）。主检出在 T-89 合入时另有一个收口提交，只把 [scheduling.ts](../packages/lcoder/workspace/src/client/scheduling.ts) 第 90 行注释里的「兑底」改成「兜底」，并修了详情弹窗刷新与两条回归测，与本报告结论无关。
>
> 结论逐条标「已证」或「未验」；只有官方页、包登记表与本机探测算证据，转载文章一律不采信。

## 目录

1. 摘要
2. 为什么这层只能做建议：现有权威链
3. 分配建议适配器接口草案
4. 供应商核查
5. 本地规则基线
6. 结论与建议
7. 未验项清单
8. 门禁与复现

## 1. 摘要

- **本地规则基线在真实任务上没有跑赢常量默认。** 40 条真实弱标签上，关键词直选 hit@1 为 23/40（57.5%），低于「一律 dev」的 82.5%；加上能力过滤后总 hit@1 为 35/40（87.5%），只高 5.0 个百分点，且有 7 条是零置信度兜底到 dev。已证（样本与脚本见第 5 节）。
- **Jev 在本机被法律原因挡在门外。** 2026-11-08 本机请求 `https://api.typesafe.ai/v1/systemone` 返回 HTTP 451，正文为 `{"title":"Typesafe is not available in your region.","status":451}`。已证（单机单点）。
- **OpenAI Decisions API 没有任何官方事实源可核。** `openai.com` 与 `platform.openai.com` 对文档抓取返回 403，浏览器打开停在人机校验页；`api.openai.com` 在本机连接超时。未验。
- **微软 Decision-1 是托管模型，不是可下载权重。** 官方发布页只给 Foundry 与 OpenRouter 两条使用路径，没有提权重下载或自托管；基座 Qwen3.5-9B 开源不等于本模型开源。已证（官方页未提供），可本地部署未验。
- **能本地部署的是 Clef、Laya、Von 这一支。** 三者都是 Apache-2.0 开源权重，其中 Clef 全兼容 Jev 的 System One 协议；但本机到 GitHub 与 Hugging Face 都超时，模型权重未实际下载。部分已证。
- **建议：现在不接主链。** 先补名册的可机读能力声明（技术栈强特征词、文件面偏好），再用现有会话模型做一次结构化排序；外部决策模型留成可选 provider，等真实分配样本与可访问性都过关再评估。已证依据见第 6 节。

## 2. 为什么这层只能做建议：现有权威链

岗位从声明到生效一共四处，缺一处就会退化成显示字段：

1. 名册声明：[.spec/roles.yaml](../.spec/roles.yaml) 第 3–19 行，四个岗位 `.NET`、`Vue`、`Python`、`Android`，都 `inherits: dev`；schema 在 [spec.ts](../packages/lcoder/kernel/src/schema/spec.ts) 第 349–360 行，写入与解析在 [role-store.ts](../packages/lcoder/kernel/src/kernel/role-store.ts) 第 39–45 行与第 76–82 行。
2. 任务落岗位：[spec.ts](../packages/lcoder/kernel/src/schema/spec.ts) 第 154 行 `role: z.string().min(1).optional()`。
3. 人机命令写盘：[task-assign.ts](../packages/lcoder/kernel/src/commands/task-assign.ts) 第 45–52 行注册、第 93–104 行解析岗位（名册优先、内置角色兜底、都不认识就拒绝）、第 106–112 行幂等判断与 `saveTask`。它按 [PROJECT-RULES.md](PROJECT-RULES.md) 第 21 行永不注册为模型工具。
4. 调度硬闸比对：[scheduling.ts](../packages/lcoder/workspace/src/client/scheduling.ts) 第 100–106 行 `roleGatePasses`（严格岗位、实施兜底）、第 289–298 行在候选打分前否决岗位不匹配的会话；会话有效岗位的推导在第 57–66 行。

角色天花板决定「能不能干」：[surface.ts](../packages/lcoder/kernel/src/kernel/surface.ts) 第 144–193 行，只有 `dev` 与 `ops` 带 `file_edit`，`intake`、`architect`、`pm`、`git`、`review`、`scheduler`、`flow`、`manager` 都没有写盘能力；内置角色集合在 [roles.ts](../packages/lcoder/kernel/src/schema/roles.ts) 第 11–22 行，共十个。这一条是第 5 节能力过滤的依据：把实施任务建议给只读角色，即使理由写得通，执行时也拿不到写盘工具。

因此适配器的正确位置是「命令之前的建议卡片」：输入是任务事实与名册，输出是排序候选与理由，人看过再执行 `/task_assign`。它不能成为 `decideScheduling` 的输入，否则等于让建议层改写硬闸。

## 3. 分配建议适配器接口草案

下面是 TypeScript 形状草案，用 `text` 代码块而不是 `ts`，因为它不落产品代码、不参与文档类型门禁；字段名与现有 schema 对齐，落地时再按包边界改。

```text
type AssignRequest = {
  task: {
    id: string
    title: string
    description: string            // 台账 note 或任务正文，允许为空
    type: string                   // 开发 / 缺陷 / 变更 / 文档 / 流程
    state: string
    dependsOn: string[]
    allowedPaths: string[]         // Task.scope.allowed_paths，空表示未声明
  }
  contract?: {
    summary: string
    irreversible: string[]         // 非空时强制人工，不给自动建议
    acceptance: string[]
  }
  rules: { id: string; module: string; text: string }[]
  fileSurface: string[]            // 契约与规格声明的落点；空表示未知
  dependencies: { id: string; state: string; role?: string }[]
  roster: {
    jobs: {
      id: string
      name: string
      inherits: BuiltinRoleId      // 只允许十个内置角色
      persona?: string
      signals?: {                   // 建议新增的可机读能力声明
        strong: string[]            // 技术栈特征词，如 c#、vue、kotlin
        medium: string[]            // 弱语义，如 页面、脚本
        preferredPaths: string[]    // 如 src/Client/、app/src/main/
      }
    }[]
    ceiling: Record<BuiltinRoleId, string[]>   // 由 surface.ts 角色表注入，不手抄
  }
  history?: { taskId: string; roleId: string; verdict: 'kept' | 'changed' }[]
}

type AssignSuggestion = {
  candidates: {
    roleId: string
    score: number
    confidence: number             // 本地规则是候选分占比，不是校准概率
    reasons: string[]              // 命中信号，直接给人看
    disqualified?: string          // 能力不足、岗位未知、不可逆任务等
  }[]
  decision: 'suggest' | 'needs_human'
  recommended?: { roleId: string; confidence: number; margin: number }
  policy: { accept: number; margin: number; source: 'project' | 'default' }
  humanAction: 'assign_via_task_assign' | 'pick_role' | 'leave_unassigned'
  offline: { mode: 'local_rules'; degradedFrom?: 'remote_model'; reason?: string }
  audit: { rubricVersion: string; inputDigest: string; at: string }
}
```

硬约束四条：

1. 只返回建议：不写 `Task.role`、不调用 `/task_assign`、不进入 `decideScheduling` 的输入，也不触碰 `.spec/evidence`。
2. 能力先于语义：候选必须按 `roster.ceiling` 过滤。任务需要写盘（`fileSurface` 非空，或类型属开发、缺陷、变更、文档、流程）时，只保留带 `file_edit` 的角色；只读复核、纯设计、提案这类任务才允许 `architect`、`review`、`pm`。
3. 不可逆任务不自动建议：`contract.irreversible` 非空时 `decision` 恒为 `needs_human`，与三道人签闸同口径（[PROJECT-RULES.md](PROJECT-RULES.md) 第 21 行）。
4. 理由必须是适配器自己算出来的命中信号，不能把外部模型返回的概率当理由；外部模型只提供排序与概率，理由由本地信号补。

阈值策略：

- 外部校准模型：`confidence ≥ 0.8` 且相对第二名 `margin ≥ 0.2` 才进 `suggest`；不满足转 `needs_human`。
- 本地规则：`confidence ≥ 0.6` 且分差 ≥ 1 才进 `suggest`；本地 confidence 是分数占比，没有校准语义，阈值只能当排序门槛，不能当准确率承诺。
- 两条都要求名册岗位可解析；未知岗位 id 不进候选，读侧按「缺信息」处理，与 [scheduling.ts](../packages/lcoder/workspace/src/client/scheduling.ts) 第 75–87 行的口径一致。

离线退化路径：

1. 默认只跑本地规则，零网络、零密钥、零外部数据外发。
2. 远端 provider 失败（超时、451、403、限流）一律降级成本地结果，`offline.degradedFrom = 'remote_model'` 并写原因；建议界面显示「本次未用外部模型」，不重试到阻塞。
3. 本地规则无任何命中时返回 `dev` 兜底、置信度 0、`needs_human`，不返回空列表，也不猜一个名册岗位。

接入点建议：独立包 `@maniu/role-suggest`，提供纯函数 `suggestRole(request): AssignSuggestion` 与可选 remote provider 接口；由客户端任务详情消费并渲染建议卡片，人点「采用」后再走既有命令。不挂在 kernel 的工具面，也不由模型自动触发。

## 4. 供应商核查

方法三条，互相不替代：一是本机网络探测（`curl`，不带任何凭据，只取状态码与错误），二是供应商官方页，三是包登记表（PyPI 与 npm 的公开 JSON）。文档抓取通道（WebFetch）能读到 GitHub 仓库页，但读不到 Hugging Face；本机直连两者都超时，所以「文档可读」不等于「本机可访问」，下表一律以本机探测回答大陆可访问性。

### 4.1 本机探测（2026-11-08，同一台机器）

| 目标 | 结果 | 读法 |
|---|---|---|
| `https://api.typesafe.ai/v1/systemone` | HTTP 451，正文 `{"title":"Typesafe is not available in your region.","status":451}` | 本机所在地区被法律原因拒绝，不是鉴权失败 |
| `https://api.openai.com/v1/models` | `curl: (28) Connection timed out after 20016 milliseconds` | 本机不可达，不能据此推断全国口径 |
| `https://openai.com` 与 `https://platform.openai.com` | 文档抓取通道 403；浏览器停在人机校验页 | 官方页无法作为事实源，相关属性全部未验 |
| `https://ai.azure.com` | 200 | 门户可达；模型是否在本订阅开通未验 |
| `https://api.cloudflare.com/client/v4` | 404 | 主机可达（404 是路径不存在）；Workers AI 账号可用性未验 |
| `https://openrouter.ai` | 200 | 网关可达；实际调用未验 |
| `https://huggingface.co` 与 `https://github.com` | 均为 `curl: (28)` 超时 | 本机拿不到权重与仓库；文档抓取通道只能读到 GitHub 仓库页 |

包登记表实测：`typesafe-sdk` 在 PyPI 为 0.7.5，`laya` 在 PyPI 为 0.4.28（许可字段 Apache-2.0）；`@typesafe-ai/sdk` 在 npm 为 0.7.0，`von-sdk` 在 npm 为 1.3.7；`laya-ts` 在 npm 查无此包。OpenRouter 模型目录实测 461 条，其中 `typesafe/jev-router` 在列但 `pricing.prompt` 为 `-1`（目录不公布价格），未见 `microsoft/decision-1`。

### 4.2 逐项核查

| 供应商/模型 | 形态与能力 | 大陆可访问性（本机） | 开源/可本地部署 | SDK | 定价 | 中文 | 数据外发条款 | 证据级别 |
|---|---|---|---|---|---|---|---|---|
| TypeSafe Jev（官方示例返回 `jev-1.13.0`） | 托管决策 API，`POST /v1/systemone`，Choice/Noul/Score 三种原语，返回校准概率与置信度，候选集在请求里自定义 | HTTP 451，地区拒绝 | 否：官方文档只给托管端点，未提供本地部署 | Python `typesafe-sdk` 0.7.5；JS/TS `@typesafe-ai/sdk` 0.7.0 | 输入 `$0.042`/百万 token，输出免费 | 官方未列语言，未验 | 官方称不用客户请求与响应训练；企业可申请零保留（ZDR） | 可达性、定价、SDK、条款已证；中文未验 |
| OpenAI Decisions API | 托管；二次资料称 predicate/choice/score，仅 GPT-6 Luna | 官方页 403、API 超时 | 未验 | 未验 | 未验（二次资料称输入 `$0.10`/百万、缓存 `$0.01`，输出免费） | 未验 | 未验 | 官方页不可达，全部未验 |
| Microsoft-Decision-1 | 托管；Qwen3.5-9B 后训练，单次前向返回每个选项的校准概率，支持是非、选择、评分与量规评分 | 门户 200；Foundry 开通未验 | 官方页只给 Foundry 与 OpenRouter，未提权重；基座开源不等于模型开源 | 官方未列 SDK | 输入 `$0.042`/百万 token，输出免费 | 官方未列；评测含多语与分布外任务 | 官方页无驻留与保留条款 | 形态、定价已证；本地部署、条款未验 |
| Cloudflare Clef / Clef-flash / Clef-omni | 托管 Workers AI 加开源权重；Clef 27B、Clef-flash 9B 级；全兼容 Jev 的 System One API | Cloudflare 主机可达；Workers AI 未验 | 是：Apache-2.0，Hugging Face 权重，可自托管 | 无官方 SDK，走 REST 与 Workers 绑定 | Clef `$0.24`、Clef-flash `$0.038`、Clef-omni `$0.15`（每百万输入） | 官方未列语言，未验 | 官方称不读、不存、不训练；Workers AI 标零保留 | 开源、定价、条款已证；中文未验 |
| Laya（Convai Innovations） | 开源非自回归决策模型，编码器家族约 150M–421M，多语版走 mmBERT，兼容 `/v1/systemone` | PyPI 可达；权重站点本机超时 | 是：Apache-2.0，`pip install laya` | Python `laya` 0.4.28 | 自托管无调用费；托管价未验 | 仓库称多语版覆盖 100 多种语言，未独立验证 | 自托管，数据不出本机 | 许可与包已证；中文效果未验 |
| Von | 开源 395M ModernBERT 编码器，单次前向，CPU 可跑，兼容 `/v1/systemone`；仓库已归档 | 本机 GitHub 超时，未下载 | 是：Apache-2.0 | `von-sdk` 1.3.7（npm） | 自托管无调用费 | 明确只支持英文，其他语言置信度不可信 | 自托管 | 许可、SDK、归档状态已证 |

### 4.3 关键差异

- **可访问性与可部署性不是一回事。** Jev 在本机被 451 挡住，但 OpenRouter 目录里有 `typesafe/jev-router`；就算网关能进，Jev 仍不能本地部署，数据必须外发。反过来，Clef、Laya、Von 能本地部署，但权重站点在本机不可达，落地要走镜像或代理，且需要自建推理。
- **「开源权重的 Microsoft Decision-1」不成立。** 官方页只写基于 Qwen3.5-9B 后训练、经 Foundry 与 OpenRouter 提供；是否发布本模型权重没有说法。把「基座开源」读成「模型可本地部署」会误导选型。
- **中文支持普遍没有官方承诺。** 只有 Laya 的仓库声称多语覆盖，Von 明确只支持英文；Jev、OpenAI、微软、Clef 的官方页都没有语言清单。中文任务分配属于短文本分类，语言风险比长文生成低，但没有实测就不能写「支持中文」。
- **定价都只按输入计费。** Jev、微软、OpenAI 都是输出免费或不计输出，Clef 按输入档位收费；按每次建议 2,000 输入 token 估算，1,000 次建议的成本是 Jev 与微软约 0.084 美元、OpenAI 约 0.20 美元、Clef 约 0.48 美元、Clef-flash 约 0.076 美元，自托管只剩机器成本。这是数量级估算，不是账单。
- **数据外发面。** 任务标题、描述、契约摘要与文件路径合起来能暴露仓库结构与业务边界；Jev 与 Clef 有「不训练」承诺，但请求仍出境。若只发脱敏后的任务摘要（去掉路径、客户名、内部编号），分类信号会明显变弱，这一点必须在上线前用真实样本测。

## 5. 本地规则基线

### 5.1 样本来源与口径

- 真实样本 40 条，取自本仓开发台账 [docs/tasks.yaml](tasks.yaml) 的 T-49 至 T-88（第 536 行到第 969 行），逐条抄录 `title`、`type`、`face`、`module`、`dep`，摘要取 `note` 首句前 160 字。样本文件是 [samples.real.json](../lcoder/spikes/decision-adapter/samples.real.json)，每条带 `source.line` 指回台账行号。
- 期望岗位是人工弱标签，不是事实。判定只用三件事：任务是否写文件、写的是业务代码还是设计/审计产物、任务类型是否属流程。四条规则：写产品或源码文件的归 `dev`；类型为流程且是脚本、发布、签名一类的归 `ops`；只出设计包、ADR、OpenAPI、DDL 且明确不改业务代码的归 `architect`；只读审计、按章程不改代码与台账的归 `review`。
- 名册里四个岗位（.NET、Vue、Python、Android）在 T-49 至 T-88 中一条也没命中：这段台账全是 TypeScript 桌面端、云端接入与文档，没有 C#、Vue、Python 或安卓任务。所以真实样本只覆盖内置角色；岗位路径由合成样本覆盖。
- 合成样本 20 条，见 [samples.synthetic.json](../lcoder/spikes/decision-adapter/samples.synthetic.json)，按接口草案的完整输入构造（标题、描述、契约摘要、规则、文件面、依赖），只为验证接口形状与打分路径。合成与真实分开统计，禁止相加或平均，合成上的 100% 不构成准确率证据。

### 5.2 两种规则口径

- 关键词直选：标题权重 2，描述、契约、规则、文件面各 1；技术栈强特征词权重 3，弱语义词权重 1；类型先验按流程→ops、缺陷→dev、文档→pm、开发→dev。名册岗位必须命中强特征词才参与，避免「页面」「组件」这类词把 TypeScript 桌面端误判成 Vue 岗位。置信度是候选分占比，分差是第一名减第二名，`confidence ≥ 0.5` 且分差 ≥ 1 才给自动建议。
- 关键词加能力过滤：在上一条基础上，需要写盘的任务只保留 `surface.ts` 角色表里带 `file_edit` 的角色（`dev`、`ops` 与四个继承 dev 的岗位）。这条约束来自代码而不是标签：`review`、`scheduler`、`flow`、`manager`、`intake` 就算语义最像也拿不到写盘工具。
- 无命中时返回 `dev` 兜底、置信度 0、强制 `needs_human`，不返回空列表。兜底命中单独计数，不混进「有依据」的命中率。

### 5.3 结果

| 口径 | 样本 | hit@1 | 有依据样本 hit@1 | 兜底条数 | 多数类基线 | 阈值覆盖率 | 阈值内准确率 |
|---|---|---|---|---|---|---|---|
| 关键词直选 | 真实 40 | 23/40（57.5%） | 21/38（55.3%） | 2 | dev 82.5% | 87.5% | 57.1% |
| 关键词 + 能力过滤 | 真实 40 | 35/40（87.5%） | 29/33（87.9%） | 7 | dev 82.5% | 82.5% | 87.9% |
| 关键词直选 | 合成 20 | 20/20（100%） | 20/20（100%） | 0 | dotnet 20% | 95% | 100% |
| 关键词 + 能力过滤 | 合成 20 | 20/20（100%） | 20/20（100%） | 0 | dotnet 20% | 95% | 100% |

读法：

1. 关键词直选明显有害：17 条 miss 里有 11 条被只读角色抢走（`scheduler` 4 条、`flow` 2 条、`intake` 3 条、`review` 2 条），3 条被 `architect` 抢走，2 条被 `ops` 抢走，1 条被 `pm` 抢走，原因是任务标题里写着「调度」「流程」「立项」「审计」「架构」这些职责词，而规则把职责词当成了执行角色。
2. 能力过滤把上述误判压到 5 条，但总 hit@1 仍只比「一律 dev」高 5.0 个百分点；7 条兜底里有 6 条恰好命中 dev，也就是说增益主要来自「默认 dev」，不是来自规则识别。
3. 合成样本 100% 是构造使然：样本文本里的技术栈词与规则词表由同一个作者写，属于接线验证，不能对外引用为准确率。

### 5.4 真实样本弱标签与依据（40 条）

| 样本 | 期望岗位 | 判定依据（弱标签） |
|---|---|---|
| T-49 | dev | 组件入口加纯判定修复，改产品代码；名册四个岗位都不对应 React/TS |
| T-50 | dev | schema 与读写路径实现；名册无后端岗位 |
| T-51 | dev | 调度判定接到外壳执行，改产品代码 |
| T-52 | dev | 队列可见性属界面实现；名册的 Vue 岗位是 Vue 栈，不能套到 React 外壳 |
| T-53 | dev | 调度内核与界面实现 |
| T-54 | dev | 空态栏两个入口的界面实现 |
| T-55 | dev | 调度硬闸代码实现 |
| T-56 | dev | 流程引擎纯函数与事实装配 |
| T-57 | dev | 新增产品数据 schema 并接读取；architect 没有 file_edit，落地只能给实施 |
| T-58 | dev | 自签闸与状态机实现，附文档同步 |
| T-59 | dev | 流程面板与两条人机命令实现 |
| T-60 | dev | 两个常驻 preset 与外壳入口实现 |
| T-61 | dev | 压缩装配与可见性实现 |
| T-62 | dev | 立项咒语模板改写并补测；仍是源码文件改动 |
| T-63 | dev | 装配加 ask-user 与提问口径 |
| T-64 | dev | 图标资产替换与外壳标替换 |
| T-65 | dev | 主进程首屏开关实现 |
| T-66 | dev | 模型选择浮层实现 |
| T-67 | dev | 附件上传与 remote 注入实现 |
| T-68 | ops | 类型为流程：上游体检脚本属于运维工具 |
| T-69 | ops | 类型为流程：按层重建脚本属于运维工具 |
| T-70 | dev | 流式渲染与滚动缺陷修复 |
| T-71 | dev | 遮罩几何缺陷修复 |
| T-72 | dev | 内置咒语不画成用户气泡的修复 |
| T-73 | dev | 任务详情三处裁剪实现 |
| T-74 | dev | 结果页与重新开始流程实现 |
| T-75 | architect | 纯设计包，产出 ADR、OpenAPI、DDL，不改业务代码 |
| T-76 | dev | 登录门禁与令牌刷新实现 |
| T-77 | architect | 纯设计包，产出身份与发布契约、平台矩阵 |
| T-78 | dev | 身份与更新源实现 |
| T-79 | dev | 更新界面实现 |
| T-80 | dev | macOS 适配与打包实现 |
| T-81 | ops | 类型为流程：COS 与 CDN 发布、回滚流水线 |
| T-82 | ops | 类型为流程：签名与公证 |
| T-83 | dev | 个人中心页面与云端读取实现 |
| T-84 | dev | 写 README；名册没有文档岗位，有 file_edit 的只有实施与运维 |
| T-85 | dev | 写单文件 HTML 报告；同上，属文件写入 |
| T-86 | review | 只读审计，按章程不改代码与台账 |
| T-87 | dev | 类型为开发：冒烟脚本是产品开发工具，需 file_edit 与跑命令 |
| T-88 | dev | 文档修正，实际写文件 |

### 5.5 miss 清单

能力过滤口径的 5 条 miss：

- T-75：期望 architect（纯设计包），规则选 dev（置信度 1.00，分差 1）。原因是能力过滤把架构设计也当成写盘任务，设计包被并进实施；需要「只出设计」意图识别，单靠关键词不够。
- T-77：期望 architect（纯设计包），规则选 ops（置信度 0.67，分差 1）。标题里的「发布」命中了运维词，设计包被读成发布任务。
- T-80：期望 dev（打包实现），规则选 ops（置信度 0.67，分差 1）。「打包」与「构建」是运维词，但这条任务改的是 macOS 适配代码；这也是弱标签本身有歧义的一条。
- T-86：期望 review（只读审计），规则选 dev（兜底，置信度 0，分差 0）。标题「审计报告」只命中 review，但能力过滤把 review 排除后没有任何候选，退回兜底。
- T-87：期望 dev（产品冒烟工具），规则选 ops（置信度 0.80，分差 3）。「冒烟」「脚本」在运维词表里权重更高；这条与 T-68、T-69 的边界确实靠类型区分（开发对流程），规则读到了却让位给了更强的运维词。

关键词直选口径的 17 条 miss（用于说明为什么先加能力过滤）：

- 被只读角色抢走 11 条：T-53、T-55、T-60、T-61 选 scheduler；T-56、T-59 选 flow；T-54、T-62、T-74 选 intake；T-79、T-88 选 review。
- 被 architect 抢走 3 条：T-50 因「schema」、T-73 因「裁剪」被读成规格改动、T-85 因标题含「架构」。
- 被 ops 抢走 2 条：T-80 因「打包」、T-87 因「冒烟脚本」。
- 被 pm 抢走 1 条：T-84 因标题含 README。

### 5.6 基线的能说明什么、不能说明什么

能说明的：

- 在「名册岗位与仓库技术栈完全不匹配」的项目里，纯关键词规则不如常量默认；把职责词当执行角色是主要错误来源。
- 从工具天花板推出的能力过滤是有效且可解释的约束，能把误判从 17 条压到 5 条，且不需要任何模型。
- 空输入必须显式兜底并转人工；返回空列表或猜一个名册岗位都会让界面无法解释。

不能说明的：

- 不能说明 87.5% 是「准确率」。样本只有 40 条，标签是弱标签，规则与标签都从同一批标题和 note 里抽词，存在循环；真实分配事实（谁最终被派给哪条任务、是否被改派）没有记录。
- 不能说明真实生产输入下的表现。台账 note 是过程记录，不是任务规格；接口草案里的契约摘要、规则、文件面在真实样本中大多缺失，这正是 7 条兜底的直接原因。
- 不能说明名册岗位路径可用。四个岗位只由 20 条合成样本覆盖，且合成文本与词表同源。

## 6. 结论与建议

### 6.1 本地基线够不够用

不够用来做自动分配，也不够用来宣称「建议准确」。真实弱标签上它没有跑赢「一律 dev」，有依据样本的 87.9% 也只覆盖 33 条，另 7 条靠兜底。原因是结构性的：名册四个岗位与这个仓库的技术栈零交集，台账 note 又不是任务规格，规则只能读到职责词，读不到技术栈与落点。

够用来做两件事：一是证明「能力过滤 + 显式兜底 + 转人工」这套形状是对的，二是证明纯关键词排序会把实施任务派给只读角色。这两条都不需要模型，先把它们做进建议层，再谈外部模型。

要让它变成可用的基线，缺的是输入而不是模型：名册要有可机读的技术栈强特征词与落点偏好（`signals.strong`、`signals.preferredPaths`），任务要带描述、契约摘要与文件面。补齐后再用同一套脚本重测，才有资格比较外部模型。

### 6.2 外部决策模型值不值得接

现在不接。三条理由按权重排：

1. **可访问性不过关。** Jev 在本机被 451 拒绝，官方没有本地部署；OpenAI 官方页与 API 都不可达；微软只给托管入口，权重未证；能自托管的 Clef、Laya、Von 需要先把权重弄进来并自建推理，本机到权重站点超时。接一个连不上或必须外发的服务，不能作为建议层的第一版。
2. **收益没有证据。** 没有任何一家的官方页给出「任务 → 岗位」这种人事分配任务的指标；它们的评测是分类、路由、工单分派。我们的本地基线又在弱标签上跑不赢常量默认，此时换模型无法判断提升来自模型还是来自标签噪声。
3. **外发与误导风险。** 任务标题、描述、契约与路径出境会暴露仓库结构；模型返回的是概率，不返回可解释理由，若把概率直接显示成「为什么选它」就是伪造解释。成本不是阻碍：按每次 2,000 输入 token 算，1,000 次建议约 0.08 美元，量级可以忽略。

如果将来要接，接在这里：

- **位置**：建议层 provider，位于 `suggestRole` 接口之后，由客户端建议卡片消费；不进 `/task_assign`、不进 `decideScheduling`、不进模型工具面，也不写任何 `.spec` 文件。
- **开关**：按项目配置，默认关闭；打开后仍然本地优先，只有本地置信度低于阈值且用户勾选「允许外发摘要」才调远端。
- **阈值**：外部模型要求 `confidence ≥ 0.8` 且 `margin ≥ 0.2`；本地规则要求 `confidence ≥ 0.6` 且分差 ≥ 1。两者都只在「建议」层生效，不可逆任务恒转人工。
- **输入裁剪**：只发任务标题、脱敏描述与契约摘要；默认不发绝对路径、客户名、内部编号。若裁剪后信号不足，就承认信号不足并转人工，不要用模型补猜。
- **降级**：远端超时、451、403、限流一律回到本地规则，界面标注「本次未用外部模型」，不重试到阻塞；本地无命中则 `dev` 兜底并转人工。

替代方案三条，按推荐顺序：

1. **改名册契约，先不接 AI。** 给 `JobRole` 加可选 `signals`（强特征词、弱语义词、落点偏好），由研发经理在起草岗位时填；本地规则直接消费。这是投入最小、可解释性最好的一步，也能让 `/task_assign` 的候选列表按相关性排序。代价是名册维护成本上升，且只能覆盖能写成词表的判断。
2. **用现有会话模型做一次性排序。** 会话里已经有模型，加一条只读的建议命令或客户端动作，让模型按固定 JSON 返回排序与理由；不引入新厂商、不外发到新地方。代价是每次建议消耗会话 token、延迟更高，且按仓规「模型可见即须落日志」，需要新增会话事件或复用命令日志；模型输出同样只作建议。
3. **自托管 Laya 或 Clef。** 只有在「必须离线、且数据绝不能出内网」时才值得：Laya 约 421M，CPU 可跑，中文效果未验；Clef 更大，需要 GPU 与推理运维。代价是机器、部署、升级与中文评测，且概率仍需在自有样本上校准。

不推荐把外部决策模型作为默认路径，也不推荐为了「看起来智能」而绕过能力过滤：工具天花板是代码事实，模型概率不能改变一个只读角色没有 `file_edit` 这件事。

### 6.3 代价清单

- 数据外发：任务文本出境，即使供应商承诺不训练，也改变了数据边界。
- 供应商锁定：每家协议都是 System One 兼容，但候选集、置信度语义、错误码不同，换供应商要重测阈值。
- 运营成本：自托管要 GPU、镜像、限流与升级；托管要账号、额度与地区合规。
- 误判成本：建议被当成事实会污染 `/task_assign` 的权威；必须始终保持「建议可忽略、命令才生效」。
- 输入投毒：任务描述是外部可写文本，可能包含指令注入；外部模型与建议卡片都不得执行任务文本里的指令，只做分类输入。
- 维护成本：词表与阈值会漂移，需要版本号、回归样本与定期重测。

## 7. 未验项清单

1. Jev 的大陆可用性只测了本机单点到 `api.typesafe.ai` 的 451；其他地区、其他网络与 OpenRouter 路径均未验，`typesafe/jev-router` 只是目录可见，未实际调用。
2. Jev 的中文效果、任务分配场景准确率、上下文与限流细节未验；官方页没有语言清单。
3. OpenAI Decisions API 的全部属性未验：官方页 403、API 超时，定价与模型只来自二次资料，不采信。
4. Microsoft-Decision-1 在本订阅的 Foundry 开通状态、OpenRouter 上架状态（目录实测未见）、数据驻留与保留条款、权重是否发布、中文效果，全部未验。
5. Clef 的 Workers AI 账号可用性、Apache-2.0 许可文件正文、中文效果、自托管显存与吞吐未验；权重未下载。
6. Laya 与 Von 的权重下载未完成（本机 GitHub 与 Hugging Face 都超时，Hugging Face 通过文档抓取通道也失败）；Laya 的中文效果、Von 的非英文行为未验（Von 官方明确只支持英文）。
7. 任何外部决策模型在「任务 → 岗位」上的表现都没有实测；本报告没有发出过一次模型请求。
8. 建议层的真实收益未验：没有真实分配事实、没有改派记录、没有 A/B；87.5% 只是规则与弱标签的一致率。
9. 接口草案里的契约摘要、规则、文件面在真实样本中大多缺失，完整输入下的表现只有合成样本，未验。
10. 阈值未校准：本地 confidence 是分数占比，不具备概率语义；外部模型的 0.8 阈值是按行业惯例给的起点，未在自有样本上校准。

## 8. 门禁与复现

交付文件四件，全部是新增；另有一处被工单允许的清单改动：

| 文件 | 作用 |
|---|---|
| [docs/spike-2026-11-08-decision-adapter.md](spike-2026-11-08-decision-adapter.md) | 本报告 |
| [lcoder/spikes/decision-adapter/evaluate.ts](../lcoder/spikes/decision-adapter/evaluate.ts) | 只读评估脚本，读名册与两份样本，输出两种口径的 hit@1、兜底数、阈值覆盖与 miss 清单 |
| [lcoder/spikes/decision-adapter/samples.real.json](../lcoder/spikes/decision-adapter/samples.real.json) | 40 条真实任务弱标签，每条带台账行号与判定依据 |
| [lcoder/spikes/decision-adapter/samples.synthetic.json](../lcoder/spikes/decision-adapter/samples.synthetic.json) | 20 条合成样本，只覆盖名册岗位与内置角色的接口形状 |

门禁结果：

- **台账未改动**：本仓 Python 3 环境对 `docs/tasks.yaml` 做字节级 sha256，工作树值与 `git show HEAD:docs/tasks.yaml` 相同，判定为未改；脚本只读该文件，没有写回。
- **文档门禁**：`pnpm run test:docs` 退出 0，原文为 `run-gates: 21 passed, 0 failed, 0 skipped`；21 项含 markdown wrap、markdown links、translation pairing、repository references、doc budgets 等全部 PASS。
- **脚本静态检查**：`pnpm exec oxlint lcoder/spikes/decision-adapter/evaluate.ts` 退出 0，原文为 `Found 0 warnings and 0 errors.`（1 个文件、90 条规则）。脚本用 `.ts` 而不是 `.mjs`，因为仓内 `.oxlintrc.json` 的 `ignorePatterns` 含 `**/*.mjs`，用 `.mjs` 跑 oxlint 会得到 `No files found to lint`，那样的门禁是空的。
- **评估可复现**：`pnpm exec tsx lcoder/spikes/decision-adapter/evaluate.ts --out <file> --json <file>` 退出 0；不传输出参数时打印同一份报告。脚本只读仓内文件，不联网、不写产品数据。
- **配对清单**：新增报告落在 `docs/` 扫描范围内，门禁要求中英配对与 `.i18n.yaml`。按 T-86 先例，在 [translation-pairing.manifest.json](../scripts/translation-pairing.manifest.json) 的 `excluded` 里只加了本报告一行，理由是这是一次性中文单语 spike 报告，补一份翻译配对等于伪造维护承诺；没有改动其他行。

复现命令：

```text
pnpm exec tsx lcoder/spikes/decision-adapter/evaluate.ts
pnpm exec oxlint lcoder/spikes/decision-adapter/evaluate.ts
pnpm run test:docs
```
