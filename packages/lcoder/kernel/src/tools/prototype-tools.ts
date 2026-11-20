/**
 * 原型产物工具：`prototype_draft` 是模型把完整单文件 HTML 落盘的唯一入口。
 *
 * 它只写 `.spec/prototypes/<需求编号>/index.html`，并把路径、生成时刻与参考
 * 信息登记进该需求 YAML 的可选 `prototype` 字段。HTML 不执行、不注入：这里
 * 只把它当字节写盘，预览由客户端在隔离 iframe 里只读渲染。
 */
import { Buffer } from 'node:buffer'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { assertRequirementId, loadRequirement, readRequirementDocument, saveRequirement } from '../kernel/requirement-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { assertPrototypeRelativePath, MAX_HTML_BYTES, prototypePath } from '../prototype/paths.js'
import { describeFailures, validatePrototypeHtml } from '../prototype/quality.js'
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

/**
 * 建原型工具；可见性由 `surface.ts` 白名单决定，新增默认不可见。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `prototype_draft` 工具定义。
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
  ]
}
