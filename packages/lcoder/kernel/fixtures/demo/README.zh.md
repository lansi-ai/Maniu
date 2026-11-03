# demo —— LCoder 的被测仓库

[English](README.md) | 中文

极简，但每一处都能证伪：

| 文件 | 用来验证什么 |
|---|---|
| `src/price.ts` | `R-01` 的落点。改名会让 P1 失败 |
| `.spec/spec/rules.yaml` | `R-01` 已确认且有落点；`R-02` 是 draft 无落点（P1 应跳过它） |
| `.spec/spec/states/order.yaml` | 状态机，后续 P5′ 用 |
| `.spec/tasks/T-01.yaml` | 起始状态 `drafting`——未签契约，模型不该能碰 `src/` |
| `.spec/env.yaml` | `build`/`test` 是 `ai-auto`；`deploy-prod` 是 `human`（模型必须被拒） |

把 `LCoder` 的 preset 指向 `.spec` 目录（不是仓库根）。

预期：

- `spec_query` 能查到 `R-01`、`R-02`
- `spec_bind` 能给 `R-02` 加落点并写回
- `cmd_run build` 能跑；`cmd_run deploy-prod` 必须被拒
- 任务在 `drafting` 时，`file_edit` 不在工具面里——这是 S1 的判据
