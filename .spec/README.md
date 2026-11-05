# .spec —— LCoder 产品示例数据

本目录是 LCoder 的示例工作区数据，用来演示规格库、任务状态机与工具面收放。它不是 LCoder 自身的开发任务台账。

- **开发台账**：`docs/tasks.yaml`（dev-flow，人维护）。
- **示例规则**：`DR-01`（已确认，有代码落点）、`DR-02`（草稿，尚无落点）。
- **示例任务**：`DEMO-01`（`drafting`）。
- **示例契约**：`contracts/DEMO-01.contract.yaml`（由 `contract_draft` 起草，`sig` 为空，等人在任务详情里签署）。
- **示例状态机**：`spec/states/order.yaml`。
- **示例命令**：`env.yaml`。
- **示例项目信息**：`project.yaml`（仓库、文档、web 环境；密码只存引用，不落明文）。

需要管理真实项目时，把本目录替换为目标工作区的 `.spec`。
