/** 审批与提问的读取与回执编码：回执必须原样带回宿主给的结果，否则工具会挂住。 */

import type { EventOutcome } from '../contract.ts'

/** 宿主推来的一条 waterfall。 */
export interface HostWaterfallRequest {
  readonly name: string
  readonly clientId: string
  readonly eventId: string
  readonly request: Record<string, unknown>
}

/** 一条等待人处理的交互的可选来源事实；只有调用方握有确定关联时才填写。 */
export interface PendingSource {
  /** 后台操作的标题。 */
  readonly title: string
  /** 岗位身份与来源标签，缺项不填。 */
  readonly roleLabel?: string
  readonly sourceLabel?: string
}

/** 一条等待人处理的交互。 */
export interface PendingInteraction {
  readonly id: string
  readonly kind: 'approval' | 'question'
  readonly clientId: string
  readonly eventId: string
  readonly request: Record<string, unknown>
  /**
   * 确定关联的会话标识；waterfall 帧不携带会话身份，缺关联时必须留空。
   * 不得由 clientId、问题内容或到达时间推断。
   */
  readonly sessionId?: string
  readonly source?: PendingSource
}

/** 审批卡要显示的内容。 */
export interface ApprovalView {
  readonly toolName: string
  readonly reason?: string
}

/** 一个问题。 */
export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect: boolean
}

/** 一个问题当前的草稿：选中的选项标签，加可选的自定义回答。 */
export interface QuestionDraft {
  readonly selected: readonly string[]
  readonly custom: string
}

/** 一个请求里每个问题的草稿，按问题 id 索引。 */
export type QuestionDrafts = Readonly<Record<string, QuestionDraft>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function localized(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.zh === 'string' && value.zh !== '') return value.zh
  if (typeof value.en === 'string' && value.en !== '') return value.en
  return undefined
}

/**
 * 把一个 waterfall 帧折成待处理交互；不认识的形状返回 undefined。
 * @param name - 事件名。
 * @param clientId - 事件代际。
 * @param eventId - 本次事件标识。
 * @param request - 宿主给的请求载荷。
 * @returns 审批或提问；其他事件不画卡片。
 */
export function interactionOf(
  name: string,
  clientId: string,
  eventId: string,
  request: unknown,
): PendingInteraction | undefined {
  if (!isRecord(request)) return undefined
  if (name !== 'approval/request' && name !== 'user-questions/request') return undefined
  return {
    id: eventId,
    kind: name === 'approval/request' ? 'approval' : 'question',
    clientId,
    eventId,
    request,
  }
}

/**
 * 审批卡的内容；工具名原样显示，理由优先取本地化版本。
 * @param request - 审批请求载荷。
 * @returns 工具名与可选理由。
 */
export function approvalViewOf(request: Record<string, unknown>): ApprovalView {
  const reason = localized(request.displayReason)
    ?? (typeof request.reason === 'string' && request.reason !== '' ? request.reason : undefined)
  return {
    toolName: typeof request.toolName === 'string' && request.toolName !== '' ? request.toolName : 'tool',
    ...(reason === undefined ? {} : { reason }),
  }
}

/**
 * 提问卡里的问题；形状不完整的问题被跳过，不编造选项。
 * @param request - 提问请求载荷。
 * @returns 可显示的问题列表。
 */
export function questionsOf(request: Record<string, unknown>): QuestionItem[] {
  if (!Array.isArray(request.questions)) return []
  const questions: QuestionItem[] = []
  for (const raw of request.questions) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.question !== 'string') continue
    const options = Array.isArray(raw.options)
      ? raw.options.flatMap((option) => {
        if (!isRecord(option) || typeof option.label !== 'string') return []
        return [{
          label: option.label,
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        }]
      })
      : []
    questions.push({
      id: raw.id,
      question: raw.question,
      ...(typeof raw.detail === 'string' && raw.detail !== '' ? { detail: raw.detail } : {}),
      ...(typeof raw.header === 'string' && raw.header !== '' ? { header: raw.header } : {}),
      options,
      multiSelect: raw.multiSelect === true,
    })
  }
  return questions
}

/** 一份空草稿：每个问题都没选、自定义回答为空。 */
export function emptyDrafts(questions: readonly QuestionItem[]): QuestionDrafts {
  return Object.fromEntries(questions.map(question => [question.id, { selected: [], custom: '' }]))
}

/**
 * 按问答规则更新一个问题的草稿；多选是勾选/取消，单选点已选项则清空。
 * @param question - 这一问的定义。
 * @param draft - 当前草稿。
 * @param option - 被点击的选项标签。
 * @returns 更新后的草稿。
 */
export function selectOption(question: QuestionItem, draft: QuestionDraft, option: string): QuestionDraft {
  if (question.multiSelect) {
    const selected = draft.selected.includes(option)
      ? draft.selected.filter(label => label !== option)
      : [...draft.selected, option]
    return { ...draft, selected }
  }
  return { ...draft, selected: draft.selected.includes(option) ? [] : [option] }
}

/**
 * 把草稿折成宿主接受的整批回答。
 * @param questions - 请求里的全部问题。
 * @param drafts - 按问题 id 索引的草稿。
 * @returns 每个问题都非空时的回答批次；否则 null（还不能提交）。
 */
export function answerBatch(
  questions: readonly QuestionItem[],
  drafts: QuestionDrafts,
): { readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] } | null {
  if (questions.length === 0) return null
  const answers: { id: string; selected: string[]; custom?: string }[] = []
  for (const question of questions) {
    const draft = drafts[question.id] ?? { selected: [], custom: '' }
    const custom = draft.custom.trim()
    if (draft.selected.length === 0 && custom === '') return null
    answers.push({ id: question.id, selected: [...draft.selected], ...(custom === '' ? {} : { custom }) })
  }
  return { answers }
}

/**
 * 审批回执；宿主只认 `allowed-once` 与 `rejected` 这两个原文。
 * @param allow - true 允许一次，false 拒绝。
 * @returns 原样发回给 waterfall 的结果。
 */
export function approvalOutcome(allow: boolean): EventOutcome {
  return { kind: 'result', value: allow ? 'allowed-once' : 'rejected' }
}

/**
 * 提问回执；`answers` 的编码与宿主 `AskUserQuestionAnswer` 一致。
 * @param questions - 请求里的全部问题。
 * @param drafts - 按问题 id 索引的草稿。
 * @returns 可提交时的结果；还不能提交时为 null。
 */
export function questionOutcome(
  questions: readonly QuestionItem[],
  drafts: QuestionDrafts,
): EventOutcome | null {
  const batch = answerBatch(questions, drafts)
  return batch === null ? null : { kind: 'result', value: batch }
}

/**
 * 宿主取消了一条等待中的交互（例如回合被停掉）。
 * @param value - waterfall cancel 帧。
 * @returns 对应的事件标识；形状不对时为 undefined。
 */
export function cancelledEventId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.eventId === 'string' ? value.eventId : undefined
}

/** 按确定关联的会话归组后的待处理交互；`sessionId` 为 null 表示来源不可用。 */
export interface PendingGroup {
  /** 稳定的分组键；无关联会话时为固定值 `unknown`。 */
  readonly key: string
  readonly sessionId: string | null
  readonly items: readonly PendingInteraction[]
}

/**
 * 把待处理交互按会话分组；没有确定会话关联的交互统一进 `unknown` 组。
 * @param items - 当前全部待处理交互。
 * @returns 按首次出现顺序排列的分组。
 */
export function groupPending(items: readonly PendingInteraction[]): PendingGroup[] {
  const groups = new Map<string, PendingInteraction[]>()
  for (const item of items) {
    const key = item.sessionId === undefined || item.sessionId === '' ? 'unknown' : item.sessionId
    const current = groups.get(key)
    if (current === undefined) groups.set(key, [item])
    else current.push(item)
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    sessionId: key === 'unknown' ? null : key,
    items: group,
  }))
}

/** 一条交互用于通知摘要的事实。 */
export interface InteractionSummary {
  readonly kind: 'approval' | 'question'
  /** 提问数；审批恒为 0。 */
  readonly count: number
  /** 审批的工具名；提问为 undefined。 */
  readonly toolName?: string
}

/**
 * 提取通知摘要；不读取问题正文，只数题目数与审批工具名。
 * @param interaction - 待处理交互。
 * @returns 摘要事实。
 */
export function summaryOfInteraction(interaction: PendingInteraction): InteractionSummary {
  if (interaction.kind === 'approval') {
    return { kind: 'approval', count: 0, toolName: approvalViewOf(interaction.request).toolName }
  }
  return { kind: 'question', count: questionsOf(interaction.request).length }
}
