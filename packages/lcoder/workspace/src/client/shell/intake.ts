/**
 * 立项会话的识别、重开与结果页取数。
 *
 * 立项分析跑完以后，需求落在 `.spec/requirements/`，会话本身留作回看；「重新开始」
 * 只是新建一条会话并重发同一档咒语，不碰任何已落盘内容。本模块只做纯判断与一次
 * 建会话加发送的组合，UI 负责把结果画出来。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RequirementDocRow } from '../projection.ts'
import type { ShellMessage, ShellProjectInfo } from './shell-data.ts'
import {
  buildIntakePrompt, buildOnboardingPrompt, INTAKE_PROMPT_HEAD, ONBOARDING_PROMPT_HEAD,
} from './shell-data.ts'
import type { ShellOnboardingDocs, ShellPromptProject } from './shell-data.ts'

/** 立项咒语的两档；与 `INTAKE_PROMPT_HEAD` / `ONBOARDING_PROMPT_HEAD` 一一对应。 */
export type IntakeTier = 'new' | 'docs'

/**
 * 从会话消息里认出立项档位。
 *
 * 只认外壳自动发出的两档咒语首行前缀；两档都没有或消息窗口读不到时返回 null，
 * 调用方据此不显示「重新开始」——猜错档位会把另一档咒语发给模型。
 * @param messages - 会话事件窗口折成的消息。
 * @returns 找到的档位；不是立项会话或读不到时为 null。
 */
export function intakeTierOfMessages(messages: readonly ShellMessage[]): IntakeTier | null {
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.text.startsWith(INTAKE_PROMPT_HEAD)) return 'new'
    if (message.text.startsWith(ONBOARDING_PROMPT_HEAD)) return 'docs'
  }
  return null
}

/** 「重新开始」确认框要列的已有产物。 */
export interface IntakeArtifacts {
  /** `.spec/project.yaml` 是否读到；`false` 表示未登记或读不到。 */
  readonly projectRegistered: boolean
  readonly rules: number
  readonly tasks: number
  readonly drafting: number
  readonly proposals: number
}

/**
 * 数一遍当前仓库已有的产物；各项为零要如实显示，不能因为零就整行藏掉。
 * @param input - 投影与项目信息的现成计数。
 * @returns 确认框用的五个计数。
 */
export function intakeArtifactsOf(input: {
  readonly info: ShellProjectInfo | null
  readonly rules: number
  readonly tasks: readonly { readonly state: string }[]
  readonly proposals: number
}): IntakeArtifacts {
  return {
    projectRegistered: input.info !== null,
    rules: input.rules,
    tasks: input.tasks.length,
    drafting: input.tasks.filter(task => task.state === 'drafting').length,
    proposals: input.proposals,
  }
}

/** 需求编号里的数字；认不出编号时按 -1 排，不与真实编号抢「最新」。 */
function requirementRank(id: string): number {
  const matched = /^REQ-(\d+)$/i.exec(id)
  return matched === null ? -1 : Number.parseInt(matched[1] ?? '', 10)
}

/**
 * 编号最大的需求；向导结果卡与结果页默认展示它。
 * @param requirements - 读到的需求行。
 * @returns 编号最大的那条；没有需求时为 undefined。
 */
export function latestRequirement(requirements: readonly RequirementDocRow[]): RequirementDocRow | undefined {
  return requirements.reduce<RequirementDocRow | undefined>(
    (latest, row) => latest === undefined || requirementRank(row.id) > requirementRank(latest.id) ? row : latest,
    undefined,
  )
}

/** 重开的结果：建会话失败、发送失败、或两件都成功。 */
export type IntakeRestartOutcome =
  | { readonly kind: 'create-failed'; readonly error: string }
  | { readonly kind: 'send-failed'; readonly sessionId: SessionId; readonly prompt: string; readonly error: string }
  | { readonly kind: 'started'; readonly sessionId: SessionId; readonly prompt: string }

/**
 * 重新开始一次立项：按原档位重建咒语，新建会话后只发给新会话。
 *
 * 不传角色，交给宿主默认；旧会话与已落盘内容完全不动。发送失败时新会话已经存在，
 * 调用方仍应切到它并把错误原文显示出来，旧会话照旧保留可回看。
 * @param input - 档位、项目事实、建会话与发送两面。
 * @returns 建会话失败、发送失败或成功三种结果。
 */
export async function runIntakeRestart(input: {
  readonly tier: IntakeTier
  readonly project: ShellPromptProject
  readonly docs: ShellOnboardingDocs
  readonly path: string
  readonly createSession: (path: string) => Promise<SessionId>
  readonly sendPrompt: (sessionId: SessionId, content: string) => Promise<void>
}): Promise<IntakeRestartOutcome> {
  const prompt = input.tier === 'new'
    ? buildIntakePrompt(input.project)
    : buildOnboardingPrompt(input.project, input.docs)
  let sessionId: SessionId
  try {
    sessionId = await input.createSession(input.path)
  } catch (error: unknown) {
    return { kind: 'create-failed', error: String(error) }
  }
  try {
    await input.sendPrompt(sessionId, prompt)
  } catch (error: unknown) {
    return { kind: 'send-failed', sessionId, prompt, error: String(error) }
  }
  return { kind: 'started', sessionId, prompt }
}
