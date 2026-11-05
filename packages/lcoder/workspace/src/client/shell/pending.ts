/**
 * 悬浮对话里的待处理交互：审批与提问的读取与回答构造。
 *
 * 数据来自上游 `ui-approval` / `ui-user-questions` 发布到 `uiSession` 的
 * `pendingInteraction`。外壳只读公开字段并调用对象自己的 `answer()`，
 * 不复制它们的结算、超时或降级逻辑；类型按用到的字段结构化声明，
 * 避免把上游 client 入口拉进本包的编译面。
 */
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'

/** 审批请求里外壳用到的字段。 */
export interface ShellApprovalPending extends SessionPendingInteractionBase {
  readonly toolName: string
  readonly reason: string | undefined
  readonly answerable: boolean
  answer(decision: 'allowed-once' | 'rejected'): Promise<void>
}

/** 一个选项：标签是回传值，说明只用于展示。 */
export interface ShellQuestionOption {
  readonly label: string
  readonly description?: string
}

/** 一个问题；`detail` 可承载计划评审的计划正文（Markdown）。 */
export interface ShellQuestion {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options?: readonly ShellQuestionOption[]
  readonly multiSelect?: boolean
}

/** 整批回答，编码与上游 `AskUserQuestionAnswer` 一致。 */
export interface ShellQuestionAnswer {
  readonly answers: readonly {
    readonly id: string
    readonly selected: readonly string[]
    readonly custom?: string
  }[]
}

/** 提问请求里外壳用到的字段。 */
export interface ShellQuestionPending extends SessionPendingInteractionBase {
  readonly questions: readonly ShellQuestion[]
  answer(answer: ShellQuestionAnswer): Promise<void>
}

/** 一个问题当前的草稿：选中的选项标签，加可选的自定义回答。 */
export interface QuestionDraft {
  readonly selected: readonly string[]
  readonly custom: string
}

/** 一个请求里每个问题的草稿，按问题 id 索引。 */
export type QuestionDrafts = Readonly<Record<string, QuestionDraft>>

/** 待处理交互是审批请求；不是时返回 null。 */
export function approvalOf(pending: SessionPendingInteractionBase | undefined): ShellApprovalPending | null {
  return pending !== undefined && pending.kind === 'approval' ? pending as ShellApprovalPending : null
}

/** 待处理交互是提问（含计划评审，二者回答编码相同）；不是时返回 null。 */
export function questionOf(pending: SessionPendingInteractionBase | undefined): ShellQuestionPending | null {
  return pending !== undefined && (pending.kind === 'question' || pending.kind === 'plan-review')
    ? pending as ShellQuestionPending
    : null
}

/** 一份空草稿：每个问题都没选、自定义回答为空。 */
export function emptyDrafts(questions: readonly ShellQuestion[]): QuestionDrafts {
  return Object.fromEntries(questions.map(question => [question.id, { selected: [], custom: '' }]))
}

/**
 * 按问答规则更新一个问题的草稿。
 *
 * 多选是勾选/取消；单选点已选项则清空，点其他项则替换。
 * @param question - 这一问的定义。
 * @param draft - 当前草稿。
 * @param option - 被点击的选项标签。
 * @returns 更新后的草稿。
 */
export function selectOption(
  question: ShellQuestion,
  draft: QuestionDraft,
  option: string,
): QuestionDraft {
  if (question.multiSelect === true) {
    const selected = draft.selected.includes(option)
      ? draft.selected.filter(label => label !== option)
      : [...draft.selected, option]
    return { ...draft, selected }
  }
  return { ...draft, selected: draft.selected.includes(option) ? [] : [option] }
}

/**
 * 把草稿折成上游 `answer()` 接受的整批回答。
 * @param questions - 请求里的全部问题。
 * @param drafts - 按问题 id 索引的草稿。
 * @returns 每个问题都非空时的回答批次；否则 null（还不能提交）。
 */
export function answerBatch(
  questions: readonly ShellQuestion[],
  drafts: QuestionDrafts,
): ShellQuestionAnswer | null {
  if (questions.length === 0) return null
  const answers: { id: string; selected: string[]; custom?: string }[] = []
  for (const question of questions) {
    const draft = drafts[question.id] ?? { selected: [], custom: '' }
    const custom = draft.custom.trim()
    if (draft.selected.length === 0 && custom === '') return null
    answers.push({
      id: question.id,
      selected: [...draft.selected],
      ...(custom === '' ? {} : { custom }),
    })
  }
  return { answers }
}
