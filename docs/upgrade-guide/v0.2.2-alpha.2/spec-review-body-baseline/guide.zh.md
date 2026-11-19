---
kind: upgrade-guide
description: "LCoder 的 .spec 新增原地修改草稿的 patch 提案与可选的评审正文基线；旧提案与旧评审仍可读。"
---

# LCoder 草稿修改与评审正文基线

[English](guide.md) | 中文

## 变更

LCoder 新增原地修改草稿的流程。`.spec/proposals/P-xx.yaml` 现在可以带 `requirement_change.mode: patch`，以及 `target` 与 `base_content`（宿主生成提案时实际读到的正文）。经 `/proposal_approve` 批准后只重写当前草稿正文：不增加版本、不写快照、不改需求状态、也不处置任何评审决定。

`.spec/requirements/REQ-xx.yaml` 的每条评审现在可以带可选的 `base_content`，即落盘该报告时读到的正文。评审陈旧判定与采纳时的版本关联改为依据这条基线，因此原地修改后报告仍指向它实际审阅过的正文。没有该字段的旧记录继续沿用原有的版本时间戳判定。

这会影响手写这两类 YAML 的脚本与模板，以及假定每次变更都会产生新版本、或假定评审决定不带正文基线的读取方。

## 迁移

1. 现有 `.spec` 文件无需改写。旧提案、旧需求与旧评审照常解析；旧评审保持没有 `base_content`。
2. 生成修改提案时写 `mode: patch`，并给出 `target`、`base_content`（实际读到的正文）、`content` 与 `analysis`；这一模式不要写 `base_version`。
3. 写评审记录时附上落盘当时读到的正文作为 `base_content`；读取时始终把它当作可选字段。
4. 验证时先打开一条带旧评审的需求，再生成并应用一个 patch 提案：报告仍以原正文为基线，正文原地更新，版本列表不变。
