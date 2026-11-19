/** 立项概要读取：从会话事件里取最后一条助手正文，供需求页就地预览。 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (value.content !== undefined) return textOf(value.content)
  return ''
}

/**
 * 读出一条会话里最后一条助手正文。
 *
 * 走 `session/events` 现有端口，与讨论历史共用同一套事件形状；不新增 IPC 契约。
 * 读不到或没有助手正文时返回 null，由调用方给可解释的空态。
 * @param sessionId - 立项会话号。
 * @returns 最后一条助手正文；无正文或读取失败为 null。
 */
export async function readLastAssistantText(sessionId: string): Promise<string | null> {
  const answer = await window.lcoder.call('session', 'events', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 200 },
  })
  if (!answer.ok || !isRecord(answer.value) || !Array.isArray(answer.value.records)) return null
  let last: string | null = null
  for (const record of answer.value.records) {
    if (!isRecord(record) || record.type !== 'event' || !isRecord(record.event)) continue
    const event = record.event
    if (event.type !== 'assistant/message' || !isRecord(event.data) || !isRecord(event.data.message)) continue
    const text = textOf(event.data.message.content).trim()
    if (text !== '') last = text
  }
  return last
}
