/** 审批与提问的读取与回执编码：回执必须原样带回宿主给的结果，否则工具会挂住。 */

import type { EventOutcome } from '../contract.ts'

/** 宿主推来的一条 waterfall。 */
export interface HostWaterfallRequest {
  readonly name: string
  readonly clientId: string
  readonly eventId: string
  readonly request: Record<string, unknown>
}

/** 一条等待人处理的交互。 */
export interface PendingInteraction {
  readonly id: string
  readonly kind: 'approval' | 'question'
  readonly clientId: string
  readonly eventId: string
  readonly request: Record<string, unknown>
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
