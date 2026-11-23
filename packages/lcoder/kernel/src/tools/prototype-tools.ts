/**
 * 原型产物工具：`prototype_draft` 是模型把完整单文件 HTML 落盘的唯一入口。
 *
 * 它只写 `.spec/prototypes/<需求编号>/index.html`，并把路径、生成时刻与参考
 * 信息登记进该需求 YAML 的可选 `prototype` 字段。HTML 不执行、不注入：这里
 * 只把它当字节写盘，预览由客户端在隔离 iframe 里只读渲染。
 */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { assertRequirementId, loadRequirement, readRequirementDocument, saveRequirement } from '../kernel/requirement-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { assertPrototypeRelativePath, MAX_HTML_BYTES, prototypePath } from '../prototype/paths.js'
import { describeFailures, validatePrototypeHtml } from '../prototype/quality.js'
import { writeStagedPrototype } from '../prototype/store.js'
import type { StagedPrototype } from '../prototype/types.js'
import type { RequirementPrototype } from '../schema/spec.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/**
 * 校验 HTML 入参：非空、按字节不超过上限。
 * @param html - 模型给出的完整 HTML 字符串。
 * @returns 原样返回的 HTML。
 */
function assertHtml(html: string): string {
  if (html.trim() === '') throw new Error('prototype_draft 需要非空的 html：给出完整单文件 HTML')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error(`prototype_draft 的 html 超过 ${String(MAX_HTML_BYTES)} 字节上限`)
  }
  return html
}

/** 无子元素的内容标签；它们不能作为需要闭合标签的定位目标。 */
const VOID_TAGS = new Set([
  'meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr',
])

/** HTML 中一个开/闭标签的位置与原文。 */
interface TagToken {
  readonly start: number
  readonly end: number
  readonly closing: boolean
  readonly tag: string
  readonly raw: string
}

/** 一个元素在原型 HTML 里的字符区间。 */
interface ElementSpan {
  readonly start: number
  readonly end: number
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}

/** 扫描 HTML 的结构标签；跳过 `<script>` / `<style>` 内部正文，避免比较符号干扰标签栈。 */
function scanTags(html: string): TagToken[] {
  const tokens: TagToken[] = []
  const rawRanges: { readonly start: number; readonly end: number }[] = []
  for (const block of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const full = block[0]
    const start = block.index
    const openEnd = full.indexOf('>')
    const closeStart = full.lastIndexOf('</')
    if (openEnd >= 0 && closeStart > openEnd) {
      rawRanges.push({ start: start + openEnd + 1, end: start + closeStart })
    }
  }
  const insideRaw = (index: number): boolean => rawRanges.some(range => index >= range.start && index < range.end)
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
    // oxlint-disable-next-line typescript/no-useless-default-assignment -- noUncheckedIndexedAccess 下这两个下标仍可能缺省，默认值供类型检查使用。
    const { 0: raw = '', index: start = 0 } = match
    if (insideRaw(start)) continue
    tokens.push({ start, end: start + raw.length, closing: raw.startsWith('</'), tag: (match[1] ?? '').toLowerCase(), raw })
  }
  return tokens
}

/** 与预览窗口检查器一致的单段标识：标签、可选 id、首个 class 与 nth-child。 */
function segmentOf(openTag: string, tag: string, nth: number): string {
  const id = safeName(/\sid\s*=\s*["']([^"']*)["']/i.exec(openTag)?.[1] ?? '')
  const firstClass = safeName((/\sclass\s*=\s*["']([^"']*)["']/i.exec(openTag)?.[1] ?? '').trim().split(/\s+/)[0] ?? '')
  return `${tag}${id === '' ? '' : `#${id}`}${firstClass === '' ? '' : `.${firstClass}`}:nth-child(${String(nth)})`
}

/**
 * 用 domPath 在已落盘 HTML 里定位元素，不做整页重写。
 * @param html - 已落盘的单文件 HTML。
 * @param domPath - 检查器上报的从 body 到元素的路径。
 * @returns 元素的字符区间；找不到时返回 undefined。
 */
function locateByDomPath(html: string, domPath: string): ElementSpan | undefined {
  interface Frame { readonly path: string; readonly tag: string; readonly start: number; children: number }
  const stack: Frame[] = []
  for (const token of scanTags(html)) {
    if (token.closing) {
      const frame = stack.pop()
      if (frame !== undefined && frame.tag === token.tag && frame.path === domPath) {
        return { start: frame.start, end: token.end }
      }
      continue
    }
    const parent = stack[stack.length - 1]
    if (parent !== undefined) parent.children += 1
    const nth = parent === undefined ? 1 : parent.children
    const segment = segmentOf(token.raw, token.tag, nth)
    // html 段不进路径：路径从 body 起算，空父段不产生多余的 ' > '。
    const path = token.tag === 'html' ? '' : parent?.path === '' || parent === undefined
      ? segment
      : `${parent.path} > ${segment}`
    if (VOID_TAGS.has(token.tag)) {
      if (path !== '' && path === domPath) return { start: token.start, end: token.end }
      continue
    }
    stack.push({ path, tag: token.tag, start: token.start, children: 0 })
  }
  return undefined
}

/** 校验模型给出的新元素片段：单个成对闭合的根元素，且无脚本与外链。 */
function assertNewHtml(newHtml: string): string {
  const html = newHtml.trim()
  const match = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>([\s\S]*)<\/\1\s*>$/.exec(html)
  if (match === null) {
    throw new Error('prototype_patch 的 newHtml 必须是单个标签成对闭合的 HTML 片段')
  }
  const tag = match[1] ?? ''
  const inner = match[2] ?? ''
  if (new RegExp(`</${tag}\\s*>`, 'i').test(inner)) {
    throw new Error('prototype_patch 的 newHtml 只能替换一个元素')
  }
  if (/<script\b|<iframe\b|<object\b|<embed\b/i.test(html)
    || /\b(?:href|src)\s*=\s*["']\s*https?:\/\//i.test(html)
    || /@import\b|url\(\s*["']?\s*https?:\/\//i.test(html)) {
    throw new Error('prototype_patch 的 newHtml 不能含脚本、外链或外部样式')
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error(`prototype_patch 的 newHtml 超过 ${String(MAX_HTML_BYTES)} 字节上限`)
  }
  return html
}

/** 校验并规范化 CSS 声明，只允许 `属性: 值` 形式，禁止注入样式表或外链。 */
function assertNewCss(newCss: string): string {
  const declarations: string[] = []
  for (const part of newCss.split(';')) {
    const declaration = part.trim()
    if (declaration === '') continue
    const match = /^([a-z][a-z0-9-]*)\s*:\s*([^;{}]+)$/i.exec(declaration)
    if (match === null || /url\s*\(|expression\s*\(|https?:/i.test(declaration)) {
      throw new Error('prototype_patch 的 newCss 只能是安全的 `属性: 值` 声明')
    }
    declarations.push(`${match[1]}: ${(match[2] ?? '').trim()}`)
  }
  if (declarations.length === 0) throw new Error('prototype_patch 的 newCss 没有有效声明')
  return declarations.join('; ')
}

/** 只改目标元素的开标签 style 属性，不触碰页面其余部分。 */
function withCss(html: string, span: ElementSpan, css: string): string {
  const openEnd = html.indexOf('>', span.start)
  if (openEnd < 0 || openEnd >= span.end) throw new Error('prototype_patch 找不到目标元素的开标签')
  const openTag = html.slice(span.start, openEnd + 1)
  const existing = /\sstyle\s*=\s*["']([^"']*)["']/i.exec(openTag)
  let merged = css
  if (existing !== null) {
    const base = (existing[1] ?? '').split(';')
      .map(part => part.trim())
      .filter(part => part !== '' && /^[a-z][a-z0-9-]*\s*:/i.test(part))
    merged = [...base, css].join('; ')
  }
  const safe = merged.replace(/["']/g, '')
  let next: string
  if (existing === null) {
    next = `${openTag.slice(0, -1).replace(/\s*\/?$/, '')} style="${safe}">`
  } else {
    const [matched = ''] = existing
    next = openTag.replace(matched, ` style="${safe}"`)
  }
  return html.slice(0, span.start) + next + html.slice(openEnd + 1)
}

/**
 * 建原型工具；可见性由 `surface.ts` 白名单决定，新增默认不可见。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `prototype_draft`、`prototype_patch` 与 `prototype_stage` 工具定义。
 */
export function createPrototypeTools(rootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'prototype_draft',
      description:
        '把一条需求的 HTML 原型写到 `.spec/prototypes/<需求编号>/index.html`，并把路径与生成时刻登记进该需求 YAML 的可选 prototype 字段。html 是完整单文件 HTML（内联 CSS、无外部依赖、无脚本），非空且不超过 512KB；requirement 是已存在的需求编号。referenceSummary 是网页样式摘要文本，referenceImages 是参考图在 `.spec` 内的相对路径数组，二者可选。重复调用覆盖同一路径。只落盘与登记，不执行网页内容。',
      parameters: {
        requirement: { type: 'string', required: true, description: '需求编号，如 REQ-01；需求必须已存在' },
        html: { type: 'string', required: true, description: '完整单文件 HTML，内联 CSS、无脚本、无外部依赖；≤512KB' },
        referenceSummary: { type: 'string', description: '网页样式摘要文本；可选' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图在 .spec 内的相对路径，如 prototypes/REQ-01/refs/a.png；可选',
        },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        if (!hasSpecRoot(root)) {
          throw new Error('这个仓库还没有 .spec 规格库；先起草一条需求，原型才有落点')
        }

        const id = assertRequirementId(args.requirement.trim())
        const requirement = loadRequirement(root, id)
        const html = assertHtml(args.html)
        const references = (args.referenceImages ?? []).map(path => assertPrototypeRelativePath(root, id, path))
        const referenceSummary = args.referenceSummary?.trim()
        const generatedAt = new Date().toISOString()

        // 质量门禁先于任何写盘：失败只回结构化原因，磁盘上一个字节都不动。
        const quality = validatePrototypeHtml(html, readRequirementDocument(root, id) ?? '')
        if (!quality.ok) {
          return {
            ok: false,
            requirement_id: id,
            failed: quality.failed.map(issue => ({ code: issue.code, message: issue.message })),
            keywords: {
              hitRate: quality.keywords.hitRate,
              hits: [...quality.keywords.hits],
              misses: [...quality.keywords.misses],
            },
            retry: '按 failed 里的失败项修正 HTML 后重试 1 到 2 次；本次没有写入任何文件。',
            reason: describeFailures(quality),
          }
        }

        const target = prototypePath(root, id, 'index.html')
        // 先写好 HTML 与字段对象，再落盘：任一步骤失败都不改磁盘。
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, html, 'utf8')
        const prototype: RequirementPrototype = {
          path: `prototypes/${id}/index.html`,
          generatedAt,
          ...(referenceSummary === undefined || referenceSummary === '' ? {} : { referenceSummary }),
          references,
          quality: {
            passed: [...quality.passed],
            failed: quality.failed.map(issue => ({ code: issue.code, message: issue.message })),
            keywordHitRate: quality.keywords.hitRate,
            keywords: [...quality.keywords.keywords],
            hits: [...quality.keywords.hits],
            misses: [...quality.keywords.misses],
          },
          ...(requirement.prototype?.adoptedAt === undefined ? {} : { adoptedAt: requirement.prototype.adoptedAt }),
        }
        try {
          saveRequirement(root, { ...requirement, prototype })
        } catch (error) {
          // 字段写失败时删掉刚写的 HTML，不留「有文件没有字段」的半成品。
          rmSync(target, { force: true })
          throw error
        }

        return {
          ok: true,
          requirement_id: id,
          path: prototype.path,
          generated_at: generatedAt,
          references,
          bytes: Buffer.byteLength(html, 'utf8'),
          quality: {
            passed: [...quality.passed],
            keywordHitRate: quality.keywords.hitRate,
            keywords: [...quality.keywords.keywords],
            hits: [...quality.keywords.hits],
            misses: [...quality.keywords.misses],
          },
          note: '原型已落盘并登记到需求的 prototype 字段。客户端负责在隔离 iframe 里只读预览；本工具不执行网页内容。',
        }
      },
    }),
    defineTool({
      name: 'prototype_patch',
      description:
        '对已落盘的单文件 HTML 原型做元素级修改：按 domPath 定位一个元素，用 newHtml 替换它或只改它的 style。requirement 是已存在且已有原型的需求编号，domPath 来自预览窗口的点选上报，instruction 是用户修改要求。newHtml 与 newCss 只填一个；newHtml 是单个成对闭合、无脚本无外链的 HTML 片段，newCss 是安全的 `属性: 值` 声明。重新跑质量门禁后才落盘，失败不动任何文件。',
      parameters: {
        requirement: { type: 'string', required: true, description: '需求编号，如 REQ-01；必须已存在原型' },
        domPath: { type: 'string', required: true, description: '从 body 到元素的 DOM 路径，由预览窗口点选上报' },
        instruction: { type: 'string', required: true, description: '用户的元素级修改要求' },
        newHtml: { type: 'string', description: '替换该元素的单个 HTML 片段；与 newCss 二选一' },
        newCss: { type: 'string', description: '只改样式时的 CSS 声明，如 `color: #333`；与 newHtml 二选一' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        if (!hasSpecRoot(root)) {
          throw new Error('这个仓库还没有 .spec 规格库；没有原型可供修改')
        }

        const id = assertRequirementId(args.requirement.trim())
        const requirement = loadRequirement(root, id)
        const domPath = args.domPath.trim()
        const instruction = args.instruction.trim()
        if (domPath === '') throw new Error('prototype_patch 需要非空 domPath')
        if (instruction === '') throw new Error('prototype_patch 需要非空 instruction')

        const hasHtml = typeof args.newHtml === 'string' && args.newHtml.trim() !== ''
        const hasCss = typeof args.newCss === 'string' && args.newCss.trim() !== ''
        if (hasHtml === hasCss) throw new Error('prototype_patch 需要且只需要 newHtml 或 newCss 中的一个')
        const replacement = hasHtml ? assertNewHtml(args.newHtml as string) : undefined
        const css = hasCss ? assertNewCss(args.newCss as string) : undefined

        const target = prototypePath(root, id, 'index.html')
        if (!existsSync(target)) throw new Error('prototype_patch：该需求还没有原型，先用 prototype_draft 生成')
        const original = readFileSync(target, 'utf8')
        const span = locateByDomPath(original, domPath)
        if (span === undefined) throw new Error(`prototype_patch：找不到元素 ${domPath}，请重新在预览窗口点选`)

        const patched = replacement === undefined
          ? withCss(original, span, css as string)
          : original.slice(0, span.start) + replacement + original.slice(span.end)

        // 质量门禁先于任何写盘：失败只回结构化原因，磁盘上一个字节都不动。
        const quality = validatePrototypeHtml(patched, readRequirementDocument(root, id) ?? '')
        if (!quality.ok) {
          return {
            ok: false,
            requirement_id: id,
            domPath,
            failed: quality.failed.map(issue => ({ code: issue.code, message: issue.message })),
            retry: '按 failed 里的失败项修正 patch 后重试 1 到 2 次；本次没有写入任何文件。',
            reason: describeFailures(quality),
          }
        }

        const generatedAt = new Date().toISOString()
        const prototype: RequirementPrototype = {
          path: `prototypes/${id}/index.html`,
          generatedAt,
          ...(requirement.prototype?.referenceSummary === undefined || requirement.prototype.referenceSummary === ''
            ? {}
            : { referenceSummary: requirement.prototype.referenceSummary }),
          references: [...(requirement.prototype?.references ?? [])],
          quality: {
            passed: [...quality.passed],
            failed: quality.failed.map(issue => ({ code: issue.code, message: issue.message })),
            keywordHitRate: quality.keywords.hitRate,
            keywords: [...quality.keywords.keywords],
            hits: [...quality.keywords.hits],
            misses: [...quality.keywords.misses],
          },
          ...(requirement.prototype?.adoptedAt === undefined ? {} : { adoptedAt: requirement.prototype.adoptedAt }),
        }
        writeFileSync(target, patched, 'utf8')
        try {
          saveRequirement(root, { ...requirement, prototype })
        } catch (error) {
          // 字段写失败时恢复原 HTML，不留「新文件配旧字段」的半成品。
          writeFileSync(target, original, 'utf8')
          throw error
        }

        return {
          ok: true,
          requirement_id: id,
          domPath,
          instruction,
          path: prototype.path,
          generated_at: generatedAt,
          bytes: Buffer.byteLength(patched, 'utf8'),
          note: '元素级修改已落盘并通过质量校验。客户端负责刷新预览窗口；本工具不执行网页内容。',
        }
      },
    }),
    defineTool({
      name: 'prototype_stage',
      description:
        '把一次交互/多轮打磨的原型改动暂存为 staged.json，不覆盖正式版 index.html、不改需求正文。requirementId 是已存在的需求编号，html 是完整单文件 HTML（非空、≤512KB、无外链脚本），changeKind 区分 visual（只动表现）与 business（涉及业务口径），summary 是 2 到 4 条人话摘要，changedDomPaths 是本次涉及的元素路径。requirementProposedContent 可选，给出拟定的需求正文全文；正文基线由宿主读盘取得，不采信模型传入的旧正文。先过质量门禁，失败不动任何文件；确认后由宿主受控提交落盘。',
      parameters: {
        requirementId: { type: 'string', required: true, description: '已存在的需求编号，如 REQ-01' },
        html: { type: 'string', required: true, description: '打磨后的完整单文件 HTML，内联 CSS、无脚本外链；≤512KB' },
        changeKind: { type: 'string', enum: ['visual', 'business'], required: true, description: 'visual 只动表现；business 涉及业务口径' },
        summary: { type: 'array', items: { type: 'string' }, required: true, description: '2 到 4 条给人读的改动摘要' },
        changedDomPaths: { type: 'array', items: { type: 'string' }, description: '本次改动涉及的 DOM 路径；可选' },
        requirementProposedContent: { type: 'string', description: '拟定的需求正文全文；可选，正文基线仍由宿主读盘' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        if (!hasSpecRoot(root)) {
          throw new Error('这个仓库还没有 .spec 规格库；先起草一条需求，原型才有暂存落点')
        }

        const id = assertRequirementId(args.requirementId.trim())
        loadRequirement(root, id)
        const html = assertHtml(args.html)
        // changeKind 的取值由工具参数的 enum 约束，execute 不再重复判定。
        const changeKind = args.changeKind
        const rawSummary = args.summary
        if (!Array.isArray(rawSummary) || rawSummary.length < 2 || rawSummary.length > 4
          || rawSummary.some(item => typeof item !== 'string' || item.trim() === '')) {
          throw new Error('prototype_stage 的 summary 必须是 2 到 4 条非空的人话摘要')
        }
        const summary: string[] = rawSummary.map((item: string) => item.trim())
        const rawPaths = args.changedDomPaths ?? []
        if (!Array.isArray(rawPaths) || rawPaths.some(item => typeof item !== 'string')) {
          throw new Error('prototype_stage 的 changedDomPaths 必须是字符串数组')
        }
        const changedDomPaths: string[] = rawPaths.map((item: string) => item.trim()).filter(item => item !== '')

        // 正文基线只认磁盘当前值：模型既不能指定旧正文，也不能借暂存改写已确认需求。
        const baseContent = readRequirementDocument(root, id) ?? ''
        const quality = validatePrototypeHtml(html, baseContent)
        if (!quality.ok) {
          return {
            ok: false,
            requirement_id: id,
            failed: quality.failed.map(issue => ({ code: issue.code, message: issue.message })),
            retry: '按 failed 里的失败项修正 HTML 后重试 1 到 2 次；本次没有写入任何文件。',
            reason: describeFailures(quality),
          }
        }

        const rawProposed = args.requirementProposedContent
        const proposed: string | undefined = typeof rawProposed === 'string' && rawProposed.trim() !== ''
          ? rawProposed
          : undefined
        const staged: StagedPrototype = {
          requirementId: id,
          html,
          changeKind,
          summary,
          changedDomPaths,
          ...(proposed === undefined
            ? {}
            : {
              requirementDiff: {
                baseContent,
                proposedContent: proposed,
                summary: summary.join('；'),
              },
            }),
          createdAt: new Date().toISOString(),
        }
        writeStagedPrototype(root, id, staged)
        return {
          ok: true,
          requirement_id: id,
          change_kind: changeKind,
          summary,
          changed_dom_paths: changedDomPaths,
          created_at: staged.createdAt,
          staged_path: `.spec/prototypes/${id}/staged.json`,
          ...(proposed === undefined
            ? {}
            : { requirement_diff: { baseLength: baseContent.length, proposedLength: proposed.length } }),
          note: '暂存已写入 staged.json；正式版 index.html 与需求正文未改动，确认后由宿主受控提交。',
        }
      },
    }),
  ]
}
