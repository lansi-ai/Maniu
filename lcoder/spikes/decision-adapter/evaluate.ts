/**
 * 决策适配器只读评估脚本。
 *
 * 用途：把「任务 → 岗位」这件事按本地规则打一遍分，分别对真实任务弱标签与合成样本
 * 出 hit@1、miss 清单与阈值覆盖率。脚本只读仓内文件，不联网、不写产品数据、不产生
 * 任何调度或分配动作。
 *
 * 运行：pnpm exec tsx lcoder/spikes/decision-adapter/evaluate.ts [--out <file>] [--json <file>]
 *
 * 依赖：只读 .spec/roles.yaml（用仓内已有的 js-yaml 解析）与同目录两份样本 JSON。
 * 本目录不进入任何产品构建面。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')

/** 规则词表：strong 是技术栈特征，medium 只是弱语义；内置角色按职责词。 */
const LEXICON = {
  'dotnet-engineer': {
    strong: ['.net', 'dotnet', 'c#', 'csharp', 'wpf', 'winforms', 'xaml', 'asp.net'],
    medium: ['后端', '服务端', 'api'],
  },
  'vue-engineer': {
    strong: ['vue', 'nuxt', 'vue3', 'element-plus', 'pinia'],
    medium: ['前端', '页面', '组件', '界面', '样式', '交互', 'ui'],
  },
  'python-engineer': {
    strong: ['python', 'pytest', 'pandas', 'numpy', 'django', 'flask', 'fastapi'],
    medium: ['脚本', '数据', '批处理'],
  },
  'android-engineer': {
    strong: ['android', '安卓', 'kotlin', 'gradle', 'jetpack'],
    medium: ['移动端', '客户端'],
  },
  intake: { strong: [], medium: ['立项', '需求收集', '新项目', '调研'] },
  architect: { strong: [], medium: ['架构', '契约', 'schema', '接口设计', 'adr', 'openapi', 'ddl', '数据面', '规格'] },
  pm: { strong: [], medium: ['需求', '方案', '提案', 'prd', '优先级', '验收标准'] },
  dev: { strong: [], medium: ['实现', '开发', '修复', '改造', '新增', '接入', '重构', '缺陷', '代码', '测试'] },
  git: { strong: [], medium: ['提交', '分支', '合并', 'rebase', '仓库'] },
  ops: { strong: [], medium: ['部署', '发布', '流水线', '运维', '脚本', '构建', '冒烟', '签名', '公证', 'ci', 'cos', 'cdn', '回滚'] },
  review: { strong: [], medium: ['审计', '评审', '复核', '检查', '漂移', '只读'] },
  scheduler: { strong: [], medium: ['调度', '分配', '会话复用'] },
  flow: { strong: [], medium: ['流程', '下一步', '挡住'] },
  manager: { strong: [], medium: ['岗位', '名册', '派工'] },
}

/** 任务类型先验：流程偏运维、缺陷偏实施、文档无人专岗时按实施执行。 */
const TYPE_PRIOR = { 流程: { ops: 3 }, 缺陷: { dev: 3 }, 文档: { pm: 1 }, 开发: { dev: 1 } }

const STRONG_WEIGHT = 3
const MEDIUM_WEIGHT = 1

/** 收集一段文本里命中的词，返回命中表；拉丁词按小写包含匹配，中文词按原样包含。 */
function hits(text, words) {
  const lower = text.toLowerCase()
  return words.filter((word) => lower.includes(word))
}

/**
 * 算一条任务在每个角色上的原始分。
 * @param task - 样本；真实样本只有 title/summary/type，合成样本还有契约、规则、文件面。
 * @param jobIds - 名册里的岗位 id；只有这些 id 需要技术栈特征词才参与打分。
 * @returns 角色 id 到分数的映射，只保留正分。
 */
function scoreTask(task, jobIds) {
  const fields = [
    { text: task.title ?? '', weight: 2 },
    { text: task.description ?? task.summary ?? '', weight: 1 },
    { text: task.contract ?? '', weight: 1 },
    { text: [task.rules ?? []].flat().join(' '), weight: 1 },
    { text: [task.paths ?? []].flat().join(' '), weight: 1 },
  ]
  const scores = new Map()
  const add = (role, points) => scores.set(role, (scores.get(role) ?? 0) + points)

  for (const [role, words] of Object.entries(LEXICON)) {
    let score = 0
    let strongHit = false
    for (const field of fields) {
      const strong = hits(field.text, words.strong)
      const medium = hits(field.text, words.medium)
      if (strong.length > 0) strongHit = true
      score += (strong.length * STRONG_WEIGHT + medium.length * MEDIUM_WEIGHT) * field.weight
    }
    // 岗位必须命中技术栈特征词才参与；只命中「页面/组件/脚本」这类弱词不算岗位归属。
    if (jobIds.has(role) && !strongHit) continue
    if (score > 0) add(role, score)
  }

  for (const [role, points] of Object.entries(TYPE_PRIOR[task.type] ?? {})) {
    if (LEXICON[role] !== undefined) add(role, points)
  }
  return scores
}

/** 名册顺序决定并列时的偏好：岗位在前，内置角色按名册声明顺序。 */
function rosterOrder(roster) {
  const order = new Map()
  roster.forEach((entry, index) => order.set(entry.id, index))
  for (const id of Object.keys(LEXICON)) {
    if (!order.has(id)) order.set(id, order.size)
  }
  return order
}

/**
 * 取排序后的候选：分数降序、岗位优先于内置角色、再按名册顺序。
 * @param scores - 角色到分数的映射。
 * @param roster - 岗位名册。
 * @returns 候选数组。
 */
function rank(scores, roster) {
  const order = rosterOrder(roster)
  const jobIds = new Set(roster.map((entry) => entry.id))
  const candidates = [...scores.entries()].map(([role, score]) => ({ role, score }))
  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const leftJob = jobIds.has(left.role) ? 0 : 1
    const rightJob = jobIds.has(right.role) ? 0 : 1
    if (leftJob !== rightJob) return leftJob - rightJob
    return (order.get(left.role) ?? 0) - (order.get(right.role) ?? 0)
  })
  return candidates
}

/** 能写盘的角色：surface.ts 的角色表里带 file_edit 的只有 dev 与 ops，名册岗位都继承 dev。 */
const WRITER_ROLES = new Set(['dev', 'ops'])
/** 需要写盘的任务类型；除纯只读复核外，台账里的任务都要落文件。 */
const WRITE_TASK_TYPES = new Set(['开发', '缺陷', '变更', '文档', '流程'])

/**
 * 能力过滤：执行类任务只在能写盘的角色里选，避免把实施任务派给只会读的角色。
 * 这是从 surface.ts 的工具天花板推出来的，不是从样本标签反推的。
 * @param task - 样本。
 * @param jobIds - 名册岗位 id。
 * @returns 允许的角色集合；null 表示不过滤。
 */
function allowedRoles(task, jobIds) {
  if (!WRITE_TASK_TYPES.has(task.type)) return null
  const allowed = new Set(WRITER_ROLES)
  for (const id of jobIds) allowed.add(id)
  return allowed
}

/** 一条样本的判定：top1、置信度（分数占比）、与第二名的差、是否过建议阈值。 */
function decide(task, roster, jobIds, threshold, mode) {
  const scores = scoreTask(task, jobIds)
  const allowed = mode === 'capability' ? allowedRoles(task, jobIds) : null
  if (allowed !== null) {
    for (const role of [...scores.keys()]) {
      if (!allowed.has(role)) scores.delete(role)
    }
  }
  const candidates = rank(scores, roster)
  const total = candidates.reduce((sum, candidate) => sum + candidate.score, 0)
  const top = candidates[0]
  const second = candidates[1]
  // 离线退化：没有任何命中时不空着，交回唯一无天花板的实施角色，并强制转人工。
  if (top === undefined) {
    return { candidates, top: 'dev', second: null, confidence: 0, margin: 0, autoSuggest: false, fallback: true }
  }
  const confidence = total === 0 ? 0 : top.score / total
  const margin = top.score - (second?.score ?? 0)
  return {
    candidates,
    top: top.role,
    second: second?.role ?? null,
    confidence,
    margin,
    autoSuggest: confidence >= threshold && margin >= 1,
    fallback: false,
  }
}

/** 统计一组样本：hit@1、多数类基线、阈值覆盖率与自动建议准确率、混淆计数。 */
function summarize(rows, samples) {
  const hit = rows.filter((row) => row.top === row.expected).length
  const counts = new Map()
  for (const sample of samples) counts.set(sample.expectedRole, (counts.get(sample.expectedRole) ?? 0) + 1)
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const majorityHits = rows.filter((row) => row.expected === majority[0]).length
  const auto = rows.filter((row) => row.autoSuggest)
  const autoHit = auto.filter((row) => row.top === row.expected).length
  const fallback = rows.filter((row) => row.fallback)
  const evidenced = rows.filter((row) => !row.fallback)
  const evidencedHits = evidenced.filter((row) => row.top === row.expected).length
  return {
    count: rows.length,
    hit,
    hitAt1: rows.length === 0 ? 0 : hit / rows.length,
    fallbackCount: fallback.length,
    evidencedCount: evidenced.length,
    evidencedHitAt1: evidenced.length === 0 ? 0 : evidencedHits / evidenced.length,
    majorityRole: majority[0],
    majorityBaseline: rows.length === 0 ? 0 : majorityHits / rows.length,
    autoCoverage: rows.length === 0 ? 0 : auto.length / rows.length,
    autoPrecision: auto.length === 0 ? null : autoHit / auto.length,
  }
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

/** 把一组结果渲染成可读表；miss 清单逐条写期望、命中、依据与候选分。 */
function render(title, rows, summary) {
  const lines = []
  lines.push(`## ${title}`)
  lines.push(`样本 ${summary.count}｜hit@1 ${summary.hit}/${summary.count}（${pct(summary.hitAt1)}）｜有依据样本 ${summary.evidencedCount} 条 hit@1 ${pct(summary.evidencedHitAt1)}｜兜底 ${summary.fallbackCount} 条｜多数类 ${summary.majorityRole} 基线 ${pct(summary.majorityBaseline)}｜阈值覆盖率 ${pct(summary.autoCoverage)}｜阈值内准确率 ${summary.autoPrecision === null ? 'n/a' : pct(summary.autoPrecision)}`)
  lines.push('')
  lines.push('| 样本 | 期望（弱标签） | 命中 | 置信度 | 分差 | 自动建议 | 第二名 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const row of rows) {
    lines.push(`| ${row.id} | ${row.expected} | ${row.top} | ${row.confidence.toFixed(2)} | ${row.margin} | ${row.autoSuggest ? '是' : '否'} | ${row.second ?? '-'} |`)
  }
  const misses = rows.filter((row) => row.top !== row.expected)
  lines.push('')
  lines.push(`### miss 清单（${misses.length} 条）`)
  if (misses.length === 0) lines.push('无。')
  for (const row of misses) {
    lines.push(`- ${row.id}：期望 ${row.expected}，规则选 ${row.top}（置信度 ${row.confidence.toFixed(2)}，分差 ${row.margin}）。标签依据：${row.rationale}。候选：${row.candidates.map((candidate) => `${candidate.role}=${candidate.score}`).join('，') || '无'}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 读 JSON 样本文件。 */
function readSamples(name) {
  return JSON.parse(readFileSync(join(HERE, name), 'utf8'))
}

async function main() {
  const args = process.argv.slice(2)
  const readArg = (flag) => {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : args[index + 1]
  }
  const outPath = readArg('--out')
  const jsonPath = readArg('--json')
  const threshold = Number(readArg('--threshold') ?? '0.5')

  const { default: yaml } = await import('js-yaml')
  const rolesDoc = yaml.load(readFileSync(join(ROOT, '.spec', 'roles.yaml'), 'utf8'))
  const roster = rolesDoc.roles.map((role) => ({ id: role.id, name: role.name, inherits: role.inherits, persona: role.persona ?? '' }))
  const builtinOrder = ['intake', 'architect', 'pm', 'dev', 'git', 'ops', 'review', 'scheduler', 'flow', 'manager']
  const fullRoster = [...roster, ...builtinOrder.map((id) => ({ id, name: id, inherits: id, persona: '' }))]
  const jobIds = new Set(roster.map((role) => role.id))

  const evaluate = (samples, mode) => samples.map((sample) => {
    const result = decide(sample, fullRoster, jobIds, threshold, mode)
    return {
      id: sample.id,
      expected: sample.expectedRole,
      top: result.top,
      second: result.second,
      confidence: result.confidence,
      margin: result.margin,
      autoSuggest: result.autoSuggest,
      fallback: result.fallback,
      candidates: result.candidates,
      rationale: sample.labelRationale,
    }
  })

  const real = readSamples('samples.real.json')
  const synthetic = readSamples('samples.synthetic.json')
  const modes = [
    { key: 'keyword', title: '关键词直选' },
    { key: 'capability', title: '关键词 + 能力过滤' },
  ]
  const results = {}
  for (const mode of modes) {
    results[mode.key] = {
      real: evaluate(real.samples, mode.key),
      synthetic: evaluate(synthetic.samples, mode.key),
    }
  }

  const report = [
    '# 决策适配器本地规则基线（只读评估）',
    '',
    `规则阈值：置信度 ≥ ${threshold} 且分差 ≥ 1 才给自动建议。真实样本 ${real.samples.length} 条，合成样本 ${synthetic.samples.length} 条；两组分开统计，不混算。两种规则口径都列出：关键词直选是下限对照，能力过滤是从工具天花板推出的执行约束。`,
    '',
  ]
  for (const mode of modes) {
    const realRows = results[mode.key].real
    const syntheticRows = results[mode.key].synthetic
    report.push(render(`真实任务（弱标签）· ${mode.title}`, realRows, summarize(realRows, real.samples)))
    report.push(render(`合成样本（覆盖岗位，不证明真实准确率）· ${mode.title}`, syntheticRows, summarize(syntheticRows, synthetic.samples)))
  }
  report.push(
    '## 口径说明',
    '',
    '- 真实样本的期望岗位是人工弱标签，依据是任务标题、类型与台账 note；台账不是事实标签，hit@1 只能读作「规则与弱标签的一致率」。',
    '- 合成样本按适配器接口草案的完整输入构造，只验证接口形状与打分路径；它与真实样本分开统计，禁止相加或平均。',
    '- 规则只用任务文本与类型，不读源码、不读契约正文、不调外部模型；置信度是候选分占比，不是校准概率。',
    '- 多数类基线是「一律给出现最多的期望角色」，用来判断规则是否比常量默认更有信息量。',
    '- 能力过滤只保留 surface.ts 角色表里带 file_edit 的角色（dev、ops 与继承 dev 的名册岗位），不是从标签反推。',
    '',
  )

  if (jsonPath !== undefined) {
    const payload = { threshold, modes: {} }
    for (const mode of modes) {
      payload.modes[mode.key] = {
        real: { summary: summarize(results[mode.key].real, real.samples), rows: results[mode.key].real },
        synthetic: { summary: summarize(results[mode.key].synthetic, synthetic.samples), rows: results[mode.key].synthetic },
      }
    }
    writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)
  }
  if (outPath === undefined) process.stdout.write(`${report}\n`)
  else {
    writeFileSync(outPath, `${report}\n`)
    process.stdout.write(`report written to ${outPath}\n`)
  }
}

await main()
