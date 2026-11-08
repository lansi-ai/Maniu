# 激活上下文与任务看板 (active-context.md)

[English](active-context.md) | 中文

## 01. 当前迭代目标 (Current Sprint Goal)

- **版本阶段**：MVP-0 —— 工作台在本地跑通。
- **核心业务价值**：agent 在工作台里按 `.spec` 规格与任务状态机工作，改动有契约、有证据、可复核。
- **关键交付物**：kernel 挂载后按 `packages/lcoder/kernel/src/kernel/surface.ts` 的角色表注册模型工具，并注册包含 `/contract_sign` 的人机命令；右栏工作台三栏；文件投影读出任务、规则与契约。

## 02. 任务看板 (Task Board)

- **开发台账（dev-flow）**：`docs/tasks.yaml`，人维护，是开发进度的唯一源。
- **产品数据（LCoder）**：`.spec/` 是产品示例数据（订单佣金：`DR-01`/`DR-02`、`DEMO-01`），供 kernel 与 UI 读取；它与开发台账 ID 不重叠，改产品数据不改变开发进度。
- **离线看板**：`docs/tasks-html/index.html`（双击打开，含概览、状态看板、层级树、矩阵与筛选）。
- **重跑命令**：`python scripts/build-tasks-html.py`。

- **当前焦点**：两条轨。云端项目：A2 至 A10 仍在分支上代码完成，真实 Postgres、opencode、Docker 与 Caddy 验收（A2b、A3b、A5c、A9d）挂起；A9b、A11、A9f 仍登记在办。桌面轨：T-89 岗位名册、分配命令与严格岗位硬闸，T-90 决策模型调研，T-91 名册可机读信号与本地建议层，T-92 任务详情建议卡片，均已在 `lcoder/main` 收口且门禁全绿、工作树已删；T-93 建议理由本地化尚未派工。T-78 不带打包收口、T-83 个人中心仅有合成证据，因此安装身份、签名与真实云端仍未验；后续 T-79、T-80、T-81、T-82 不变，其中 T-80 需要用户的 Mac，T-82 需要证书。
- **已完成**：T-01 文件投影；T-02 宿主挂载；T-04 规格根与文档门禁；T-05 LCoder 外壳；T-06 真实 `.spec`/`project.yaml`/工作区会话数据；T-07 项目信息抽屉与 `.spec/project.yaml` schema；T-08 真实悬浮对话；T-09 README、测试与旧预设收口；T-56/T-57/T-58 流程引擎、自动化策略与 AI 自签三闸；T-59/T-60/T-61 流程界面、单例会话与压缩可见性；T-66/T-67 会话模型切换与图片文件附件；T-73 任务详情三处裁剪与 T-74 立项结果页与重新开始；T-89 岗位分配数据面、T-90 决策模型调研、T-91 名册信号与本地建议层、T-92 任务详情建议卡片。T-03 已被外壳取代并关闭。
- **下一步**：见 §04。

## 03. 关键决策与架构遗留 (Key Decisions & Context)

- **已做出的关键技术决策**：
  - 数据面走文件投影，不自建 Remote、不引 typert 生成器。
  - 工具面按状态 fail-closed；`contract_sign` 不进模型工具。
  - 挂载只走 `lcoder/cordis.patch.yml`，不改上游清单。
  - `.spec/tasks` 是产品数据；`docs/tasks.yaml` 是开发台账；两者不互相派生，看板只从开发台账生成。
  - 规格根跟随会话工作区（`session.header.cwd/.spec`）；没有会话 cwd 时退回配置的 root，再退回 `process.cwd()/.spec`。
  - LCoder 外壳方向已确认：首页=项目+任务板；左上项目切换弹窗；选任务弹对话并自动填 dev-flow 启动咒语；修改阶段主窗缩成悬浮对话窗、任务板窗保留；只保留设置。
  - 外壳默认占用 `lcoder-home` 主面板；`shell: false` 回退旧的右栏工作台页签。桌面 profile 禁用 `ui-sidebar`，外壳自己的左栏是唯一导航。
  - 项目信息落在 `.spec/project.yaml`；密码/Token 只存引用（`passwordRef`）。抽屉默认掩码，眼睛显示本机解析值，不入库、不进模型。
  - 外壳从会话工作区的 `.spec` 读真实任务/规则，从 `.spec/project.yaml` 读项目信息；项目选择器的「打开仓库」会创建/复用工作区并建会话，不离开外壳就能打开新仓库。
  - 悬浮对话通过会话控制器发送启动咒语，并从会话事件窗口渲染真实用户/助手文本；输入框继续同一会话。kernel 的 `file_read`/`file_edit` 改用仓库根，`env.yaml` 与证据仍留在 `.spec`。
  - 桌面 profile 的 LCoder 预设已改为挂载 `@lcoder/kernel`；旧 WorkBuddy 包链接在 T-09 清理。
- **风险与技术债记录**：
  - 签署走人机命令 `/contract_sign`：宿主复算契约正文哈希后写 `sig`，`/task_contract` 在任务进入 `contracted` 前再复核签名；三闸不全的 agent 签名会被拒。
  - 任务状态没有独立迁移工具：`/task_contract` 把已签任务从 `drafting` 推到 `contracted`，`task_close` 负责收口，`task_transition` 不存在。
  - `DEMO-01` 处于 `drafting`；`.spec/contracts/DEMO-01.contract.yaml` 已入库但 `sig: null`，示例 `env.yaml` 已就位。
  - `file_read` 与 `file_edit` 以仓库根为边界；规格根只保留 `env.yaml` 与证据。
  - 桌面 profile 是九个角色 preset，各挂一份 `@lcoder/kernel`，没有全局 kernel 行，也不再引用 `WorkBuddy/LCoder`。
  - 悬浮对话渲染流式正文与思考、贴底跟随、Markdown、审批与提问卡片；工具卡片尚未渲染。
  - 演示仓库没有 `.spec/local.yaml`，抽屉眼睛显示「未配置」；本机解析路径已实现，但没有样例文件可读。
  - 任务卡片按 `.spec/tasks/<ID>.yaml` 的 `session` 字段认领自己的会话；未绑定的卡片显示「未开始」，不借用别的会话状态。
  - 「打开仓库」有 15 秒超时与可区分的超时/拒绝文案（T-17）；底层文档目录查询挂死属上游，本仓不修（T-12、T-15、T-16）。

## 04. 下一步即时行动 (Next Immediate Actions)

- **当前正在处理**：T-94 把岗位建议从独立卡片移到现有分配芯片上，原卡片把同一批岗位列了两遍；打分、阈值与分配权威不变。
- **即将执行**：T-94 收口后按用户优先级继续 T-79 至 T-82 发布链；本地提交的合入与推送仍由用户决定。
- **待定决策**：产品任务是否补 `type` 字段，让建议层能区分只读任务；生产短信通道、20 美元额度背后的 opencode 实际单价、部署域名与主机，以及是否补应用层匿名总开关与 `/health` 端点。
- **开发证据**：门禁命令输出记录在 `docs/tasks.yaml` 的任务 note 或提交说明；`.spec/evidence` 只服务产品任务。
- **看板重跑**：开发状态变化后先改 `docs/tasks.yaml`，再执行 `python scripts/build-tasks-html.py`。
- **文档门禁**：已随 T-02 与 T-04 收口；改文档时包 README 与中英配对必须保持全绿。
- **AI 交互指令提示**：后续会话可直接提示「按 active-context.md 的下一步继续执行」。

## 05. 规则自我演进维护

本文件为动态看板。每次开发任务收口或业务需求变更时，先改 `docs/tasks.yaml`（开发台账），再跑 `python scripts/build-tasks-html.py`，最后按 [PROJECT-RULES.zh.md](PROJECT-RULES.zh.md) §3 的更新协议更新本文件的当前焦点；只维护当前窗口，完成史留在 git。产品数据（`.spec`）的变更另走产品流程，不通过本看板。C 类小任务不强制更新，日末或发版统一收口。
