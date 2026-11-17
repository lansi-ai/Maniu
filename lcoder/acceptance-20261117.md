# T-242 / T-243 真机验收报告（2026-11-17）

验收人：监督窗口（CDP DOM 断言＋磁盘事实核对）；样式截图留用户审。靶仓：`E:\Projects\LCoder-Accept-20261117`（靶 1）、`E:\Projects\LCoder-Accept2-20261117`（靶 2）、`E:\Projects\LCoder-Accept3-20261117`（靶 3），均为新建空仓，未碰 LCoder-First-Demo。实例：主检出 9822（重启后加载 T-242/T-243/T-244/T-245 产物）。

## 判据清单与结果

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 1 | 评审不跳对话＋浮卡（蓝边框/标题/岗位子标题/四步） | ✅ | 靶 1 DOM：`op-card op-running`，子标题「项目经理 · 内置岗位」；page-requirements 在场、session-list 不在场 |
| 2 | 报告直读：绿卡＋详情内联最新报告＋打开报告入口 | ✅ | 靶 1：`op-card op-done`；`requirement-review-report` data-round=1、正文 6970 字；时间线 R1 |
| 3 | 多版本：v1/v2 时间线、快照互异、v2＝当前正文 | ✅ | 靶 1：阅读器 v1 1304 字 vs v2 6571 字；v2.md 与 REQ-01.md 均 17196 字节 |
| 4 | 最小化胶囊→展开；查看对话自愿 | ✅ | 靶 1：`op-capsule op-done`→点击回 `op-card op-done` |
| 5 | 立项不跳对话＋七问浮层触达 | ✅ | 靶 1/2/3：wizard 收起、浮卡《需求调研》、question-card 从 pending-layer 触达 |
| 5b | 立项概要确认入口（等待确认态＋浮卡确认＋落盘转绿） | ✅ | 靶 2：卡文案「概要已出，等待你确认；点「确认需求」后才会落盘」＋`op-confirm-intake`＋「查看概要」；点击后 REQ-01 落盘、`op-card op-done` |
| 6 | 配置节：预制渲染/加岗/排序/auto/保存/恢复预制 | ✅ | 靶 1/2/3：flow.yaml 落盘内容与操作一致；恢复预制删文件 |
| 7 | 多岗 manual：下一岗位＋配齐过审＋一轮拒绝 | ✅ | 靶 2：R1 后卡「项目经理已完成，点下一岗位发起研发经理」；靶 3：一轮时过审拒绝文案点名 maniu-manager（一轮一岗口径）；R2 后过审批准 v1 |
| 8 | 多岗 auto 自动衔接 | ✅ | 靶 3 盘上署名 R2=maniu-pm → R3=maniu-manager 顺序落盘、卡转 op-done；manager 轮耗时约 3 分钟。初判 ❌ 系误判（错页探针＋busy 禁用按钮空点＋等待不足），已纠正并披露 |
| 9 | 节点能力校验 fail-loud | ✅ | 靶 1（T-244 前）：保存拒绝「maniu-manager（根 manager）没有 requirement_review_draft」；T-244 后同配置保存成功 |
| 10 | 超时卡＋查看对话/最小化/手动刷新入口 | ✅ | 靶 1 立项缺口那次自然触发：`requirement-op-timeout` 三入口齐全 |
| 11 | 过审（无配置≥1 轮）＋批准版本＋状态 | ✅ | 靶 1：批准版本 v2、状态已确认 |

## 门禁证据（合入前后均复跑）

- T-242：typecheck 5、vitest 143/1489、oxlint 0、i18n 1318；主检 build 8+2 全绿。
- T-243：typecheck 5、vitest 150/1551、oxlint 0、i18n、test:docs 21；主检全绿。
- T-244：typecheck 5、vitest 150/1556、oxlint 0、test:docs 21；snapshot 全量红 182/241 归因 Windows 环境性预存（基提交同红同 diff、场景不装 @maniu/kernel），对照日志 `/tmp/t244-snap-base.log`，按政策归 CI。
- T-245：typecheck 5、vitest 151/1563、oxlint 0、i18n、test:docs 21；主检与 T-244 合流复跑 vitest 151/1568 全绿。

## 未验项与开放缺陷

1. **T-247（B，已合入主线，真机复验通过）**：范围收敛为「操作状态随页卸载丢失、切页浮卡消失」（D1）；修法为需求页跨页保持挂载（隐藏）。auto 衔接本身真机通过（判据 8）。回归测试：切对话页再回需求页运行卡仍在。
2. **T-246（B，已合入主线，真机复验通过）**：切项目清除 intakeResult；结果视图硬编码旧文案改词典键 intake.resultBackground（后台口径）。
3. **误判披露**：判据 8 初判 ❌ 的三条成因（探针落在 chat 页、busy 期间评审按钮禁用导致空点、manager 轮约 3 分钟等待不足）已查明；「切页后浮卡消失」是真缺陷 D1，「auto 不发起 manager」是误判。另有一次未知触发把页面切到 chat（监督窗口 CDP 操作期间），D1 修复后浮卡不再受切页影响，该触发源留观察。
3. 真窗口样式观感：截图 `C:\Users\Administrator\AppData\Local\Temp\t243-detail.png`、`t243-flow.png` 留用户审。
4. Windows snapshot 套件环境性红：预存问题，归 CI；若要求 Windows 全绿需另立任务。
5. 云端真实 COS/短信等（A9d/A11/A9f/A12）不在本次范围。

## 复现命令（人工可复核）

- 起实例：`lcoder\scripts\start-all.cmd -Fast`（renderer 9822）。
- CDP 助手：`node C:\Users\Administrator\AppData\Local\Temp\t243-cdp.mjs <eval|click|set|wait|text|shot> ...`（CDP_WS 环境变量指定 page websocket）。
- 磁盘事实：靶仓 `.spec/requirements/REQ-01/reviews/R<n>.md`、`versions/v<n>.md`、`.spec/flow.yaml`。

## 打勾位（用户复核）

- [ ] 判据 1-5 观感与交互符合预期
- [ ] 判据 5b 确认入口文案与位置符合预期
- [ ] 判据 6 配置节操作顺手
- [ ] 判据 7 拒绝文案可读
- [ ] 判据 8 已真机通过（署名链核对）
- [x] D1 切页浮卡存活真机复验通过（chat 页隐藏期卡仍在、回页仍 running）
- [x] 切项目向导回起始表单真机复验通过（靶 2 显示立项向导禁用态）
- [ ] 样式截图审毕