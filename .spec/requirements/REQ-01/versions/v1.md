# 需求评审与版本留存示例

这条需求演示评审与版本留存的流程：

- 初稿在 `requirement_draft` 落盘时存成 v1。
- 项目经理用 `requirement_review_draft` 每轮写一份评审报告。
- 需求分析师用 `requirement_revise` 改稿，每次留下一个新版本。
- 人至少看过一轮评审后才用 `/requirement_approve` 过审，并锁定 `approved_version`。
