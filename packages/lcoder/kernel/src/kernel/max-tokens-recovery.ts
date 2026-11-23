/**
 * Harness 层 `max-tokens` 截断自动续跑：在 `agent/turn-stopping` 边界从持久化会话日志推导
 * 当前回合最后一步是否命中 `max-tokens`，未达上限时通过 `agent.steer()` 在同回合无缝注入精简续跑指令。
 *
 * 全程无进程级可变单例状态，所有判定均来自 `session.snapshotEvents()` 的可重放事实。
 */
import { randomUUID } from 'node:crypto'

import type { RoleId } from './surface.js'

/** 截断自动续跑注入消息的 `source.kind` 标识；模型可见且落盘，不冒充人类用户气泡。 */
export const MAX_TOKENS_RECOVERY_SOURCE_KIND = 'maniu-max-tokens-recovery'

/** 判定截断恢复所需的最小会话事件结构。 */
export interface RecoveryEventLike {
  readonly type: string
  readonly data?: unknown
}

/** 截断自动续跑注入给 `agent.steer` 的只读用户消息结构。 */
export interface RecoveryUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  readonly source: { readonly kind: typeof MAX_TOKENS_RECOVERY_SOURCE_KIND }
}

/** `agent/turn-stopping` 载荷中恢复逻辑用到的最小 Agent 结构。 */
export interface RecoveryAgentLike {
  readonly session?: {
    snapshotEvents?: () => readonly RecoveryEventLike[]
  }
  steer?: (message: RecoveryUserMessage) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验并解析 `maxTokensAutoContinue` 配置。
 * @param value - 插件配置项；缺省为 1，传 0 关闭自动续跑。
 * @returns 合法的非负整数上限。
 */
export function resolveMaxTokensAutoContinue(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`maxTokensAutoContinue must be a non-negative safe integer, got ${String(value)}`)
  }
  return value
}

function streamEndedWithMaxTokens(stream: unknown): boolean {
  if (!Array.isArray(stream)) return false
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record: unknown = stream[i]
    if (!isRecord(record) || record.type !== 'chunk' || !isRecord(record.chunk)) continue
    if (record.chunk.type !== 'finish') continue
    const reason = record.chunk.reason
    return isRecord(reason) && reason.kind === 'max-tokens'
  }
  return false
}

function turnStartIndex(events: readonly RecoveryEventLike[], turn: number): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'turn/start' && isRecord(event.data) && event.data.turn === turn) {
      return i
    }
  }
  return 0
}

/**
 * 判断指定回合的最后一条 `assistant/message` 是否以 `max-tokens` 截断结束。
 * @param events - 会话已提交事件快照。
 * @param turn - 当前回合号。
 * @returns 若最后一步助手消息因 `max-tokens` 结束则为 true。
 */
export function lastAssistantEndedWithMaxTokens(events: readonly RecoveryEventLike[], turn: number): boolean {
  const start = turnStartIndex(events, turn)
  for (let i = events.length - 1; i >= start; i -= 1) {
    const event = events[i]
    if (event?.type !== 'assistant/message' || !isRecord(event.data)) continue
    if (typeof event.data.turn === 'number' && event.data.turn !== turn) continue
    return streamEndedWithMaxTokens(event.data.stream)
  }
  return false
}

/**
 * 统计指定回合内已经注入过多少次 `max-tokens` 自动续跑消息。
 * @param events - 会话已提交事件快照。
 * @param turn - 当前回合号。
 * @returns 当前回合已发生的自动续跑次数。
 */
export function countRecoveriesInTurn(events: readonly RecoveryEventLike[], turn: number): number {
  const start = turnStartIndex(events, turn)
  let count = 0
  for (let i = start; i < events.length; i += 1) {
    const event = events[i]
    if (event?.type !== 'user/message' || !isRecord(event.data)) continue
    const source = event.data.source
    if (isRecord(source) && source.kind === MAX_TOKENS_RECOVERY_SOURCE_KIND) count += 1
  }
  return count
}

/**
 * 按角色构造精简续跑提示词。
 * @param role - 当前插件实例绑定的角色标识。
 * @returns 注入给模型的续跑文本。
 */
export function buildMaxTokensRecoveryPrompt(role: RoleId | undefined): string {
  if (role === 'prototype') {
    return [
      '上一轮生成因思考或输出过长达到了单次输出上限，导致原型未能落盘。',
      '请跳过长篇思考、不要在思考中预写代码，保持多页 SPA 结构精炼紧凑（约 250–400 行、3–5 条示例数据），',
      '直接调用 prototype_draft 完成落盘。',
    ].join('')
  }
  return '上一轮生成达到模型单次输出上限导致本步被截断。请跳过冗长思考，直接精炼地完成剩余内容并调用对应的专用工具将结果落盘。'
}

/**
 * 创建并冻结一条带来源标记的自动续跑消息。
 * @param role - 当前角色标识。
 * @returns 可直接传给 `agent.steer` 的不可变消息。
 */
export function createMaxTokensRecoveryMessage(role: RoleId | undefined): RecoveryUserMessage {
  const part = Object.freeze({ type: 'text' as const, text: buildMaxTokensRecoveryPrompt(role) })
  const content = Object.freeze([part]) as readonly [{ readonly type: 'text'; readonly text: string }]
  const source = Object.freeze({ kind: MAX_TOKENS_RECOVERY_SOURCE_KIND })
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content,
    source,
  })
}

/**
 * 在 `agent/turn-stopping` 钩子中决定是否触发 `max-tokens` 自动续跑。
 * @param payload - `agent/turn-stopping` 事件载荷。
 * @param options - 角色与每回合自动续跑上限。
 * @returns 实际触发了 `agent.steer` 时返回 true。
 */
export function maybeRecoverMaxTokens(
  payload: { readonly agent?: RecoveryAgentLike; readonly turn: number },
  options: { readonly role: RoleId | undefined; readonly maxAutoContinues: number },
): boolean {
  if (options.maxAutoContinues <= 0) return false
  const agent = payload.agent
  if (typeof agent?.steer !== 'function' || typeof agent.session?.snapshotEvents !== 'function') {
    return false
  }
  const events = agent.session.snapshotEvents()
  if (!lastAssistantEndedWithMaxTokens(events, payload.turn)) return false
  if (countRecoveriesInTurn(events, payload.turn) >= options.maxAutoContinues) return false
  agent.steer(createMaxTokensRecoveryMessage(options.role))
  return true
}
