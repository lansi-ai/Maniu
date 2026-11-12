/**
 * 一轮会话的等待：最后一条助手答复、结束判据与超时。
 *
 * 拆分、方案讨论与契约起草都靠同一套事实收口：助手答复来自会话消息窗口，
 * 运行位来自宿主推流。这里只认这两样，不碰 React，也不替调用方挑会话。
 */
import type { ShellSessionNotice } from '../model-status.ts'
import type { ShellMessage } from './shell-data.ts'

/** 等一轮会话需要的最小注入面。 */
export interface SessionTurnPorts {
  readMessages(sessionId: string): readonly ShellMessage[]
  readNotice(sessionId: string): ShellSessionNotice | null
  /** 宿主推流的运行位；读不到时为 undefined。 */
  isRunning(sessionId: string): boolean | undefined
  now(): number
  sleep(ms: number): Promise<void>
}

/** 一轮等待的结果。 */
export type TurnWait =
  | { readonly kind: 'done'; readonly messages: readonly ShellMessage[] }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }

/** 最后一条非空助手答复；没有时返回 null。 */
export function lastAssistantText(messages: readonly ShellMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message !== undefined && message.role === 'assistant' && message.text.trim() !== '') return message.text
  }
  return null
}

/**
 * 等一条会话跑完这一轮。
 *
 * 结束判据是「有输出且运行位为假」。运行位读不到时只在已有助手答复后收口，
 * 避免把「状态还没推上来」当成「已跑完」。会话失败先于超时报出原文。
 * @param input - 注入面、会话号、超时与轮询间隔。
 * @returns 完成、失败、超时或取消。
 */
export async function waitForTurn(input: {
  readonly ports: SessionTurnPorts
  readonly sessionId: string
  readonly timeoutMs: number
  readonly pollMs: number
  readonly signal?: AbortSignal
}): Promise<TurnWait> {
  const { ports, sessionId } = input
  const deadline = ports.now() + input.timeoutMs
  for (;;) {
    if (input.signal?.aborted === true) return { kind: 'cancelled' }
    const notice = ports.readNotice(sessionId)
    if (notice !== null) return { kind: 'failed', detail: notice.detail }
    const messages = ports.readMessages(sessionId)
    const answer = lastAssistantText(messages)
    const hasOutput = answer !== null || messages.some(message => message.role === 'process')
    const running = ports.isRunning(sessionId)
    const settled = running === false ? hasOutput : running === undefined ? answer !== null : false
    if (settled) return { kind: 'done', messages }
    if (ports.now() >= deadline) return { kind: 'timeout' }
    await ports.sleep(input.pollMs)
  }
}
