/** 原型生成提示词：把需求正文、样式摘要与参考图拼成给原型设计师的指令。 */

import type { PrototypeStyleSummary } from './remote.ts'

/** 区块级重生成时可选的区块；与质量门禁的固定骨架一致。 */
export const PROTOTYPE_SECTIONS = ['顶部导航', '主视觉区', '核心功能区', '内容列表区', '页脚'] as const
export type PrototypeSection = (typeof PROTOTYPE_SECTIONS)[number]

/** 一条参考图的展示信息。 */
export interface PrototypeRefView {
  readonly path: string
  readonly name: string
  /** 上传时内存里的缩略图 data URL；重新载入后只有路径，没有字节。 */
  readonly dataUrl?: string
}

/** 提示词输入。 */
export interface PrototypePromptInput {
  readonly requirementId: string
  readonly requirementTitle: string
  readonly requirementText: string
  readonly summary: PrototypeStyleSummary | undefined
  readonly refs: readonly PrototypeRefView[]
  /** 非空时只重做该区块，其它区块保持不变。 */
  readonly section?: PrototypeSection | undefined
}

/** 把样式摘要折成给模型的可读文本，不回传任何网页 HTML 原文。 */
export function styleSummaryText(summary: PrototypeStyleSummary | undefined): string {
  if (summary === undefined) return '（没有网页样式参考，按产品 Glass 设计 token 自行设计）'
  const lines = [
    `参考网页：${summary.url}`,
    `标题：${summary.title}`,
    `主色：${summary.colors.length === 0 ? '未识别' : summary.colors.join('、')}`,
    `字体：${summary.font === '' ? '未识别' : summary.font}`,
    `布局：${summary.layout === '' ? '未识别' : summary.layout}`,
    `按钮风格：${summary.buttonStyle === '' ? '未识别' : summary.buttonStyle}`,
    `正文节选：${summary.text}`,
  ]
  return lines.join('\n')
}

/**
 * 拼一条原型生成提示词。区块级重生成采用「整体重生成、只改目标区块、覆盖同一路径」，
 * 因为 prototype_draft 只写一个完整 HTML 文件。
 * @param input - 需求、摘要、参考图与可选区块。
 * @returns 发给 maniu-prototype 会话的提示词。
 */
export function buildPrototypePrompt(input: PrototypePromptInput): string {
  const sectionLine = input.section === undefined
    ? '重新生成整份原型。'
    : `区块级重生成：只重做「${input.section}」区块，其它区块的内容与结构保持不变，输出完整单文件 HTML。`
  const refLines = input.refs.length === 0
    ? '（没有参考图）'
    : input.refs.map(ref => `- ${ref.path}（${ref.name}）`).join('\n')

  return [
    `请为需求 ${input.requirementId}「${input.requirementTitle}」生成 HTML 原型。`,
    sectionLine,
    '',
    '【需求正文】',
    input.requirementText.trim(),
    '',
    '【网页样式摘要（仅摘要，不含网页原文）】',
    styleSummaryText(input.summary),
    '',
    '【参考图（已在规格库里）】',
    refLines,
    '',
    '【交付要求】',
    '1. 产出完整单文件 HTML：内联 CSS、零 JavaScript、零外部依赖、无 http(s) 外链。',
    '2. 固定区块骨架：顶部导航、主视觉区、核心功能区、内容列表区、页脚。',
    '3. 采用产品 Glass 设计 token：半透明磨砂卡片、柔和阴影、低饱和主色、圆角与留白。',
    '4. 覆盖需求正文里的功能点，尽量命中需求关键词；只画界面，不写业务逻辑。',
    `5. 调用 prototype_draft：requirement 填 ${input.requirementId}，html 填完整 HTML，referenceSummary 填上面的样式摘要文本，referenceImages 填参考图相对路径数组。`,
    '6. 若 prototype_draft 返回失败项，按失败项修正后重试 1 到 2 次；仍失败就如实报告，不留半成品。',
  ].join('\n')
}
