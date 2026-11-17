# Agent Note: 退役的 preset 身份归声明它的 preset 所有

Status: implemented

[English](2026-11-17-preset-retired-identities.md) | 中文

## 问题

会话 header 记录它启动时的 Agent preset，已发布的会话日志一律不改写。续会话时 registry 按这条记录的身份去查声明，所以只要产品改一次 preset id，此前所有会话就变成 `agent-preset/not-found`——事件、角色与工作区都还在，却起不来。LCoder 的 T-226 把 `lcoder*` 改名到 `maniu*`，要求旧会话仍能续聊，同时旧 id 不进名册、角色组合也不注册两遍。

## 决策

preset 声明可以写 `retiredIds`。声明注册时 registry 把这些身份编入索引，注销时一并移除。所有按身份读取的入口——`resolve`、`retain`（`mount` 与 `select` 也走它）、`readDocument`、`definitionPlugins` 与 `definitionScope`——都从退役 id 走一跳解析到声明它的 preset。退役 id 与在册 preset id、别的声明的退役 id、或本声明自己的 id 冲突时，注册直接失败。

## 备选方案

- 注册隐藏别名 preset 让解析留在 YAML 里，但每条别名都要再挂一份角色组合，并在上游设置面无法隐藏的名册里多一行。
- 只在会话控制器或客户端里做 id 映射只能覆盖续聊与展示；云端保存的人才配置也引用 `basePreset`，而它走 `definitionPlugins` 解析。

## 后果

会话投影保留退役 id，名册、会话列表与历史展示都按原样显示；比较 preset id 的产品面必须两代都认，LCoder 客户端在角色反推、人才名、会话计数与调度上都做了前缀归一。解析按设计只有一跳，退役 id 不会再链到另一个退役 id。以退役身份续起的会话运行当前声明，之后的选择与新会话记录的都是当前 id。
