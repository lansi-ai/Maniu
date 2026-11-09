# .spec —— LCoder 产品示例数据

本目录是 LCoder 的示例工作区数据，用来演示规格库、任务状态机与工具面收放。它不是 LCoder 自身的开发任务台账。

- **开发台账**：`docs/tasks.yaml`（dev-flow，人维护）。
- **示例规则**：`DR-01`（已确认，有代码落点）、`DR-02`（草稿，尚无落点）。
- **示例任务**：`DEMO-01`（`drafting`），带描述、领域 `data`、变更类型 `feature` 与一张示例图片附件。
- **示例契约**：`contracts/DEMO-01.contract.yaml`（由 `contract_draft` 起草，`sig` 为空，等人在任务详情里签署）。
- **示例状态机**：`spec/states/order.yaml`。
- **示例命令**：`env.yaml`。
- **示例项目信息**：`project.yaml`（仓库、文档、web 环境；密码只存引用，不落明文）。
- **示例岗位**：`roles.yaml`（研发经理起草的岗位名册，每个岗位继承一个内置角色）。岗位可选 `signals`，是三组字符串数组：`strong` 技术栈强特征词、`medium` 弱语义词、`preferredPaths` 文件落点前缀；每组最多 32 条、每条最多 64 个字符，忽略大小写去重。`signals` 只供本地建议层排序，不参与调度硬闸。

任务可选四个需求字段：`description` 写要做的事与原因，允许换行，最多 4000 个字符；`category` 是领域，取 `page`、`api`、`data`、`other`；`change_type` 是变更类型，取 `bug`、`feature`、`improvement`、`style`；`attachments` 是图片附件，最多 8 张。四个字段都不填的旧任务照常解析，读出的描述为空串、附件为空数组、分类省略。

附件只收图片，扩展名限 `png`、`jpg`、`jpeg`、`webp`、`gif`；路径相对 `.spec` 根目录，不接受绝对路径、`..` 上跳与空串。目录约定为 `.spec/attachments/<任务编号>/<文件名>`，例如 `attachments/DEMO-01/bull-mark.png`。文件缺失不算规格错误，由界面显示占位。

需要管理真实项目时，把本目录替换为目标工作区的 `.spec`。
