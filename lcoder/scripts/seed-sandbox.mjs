#!/usr/bin/env node
/**
 * LCoder 测试种子仓一键生成与重置脚本。
 *
 * 用途：在 `lcoder/seed-sandbox/` 下构建一个独立的、带 `.git` 与全态 `.spec/` 的
 * 演示产品仓（轻报销 LiteExpense），覆盖需求全生命周期（draft / confirmed / released）、
 * 任务全看板态（drafting / contracted / implementing / verifying / closed）、
 * 评审报告、可交互 HTML 原型、S 级修补计数、待审提案与零依赖可运行源码。
 *
 * 破坏后随时重跑本脚本（或双击 `lcoder/重置测试种子仓.cmd`）即可在 2 秒内彻底重建并还原。
 *
 * 用法：
 *   node lcoder/scripts/seed-sandbox.mjs             # 重建/还原种子仓（默认）
 *   node lcoder/scripts/seed-sandbox.mjs --reset     # 同上
 *   node lcoder/scripts/seed-sandbox.mjs --force     # 同上（强制清空旧产物后重建）
 *   node lcoder/scripts/seed-sandbox.mjs --status    # 只读查看当前种子仓状态与 git 改动
 *   node lcoder/scripts/seed-sandbox.mjs --target <dir>  # 指定输出目录
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const DEFAULT_TARGET = join(REPO_ROOT, 'lcoder', 'seed-sandbox')

/**
 * 解析命令行参数。
 * @param {readonly string[]} argv - 命令行参数（不含 node 与脚本路径）。
 * @returns {{ mode: 'reset' | 'status'; target: string }} 解析结果。
 */
function parseArgs(argv) {
  let mode = 'reset'
  let target = DEFAULT_TARGET
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--status') {
      mode = 'status'
    } else if (arg === '--reset' || arg === '--force') {
      mode = 'reset'
    } else if (arg === '--target' && argv[i + 1]) {
      target = resolve(argv[i + 1])
      i += 1
    } else if (arg === '-h' || arg === '--help') {
      console.log([
        'LCoder 测试种子仓生成/重置工具',
        '',
        '用法：',
        '  node lcoder/scripts/seed-sandbox.mjs [--reset | --force | --status] [--target <dir>]',
        '',
        `默认目录：${DEFAULT_TARGET}`,
      ].join('\n'))
      process.exit(0)
    }
  }
  return { mode, target }
}

/**
 * 与 `@maniu/kernel` 的 `contractHash` 保持逐字节一致的契约正文哈希。
 * @param {{ id: string; change: string[]; not_change: string[]; acceptance: string[]; affected_tests: string[]; fail_if: string[] }} body - 契约正文。
 * @returns {string} `sha256:<hex>` 格式哈希。
 */
function computeContractHash(body) {
  const canonical = JSON.stringify({
    id: body.id,
    change: body.change,
    not_change: body.not_change,
    acceptance: body.acceptance,
    affected_tests: body.affected_tests,
    fail_if: body.fail_if,
  })
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

/**
 * 写 UTF-8 文件并确保父目录存在、末尾单一换行。
 * @param {string} baseDir - 种子仓根目录。
 * @param {string} relPath - 相对路径。
 * @param {string} content - 文件正文。
 */
function writeSeedFile(baseDir, relPath, content) {
  const full = join(baseDir, relPath)
  mkdirSync(dirname(full), { recursive: true })
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
  writeFileSync(full, normalized, 'utf8')
}

/**
 * 构造已签署契约 YAML（带真实复算 sha256 签名）。
 * @param {{ id: string; change: string[]; not_change: string[]; acceptance: string[]; affected_tests: string[]; fail_if: string[] }} body - 契约正文。
 * @param {string | null} signedAt - 签署 ISO 时间；null 表示未签署。
 * @returns {string} YAML 文本。
 */
function renderContractYaml(body, signedAt) {
  const list = (items) => (items.length === 0 ? ' []' : '\n' + items.map((s) => `  - ${JSON.stringify(s)}`).join('\n'))
  const sigBlock = signedAt === null
    ? 'sig: null'
    : [
        'sig:',
        '  by: human',
        `  at: ${JSON.stringify(signedAt)}`,
        `  hash: ${JSON.stringify(computeContractHash(body))}`,
      ].join('\n')
  return [
    `id: ${body.id}`,
    `change:${list(body.change)}`,
    `not_change:${list(body.not_change)}`,
    `acceptance:${list(body.acceptance)}`,
    `affected_tests:${list(body.affected_tests)}`,
    `fail_if:${list(body.fail_if)}`,
    sigBlock,
  ].join('\n')
}

/**
 * 返回全部种子文件映射（相对路径 -> 文件内容）。
 * @returns {Record<string, string>} 种子文件集合。
 */
function buildSeedFiles() {
  const req01Md = `# REQ-01 员工报销单填写与提交

## 背景与目标
团队成员目前通过线下表格与聊天消息零散提交报销，存在费用类型不统一、事由缺失与状态不可追踪的问题。本需求旨在提供轻量级的单页报销录入与近期记录查看能力，使员工可在 1 分钟内完成单笔报销录入与提交，并在提交前拦截明显的必填项与金额格式错误，将表单退回率降低 50% 以上。

## 适用角色与范围边界
- **目标角色**：普通员工（含所有需要发起个人费用报销的团队成员）。
- **本期包含（In Scope）**：顶部用户信息与本月已提交总额概览、单页报销录入表单、本地草稿暂存与删除、正式提交审批、本人近期 10 条报销记录列表。
- **本期不做（Non-Goals）**：多币种外币折算、批量导入报销单、财务打款流水回填、移动端独立适配。
- **关联约束**：依赖 \`REQ-04\` 提供当前登录员工身份；报销单正式提交后的状态流转与审批通知遵循 \`REQ-03\` 规则。

## 核心用户流程
1. **新建并正式提交报销单**：员工进入报销录入页，查看顶部当前姓名与本月已提交总额；在表单中选择费用类型、输入报销金额、选择发生日期并填写事由说明，点击「提交审批」，系统校验通过后生成待审批单据并刷新近期报销记录列表与本月已提交总额。
2. **暂存本地草稿与继续编辑**：员工填写部分或全部表单字段后点击「暂存草稿」，系统将记录以草稿状态保存在本地并展示在近期记录列表中；员工后续可基于草稿补充信息后正式提交。
3. **查看与删除近期记录**：员工在近期报销记录列表中查看最近 10 条报销单状态，并对不再需要的草稿执行删除操作，列表与统计指标同步更新。

## 功能与业务规则
### 字段与数据口径
- **费用类型**：必填枚举，包含「差旅」「餐饮」「办公」「交通」4 项，表单初始化默认选中「差旅」。
- **报销金额（元）**：必填正数，最小值为 \`0.01\` 元，支持最多两位小数。
- **发生日期**：必填，格式为 \`YYYY-MM-DD\`，允许范围为当前自然日前 90 天（含）至当前自然日（含），默认填充当前自然日。
- **事由说明**：必填文本，去除首尾空白字符后长度为 2 至 200 个字符。
- **本月已提交总额**：统计当前登录员工本人、归属当前自然月且状态为「待审批（\`pending\`）」或「已通过（\`approved\`）」的报销单金额总和（不含「草稿（\`draft\`）」与「已驳回（\`rejected\`）」），以人民币符号开头并保留两位小数展示。
- **本地草稿保留规则**：单名员工在本地最多保留 10 份草稿，草稿在浏览器本地持久化保留 30 天；正式提交或手动删除后立即从草稿中移除。
- **近期报销记录列表**：按最后更新时间倒序展示当前员工本人最近 10 条记录，每行包含单号、费用类型、金额、事由说明、状态与删除操作入口。

### 业务规则（EARS）
- 当员工进入报销录入页时，系统应在顶部导航展示当前登录员工姓名及本月已提交总额。
- 当员工点击「提交审批」或「暂存草稿」且报销金额小于或等于 0、或非合法数字时，系统应阻断操作并在表单反馈区提示「请输入大于 0 的报销金额」。
- 当员工点击「提交审批」或「暂存草稿」且事由说明去除首尾空白后少于 2 个字符或超过 200 个字符时，系统应阻断操作并提示事由长度要求（2–200 字）。
- 当员工选择的发生日期早于当前自然日前 90 天或晚于当前自然日时，系统应阻断提交并提示发生日期须在近 90 天内且不晚于今天。
- 当表单全部校验通过且员工点击「提交审批」时，系统应生成状态为 \`pending\` 的报销单，清空表单输入，并立即更新近期报销记录列表与本月已提交总额。
- 在本地草稿数量已达 10 份的状态下，当员工再次点击「暂存草稿」时，系统应阻断新增草稿并提示「本地草稿已达 10 份上限，请先提交或删除旧草稿」。

## 权限、空态与异常边界
- **数据可见性与操作权限**：员工仅可查看、提交与删除本人名下的报销单与本地草稿，不可访问或删除其他成员的单据；已通过（\`approved\`）或待审批（\`pending\`）单据在正式流转后不支持通过草稿删除入口直接销毁。
- **临界态处理**：当本月尚无已提交记录时，顶部「本月已提交」展示为 \`¥ 0.00\`；当近期记录超过 10 条时，列表仅保留最新的 10 条展示。
- **失败与防重兜底**：提交审批请求进行中时禁用提交按钮以防止重复生成单据；若提交失败，系统应保留表单已填内容并给出明确失败提示，允许员工重试。

## 验收标准
- **AC-1**：当报销金额为 \`0\`、\`-10\` 或空值，且员工点击「提交审批」或「暂存草稿」时，应阻断提交并在页面展示错误提示，近期报销记录列表不新增数据。
- **AC-2**：当发生日期晚于当前自然日或早于当前自然日前 90 天，且员工点击「提交审批」时，应阻断提交并提示日期范围错误。
- **AC-3**：当费用类型为「餐饮」、金额为 \`128.50\`、发生日期为当前自然日、事由说明为「客户工作餐」且员工点击「提交审批」时，应生成状态为 \`pending\` 的记录并出现在近期报销记录列表首位，且顶部本月已提交总额同步增加 \`128.50\`。
- **AC-4**：当员工点击「暂存草稿」且输入合法时，应生成状态为「草稿」的记录，且顶部本月已提交总额不计入该草稿金额。
- **AC-5**：当员工在本地已存满 10 份草稿且再次点击「暂存草稿」时，应阻断保存并提示草稿数量已达上限。
- **AC-6**：当员工点击某条草稿记录的「删除」按钮时，应从近期报销记录列表中移除该记录，并同步刷新本地草稿计数。
`

  // T-328：同一需求的三版快照，覆盖段落词级修改、新增章节与整段删除，供修改批注视图开箱演示。
  const req01ObsoleteSection = `
## 旧版离线导出

早期版本允许员工把报销单导出为本地 CSV 文件，新版不再保留该入口。
`
  const req01SafetySection = `
## 安全与审计

报销单与草稿的读写仅限当前登录员工本人；任何批量导出与下载入口都不在本期范围。
`
  const req01V1Md = req01Md
    .replace('轻量级的单页报销录入与近期记录查看能力', '单页报销录入与近期记录查看能力')
    .replace('将表单退回率降低 50% 以上。', '将表单退回率降低 30% 以上。')
    .replace('- **关联约束**：依赖 `REQ-04` 提供当前登录员工身份；报销单正式提交后的状态流转与审批通知遵循 `REQ-03` 规则。\n', '')
    .replace('- 当员工点击「提交审批」或「暂存草稿」且报销金额小于或等于 0、或非合法数字时，系统应阻断操作并在表单反馈区提示「请输入大于 0 的报销金额」。\n', '')
    + req01ObsoleteSection
  const req01V2Md = req01Md + req01ObsoleteSection + req01SafetySection
  const req01V3Md = (req01Md + req01SafetySection)
    .replace('轻量级的单页报销录入与近期记录查看能力', '轻量的单页报销录入与近期记录查看能力')

  const req01ReviewR1 = `# REQ-01 评审报告 R1

## 评审结论
整体流程清晰，建议补充以下 3 项细节后再定稿：

| 编号 | 严重度 | 所在章节 | 问题说明 | 修改建议 |
| --- | --- | --- | --- | --- |
| 1 | 高 | 功能与业务规则 | 未明确单笔报销金额上限及超限提示 | 补充单笔上限 5000 元校验，超限需拆单或备注审批说明 |
| 2 | 中 | 功能与业务规则 | 缺少凭证/发票附件字段说明 | 明确支持上传图片或 PDF 发票，或勾选「无票说明」 |
| 3 | 低 | 权限、空态与异常边界 | 未定义近期报销记录列表的空态展示文案 | 补充无记录时的空态引导文案与新建按钮 |
`

  const req01PrototypeHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>轻报销 LiteExpense · REQ-01 员工报销单原型</title>
  <style>
    :root { --bg: #f4f7fb; --card: #ffffff; --ink: #172033; --muted: #5a667a; --line: #dce3ee; --accent: #1d4ed8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--ink); }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
    .brand { font-weight: 700; font-size: 16px; }
    .nav-meta { display: flex; gap: 16px; color: var(--muted); font-size: 13px; }
    main { max-width: 960px; margin: 24px auto; padding: 0 20px; display: grid; gap: 20px; }
    .hero { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; }
    .hero h1 { margin: 0 0 8px; font-size: 22px; }
    .hero p { margin: 0; color: var(--muted); font-size: 14px; }
    .features { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; }
    .features h2 { margin: 0 0 14px; font-size: 16px; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
    input, select { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; color: var(--ink); }
    .actions { grid-column: 1 / -1; display: flex; gap: 10px; margin-top: 6px; }
    button { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); cursor: pointer; font-size: 13px; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .list { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; }
    .list h2 { margin: 0 0 12px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
    th { color: var(--muted); font-weight: 600; }
    footer { text-align: center; color: var(--muted); font-size: 12px; padding: 20px; }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="brand">轻报销 LiteExpense</div>
    <div class="nav-meta">
      <span>当前员工：林小牛</span>
      <span>本月已提交：<strong id="month-total">¥ 1,280.00</strong></span>
    </div>
  </nav>
  <main>
    <div class="hero">
      <h1>员工报销单填写与提交</h1>
      <p>录入差旅、餐饮、办公或交通费用，校验金额与必填项后提交待审批，实时同步近期报销记录列表。</p>
    </div>
    <section class="features">
      <h2>报销录入表单</h2>
      <form id="expense-form">
        <label>费用类型
          <select name="category" id="field-category">
            <option>差旅</option>
            <option>餐饮</option>
            <option>办公</option>
            <option>交通</option>
          </select>
        </label>
        <label>报销金额（元）
          <input id="field-amount" type="number" step="0.01" min="0.01" placeholder="例如：328.50" />
        </label>
        <label>发生日期
          <input id="field-date" type="date" value="2026-11-22" />
        </label>
        <label>事由说明
          <input id="field-reason" type="text" placeholder="例如：客户拜访高铁往返" />
        </label>
        <div class="actions">
          <button type="button" id="btn-save-draft">暂存草稿</button>
          <button type="submit" class="primary" id="btn-submit">提交审批</button>
          <span id="form-feedback" style="font-size:12px;color:#1d4ed8;align-self:center;"></span>
        </div>
      </form>
    </section>
    <section class="list">
      <h2>近期报销记录列表</h2>
      <table>
        <thead>
          <tr><th>单号</th><th>费用类型</th><th>金额</th><th>事由说明</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody id="expense-tbody"></tbody>
      </table>
    </section>
  </main>
  <footer class="footer">轻报销 LiteExpense · REQ-01 种子原型（独立预览窗可直接点击表单与删除交互；Alt+点击可点选元素让 AI 修改）</footer>
  <script>
    (function () {
      const rows = [
        { id: 'EXP-202611-01', category: '差旅', amount: 860, reason: '上海客户回访动车票', status: '待审批' },
        { id: 'EXP-202611-02', category: '餐饮', amount: 420, reason: '团队项目复盘工作餐', status: '已通过' },
      ];
      let seq = 3;
      const tbody = document.getElementById('expense-tbody');
      const totalEl = document.getElementById('month-total');
      const feedback = document.getElementById('form-feedback');
      const form = document.getElementById('expense-form');
      const catEl = document.getElementById('field-category');
      const amtEl = document.getElementById('field-amount');
      const reasonEl = document.getElementById('field-reason');

      function render() {
        tbody.innerHTML = '';
        let sum = 0;
        for (let i = 0; i < rows.length; i += 1) {
          const item = rows[i];
          sum += item.amount;
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + item.id + '</td>' +
            '<td>' + item.category + '</td>' +
            '<td>¥ ' + item.amount.toFixed(2) + '</td>' +
            '<td>' + item.reason + '</td>' +
            '<td>' + item.status + '</td>' +
            '<td><button type="button" data-del="' + item.id + '">删除</button></td>';
          tbody.appendChild(tr);
        }
        totalEl.textContent = '¥ ' + sum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function addRecord(status) {
        const amount = Number(amtEl.value);
        const reason = reasonEl.value.trim();
        if (!Number.isFinite(amount) || amount <= 0) {
          feedback.style.color = '#dc2626';
          feedback.textContent = '请输入大于 0 的报销金额';
          return;
        }
        if (reason === '') {
          feedback.style.color = '#dc2626';
          feedback.textContent = '请填写事由说明';
          return;
        }
        const id = 'EXP-202611-' + String(seq).padStart(2, '0');
        seq += 1;
        rows.unshift({ id: id, category: catEl.value, amount: amount, reason: reason, status: status });
        amtEl.value = '';
        reasonEl.value = '';
        feedback.style.color = '#15803d';
        feedback.textContent = '已' + (status === '草稿' ? '暂存草稿' : '提交审批') + '：' + id;
        render();
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        addRecord('待审批');
      });
      document.getElementById('btn-save-draft').addEventListener('click', function () {
        addRecord('草稿');
      });
      tbody.addEventListener('click', function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const id = target.getAttribute('data-del');
        if (!id) return;
        const idx = rows.findIndex(function (r) { return r.id === id; });
        if (idx >= 0) {
          rows.splice(idx, 1);
          feedback.style.color = '#1d4ed8';
          feedback.textContent = '已删除报销单：' + id;
          render();
        }
      });
      render();
    })();
  </script>
</body>
</html>
`

  const projectPrototypeHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>轻报销 LiteExpense · 项目级统一活原型</title>
  <style>
    :root { --bg: #f4f7fb; --card: #ffffff; --ink: #172033; --muted: #5a667a; --line: #dce3ee; --accent: #1d4ed8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--ink); }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
    .brand { font-weight: 700; font-size: 16px; }
    .nav-meta { display: flex; gap: 16px; color: var(--muted); font-size: 13px; }
    main { max-width: 960px; margin: 24px auto; padding: 0 20px; display: grid; gap: 20px; }
    .hero, .features, .list, .summary { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; }
    .hero h1 { margin: 0 0 8px; font-size: 22px; }
    .hero p { margin: 0; color: var(--muted); font-size: 14px; }
    h2 { margin: 0 0 14px; font-size: 16px; }
    .metrics { display: flex; gap: 24px; font-size: 14px; }
    .metric strong { display: block; margin-top: 6px; font-size: 20px; color: var(--accent); }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
    input, select { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; color: var(--ink); }
    .actions { grid-column: 1 / -1; display: flex; gap: 10px; margin-top: 6px; }
    button { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); cursor: pointer; font-size: 13px; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
    th { color: var(--muted); font-weight: 600; }
    footer { text-align: center; color: var(--muted); font-size: 12px; padding: 20px; }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="brand">轻报销 LiteExpense · 项目统一视图</div>
    <div class="nav-meta">
      <span>当前员工：林小牛</span>
      <span>本月已提交：<strong id="month-total">¥ 1,280.00</strong></span>
    </div>
  </nav>
  <main>
    <div class="hero">
      <h1>员工报销单填写与提交</h1>
      <p>项目当前正式版活原型：报销录入、月度汇总与近期记录在同一页完成，提交前即时校验必填项与金额。</p>
    </div>
    <section class="summary">
      <h2>月度汇总</h2>
      <div class="metrics">
        <span class="metric">总笔数<strong id="m-total">2</strong></span>
        <span class="metric">待审批笔数<strong id="m-pending">1</strong></span>
        <span class="metric">已通过金额<strong id="m-approved">¥ 420.00</strong></span>
      </div>
    </section>
    <section class="features">
      <h2>报销录入表单</h2>
      <form id="expense-form">
        <label>费用类型
          <select name="category" id="field-category">
            <option>差旅</option><option>餐饮</option><option>办公</option><option>交通</option>
          </select>
        </label>
        <label>报销金额（元）
          <input id="field-amount" type="number" step="0.01" min="0.01" placeholder="例如：328.50" />
        </label>
        <label>发生日期
          <input id="field-date" type="date" value="2026-11-22" />
        </label>
        <label>事由说明
          <input id="field-reason" type="text" placeholder="例如：客户拜访高铁往返" />
        </label>
        <div class="actions">
          <button type="button" id="btn-save-draft">暂存草稿</button>
          <button type="submit" class="primary" id="btn-submit">提交审批</button>
          <span id="form-feedback" style="font-size:12px;color:#1d4ed8;align-self:center;"></span>
        </div>
      </form>
    </section>
    <section class="list">
      <h2>近期报销记录列表</h2>
      <table>
        <thead>
          <tr><th>单号</th><th>费用类型</th><th>金额</th><th>事由说明</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody id="expense-tbody"></tbody>
      </table>
    </section>
  </main>
  <footer class="footer">轻报销 LiteExpense · 项目级统一活原型（历史版本可在原型页只读预览与恢复）</footer>
  <script>
    (function () {
      const rows = [
        { id: 'EXP-202611-01', category: '差旅', amount: 860, reason: '上海客户回访动车票', status: '待审批' },
        { id: 'EXP-202611-02', category: '餐饮', amount: 420, reason: '团队项目复盘工作餐', status: '已通过' },
      ];
      let seq = 3;
      const tbody = document.getElementById('expense-tbody');
      const totalEl = document.getElementById('month-total');
      const feedback = document.getElementById('form-feedback');
      const form = document.getElementById('expense-form');
      const catEl = document.getElementById('field-category');
      const amtEl = document.getElementById('field-amount');
      const reasonEl = document.getElementById('field-reason');

      function render() {
        tbody.innerHTML = '';
        let sum = 0;
        let pending = 0;
        let approved = 0;
        for (const item of rows) {
          sum += item.amount;
          if (item.status === '待审批') pending += 1;
          if (item.status === '已通过') approved += item.amount;
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + item.id + '</td><td>' + item.category + '</td>' +
            '<td>¥ ' + item.amount.toFixed(2) + '</td><td>' + item.reason + '</td>' +
            '<td>' + item.status + '</td>' +
            '<td><button type="button" data-del="' + item.id + '">删除</button></td>';
          tbody.appendChild(tr);
        }
        totalEl.textContent = '¥ ' + sum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('m-total').textContent = String(rows.length);
        document.getElementById('m-pending').textContent = String(pending);
        document.getElementById('m-approved').textContent = '¥ ' + approved.toFixed(2);
      }

      function addRecord(status) {
        const amount = Number(amtEl.value);
        const reason = reasonEl.value.trim();
        if (!Number.isFinite(amount) || amount <= 0) {
          feedback.style.color = '#dc2626';
          feedback.textContent = '请输入大于 0 的报销金额';
          return;
        }
        if (reason === '') {
          feedback.style.color = '#dc2626';
          feedback.textContent = '请填写事由说明';
          return;
        }
        const id = 'EXP-202611-' + String(seq).padStart(2, '0');
        seq += 1;
        rows.unshift({ id: id, category: catEl.value, amount: amount, reason: reason, status: status });
        amtEl.value = '';
        reasonEl.value = '';
        feedback.style.color = '#15803d';
        feedback.textContent = '已' + (status === '草稿' ? '暂存草稿' : '提交审批') + '：' + id;
        render();
      }

      form.addEventListener('submit', function (event) { event.preventDefault(); addRecord('待审批') });
      document.getElementById('btn-save-draft').addEventListener('click', function () { addRecord('草稿') });
      tbody.addEventListener('click', function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const id = target.getAttribute('data-del');
        if (!id) return;
        const idx = rows.findIndex(function (r) { return r.id === id });
        if (idx >= 0) {
          rows.splice(idx, 1);
          feedback.style.color = '#1d4ed8';
          feedback.textContent = '已删除报销单：' + id;
          render();
        }
      });
      render();
    })();
  </script>
</body>
</html>
`

  const projectPrototypeSnapshotV1Html = req01PrototypeHtml
    .replace('REQ-01 员工报销单原型', '项目级活原型 · 历史版本 v1')
    .replace('REQ-01 种子原型', '项目级历史版本 v1')
  const projectPrototypeSnapshotV2Html = projectPrototypeHtml.replace('项目级统一活原型', '项目级活原型 · 历史版本 v2')
  const projectSnapshotV1Id = `${Date.parse('2026-11-20T10:00:00+08:00')}-1`
  const projectSnapshotV2Id = `${Date.parse('2026-11-22T15:00:00+08:00')}-1`
  const projectStaged = {
    requirementId: '__project__',
    html: projectPrototypeHtml,
    changeKind: 'visual',
    summary: [
      '合并报销录入与近期记录为单一项目级活原型',
      '顶部补齐当前员工与本月已提交总额展示',
    ],
    changedDomPaths: ['nav.nav-meta', 'section.list'],
    createdAt: '2026-11-23T10:00:00+08:00',
  }

  const req02Md = `# REQ-02 报销单列表筛选与月度汇总

## 背景与目标
团队报销单数量增长后，财务与团队负责人无法快速按月份、费用类型与审批状态定位单据，人工核对月度支出总额耗时且易产生小数舍入误差。本需求旨在提供多条件组合筛选、月度精确汇总卡片与单据详情抽屉，使月度报销核对耗时缩短至 3 分钟内，汇总金额与单据明细保持 100% 一致。

## 适用角色与范围边界
- **目标角色**：财务人员、审批主管、普通员工。
- **本期包含（In Scope）**：按月份/状态/费用类型多条件筛选报销列表、月度汇总指标卡片、单据详情抽屉与审批时间线查看。
- **本期不做（Non-Goals）**：自定义复杂逻辑表达式查询、跨年度汇总报表图表、Excel/CSV 导出下载。
- **关联约束**：依赖 \`REQ-04\` 提供角色与数据权限范围；报销单数据与状态由 \`REQ-01\` 与 \`REQ-03\` 产生并驱动。

## 核心用户流程
1. **多条件组合筛选与同步汇总**：用户进入报销列表页，默认展示当前自然月全量可见单据；切换月份、状态或费用类型筛选条件后，列表与顶部月度汇总卡片同步重新计算并刷新。
2. **查看单据详情抽屉**：用户点击列表中的任意报销单行，右侧弹出详情抽屉，展示单号、提交人、费用类型、发生日期、金额、事由说明及完整审批时间线。

## 功能与业务规则
### 字段与数据口径
- **筛选条件**：
  - 月份：格式 \`YYYY-MM\`，默认选中当前自然月。
  - 状态：枚举「全部」「草稿（\`draft\`）」「待审批（\`pending\`）」「已通过（\`approved\`）」「已驳回（\`rejected\`）」，默认选中「全部」。
  - 费用类型：枚举「全部」「差旅」「餐饮」「办公」「交通」，默认选中「全部」。
- **列表展示与排序**：展示单号、提交人、费用类型、发生日期、金额、事由说明与状态；默认按发生日期倒序排列，费用类型列保留固定最小展示宽度以防文字截断。
- **月度汇总卡片**：
  - 总笔数：当前筛选条件命中的报销单总数量。
  - 待审批笔数：当前筛选条件命中且状态为 \`pending\` 的单据数量，作为副标题展示。
  - 待审批总金额：当前筛选条件命中且状态为 \`pending\` 的单据金额之和，按分累加保留两位小数。
  - 已通过总金额：月度汇总金额按分累加保留两位小数，仅统计 \`approved\` 状态，\`rejected\` 与 \`draft\` 状态不计入月度支出。

### 业务规则（EARS）
- 当用户修改月份、状态或费用类型任一筛选条件时，系统应立即重新过滤列表并同步更新月度汇总卡片的全部 4 项指标。
- 在计算「已通过总金额」与「待审批总金额」时，系统应将每笔金额换算为整数分后累加再还原为元并保留两位小数，避免浮点精度误差。
- 当用户点击列表中任意报销单行时，系统应打开详情抽屉并展示该单据的完整字段与按时间正序排列的审批时间线。
- 当用户点击详情抽屉关闭按钮或遮罩层时，系统应关闭抽屉并保持当前列表筛选条件与滚动位置不变。

## 权限、空态与异常边界
- **数据可见性与操作权限**：财务人员可查看全团队所有已提交单据（不含他人 \`draft\`）；审批主管可查看本部门成员已提交单据；普通员工仅可查看本人名下所有状态的报销单。
- **空态处理**：当筛选条件组合无任何匹配记录时，列表区域展示「暂无符合条件的报销单」与「重置筛选条件」按钮，月度汇总卡片各金额指标展示为 \`¥ 0.00\`、笔数展示为 \`0\`。
- **异常与边界兜底**：若汇总数据加载失败，列表与汇总卡片同步展示「数据加载失败，请点击重试」提示，禁止展示过期缓存金额与最新列表混排；当筛选年份月份超出系统最早启用月份时，提示无历史数据并允许一键切回当前自然月。

## 验收标准
- **AC-1**：当列表存在 2 笔 \`approved\`（金额分别为 \`10.10\` 元、\`20.20\` 元）、1 笔 \`pending\`（\`30.00\` 元）与 1 笔 \`rejected\`（\`50.00\` 元）单据且筛选条件为当前月「全部」时，已通过总金额应为 \`¥ 30.30\`、待审批笔数应为 \`1\`、待审批总金额应为 \`¥ 30.00\`、总笔数应为 \`4\`。
- **AC-2**：当用户将费用类型筛选切换为「差旅」时，列表仅展示「差旅」类单据，且月度汇总卡片的 4 项指标同步仅统计「差旅」类单据。
- **AC-3**：当用户切换筛选条件后无匹配单据时，列表应展示空态提示与「重置筛选条件」按钮，且月度汇总显示 \`0\` 笔与 \`¥ 0.00\`。
- **AC-4**：当多条单据同时存在时，列表默认应按发生日期倒序排列，且费用类型列文字完整展示不被截断。
- **AC-5**：当用户点击某条报销单行时，应打开详情抽屉并完整展示其事由说明与审批时间线。

## 变更记录
- [S级微调] 2026-11-20 列表默认按发生日期倒序排列，并增加费用类型列宽防截断
- [S级微调] 2026-11-21 月度汇总卡片补充「待审批笔数」副标题展示
`

  const req03Md = `# REQ-03 报销审批状态流转与通知

## 背景与目标
报销单提交后缺乏明确的状态机约束与驳回原因规范，导致部分单据被口头驳回或误触通过，提交人无法及时获知审批进度与修改方向。本需求旨在建立严格的报销单状态流转规则、审批二次确认、驳回原因强制校验及站内通知机制，确保每笔审批结果可追溯、零误操作且 100% 触达提交人。

## 适用角色与范围边界
- **目标角色**：审批主管、普通员工（报销单提交人）。
- **本期包含（In Scope）**：报销单 4 态流转规则、待审批列表「通过/驳回」操作、通过二次确认、驳回原因必填校验、审批时间线记录、站内结果通知。
- **本期不做（Non-Goals）**：多级会签或或签工作流配置、邮件/短信/企微外部渠道推送、审批转交与代理审批。
- **关联约束**：依赖 \`REQ-04\` 判定审批主管权限；状态流转结果直接影响 \`REQ-01\` 近期列表状态与 \`REQ-02\` 月度汇总统计口径。

## 核心用户流程
1. **审批通过流程**：审批主管进入待审批列表，查看报销单明细后点击「通过」，在弹出的二次确认弹窗中核对单号与金额并点击「确认通过」，单据状态变更为 \`approved\`，审批时间线追加记录，提交人收到通过通知。
2. **审批驳回与重新提交**：审批主管点击「驳回」，在驳回弹窗中输入不少于 4 个字的驳回理由并确认，单据状态变更为 \`rejected\`；提交人收到驳回通知后，可修改单据并重新提交，状态重新进入 \`pending\`。
3. **站内结果通知查看**：提交人在站内通知列表查看带报销单号的审批结果通知，点击通知条目定位到对应单据详情。

## 功能与业务规则
### 状态机与字段口径
- **状态枚举**：\`draft\`（草稿）、\`pending\`（待审批）、\`approved\`（已通过）、\`rejected\`（已驳回）。
- **合法状态迁移**：
  - \`draft\` → \`pending\`（触发动作：提交 \`submit\`）
  - \`pending\` → \`approved\`（触发动作：通过 \`approve\`）
  - \`pending\` → \`rejected\`（触发动作：驳回 \`reject\`）
  - \`rejected\` → \`pending\`（触发动作：重新提交 \`resubmit\`）
- **驳回原因**：必填文本，去除首尾空白字符后长度不少于 4 个字符、不超过 200 个字符；输入框占位提示提供常见原因示例（如「发票金额与明细不一致，请核对后重提」）。
- **审批时间线**：每条时间线记录包含操作时间、操作动作、审批人姓名及备注（驳回时展示驳回原因）。
- **站内通知**：标题格式包含报销单号与审批结果（如「报销单 EXP-202611-01 已通过」），正文包含审批人姓名与驳回原因（若驳回）。

### 业务规则（EARS）
- 在报销单处于 \`pending\` 状态下，当审批主管点击「通过」按钮时，系统应弹出二次确认弹窗提示「确认通过该笔报销单？通过后将计入月度已审批支出」，仅当主管点击确认后才将状态变更为 \`approved\`。
- 在报销单处于 \`pending\` 状态下，当审批主管点击「驳回」按钮并输入少于 4 个非空白字符或空文本时，系统应阻断提交并提示「驳回原因至少填写 4 个字」。
- 当报销单状态成功变更为 \`approved\` 或 \`rejected\` 时，系统应在审批时间线中追加本次操作记录（含审批人姓名与时间），并立即向提交人发送一条标题附带报销单号的站内通知。
- 在报销单处于 \`rejected\` 状态下，当提交人修改信息并点击「重新提交」时，系统应将状态迁移为 \`pending\` 并重置至待审批队列。
- 在报销单处于 \`draft\`、\`approved\` 或 \`rejected\` 状态下，系统应禁止执行「通过」或「驳回」审批操作。

## 权限、空态与异常边界
- **数据可见性与操作权限**：仅具备 \`REQ-04\` 审批权限标识的成员可见「通过」「驳回」操作按钮；禁止审批人审批本人名下提交的报销单（本人单据不展示审批操作按钮，服务端同步校验拒绝自批）。
- **空态处理**：当待审批队列中无 \`pending\` 状态单据时，待审批页面展示「当前暂无待审批报销单」。
- **并发与异常兜底**：若主管打开页面后该单据已被他人处理或状态已变更，点击通过或驳回时系统应阻断操作并提示「该报销单状态已更新，请刷新列表」；通知发送失败不得回滚已完成的审批状态，但需记录待补发标记。

## 验收标准
- **AC-1**：当报销单状态为 \`pending\` 且审批主管点击「通过」并在二次确认弹窗点击确认时，单据状态应变为 \`approved\`，时间线应展示审批人姓名与通过时间。
- **AC-2**：当报销单状态为 \`pending\` 且审批主管点击「驳回」但输入「不对」（2 个字）时，应阻断驳回操作并提示至少填写 4 个字。
- **AC-3**：当审批主管输入「发票抬头有误，请重新上传」并确认驳回时，单据状态应变为 \`rejected\`，且提交人应收到标题包含该报销单号的站内通知。
- **AC-4**：当报销单状态为 \`rejected\` 且提交人修改后重新提交时，单据状态应从 \`rejected\` 迁移为 \`pending\`。
- **AC-5**：当普通员工（无审批权限）或提交人本人查看 \`pending\` 状态报销单时，界面不应展示「通过」与「驳回」按钮。
- **AC-6**：当尝试对 \`draft\` 或 \`approved\` 状态的单据发起「通过」请求时，系统应拒绝状态变更并保持原状态不变。

## 变更记录
- [S级微调] 2026-11-18 审批通过按钮增加二次确认文案防误触
- [S级微调] 2026-11-19 驳回原因输入框提示文案补充常见原因示例
- [S级微调] 2026-11-20 审批时间线补充审批人姓名展示
- [S级微调] 2026-11-21 站内通知标题附带报销单号便于检索
`

  const req04Md = `# REQ-04 基础登录与成员名册

## 背景与目标
报销录入、列表权限隔离与审批流转均依赖明确的当前用户身份与角色标识。本需求旨在提供轻量级的团队成员登录认证与成员名册管理能力，作为整套报销系统的基础身份层，确保所有业务操作具备可信的操作人归属与角色权限边界。

## 适用角色与范围边界
- **目标角色**：普通员工、审批主管、财务人员、系统管理员。
- **本期包含（In Scope）**：成员账号密码登录与安全退出、当前登录态校验与跳转、成员名册查看与基础信息维护（姓名、部门、角色标识、启用状态）。
- **本期不做（Non-Goals）**：企业微信/飞书/SSO 第三方单点登录、自助注册、细粒度字段级动态权限配置、密码找回短信验证码。
- **关联约束**：为 \`REQ-01\`、\`REQ-02\`、\`REQ-03\` 与 \`REQ-05\` 提供当前登录用户上下文及角色权限判定依据。

## 核心用户流程
1. **成员登录与退出流程**：成员访问系统登录页，输入成员账号与密码并点击「登录」，校验通过后进入报销首页；点击顶部用户栏「退出登录」后清除会话并返回登录页。
2. **成员名册查看与维护流程**：系统管理员进入成员名册页，查看全部成员的账号、姓名、部门、角色标识与启用状态，可新增成员或修改已有成员的部门、角色与启用状态。

## 功能与业务规则
### 字段与数据口径
- **成员账号**：必填且全团队唯一，支持工号或工作邮箱格式，长度为 3 至 64 个字符。
- **成员姓名**：必填，去除首尾空白后长度为 2 至 30 个字符。
- **所属部门**：必填文本，长度为 2 至 30 个字符。
- **角色标识**：必填枚举，包含「普通员工」「审批主管」「财务」3 项；其中仅「审批主管」具备 \`REQ-03\` 审批操作权限。
- **账号状态**：枚举「启用」「停用」，新创建成员默认为「启用」。

### 业务规则（EARS）
- 当未登录用户访问报销录入、报销列表、审批或成员名册任意业务页面时，系统应自动拦截并跳转至登录页。
- 当用户输入匹配的账号与密码且账号处于「启用」状态时，系统应建立登录会话并跳转至报销首页，同时在顶部导航展示当前成员姓名。
- 当用户点击「退出登录」时，系统应立即销毁当前登录会话并跳转回登录页。
- 当系统管理员在名册中将某成员的角色标识变更为「审批主管」或「普通员工」时，系统应更新其权限标识并在该成员下次操作或刷新页面时生效。
- 当系统管理员新增成员且输入的成员账号与名册中已有账号重复时，系统应阻断创建并提示「该成员账号已存在」。

## 权限、空态与异常边界
- **数据可见性与操作权限**：所有已登录成员均可读取自身姓名、部门与角色；仅系统管理员可执行成员名册的新增、编辑与停用操作，非管理员访问名册管理入口时提示「无操作权限」。
- **临界态与空态**：当名册按姓名或部门搜索无匹配成员时，列表展示「未找到匹配的成员记录」。
- **异常与防错兜底**：
  - 当账号不存在或密码错误时，统一提示「账号或密码错误」，不泄露具体是账号不存在还是密码错误。
  - 当账号处于「停用」状态时，阻断登录并提示「该账号已被停用，请联系管理员」。
  - 禁止管理员在名册中停用当前唯一处于启用状态的管理员账号，避免系统锁死。

## 验收标准
- **AC-1**：当用户处于未登录状态且直接访问报销列表页时，应自动跳转至登录页且不展示任何业务数据。
- **AC-2**：当用户输入已启用成员的正确账号与密码并点击「登录」时，应成功进入系统并在顶部展示该成员姓名。
- **AC-3**：当用户输入错误密码或已停用账号尝试登录时，应阻断登录并展示对应的明确错误提示。
- **AC-4**：当分别使用「普通员工」与「审批主管」账号登录并查看待审批单据时，仅「审批主管」界面可见审批操作按钮。
- **AC-5**：当已登录成员点击「退出登录」后，再次访问原业务页面应被拦截并跳转至登录页。
`

  const req05Md = `# REQ-05 常用报销模板收藏（未送审草稿）

## 背景与目标
团队成员每月存在大量重复发生的固定报销事项（如月度通勤交通、固定客户差旅），每次均需重新选择费用类型与重复输入相同事由，录入效率低且事由表述易前后不一致。本需求旨在支持将常用报销项保存为个人模板并一键回填表单，使高频报销单的填写耗时缩短至 15 秒以内。

## 适用角色与范围边界
- **目标角色**：普通员工（所有需要重复发起个人报销的团队成员）。
- **本期包含（In Scope）**：在报销录入页将当前内容收藏为个人模板、新建报销单时下拉选择模板一键回填、个人模板列表查看与删除。
- **本期不做（Non-Goals）**：团队共享公共模板库、模板定时自动发起报销、模板批量导入导出。
- **关联约束**：模板功能依附于 \`REQ-01\` 报销录入表单；套用模板回填后的报销单在正式提交时，仍须完整遵守 \`REQ-01\` 的单笔金额 5000 元上限校验与凭证/发票附件必填规则。

## 核心用户流程
1. **收藏个人模板**：员工在报销录入表单中填写费用类型、事由说明及可选默认金额后，点击「存为常用模板」，输入模板名称并确认保存，模板加入个人模板下拉列表。
2. **套用模板一键回填**：员工新建报销单时，在表单顶部「选择常用模板」下拉框中选中目标模板，系统自动回填费用类型、事由说明与默认金额（若有），员工核对发生日期与凭证附件后点击提交。
3. **管理与删除模板**：员工在模板管理弹窗中查看已收藏的个人模板列表，对不再使用的模板执行删除操作。

## 功能与业务规则
### 字段与数据口径
- **模板名称**：必填文本，去除首尾空白后长度为 2 至 20 个字符，同一员工名下模板名称不可重复。
- **费用类型**：必填枚举（\`差旅\` / \`餐饮\` / \`办公\` / \`交通\`），与 \`REQ-01\` 保持一致。
- **默认事由说明**：必填文本，去除首尾空白后长度为 2 至 200 个字符。
- **默认金额（元）**：选填；若填写则须大于 \`0\` 且不超过 \`5000.00\` 元，保留两位小数。
- **个人模板数量上限**：每位员工最多收藏 20 个个人模板。

### 业务规则（EARS）
- 当员工在报销录入页点击「存为常用模板」并输入合法模板名称时，系统应保存模板并立即刷新「选择常用模板」下拉选项。
- 当员工在「选择常用模板」下拉框中选中某个模板时，系统应将模板的费用类型、默认事由说明与默认金额（若已设置）回填至当前表单对应输入框，发生日期保持当前自然日不变。
- 在套用模板回填表单后，当员工点击「提交审批」时，系统应继续执行 \`REQ-01\` 的全部提交校验（含单笔 5000 元金额上限、超限提示及凭证/发票附件规则），不得因使用模板而跳过校验或自动提交。
- 当员工收藏模板时输入的模板名称与本人已有模板重名时，系统应阻断保存并提示「模板名称已存在，请更换名称」。
- 在个人模板数量已达 20 个的状态下，当员工再次点击「存为常用模板」时，系统应阻断保存并提示「个人模板最多收藏 20 个，请先删除旧模板」。

## 权限、空态与异常边界
- **数据可见性与操作权限**：个人模板仅创建者本人可见、套用与删除，跨成员账号不可查看或引用他人模板。
- **空态处理**：当员工尚未收藏任何模板时，「选择常用模板」下拉框置灰或展开显示「暂无常用模板，可在填写报销单时点击收藏」。
- **异常与边界兜底**：
  - 当表单中的费用类型或事由说明为空时点击「存为常用模板」，系统应阻断保存并提示先完善费用类型与事由说明。
  - 若填写的默认金额超过 5000 元或小于等于 0，阻断收藏并提示金额须大于 0 且不超过 5000 元。
  - 删除某个个人模板仅从模板列表中移除该模板，不得影响历史上已通过该模板创建并提交的报销单记录。

## 验收标准
- **AC-1**：当员工填写费用类型为「交通」、事由说明为「市内通勤地铁交通费」、默认金额为 \`150.00\`，并以名称「月度通勤」点击「存为常用模板」时，应成功保存并在模板下拉列表中可见「月度通勤」。
- **AC-2**：当员工在空白报销表单中选中「月度通勤」模板时，费用类型应自动回填为「交通」、事由说明应回填为「市内通勤地铁交通费」、金额应回填为 \`150.00\`，且发生日期仍保持当前自然日。
- **AC-3**：当员工套用模板后未上传凭证/发票且未勾选无票说明，点击「提交审批」时，应被 \`REQ-01\` 提交校验阻断，不得跳过校验直接提交。
- **AC-4**：当员工保存同名模板或已满 20 个模板后继续收藏时，应阻断保存并展示对应的明确提示文案。
- **AC-5**：当员工删除「月度通勤」模板后，该模板不再出现在下拉列表中，且此前使用该模板提交的报销单记录仍完整保留。
`

  const contractT02 = {
    id: 'T-02',
    change: [
      'src/expense.mjs：为 summarizeMonthly 增加按 category 过滤的可选参数',
      'tests/expense.test.mjs：补充按费用类型筛选的月度汇总单测',
    ],
    not_change: [
      '不改 calculateTotal 的入参与返回格式',
    ],
    acceptance: [
      '按 category 过滤后只汇总匹配类型且状态为 approved 的金额',
      'node tests/expense.test.mjs 全部通过',
    ],
    affected_tests: ['node tests/expense.test.mjs'],
    fail_if: [
      '把 rejected 或 draft 状态的单据计入 approvedTotal',
    ],
  }

  const contractT03 = {
    id: 'T-03',
    change: [
      'src/expense.mjs：补充 validateExpense 对空事由与负数金额的清晰错误码',
      'tests/expense.test.mjs：补充非法输入校验单测',
    ],
    not_change: [
      '不改既有状态机枚举值',
    ],
    acceptance: [
      '金额 <= 0 时返回 INVALID_AMOUNT',
      'node tests/expense.test.mjs 全部通过',
    ],
    affected_tests: ['node tests/expense.test.mjs'],
    fail_if: [
      '放行 0 元或负数报销单',
    ],
  }

  const contractT04 = {
    id: 'T-04',
    change: [
      'src/expense.mjs：月度汇总返回 pendingCount 字段以对齐 REQ-02 S 级微调',
      'tests/expense.test.mjs：验证 pendingCount 与待审批单据数量一致',
    ],
    not_change: [
      '不改已通过总金额计算逻辑',
    ],
    acceptance: [
      'summarizeMonthly 返回的 pendingCount 准确统计 pending 单据数量',
      'build 与 test 证据日志均全绿',
    ],
    affected_tests: ['node tests/expense.test.mjs'],
    fail_if: [
      '漏统或重复统计 pending 状态单据',
    ],
  }

  const contractT05 = {
    id: 'T-05',
    change: [
      'src/expense.mjs：初始化报销金额汇总与基础成员校验基线',
    ],
    not_change: [
      '无历史基线约束',
    ],
    acceptance: [
      'calculateTotal 保留两位小数并与 R-01 一致',
      'node tests/expense.test.mjs 全绿',
    ],
    affected_tests: ['node tests/expense.test.mjs'],
    fail_if: [
      '浮点误差导致分位金额错位',
    ],
  }

  return {
    'README.md': `# 轻报销 LiteExpense（LCoder 测试种子仓）

本目录是由 \`lcoder/scripts/seed-sandbox.mjs\` 生成的独立测试种子仓库，用于免走冗长前置流程、直接验收 LCoder 的各项需求/原型/任务/变更功能。

## 内置测试数据速查
- \`REQ-01\`（\`draft\` 草稿态）：带 R1 评审报告 + 可交互 HTML 原型 → 测草稿修改、评审处置、原型预览/点选修改、提变更禁选 S 级
- \`REQ-02\`（\`confirmed\` 已确认态，已微调 2 次）：→ 测「提变更 / 加功能」S/M/L 自动分流、手动改选、真实跑 \`requirement_amend\`
- \`REQ-03\`（\`confirmed\` 已确认态，已微调 4 次）：→ 再做 1 次 S 级微调立刻触发「累计 5 次一致性核对提醒」
- \`REQ-04\`（\`released\` 已上线态）：→ 测终态需求禁打 S 级（走 M/L）与基于此版本新建
- \`T-01\`（\`drafting\` 待确认）：AI 已分配给接口工程师、尚无契约 → 点「确认」测二次确认弹窗（提示将生成方案并由接口工程师开发）
- \`T-02\` ~ \`T-05\`：覆盖 \`contracted / implementing / verifying / closed\`，契约与证据按状态齐备，无超前产物
- 办公室岗位：\`fe-dev\`（林夕）、\`fe-dev-2\`（周澄）、\`api-engineer\`（陈默）、\`qa-engineer\`（苏晴）→ 测同岗位多人与岗位分配
- \`.spec/prototypes/__project__/\`：项目级统一活原型（正式版 + 待打磨 \`staged.json\` + 历史快照）→ 测暂存预览与历史恢复
- \`P-01\`：待审批提案（\`draft\`），可测提案对比与批准/拒绝

## 如何还原
改坏或测脏后，双击主仓的 \`lcoder/重置测试种子仓.cmd\`（或运行 \`node lcoder/scripts/seed-sandbox.mjs --reset\`）即可在 2 秒内彻底还原。
`,
    'docs/prd.md': `# 轻报销 LiteExpense 产品需求总览

面向中小团队的轻量报销管理工具，包含报销单录入（REQ-01）、列表筛选与月度汇总（REQ-02）、审批流转（REQ-03）与成员名册（REQ-04）。
`,
    'docs/architecture.md': `# 轻报销 LiteExpense 架构说明

- 纯 Node ESM 核心域模块：\`src/expense.mjs\`（金额计算、表单校验、月度汇总）
- 零依赖断言单测：\`tests/expense.test.mjs\`
`,
    'src/expense.mjs': `/**
 * 轻报销核心金额计算与月度汇总逻辑（零依赖 Node ESM）。
 */

/**
 * 计算多笔报销单的总金额（按分整数累加，避免浮点误差，保留两位小数）。
 * 对应规格条目 R-01。
 * @param {readonly { amount: number }[]} items - 报销条目列表。
 * @returns {number} 保留两位小数的总金额。
 */
export function calculateTotal(items) {
  let cents = 0
  for (const item of items) {
    cents += Math.round(item.amount * 100)
  }
  return Number((cents / 100).toFixed(2))
}

/**
 * 校验单条报销单的基础字段合法性。
 * @param {{ category?: string; amount?: number; reason?: string }} record - 报销单草稿。
 * @returns {{ ok: boolean; code?: string; message?: string }} 校验结果。
 */
export function validateExpense(record) {
  if (typeof record.amount !== 'number' || !Number.isFinite(record.amount) || record.amount <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', message: '报销金额必须大于 0' }
  }
  if (typeof record.reason !== 'string' || record.reason.trim() === '') {
    return { ok: false, code: 'EMPTY_REASON', message: '请填写事由说明' }
  }
  return { ok: true }
}

/**
 * 按月份汇总报销单统计指标（仅将 approved 状态计入已通过总额）。
 * @param {readonly { month: string; status: string; amount: number; category?: string }[]} records - 报销单列表。
 * @param {string} month - 目标月份（YYYY-MM）。
 * @returns {{ month: string; totalCount: number; approvedTotal: number; pendingTotal: number; pendingCount: number }} 月度汇总。
 */
export function summarizeMonthly(records, month) {
  const matched = records.filter((r) => r.month === month)
  const approved = matched.filter((r) => r.status === 'approved')
  const pending = matched.filter((r) => r.status === 'pending')
  return {
    month,
    totalCount: matched.length,
    approvedTotal: calculateTotal(approved),
    pendingTotal: calculateTotal(pending),
    pendingCount: pending.length,
  }
}
`,
    'tests/expense.test.mjs': `import assert from 'node:assert/strict'
import { calculateTotal, summarizeMonthly, validateExpense } from '../src/expense.mjs'

// R-01：避免浮点误差
assert.equal(calculateTotal([{ amount: 0.1 }, { amount: 0.2 }]), 0.3)
assert.equal(calculateTotal([{ amount: 860 }, { amount: 420.55 }]), 1280.55)

// 基础校验
assert.equal(validateExpense({ amount: 0, reason: '差旅' }).code, 'INVALID_AMOUNT')
assert.equal(validateExpense({ amount: 120, reason: '' }).code, 'EMPTY_REASON')
assert.equal(validateExpense({ amount: 120, reason: '高铁票' }).ok, true)

// 月度汇总（rejected 不计入已通过总额）
const summary = summarizeMonthly(
  [
    { month: '2026-11', status: 'approved', amount: 420 },
    { month: '2026-11', status: 'pending', amount: 860 },
    { month: '2026-11', status: 'rejected', amount: 999 },
    { month: '2026-10', status: 'approved', amount: 300 },
  ],
  '2026-11',
)
assert.deepEqual(summary, {
  month: '2026-11',
  totalCount: 3,
  approvedTotal: 420,
  pendingTotal: 860,
  pendingCount: 1,
})

console.log('seed expense tests ok (3/3 passed)')
`,
    '.spec/project.yaml': `kind: web
repo:
  url: https://example.com/lite-expense-seed.git
  branch: main
docs:
  product: docs/prd.md
  architecture: docs/architecture.md
  tests: tests
environments:
  dev:
    server: http://127.0.0.1:4173
    note: 本地测试种子环境，可随时重置
tracks:
  - id: finance
    name: 财务结算轨
`,
    '.spec/env.yaml': `repo:
  url: https://example.com/lite-expense-seed.git
  branch: main
  push_mode: branch
commands:
  - id: build
    name: 语法检查
    cmd: node --check src/expense.mjs
    cwd: .
    timeout: 60
    exec: ai-auto
    verify_days: 30
    last_ok: '2026-11-22T09:00:00+08:00'
  - id: test
    name: 核心单测
    cmd: node tests/expense.test.mjs
    cwd: .
    timeout: 60
    exec: ai-auto
    verify_days: 30
    precheck: [build]
    last_ok: '2026-11-22T09:00:00+08:00'
credentials: []
`,
    '.spec/roles.yaml': `roles:
  - id: fe-dev
    name: 前端工程师-林夕
    inherits: dev
    derived_from: 实施
    persona: 负责轻报销 Web 录入页与近期记录列表的前端实现，重视表单校验反馈与交互可用性。
    signals:
      strong: [html, css, form, table]
      medium: [页面, 表单, 列表, 原型]
      preferredPaths: [src/]
  - id: fe-dev-2
    name: 前端工程师-周澄
    inherits: dev
    derived_from: 实施
    persona: 负责报销列表筛选与月度汇总卡片的前端实现，重视筛选联动与金额展示精度。
    signals:
      strong: [html, css, form, table]
      medium: [页面, 筛选, 汇总]
      preferredPaths: [src/]
  - id: api-engineer
    name: 接口工程师-陈默
    inherits: dev
    derived_from: 实施
    persona: 负责金额计算、月度汇总与审批流转的接口实现，重视分位精度与错误码清晰。
    signals:
      strong: [node, api, mjs, schema]
      medium: [接口, 汇总, 校验]
      preferredPaths: [src/, tests/]
  - id: qa-engineer
    name: 测试工程师-苏晴
    inherits: dev
    derived_from: 实施
    persona: 负责轻报销核心域与页面交互的验收测试，重视边界用例与证据日志完整。
    signals:
      strong: [test, assert, vitest]
      medium: [测试, 用例, 验收]
      preferredPaths: [tests/]
`,
    '.spec/flow.yaml': `nodes:
  - node: intake
    roles: [maniu-intake]
    auto: false
  - node: review
    roles: [maniu-pm]
    auto: false
  - node: revise
    roles: [maniu-intake]
    auto: false
  - node: split
    roles: [maniu-architect, maniu-manager]
    auto: true
`,
    '.spec/automation.yaml': `actions:
  draft: manual
  contract: manual
  sign: auto
  implement: manual
  verify: manual
  close: manual
  commit: manual
limits:
  max_consecutive_failures: 3
tasks: []
`,
    '.spec/spec/rules.yaml': `rules:
  - id: R-01
    module: expense
    kind: formula
    title: 月度汇总金额按分累加保留两位小数
    text: 月度汇总金额按分累加保留两位小数；total = round(sum(round(amount * 100)) / 100, 2)
    source:
      doc: .spec/requirements/REQ-02.md
      quote: 月度汇总金额按分累加保留两位小数，仅统计 approved 状态
    status: confirmed
    found_at:
      - file: src/expense.mjs
        symbol: calculateTotal
    acceptance:
      - kind: test
        ref: tests/expense.test.mjs
    blocks: []
  - id: R-02
    module: expense
    kind: rule
    title: 单笔报销金额超过 5000 元需二级审批
    text: 单笔报销金额大于 5000 元时需触发二级审批
    source:
      doc: .spec/requirements/REQ-01/reviews/R1.md
      quote: 补充单笔上限 5000 元校验
    status: draft
    found_at: []
    acceptance: []
    blocks: []
`,
    '.spec/spec/states/expense.yaml': `id: expense_status
module: expense
statuses:
  - draft
  - pending
  - approved
  - rejected
transitions:
  - from: draft
    to: pending
    trigger: submit
  - from: pending
    to: approved
    trigger: approve
  - from: pending
    to: rejected
    trigger: reject
  - from: rejected
    to: pending
    trigger: resubmit
guards:
  - to: approved
    only_from: [pending]
    note: 只有待审批报销单允许通过
`,
    '.spec/requirements/REQ-01.yaml': `id: REQ-01
title: 员工报销单填写与提交
state: draft
options:
  - name: 单页表单 + 近期列表
    summary: 一屏完成报销录入与历史状态查看，减少页面跳转
    cost: 低（1 天）
recommendation: 推荐单页表单 + 近期列表，最贴合轻量高频录入场景
opened_at: '2026-11-18T09:00:00+08:00'
versions:
  - n: 1
    at: '2026-11-18T09:00:00+08:00'
    note: 初稿
  - n: 2
    at: '2026-11-19T10:00:00+08:00'
    note: 补充单笔金额校验、关联约束与安全审计边界
  - n: 3
    at: '2026-11-23T14:20:00+08:00'
    note: 细化录入描述并移除旧版离线导出章节
amendCount: 2
amendments:
  - at: '2026-11-19T10:00:00+08:00'
    summary: 补充单笔金额校验与跨需求关联约束，明确安全审计边界
    files: [.spec/requirements/REQ-01.md]
    actor: maniu-pm
  - at: '2026-11-23T14:20:00+08:00'
    summary: 细化报销录入轻量化描述并移除旧版离线导出入口
    files: [.spec/requirements/REQ-01.md]
    actor: maniu-pm
reviews:
  - round: 1
    at: '2026-11-18T11:30:00+08:00'
    report: requirements/REQ-01/reviews/R1.md
    role: maniu-pm
    decision: pending
prototype:
  path: prototypes/REQ-01/index.html
  generatedAt: '2026-11-18T14:00:00+08:00'
  references: []
  quality:
    passed: [parseable, navigation, hero, features, content, footer, no-script, no-external-links, size, keywords]
    failed: []
    keywordHitRate: 0.9
    keywords: [报销, 费用, 金额, 表单, 审批, 列表, 草稿, 提交, 差旅, 餐饮]
    hits: [报销, 费用, 金额, 表单, 审批, 列表, 草稿, 提交, 差旅]
    misses: [餐饮]
`,
    '.spec/requirements/REQ-01.md': req01V3Md,
    '.spec/requirements/REQ-01/versions/v1.md': req01V1Md,
    '.spec/requirements/REQ-01/versions/v2.md': req01V2Md,
    '.spec/requirements/REQ-01/versions/v3.md': req01V3Md,
    '.spec/requirements/REQ-01/reviews/R1.md': req01ReviewR1,
    '.spec/prototypes/REQ-01/index.html': req01PrototypeHtml,

    '.spec/prototypes/__project__/index.html': projectPrototypeHtml,
    '.spec/prototypes/__project__/staged.json': `${JSON.stringify(projectStaged, null, 2)}\n`,
    [`.spec/prototypes/__project__/history/${projectSnapshotV1Id}.html`]: projectPrototypeSnapshotV1Html,
    [`.spec/prototypes/__project__/history/${projectSnapshotV2Id}.html`]: projectPrototypeSnapshotV2Html,
    '.spec/prototypes/__project__/snapshots/v1-initial.html': projectPrototypeSnapshotV1Html,
    '.spec/prototypes/__project__/snapshots/v2-summary.html': projectPrototypeSnapshotV2Html,

    '.spec/requirements/REQ-02.yaml': `id: REQ-02
title: 报销单列表筛选与月度汇总
state: confirmed
options: []
opened_at: '2026-11-16T10:00:00+08:00'
confirmed_at: '2026-11-17T16:00:00+08:00'
approved_at: '2026-11-17T16:00:00+08:00'
approved_version: 1
versions:
  - n: 1
    at: '2026-11-16T10:00:00+08:00'
    note: 过审定稿
reviews:
  - round: 1
    at: '2026-11-17T14:00:00+08:00'
    report: requirements/REQ-02/reviews/R1.md
    role: maniu-pm
    decision: accepted
    decided_at: '2026-11-17T15:30:00+08:00'
    applied_version: 1
amendCount: 2
amendments:
  - at: '2026-11-20T10:20:00+08:00'
    summary: 列表默认按发生日期倒序排列，并增加费用类型列宽防截断
    files: [src/expense.mjs]
    actor: maniu-intake
  - at: '2026-11-21T15:40:00+08:00'
    summary: 月度汇总卡片补充「待审批笔数」副标题展示
    files: [src/expense.mjs, tests/expense.test.mjs]
    actor: maniu-intake
`,
    '.spec/requirements/REQ-02.md': req02Md,
    '.spec/requirements/REQ-02/versions/v1.md': req02Md.split('\n## 变更记录')[0] + '\n',
    '.spec/requirements/REQ-02/reviews/R1.md': `# REQ-02 评审报告 R1\n\n评审通过：筛选条件与月度汇总口径清晰一致，可进入定稿拆任务。\n`,

    '.spec/requirements/REQ-03.yaml': `id: REQ-03
title: 报销审批状态流转与通知
state: confirmed
options: []
opened_at: '2026-11-15T10:00:00+08:00'
confirmed_at: '2026-11-16T12:00:00+08:00'
approved_at: '2026-11-16T12:00:00+08:00'
approved_version: 1
versions:
  - n: 1
    at: '2026-11-15T10:00:00+08:00'
    note: 过审定稿
reviews:
  - round: 1
    at: '2026-11-16T10:00:00+08:00'
    report: requirements/REQ-03/reviews/R1.md
    role: maniu-pm
    decision: accepted
    decided_at: '2026-11-16T11:30:00+08:00'
    applied_version: 1
amendCount: 4
amendments:
  - at: '2026-11-18T11:00:00+08:00'
    summary: 审批通过按钮增加二次确认文案防误触
    actor: maniu-intake
  - at: '2026-11-19T11:00:00+08:00'
    summary: 驳回原因输入框提示文案补充常见原因示例
    actor: maniu-intake
  - at: '2026-11-20T11:00:00+08:00'
    summary: 审批时间线补充审批人姓名展示
    actor: maniu-intake
  - at: '2026-11-21T11:00:00+08:00'
    summary: 站内通知标题附带报销单号便于检索
    actor: maniu-intake
`,
    '.spec/requirements/REQ-03.md': req03Md,
    '.spec/requirements/REQ-03/versions/v1.md': req03Md.split('\n## 变更记录')[0] + '\n',
    '.spec/requirements/REQ-03/reviews/R1.md': `# REQ-03 评审报告 R1\n\n评审通过：审批状态迁移与驳回校验规则完备。\n`,

    '.spec/requirements/REQ-04.yaml': `id: REQ-04
title: 基础登录与成员名册
state: released
options: []
opened_at: '2026-11-10T09:00:00+08:00'
confirmed_at: '2026-11-11T10:00:00+08:00'
released_at: '2026-11-14T18:00:00+08:00'
approved_at: '2026-11-11T10:00:00+08:00'
approved_version: 1
versions:
  - n: 1
    at: '2026-11-10T09:00:00+08:00'
    note: 上线基线
reviews:
  - round: 1
    at: '2026-11-10T16:00:00+08:00'
    report: requirements/REQ-04/reviews/R1.md
    role: maniu-pm
    decision: accepted
    decided_at: '2026-11-11T09:30:00+08:00'
    applied_version: 1
`,
    '.spec/requirements/REQ-04.md': req04Md,
    '.spec/requirements/REQ-04/versions/v1.md': req04Md,
    '.spec/requirements/REQ-04/reviews/R1.md': `# REQ-04 评审报告 R1\n\n评审通过，已随 V1.0 上线。\n`,

    '.spec/requirements/REQ-05.yaml': `id: REQ-05
title: 常用报销模板收藏（未送审草稿）
state: draft
options: []
opened_at: '2026-11-22T09:00:00+08:00'
versions:
  - n: 1
    at: '2026-11-22T09:00:00+08:00'
    note: 初稿（未送审，可原地修改）
reviews: []
`,
    '.spec/requirements/REQ-05.md': req05Md,
    '.spec/requirements/REQ-05/versions/v1.md': req05Md,

    '.spec/proposals/P-01.yaml': `id: P-01
title: 报销月度明细导出 CSV 方案
problem: 财务月底记账需要把已通过的报销单导出为表格，目前只能手工抄录。
options:
  - name: 前端直接生成 UTF-8 BOM CSV
    summary: 在浏览器端将筛选后的已通过记录导出为带 BOM 的 CSV，Excel 直接打开不乱码
    cost: 低（0.5 天，零后端改造）
  - name: 后端异步生成 XLSX 文件
    summary: 新增服务端导出任务并写入临时对象存储
    cost: 中（2 天，需引入表格库）
recommendation: 推荐前端直接生成 UTF-8 BOM CSV，满足当前中小团队导出需求且零依赖。
decision: draft
decided_at: null
opened_at: '2026-11-21T16:00:00+08:00'
`,

    '.spec/tasks/T-01.yaml': `id: T-01
title: 报销单大额审批限额判定
description: 单笔报销超过 5000 元时，需要标记为走二级审批，避免大额费用只经一级审批就通过。
category: data
change_type: feature
grade: B
state: drafting
rules: [R-02]
requirement: REQ-02
track: finance
role: api-engineer
scope:
  irreversible: []
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-21T10:00:00+08:00'
closed_at: null
`,

    '.spec/tasks/T-02.yaml': `id: T-02
title: 月度汇总支持按费用类型筛选
description: |-
  财务核对月度支出时，希望能按差旅、餐饮等费用类型单独看汇总金额，不用再从总表里手工挑。

  ### 技术实施细节
  - summarizeMonthly 增加可选 category 参数，先按费用类型过滤命中记录再汇总。
  - 仍按整数分累加计算 approvedTotal，保持 R-01 口径不变。
  - tests/expense.test.mjs 补充按费用类型筛选的单测。
category: api
change_type: feature
grade: B
state: contracted
rules: [R-01]
requirement: REQ-02
track: api
role: api-engineer
scope:
  irreversible: []
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-20T09:00:00+08:00'
closed_at: null
`,
    '.spec/contracts/T-02.contract.yaml': renderContractYaml(contractT02, '2026-11-20T10:00:00+08:00'),

    '.spec/tasks/T-03.yaml': `id: T-03
title: 报销表单基础字段错误码细化
description: |-
  员工填错金额或漏写事由时，页面应直接指出是哪一栏出了问题，而不是只给一句笼统提示。

  ### 技术实施细节
  - validateExpense 对非正数金额返回 INVALID_AMOUNT、对空白事由返回 EMPTY_REASON。
  - 表单按错误码定位到对应字段并展示文案，不改动既有状态机枚举值。
  - tests/expense.test.mjs 补充非法输入校验单测。
category: page
change_type: improvement
grade: C
state: implementing
rules: []
requirement: REQ-02
track: h5
role: fe-dev
scope:
  irreversible: []
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-20T14:00:00+08:00'
closed_at: null
`,
    '.spec/contracts/T-03.contract.yaml': renderContractYaml(contractT03, '2026-11-20T14:30:00+08:00'),

    '.spec/tasks/T-04.yaml': `id: T-04
title: 月度汇总补充待审批笔数统计
description: |-
  月度汇总卡片需要显示「待审批笔数」副标题，财务才能一眼看出还有多少单据没处理。

  ### 技术实施细节
  - summarizeMonthly 返回 pendingCount，只统计当月状态为 pending 的单据。
  - 已通过总金额计算逻辑保持不变，构建与测试证据已挂待验收。
category: api
change_type: improvement
grade: C
state: verifying
rules: [R-01]
requirement: REQ-02
track: api
role: qa-engineer
scope:
  irreversible: []
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-21T16:00:00+08:00'
closed_at: null
`,
    '.spec/contracts/T-04.contract.yaml': renderContractYaml(contractT04, '2026-11-21T16:15:00+08:00'),
    '.spec/evidence/T-04/build.log': `[2026-11-21T16:30:00+08:00] $ node --check src/expense.mjs\nexit 0\n`,
    '.spec/evidence/T-04/test.log': `[2026-11-21T16:30:02+08:00] $ node tests/expense.test.mjs\nseed expense tests ok (3/3 passed)\nexit 0\n`,

    '.spec/tasks/T-05.yaml': `id: T-05
title: 报销金额分位汇总基线实现
description: |-
  先把报销金额汇总的分位精度做对，再让后续报表都基于同一套口径，已随 REQ-04 上线收口。

  ### 技术实施细节
  - calculateTotal 按整数分累加后还原为元并保留两位小数，对应 R-01。
  - tests/expense.test.mjs 覆盖分位与浮点误差基线，构建与测试证据齐全。
category: data
change_type: feature
grade: B
state: closed
rules: [R-01]
requirement: REQ-04
track: api
role: api-engineer
scope:
  irreversible: []
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-11T11:00:00+08:00'
closed_at: '2026-11-14T17:00:00+08:00'
`,
    '.spec/contracts/T-05.contract.yaml': renderContractYaml(contractT05, '2026-11-11T11:30:00+08:00'),
    '.spec/evidence/T-05/build.log': `[2026-11-14T16:50:00+08:00] $ node --check src/expense.mjs\nexit 0\n`,
    '.spec/evidence/T-05/test.log': `[2026-11-14T16:50:02+08:00] $ node tests/expense.test.mjs\nseed expense tests ok (3/3 passed)\nexit 0\n`,
  }
}

/**
 * 在指定目录执行子进程并要求退出码为 0。
 * @param {string} cmd - 可执行文件名。
 * @param {readonly string[]} args - 参数数组。
 * @param {string} cwd - 工作目录。
 * @returns {string} 标准输出。
 */
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * 调用 `@maniu/kernel` 真实 schema 校验器验证生成的 `.spec/` 目录。
 * @param {string} targetDir - 种子仓根目录。
 */
async function validateGeneratedSpec(targetDir) {
  const kernelLib = join(REPO_ROOT, 'packages', 'lcoder', 'kernel', 'lib', 'index.js')
  if (!existsSync(kernelLib)) {
    console.warn('[warn] 未找到 packages/lcoder/kernel/lib/index.js，跳过内核 schema 自检')
    return
  }
  const kernel = await import(pathToFileURL(kernelLib).href)
  const result = kernel.validateSpec(join(targetDir, '.spec'))
  const errors = result.issues.filter((i) => i.severity === 'error')
  if (!result.ok || errors.length > 0) {
    console.error('[error] 种子仓 .spec 未通过 @maniu/kernel 校验：')
    for (const issue of result.issues) {
      console.error(`  - [${issue.severity}] ${issue.file} (${issue.path}): ${issue.message}`)
    }
    process.exit(1)
  }
  console.log(`[check] @maniu/kernel validateSpec 通过（已校验 ${result.loaded.length} 份 YAML，0 错误）`)
}

/**
 * 查看当前种子仓状态。
 * @param {string} targetDir - 种子仓根目录。
 */
function showStatus(targetDir) {
  if (!existsSync(targetDir)) {
    console.log(`种子仓尚未建立：${targetDir}`)
    console.log('运行 `node lcoder/scripts/seed-sandbox.mjs --reset` 或双击 `lcoder/重置测试种子仓.cmd` 即可生成。')
    return
  }
  console.log(`种子仓路径：${targetDir}`)
  try {
    const head = run('git', ['log', '-1', '--oneline'], targetDir)
    const dirty = run('git', ['status', '--short'], targetDir)
    console.log(`当前提交：${head}`)
    console.log(dirty === '' ? '工作区状态：干净（与种子基线一致）' : `工作区改动：\n${dirty}`)
  } catch {
    console.log('工作区状态：.git 已损坏或缺失，建议运行 --reset 重建。')
  }
}

/**
 * 彻底重建并重置种子仓到初始基线。
 * @param {string} targetDir - 种子仓根目录。
 */
async function resetSandbox(targetDir) {
  const start = Date.now()
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
  }
  mkdirSync(targetDir, { recursive: true })

  const files = buildSeedFiles()
  for (const [relPath, content] of Object.entries(files)) {
    writeSeedFile(targetDir, relPath, content)
  }

  await validateGeneratedSpec(targetDir)

  const testOut = run(process.execPath, ['tests/expense.test.mjs'], targetDir)
  console.log(`[check] 种子仓单测通过：${testOut}`)

  run('git', ['init', '-b', 'main'], targetDir)
  run('git', ['config', 'user.name', 'LCoder Seed'], targetDir)
  run('git', ['config', 'user.email', 'seed@lcoder.local'], targetDir)
  run('git', ['add', '-A'], targetDir)
  run('git', ['commit', '-m', 'seed: initial LiteExpense baseline'], targetDir)
  run('git', ['tag', 'seed-v1'], targetDir)

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log('')
  console.log('================================================================')
  console.log(`  测试种子仓已重置就绪（耗时 ${elapsed}s）`)
  console.log(`  仓库路径：${targetDir}`)
  console.log('================================================================')
  console.log('在 LCoder「项目」页打开上方目录，即可直接验收：')
  console.log('  - REQ-01（草稿 v1 · 送审锁定）：带 R1 待处理评审 + HTML 原型 → 测评审锁定禁改 / 评审处置 / 原型预览')
  console.log('  - REQ-02（已确认 v1）        ：已累计 2 次 [S级微调] → 测 S/M/L 分流、手动切换、真实跑 requirement_amend')
  console.log('  - REQ-03（已确认 v1）        ：已累计 4 次 [S级微调] → 再微调 1 次即触发第 5 次一致性核对提醒')
  console.log('  - REQ-04（已上线 v1）        ：已上线终态 → 测终态禁打 S 级（走 M/L）与基于此版本新建')
  console.log('  - REQ-05（草稿 v1 · 未送审）  ：无未决评审 → 测自由草稿原地修改与提变更草稿通道')
  console.log('  - T-01（待确认）    ：已分配接口工程师、无契约 → 测「确认」二次弹窗')
  console.log('  - T-02 ~ T-05       ：覆盖 contracted / implementing / verifying / closed，产物与状态严格对齐')
  console.log('  - 办公室岗位        ：fe-dev / fe-dev-2 / api-engineer / qa-engineer（同岗位可多人）')
  console.log('  - __project__ 活原型：正式版 + staged.json + 历史快照 → 测暂存预览与历史恢复')
  console.log('  - P-01              ：待审提案（draft）→ 测提案对比与批准/拒绝')
  console.log('')
  console.log('测脏或改坏后，随时再次双击 `lcoder\\重置测试种子仓.cmd` 即可瞬间还原。')
}

const { mode, target } = parseArgs(process.argv.slice(2))
if (mode === 'status') {
  showStatus(target)
} else {
  await resetSandbox(target)
}
