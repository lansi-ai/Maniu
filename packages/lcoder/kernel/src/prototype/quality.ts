/**
 * 原型 HTML 的质量门禁：落盘前自动校验，失败返回结构化原因而不写半成品。
 *
 * 校验项全部是机械可判定的：可解析、必需区块、零脚本零外链、体积与路径、
 * 需求关键词命中。模型按失败项修正后可重试 1 到 2 次。
 */
import { MAX_HTML_BYTES } from './paths.js'

/** 一条失败项；`code` 稳定，`message` 给人读。 */
export interface QualityIssue {
  readonly code: string
  readonly message: string
}

/** 关键词命中情况。 */
export interface KeywordCoverage {
  readonly keywords: readonly string[]
  readonly hits: readonly string[]
  readonly misses: readonly string[]
  readonly hitRate: number
}

/** 一次质量校验的完整结果。 */
export interface QualityReport {
  readonly ok: boolean
  readonly passed: readonly string[]
  readonly failed: readonly QualityIssue[]
  readonly keywords: KeywordCoverage
  readonly bytes: number
}

/** 必需区块：`id` 是失败项 code 的一部分，`pattern` 命中任意一处即算存在。 */
const REQUIRED_SECTIONS: readonly { readonly id: string; readonly label: string; readonly pattern: RegExp }[] = [
  { id: 'navigation', label: '顶部导航', pattern: /<nav\b|\bclass\s*=\s*["'][^"']*\bnav\b/i },
  { id: 'hero', label: '主视觉区', pattern: /<h1\b|\bclass\s*=\s*["'][^"']*\bhero\b|\b主视觉/i },
  { id: 'features', label: '核心功能区', pattern: /\bclass\s*=\s*["'][^"']*\b(feature|features|功能)\b|<section\b/i },
  { id: 'content', label: '内容列表区', pattern: /<ul\b|<ol\b|<table\b|\bclass\s*=\s*["'][^"']*\b(list|grid|列表)\b/i },
  { id: 'footer', label: '页脚', pattern: /<footer\b|\bclass\s*=\s*["'][^"']*\bfooter\b|\b页脚/i },
]

/** 关键词命中率下限；低于它判定需求覆盖不足。 */
export const MIN_KEYWORD_HIT_RATE = 0.4

/** 从需求正文提取关键词时忽略的高频虚词。 */
const STOP_WORDS = new Set([
  '用户', '系统', '功能', '需求', '原型', '页面', '界面', '设计', '实现', '具备', '可以', '能够',
  '一个', '这个', '那个', '以及', '并且', '或者', '其他', '通过', '进行', '支持', '提供', '相关',
  '需要', '应该', '必须', '使用', '包括', '例如', '如果', '然后', '没有', '不是', '就是',
])

/** HTML 结构标签的栈平衡检查；只覆盖常见容器与标题标签。 */
const STACK_TAGS = new RegExp(
  '^(html|head|body|div|section|header|footer|main|nav|article|aside|ul|ol|li|table|'
  + 'thead|tbody|tr|td|th|h[1-6]|p|span|button|form|label|figure|figcaption)$',
)
const VOID_TAGS = /^(meta|link|br|hr|img|input|source|area|base|col|embed|param|track|wbr)$/

/**
 * 检查 HTML 基本可解析：有根元素、结构标签成对闭合。
 * @param html - 完整 HTML 字符串。
 * @returns 可解析为 true。
 */
export function isParseableHtml(html: string): boolean {
  const trimmed = html.trim()
  if (!/^<!doctype\s+html\b|^<html\b/i.test(trimmed)) return false
  if (!/<\/html\s*>/i.test(trimmed)) return false
  const stack: string[] = []
  for (const match of trimmed.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const raw = match[0] ?? ''
    const tag = (match[1] ?? '').toLowerCase()
    if (VOID_TAGS.test(tag) || raw.startsWith('<!') || raw.endsWith('/>')) continue
    if (!STACK_TAGS.test(tag)) continue
    if (raw.startsWith('</')) {
      if (stack.pop() !== tag) return false
    } else {
      stack.push(tag)
    }
  }
  return stack.length === 0
}

/**
 * 从需求正文提取关键词：中文词块优先，其次英文标题词。
 * @param text - 需求正文 Markdown。
 * @returns 去重后的关键词，最多 20 个。
 */
export function extractKeywords(text: string): string[] {
  const body = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<[^>]*>/g, ' ')
  const cjk = [...body.matchAll(/[\u4e00-\u9fff]{2,8}/g)].map(match => match[0] ?? '')
  const latin = [...body.matchAll(/\b[A-Za-z][A-Za-z0-9_-]{2,}\b/g)].map(match => match[0] ?? '')
  const counts = new Map<string, number>()
  for (const word of [...cjk, ...latin]) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([word]) => word)
    .slice(0, 20)
}

/**
 * 统计关键词命中；没有可用关键词时命中率记为 1，不冤枉空需求。
 * @param html - 原型 HTML。
 * @param keywords - 关键词集合。
 * @returns 命中明细。
 */
export function keywordCoverage(html: string, keywords: readonly string[]): KeywordCoverage {
  const haystack = html.toLowerCase()
  const hits = keywords.filter(word => haystack.includes(word.toLowerCase()))
  const misses = keywords.filter(word => !hits.includes(word))
  return {
    keywords,
    hits,
    misses,
    hitRate: keywords.length === 0 ? 1 : hits.length / keywords.length,
  }
}

/**
 * 运行全部质量校验；不修改 HTML。
 * @param html - 完整单文件 HTML。
 * @param requirementText - 需求正文，用于关键词命中。
 * @returns 通过项、失败项与关键词命中情况。
 */
export function validatePrototypeHtml(html: string, requirementText: string): QualityReport {
  const passed: string[] = []
  const failed: QualityIssue[] = []
  const bytes = Buffer.byteLength(html, 'utf8')

  const add = (ok: boolean, name: string, issue: QualityIssue): void => {
    if (ok) passed.push(name)
    else failed.push(issue)
  }

  add(isParseableHtml(html), 'parseable', { code: 'UNPARSEABLE_HTML', message: 'HTML 不可解析：缺少根元素或结构标签未成对闭合' })

  const missingSections = REQUIRED_SECTIONS.filter(section => !section.pattern.test(html))
  add(missingSections.length === 0, 'sections', {
    code: 'MISSING_SECTIONS',
    message: `缺少必需区块：${missingSections.map(section => section.label).join('、')}`,
  })

  const forbidden: string[] = []
  if (/<script\b/i.test(html)) forbidden.push('<script>')
  if (/<iframe\b/i.test(html)) forbidden.push('<iframe>')
  if (/<object\b|<embed\b/i.test(html)) forbidden.push('<object>/<embed>')
  if (/\b(?:href|src)\s*=\s*["']\s*https?:\/\//i.test(html)) forbidden.push('http(s) 外链')
  if (/@import\b|<link\b[^>]*rel\s*=\s*["']stylesheet/i.test(html)) forbidden.push('外部样式')
  if (/url\(\s*["']?\s*https?:\/\//i.test(html)) forbidden.push('外链资源')
  add(forbidden.length === 0, 'no-unsafe-markup', {
    code: 'UNSAFE_MARKUP',
    message: `原型含禁止内容：${forbidden.join('、')}；必须是零脚本零外链的单文件 HTML`,
  })

  add(bytes <= MAX_HTML_BYTES, 'size', {
    code: 'HTML_TOO_LARGE',
    message: `HTML 超过 ${String(MAX_HTML_BYTES)} 字节上限（当前 ${String(bytes)} 字节）`,
  })

  const keywords = keywordCoverage(html, extractKeywords(requirementText))
  add(keywords.hitRate >= MIN_KEYWORD_HIT_RATE, 'keywords', {
    code: 'LOW_KEYWORD_COVERAGE',
    message: `需求关键词命中率 ${String(Math.round(keywords.hitRate * 100))}% 低于 ${String(Math.round(MIN_KEYWORD_HIT_RATE * 100))}%：未命中 ${keywords.misses.slice(0, 8).join('、') || '无'}`,
  })

  return { ok: failed.length === 0, passed, failed, keywords, bytes }
}

/**
 * 把质量失败折成可读的一句话，供工具回执与会话重试提示。
 * @param report - 质量结果。
 * @returns 通过时为空串；失败时为逐项说明。
 */
export function describeFailures(report: QualityReport): string {
  return report.failed.map(issue => `${issue.code}: ${issue.message}`).join('；')
}
