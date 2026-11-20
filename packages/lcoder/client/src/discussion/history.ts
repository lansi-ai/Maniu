/** 讨论历史：从会话事件窗口里按需求编号与参会身份聚合角色发言。 */

import type { SessionSummary } from '../store.ts'

/** 角色 preset 的前缀；改名前的 `lcoder*` 仍可能留在旧会话的 header 里。 */
const PRESET_PREFIX = 'maniu'
const RETIRED_PRESET_PREFIX = 'lcoder'

/** 讨论提示词里的身份标记。 */
const ROLE_MARKER = '参会身份：'

/** 一名角色在讨论里的发言。 */
export interface DiscussionRoleRow {
  readonly roleId: string
  readonly roleName: string
  readonly statements: readonly string[]
}

/** 一次历史读取的结果。 */
export interface DiscussionHistory {
  readonly status: 'ready' | 'failed'
  readonly groups: readonly DiscussionRoleRow[]
  readonly message: string
}

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

/** 会话历史里的一条消息；角色只区分用户发言、助手回复与上下文。 */
export interface SessionMessage {
  readonly role: 'user' | 'assistant' | 'context'
  readonly text: string
}

/**
 * 把 `session/events` 的记录解析成消息，供讨论聚合与待回答弹窗共用。
 * @param records - `session/events` 返回的 `records`。
 * @returns 非空文本消息；格式不符时为空数组。
 */
export function messagesOf(records: unknown): SessionMessage[] {
  if (!Array.isArray(records)) return []
  const out: SessionMessage[] = []
  for (const record of records) {
    if (!isRecord(record) || record.type !== 'event' || !isRecord(record.event)) continue
    const event = record.event
    if (typeof event.type !== 'string' || !isRecord(event.data)) continue
    if (event.type === 'user/message') {
      const text = textOf(event.data.content)
      if (text.trim() === '') continue
      const kind = isRecord(event.data.source) && typeof event.data.source.kind === 'string'
        ? event.data.source.kind
        : ''
      out.push({ role: kind === 'user' ? 'user' : 'context', text })
      continue
    }
    if (event.type === 'developer/message' && isRecord(event.data.message)) {
      const text = textOf(event.data.message.content)
      if (text.trim() !== '') out.push({ role: 'context', text })
      continue
    }
    if (event.type === 'assistant/message' && isRecord(event.data.message)) {
      const text = textOf(event.data.message.content)
      if (text.trim() !== '') out.push({ role: 'assistant', text })
    }
  }
  return out
}

function mentions(messages: readonly SessionMessage[], requirement: string): boolean {
  const escaped = requirement.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?![0-9])`, 'u')
  return messages.some(message => pattern.test(message.text))
}

function markerOf(messages: readonly SessionMessage[]): { readonly id: string; readonly name: string } | undefined {
  const pattern = new RegExp(`${ROLE_MARKER}([^（\\n]+)（([^）\\n]+)）`, 'u')
  for (const message of messages) {
    const match = pattern.exec(message.text)
    if (match !== null) return { name: (match[1] ?? '').trim(), id: (match[2] ?? '').trim() }
  }
  return undefined
}

/** 去掉 preset 前缀后的角色名；裸前缀（实施）为空串，其它 preset 为 undefined。 */
function presetRole(preset: string | undefined): string | undefined {
  if (preset === undefined || preset === '') return undefined
  for (const prefix of [PRESET_PREFIX, RETIRED_PRESET_PREFIX]) {
    if (preset === prefix) return ''
    if (preset.startsWith(`${prefix}-`)) return preset.slice(prefix.length + 1)
  }
  return undefined
}

function roleOfPreset(preset: string | undefined): { readonly id: string; readonly name: string } | undefined {
  switch (presetRole(preset)) {
    case '': return { id: 'track', name: '技术岗位' }
    case 'intake': return { id: 'analyst', name: '需求分析师' }
    case 'pm': return { id: 'pm', name: '项目经理' }
    case 'manager': return { id: 'manager', name: '研发经理' }
    case 'architect': return { id: 'architect', name: '架构师' }
    default: return undefined
  }
}

function isDiscussionSession(session: SessionSummary): boolean {
  return roleOfPreset(session.agentPreset) !== undefined
}

/**
 * 读取一条会话的近期消息；失败时返回 null，由调用方决定如何呈现。
 * @param sessionId - 会话标识。
 * @returns 消息列表；读取失败或格式不对时为 null。
 */
export async function readMessages(sessionId: string): Promise<SessionMessage[] | null> {
  const answer = await window.lcoder.call('session', 'events', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 200 },
  })
  if (!answer.ok) return null
  const value = answer.value
  return isRecord(value) ? messagesOf(value.records) : null
}

/**
 * 读出一个需求的讨论历史。
 * @param projectPath - 当前项目路径；只扫同项目会话。
 * @param sessions - 会话列表。
 * @param requirement - 需求编号。
 * @returns 按角色分组的发言；没有命中时 message 说明原因。
 */
export async function readDiscussionHistory(
  projectPath: string,
  sessions: readonly SessionSummary[],
  requirement: string,
): Promise<DiscussionHistory> {
  const normalized = projectPath.toLowerCase()
  const candidates = sessions.filter(session =>
    isDiscussionSession(session)
    && (session.cwd ?? '').toLowerCase() === normalized)
  const groups = new Map<string, { name: string; statements: string[] }>()
  let unreadable = 0
  for (const session of candidates) {
    const messages = await readMessages(session.sessionId)
    if (messages === null) {
      unreadable += 1
      continue
    }
    if (!mentions(messages, requirement)) continue
    const marker = markerOf(messages)
    const role = marker ?? roleOfPreset(session.agentPreset)
    if (role === undefined) continue
    const statements = messages.filter(message => message.role === 'assistant').map(message => message.text.trim())
    if (statements.length === 0) continue
    const current = groups.get(role.id)
    if (current === undefined) groups.set(role.id, { name: role.name, statements })
    else current.statements.push(...statements)
  }
  if (groups.size > 0) {
    return {
      status: 'ready',
      groups: [...groups.entries()].map(([roleId, group]) => ({
        roleId,
        roleName: group.name,
        statements: group.statements,
      })),
      message: '',
    }
  }
  return {
    status: candidates.length === 0 ? 'ready' : 'failed',
    groups: [],
    message: candidates.length === 0
      ? '没有找到带参会身份的讨论会话。'
      : unreadable === candidates.length
        ? '讨论会话暂时读不出来。'
        : '候选会话里没有提到这条需求。',
  }
}
