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
    } else if (arg === '--reset') {
      mode = 'reset'
    } else if (arg === '--target' && argv[i + 1]) {
      target = resolve(argv[i + 1])
      i += 1
    } else if (arg === '-h' || arg === '--help') {
      console.log([
        'LCoder 测试种子仓生成/重置工具',
        '',
        '用法：',
        '  node lcoder/scripts/seed-sandbox.mjs [--reset | --status] [--target <dir>]',
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
为团队成员提供轻量报销单录入页，支持填写费用类型、金额、发生日期与事由说明，提交后进入待审批状态。

## 核心功能
1. **顶部导航与概览**：展示当前用户姓名、本月已提交报销总额与快速新建入口。
2. **报销录入表单**：包含费用类型（差旅 / 餐饮 / 办公 / 交通）、金额（保留两位小数且大于 0）、发生日期与事由说明。
3. **草稿与提交**：支持本地暂存草稿或正式提交审批，提交前校验金额上限与必填项。
4. **近期报销记录列表**：按提交时间倒序展示本人最近 10 条报销单状态。

## 验收口径
- 金额为 0 或负数时阻断提交并提示错误。
- 合法报销单提交后状态为 \`pending\`，并实时刷新本人近期报销列表。
`

  const req01ReviewR1 = `# REQ-01 评审报告 R1

## 评审结论
整体流程清晰，建议补充以下 3 项细节后再定稿：

| 编号 | 严重度 | 所在章节 | 问题说明 | 修改建议 |
| --- | --- | --- | --- | --- |
| 1 | 高 | 报销录入表单 | 未明确单笔报销金额上限及超限提示 | 补充单笔上限 5000 元校验，超限需拆单或备注审批说明 |
| 2 | 中 | 报销录入表单 | 缺少凭证/发票附件字段说明 | 明确支持上传图片或 PDF 发票，或勾选「无票说明」 |
| 3 | 低 | 近期报销记录列表 | 未定义空态展示文案 | 补充无记录时的空态引导文案与新建按钮 |
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

  const req02Md = `# REQ-02 报销单列表筛选与月度汇总

## 背景与目标
为财务和团队负责人提供报销单列表检索与按月统计汇总能力，支持按状态、费用类型和月份组合筛选。

## 核心功能
1. **多条件筛选**：支持按月份（\`YYYY-MM\`）、状态（草稿 / 待审批 / 已通过 / 已驳回）与费用类型过滤列表。
2. **月度汇总卡片**：实时统计当前筛选范围内的总笔数、已通过总金额与待审批总金额。
3. **详情抽屉**：点击单行查看报销单明细、事由说明与审批时间线。

## 验收口径
- 筛选条件变化后，列表数据与月度汇总金额保持 100% 一致。
- 仅统计 \`approved\` 状态的金额计入「已通过总金额」，\`rejected\` 不计入月度支出。

## 变更记录
- [S级微调] 2026-11-20 列表默认按发生日期倒序排列，并增加费用类型列宽防截断
- [S级微调] 2026-11-21 月度汇总卡片补充「待审批笔数」副标题展示
`

  const req03Md = `# REQ-03 报销审批状态流转与通知

## 背景与目标
规范报销单从 \`draft\` → \`pending\` → \`approved\` / \`rejected\` 的状态流转，并在驳回时强制填写驳回原因。

## 核心功能
1. **审批操作**：主管可在待审批列表点击「通过」或「驳回」。
2. **驳回原因校验**：点击「驳回」时必须输入不少于 4 个字的驳回理由。
3. **状态通知**：审批完成后向提交人发出站内结果通知。

## 变更记录
- [S级微调] 2026-11-18 审批通过按钮增加二次确认文案防误触
- [S级微调] 2026-11-19 驳回原因输入框提示文案补充常见原因示例
- [S级微调] 2026-11-20 审批时间线补充审批人姓名展示
- [S级微调] 2026-11-21 站内通知标题附带报销单号便于检索
`

  const req04Md = `# REQ-04 基础登录与成员名册

## 背景与目标
提供最小团队成员登录与角色标识（普通员工 / 审批主管 / 财务），作为报销系统的基础身份层。

## 核心功能
1. 成员账号登录与退出。
2. 名册维护成员姓名、部门与审批权限标识。

## 验收口径
- 未登录访问报销页面自动跳转登录页。
- 仅具备审批权限的成员可见审批操作按钮。
`

  const req05Md = `# REQ-05 常用报销模板收藏（未送审草稿）

## 背景与目标
允许员工把高频出现的报销项（例如月度通勤、定期差旅）保存为个人模板，一键填入表单。

## 核心功能
1. 在报销录入页保存当前填写内容为个人模板。
2. 新建报销单时可下拉选择已收藏模板自动填充费用类型与事由。

## 验收口径
- 未送审草稿状态，可直接测试原地「修改需求」与「提变更 / 加功能」草稿修改通道。
`

  const contractT01 = {
    id: 'T-01',
    change: [
      'src/expense.mjs：新增单笔报销审批限额判定逻辑（超 5000 元需二级审批）',
      'tests/expense.test.mjs：补充限额边界用例（4999.99 / 5000 / 5000.01）',
    ],
    not_change: [
      '不改 R-01 已确认的金额汇总公式',
      '不改 REQ-04 登录与权限模型',
    ],
    acceptance: [
      'node tests/expense.test.mjs 全部通过',
      '超限额单据返回 requiresSecondaryApproval: true',
    ],
    affected_tests: ['node tests/expense.test.mjs'],
    fail_if: [
      '修改了 R-01 的 calculateTotal 精度舍入行为',
    ],
  }

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
- \`T-01\` ~ \`T-05\`：覆盖 \`drafting / contracted / implementing / verifying / closed\` 全部任务状态
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
    name: 前端工程师
    inherits: dev
    persona: 专注轻报销 Web 页面、表单交互与组件可用性。
    signals:
      strong: [html, css, form, table]
      medium: [页面, 表单, 列表]
      preferredPaths: [src/]
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
    roles: [maniu-manager]
    auto: false
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
    text: total = round(sum(round(amount * 100)) / 100, 2)
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
    '.spec/requirements/REQ-01.md': req01Md,
    '.spec/requirements/REQ-01/versions/v1.md': req01Md,
    '.spec/requirements/REQ-01/reviews/R1.md': req01ReviewR1,
    '.spec/prototypes/REQ-01/index.html': req01PrototypeHtml,

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
title: 报销单大额审批限额判定（含不可逆项，需人工签署）
description: 单笔报销超过 5000 元时标记需要二级审批，触及审批限额策略，需人工签署契约。
category: data
change_type: feature
grade: B
state: drafting
rules: [R-02]
requirement: REQ-02
track: finance
role: dev
scope:
  irreversible: [approval_limit]
  allowed_paths: [src/, tests/]
evidence_required: [build, test]
opened_at: '2026-11-21T10:00:00+08:00'
closed_at: null
`,
    '.spec/contracts/T-01.contract.yaml': renderContractYaml(contractT01, null),

    '.spec/tasks/T-02.yaml': `id: T-02
title: 月度汇总支持按费用类型筛选
description: 为 summarizeMonthly 增加可选 category 筛选，保持 R-01 金额计算口径不变。
category: api
change_type: feature
grade: B
state: contracted
rules: [R-01]
requirement: REQ-02
track: api
role: dev
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
description: 补齐负数金额与空事由的错误码及单测，供页面精准高亮报错字段。
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
description: 对齐 REQ-02 第二条 S 级微调，在月度汇总结果返回 pendingCount 并挂证据待收口。
category: api
change_type: improvement
grade: C
state: verifying
rules: [R-01]
requirement: REQ-02
track: api
role: dev
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
description: 实现 R-01 整数分累加汇总与基础单测，已随 REQ-04 上线收口。
category: data
change_type: feature
grade: B
state: closed
rules: [R-01]
requirement: REQ-04
track: api
role: dev
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
  console.log('  - T-01 ~ T-05       ：覆盖 drafting / contracted / implementing / verifying / closed 全看板态')
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
