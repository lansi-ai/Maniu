/** 原型生成提示词：把需求正文、样式摘要与参考图拼成给原型设计师的指令。 */

import type { StudioAnchorDraft } from '../prototype-studio/anchor-composer.tsx'
import { DEFAULT_PROTOTYPE_LIBRARY, type PrototypeLibrary } from './libraries.ts'
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

/** 元素级修改的选中上下文；来自独立预览窗口的点选上报。 */
export interface PrototypePatchContext {
  readonly domPath: string
  readonly html: string
  readonly css: string
  readonly instruction: string
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
  /** 非空时进入元素修改模式，按选中的元素片段出 patch，而不是整页重生成。 */
  readonly patch?: PrototypePatchContext | undefined
  /** 选用的组件素材库；未传时保持向后兼容，默认使用 heroui-glass 规范。 */
  readonly library?: PrototypeLibrary | undefined
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
 * 拼一条原型提示词。区块级重生成采用「整体重生成、只改目标区块、覆盖同一路径」，
 * 因为 prototype_draft 只写一个完整 HTML 文件；带 patch 时改走元素级修改，
 * 要求模型调用 prototype_patch 做受控替换。
 * @param input - 需求、摘要、参考图、可选区块或选中元素上下文。
 * @returns 发给 maniu-prototype 会话的提示词。
 */
export function buildPrototypePrompt(input: PrototypePromptInput): string {
  const library = input.library ?? DEFAULT_PROTOTYPE_LIBRARY

  if (input.patch !== undefined) {
    return [
      `请修改需求 ${input.requirementId}「${input.requirementTitle}」的现有 HTML 原型，只改选中的这一个元素。`,
      '',
      '【需求正文】',
      input.requirementText.trim(),
      '',
      `【组件素材库约束（${library.name}）】`,
      `风格定位：${library.summary}`,
      'Design Tokens：',
      library.designTokens,
      '',
      '【选中元素】',
      `DOM 路径：${input.patch.domPath}`,
      `元素 HTML：${input.patch.html}`,
      `关键计算样式：${input.patch.css}`,
      '',
      '【修改指令】',
      input.patch.instruction.trim(),
      '',
      '【交付要求】',
      '1. 元素级修改：只改选中的元素，其它区块的内容与结构保持不变，不要整页重生成，样式需与当前组件素材库 Design Tokens 一致。',
      `2. 调用 prototype_patch：requirement 填 ${input.requirementId}，domPath 填上面的 DOM 路径，instruction 填修改指令；改结构用 newHtml，只改样式用 newCss，二者只填一个。`,
      '3. newHtml 是替换该元素的单个 HTML 片段：标签成对闭合、无脚本、无外链；newCss 写 CSS 声明，如 `color: #333; font-size: 16px`。',
      '4. 若 prototype_patch 返回失败项，按失败项修正后重试 1 到 2 次；仍失败就如实报告，不留半成品。',
    ].join('\n')
  }
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
    `【组件素材库（${library.name}）】`,
    `风格定位：${library.summary}`,
    'Design Tokens：',
    library.designTokens,
    '组件 HTML/CSS 规范：',
    library.componentGuidelines,
    '',
    '【网页样式摘要（仅摘要，不含网页原文）】',
    styleSummaryText(input.summary),
    '',
    '【参考图（已在规格库里）】',
    refLines,
    '',
    '【交付要求】',
    '1. 产出完整单文件 HTML：内联 CSS + 自包含内联 `<script>` 交互逻辑，零外部依赖、无 `<script src>`、无 http(s) 外链、不调用 `fetch`/`XMLHttpRequest`/`WebSocket`/`eval`/`window.open`。',
    '2. **真实多页面应用架构（单文件 SPA，严禁把所有功能堆在一个长页面里）**：',
    '   - 必须提供清晰的左侧侧边栏或顶部导航栏，按真实软件信息架构拆分为多个独立页面视图（例如：概览/仪表盘、业务列表页、草稿/审批页等），同一时刻只展示当前激活的一个视图，其余视图隐藏，点击导航真实切换页面；',
    '   - **表单与列表必须分离**：新建/编辑表单放在独立表单页、居中弹窗（Modal）或右侧抽屉（Drawer）中，点击「+ 新建」或「编辑」才打开/切换；点击记录行可查看详情抽屉/详情页，绝不把大录入表单、大数据表格和统计卡片全堆在同一屏上下滚动；',
    '   - 业务应用不要强行堆砌官网式 Hero 广告横幅与营销页脚；**严禁把“需求要点 / 验收口径 / 背景与目标 / 状态机说明”等 PRD 文档文字画成软件界面卡片**，只呈现真实终端用户会看到的界面。',
    `3. 严格遵循所选组件素材库「${library.name}」的 Design Tokens 与组件 HTML/CSS 规范，保持组件形态、圆角、边框与色彩语义一致。`,
    '4. 必须实现真实可点击的前端假数据交互：页面切换、弹窗/抽屉开关、新建、编辑、删除、提交表单、搜索筛选等均须在内存态实时响应并更新界面，供用户在独立预览窗口直接试玩。',
    '5. 脚本防错红线：所有 `getElementById`/`querySelector` 结果读写属性前必须先判空（如 `if (el) el.textContent = ...`）；严禁在表单 `reset` 事件监听里再次调用 `form.reset()` 引发死循环；确保脚本引用的每个 `id` 在 HTML 中都存在；避免表单默认整页刷新（使用 `event.preventDefault()`）。',
    '6. 覆盖需求正文里的真实产品功能点，自然融入业务术语与关键词。',
    '7. 保持高效与精炼：需求正文与素材库规范已在上方完整给出，无需反复读取无关需求或旧原型文件，不要在思考过程里预写大段完整 HTML/CSS/JS 代码；将整份单文件原型控制在精炼紧凑的规模（约 250–450 行、3–6 条典型示例数据、复用通用样式类），确保单次输出就能完整调用 `prototype_draft` 落盘，避免超长被截断。',
    `8. 调用 prototype_draft：requirement 填 ${input.requirementId}，html 填完整 HTML，referenceSummary 填上面的样式摘要文本，referenceImages 填参考图相对路径数组。`,
    '9. 若 prototype_draft 返回失败项，按失败项修正后重试 1 到 2 次；仍失败就如实报告，不留半成品。',
  ].join('\n')
}

/** 协作流一轮修改的输入：多个点选锚点、人的修改意见与当前基准 HTML 的说明。 */
export interface StudioCoDesignInput {
  readonly requirementId: string
  readonly requirementTitle: string
  /** 基准说明（例如「当前暂存版」）；只传说明，不把整份 HTML 塞进提示词。 */
  readonly baselineNote: string
  readonly instruction: string
  /** 每个锚点带自己的修改要求；note 为空表示这一项见整体修改意见。 */
  readonly anchors: readonly StudioAnchorDraft[]
}

/**
 * 把协作流的一轮修改意见拼成给 maniu-prototype 的暂存指令。
 * 只要求模型调用 prototype_stage，不直接改正式版或需求正文；需求正文变更必须显式提案。
 * @param input - 需求、基准说明、修改意见与点选锚点。
 * @returns 发给 maniu-prototype 会话的提示词。
 */
export function buildStudioCoDesignPrompt(input: StudioCoDesignInput): string {
  const anchorLines = input.anchors.length === 0
    ? '（没有点选锚点，按修改意见自行定位 DOM 区域）'
    : input.anchors.map((anchor, index) => [
      `${index + 1}. DOM 路径：${anchor.domPath}`,
      `   标签名：${anchor.label ?? '未命名'}`,
      `   针对该元素的修改要求：${anchor.note?.trim() || '（未单独指定，见下方整体修改意见）'}`,
      `   元素 HTML：${anchor.html}`,
      `   关键样式：${anchor.css}`,
    ].join('\n')).join('\n')

  // 只填了逐锚点意见时，把各锚点要求汇总成整体修改意见，模型不必回头猜全局指令。
  const instruction = input.instruction.trim()
  const collected = instruction !== ''
    ? instruction
    : input.anchors
      .map((anchor, index) => ({ anchor, note: (anchor.note ?? '').trim(), index }))
      .filter(item => item.note !== '')
      .map(item => `#${String(item.index + 1)} ${item.anchor.label ?? item.anchor.domPath}：${item.note}`)
      .join('\n')
  const instructionBlock = collected === '' ? '（未填写整体修改意见，按点选锚点与各自要求处理）' : collected

  return [
    `请修改需求 ${input.requirementId}「${input.requirementTitle}」的 HTML 原型，本轮只做增量打磨。`,
    '',
    '【当前基准】',
    input.baselineNote.trim(),
    '',
    '【点选锚点】',
    anchorLines,
    '',
    '【修改意见】',
    instructionBlock,
    '',
    '【交付要求】',
    '1. 优先调用 prototype_stage 暂存本轮修改，不要直接覆盖正式版 HTML，也不要自行改动需求正文。',
    `2. 暂存条目 requirement 填 ${input.requirementId}；summary 给 2 到 4 条人话要点，让人不看代码就知道改了什么。`,
    '3. changedDomPaths 填本轮实际改动区域的 DOM 路径，优先取上面点选锚点的 domPath；只改样式也要填。',
    "4. 只动表现时 changeKind 填 'visual'；涉及业务规则、口径或字段增删时 changeKind 填 'business'，并同时给出 requirementProposedContent（提案后的需求正文全文），由人确认后才会同步。",
    '5. 改动要落在锚点元素的既有结构上，保持与当前组件素材库一致的样式语义；不引入外链与脚本。',
    '6. prototype_stage 返回失败项时按失败项修正后重试 1 到 2 次；仍失败就如实报告，不留半成品。',
  ].join('\n')
}
