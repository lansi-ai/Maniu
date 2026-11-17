/**
 * 讨论历史：把方案讨论会话里的发言按角色分组，供需求卡片的「讨论历史」抽屉展示。
 *
 * 定位会话有两条路：本窗口记下的讨论会话号优先；重启后没有记录时，只认带参会身份
 * 标记、且消息里出现需求编号（REQ-xx）的同项目会话。两条都找不到就如实说定位不到，
 * 不拿别的需求的会话顶上。这里只做纯函数，不读宿主状态，便于单测。
 */
import type { ShellMessage } from './shell-data.ts'
import { MEETING_ROLE_MARKER } from './plan-discussion.ts'

/** 角色 preset 的前缀；改名前的 `lcoder*` 仍可能留在旧会话的 `agentPreset` 里。 */
const PRESET_PREFIX = 'maniu'
const RETIRED_PRESET_PREFIX = 'lcoder'

/** 一条候选会话：会话号、preset、是否本窗口记录过，与已读到的消息。 */
export interface DiscussionHistoryCandidate {
  readonly sessionId: string
  readonly preset?: string
  /**
   * 是否本窗口记下的讨论会话。
   *
   * 为 true 时按记录信任，允许 preset 兜底认角色；为 false 表示重启后扫描回来的
   * 候选，必须带参会身份标记才认——同项目的立项与拆分会话也会提到方案编号。
   */
  readonly recorded: boolean
  readonly messages: readonly ShellMessage[]
}

/** 一条会话在讨论里的角色与发言。 */
export interface DiscussionHistoryRound {
  readonly sessionId: string
  readonly roleId: string
  readonly roleName: string
  /** 这一轮里每个助手答复的原文，已去首尾空白。 */
  readonly statements: readonly string[]
}

/** 按角色合并后的历史。 */
export interface DiscussionHistoryGroup {
  readonly roleId: string
  readonly roleName: string
  readonly sessionIds: readonly string[]
  readonly statements: readonly string[]
}

/** 一次定位结果；`found` 为 false 表示没有任何候选会话提到这个方案。 */
export interface DiscussionHistorySelection {
  readonly rounds: readonly DiscussionHistoryRound[]
  readonly found: boolean
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

/** 这条 preset 是不是讨论角色的 preset。 */
export function isDiscussionPreset(preset: string | undefined): boolean {
  return roleOfPreset(preset) !== undefined
}

/** 只取有正文的消息文本：用户发言、助手答复与注入上下文；过程段与压缩标记不含正文。 */
function textsOf(messages: readonly ShellMessage[]): readonly string[] {
  return messages.flatMap((message) => {
    if (message.role === 'user' || message.role === 'assistant' || message.role === 'context') {
      return message.text.trim() === '' ? [] : [message.text]
    }
    return []
  })
}

/** 只取助手答复：讨论历史展示的是每个角色每轮的发言，不是我们发出去的指令。 */
export function statementsOf(messages: readonly ShellMessage[]): readonly string[] {
  return messages.flatMap(message =>
    message.role === 'assistant' && message.text.trim() !== '' ? [message.text.trim()] : [])
}

/**
 * 消息里是否提到这个需求编号。
 *
 * 用编号边界而不是简单包含：REQ-01 不能命中 REQ-010。讨论提示词里总带着
 * `.spec/requirements/REQ-xx.md`，所以这条判据在重启后仍可用。
 * @param messages - 候选会话的消息。
 * @param requirement - 需求编号，如 REQ-01。
 * @returns 至少一条消息提到它时为 true。
 */
export function mentionsRequirement(messages: readonly ShellMessage[], requirement: string): boolean {
  const escaped = requirement.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?![0-9])`, 'u')
  return textsOf(messages).some(text => pattern.test(text))
}

/**
 * 从会议指令里的身份标记读回角色。
 *
 * 重启后没有本窗口记录时，这是唯一可靠的认人依据；读不到再退回 preset。
 * @param messages - 候选会话的消息。
 * @returns 角色 id 与显示名；没有标记时为 null。
 */
export function parseMeetingRole(messages: readonly ShellMessage[]): { readonly roleId: string; readonly roleName: string } | null {
  const pattern = new RegExp(`${MEETING_ROLE_MARKER}([^（\\n]+)（([^）\\n]+)）`, 'u')
  for (const text of textsOf(messages)) {
    const match = pattern.exec(text)
    if (match !== null) return { roleName: match[1]?.trim() ?? '', roleId: match[2]?.trim() ?? '' }
  }
  return null
}

/** preset 到讨论角色的兜底映射；技术岗位重启后只知道是 dev 面。 */
export function roleOfPreset(preset: string | undefined): { readonly roleId: string; readonly roleName: string } | undefined {
  switch (presetRole(preset)) {
    case '':
      return { roleId: 'track', roleName: '技术岗位' }
    case 'intake':
      return { roleId: 'analyst', roleName: '需求分析师' }
    case 'pm':
      return { roleId: 'pm', roleName: '项目经理' }
    case 'manager':
      return { roleId: 'manager', roleName: '研发经理' }
    case 'architect':
      return { roleId: 'architect', roleName: '架构师' }
    default:
      return undefined
  }
}

/**
 * 从候选会话里挑出这次需求的讨论。
 *
 * 扫描回来的候选必须带参会身份标记才进历史：立项与拆分会话同样会提到方案编号，
 * 只凭 preset 与编号会把它们当成讨论角色。本窗口记录过的会话按记录信任，
 * 读不到标记时仍可按 preset 兜底。没提到方案的会话一律不进结果——宁可显示
 * 「定位不到」，也不混进别的需求。
 * @param candidates - 候选会话，按建议顺序排列。
 * @param requirement - 需求编号。
 * @returns 命中的发言轮次与是否找到任何候选会话。
 */
export function selectDiscussionHistory(
  candidates: readonly DiscussionHistoryCandidate[],
  requirement: string,
): DiscussionHistorySelection {
  const rounds: DiscussionHistoryRound[] = []
  let found = false
  for (const candidate of candidates) {
    const marker = parseMeetingRole(candidate.messages)
    if (!candidate.recorded && marker === null) continue
    if (!mentionsRequirement(candidate.messages, requirement)) continue
    found = true
    const role = marker ?? roleOfPreset(candidate.preset)
    if (role === undefined) continue
    const statements = statementsOf(candidate.messages)
    if (statements.length === 0) continue
    rounds.push({
      sessionId: candidate.sessionId,
      roleId: role.roleId,
      roleName: role.roleName,
      statements,
    })
  }
  return { rounds, found }
}

/** 一条待读的候选会话：会话号、preset 与是否本窗口记录过，按优先顺序排好。 */
export interface DiscussionHistorySession {
  readonly sessionId: string
  readonly preset?: string
  /** 是否本窗口记下的讨论会话；重启后扫描的候选为 false。 */
  readonly recorded: boolean
}

/** 一次异步读取的结果：命中情况与读不出来的条数。 */
export interface DiscussionHistoryRead {
  readonly selection: DiscussionHistorySelection
  /** 打开失败或超时、读不到消息窗口的候选数。 */
  readonly unreadable: number
}

/**
 * 异步读取一条会话消息的端口；读不出来返回 null，不抛到界面。
 *
 * 重启后候选会话需要先等宿主把会话打开（`reference.ready`）才读得到事件窗口，
 * 同步读只会拿到空消息，所以历史定位必须走这条异步路径。
 */
export type DiscussionHistoryReader = (sessionId: string) => Promise<readonly ShellMessage[] | null>

/**
 * 依次读取候选会话，再按方案编号挑出讨论。
 *
 * `sessions` 的先后就是优先顺序：本窗口记录过的会话排在前面，重启后才补的候选在后；
 * `recorded` 决定这条会话能不能在没有参会身份标记时按 preset 兜底。某条会话读不出来
 * 只计一条 `unreadable`，不抛到界面；全部没有命中时由调用方按 `unreadable > 0`
 * 区分「读取失败」与「定位不到」。
 * @param sessions - 候选会话，已按优先顺序去重。
 * @param requirement - 需求编号。
 * @param read - 异步读取端口；返回 null 表示这条会话暂时读不出来。
 * @returns 选择结果与读不出来的条数。
 */
export async function readDiscussionHistory(
  sessions: readonly DiscussionHistorySession[],
  requirement: string,
  read: DiscussionHistoryReader,
): Promise<DiscussionHistoryRead> {
  const candidates: DiscussionHistoryCandidate[] = []
  let unreadable = 0
  for (const session of sessions) {
    let messages: readonly ShellMessage[] | null
    try {
      messages = await read(session.sessionId)
    } catch (error: unknown) {
      // 端口契约是不抛；真抛了也只算这一条读不出来，不打断其余候选。
      void error
      messages = null
    }
    if (messages === null) {
      unreadable += 1
      continue
    }
    candidates.push({
      sessionId: session.sessionId,
      ...(session.preset === undefined ? {} : { preset: session.preset }),
      recorded: session.recorded,
      messages,
    })
  }
  return { selection: selectDiscussionHistory(candidates, requirement), unreadable }
}

/**
 * 按角色合并轮次，保持角色与会话首次出现的顺序。
 * @param rounds - 定位到的发言轮次。
 * @returns 每个角色一组的历史。
 */
export function groupDiscussionHistory(rounds: readonly DiscussionHistoryRound[]): DiscussionHistoryGroup[] {
  const groups = new Map<string, { roleName: string; sessionIds: string[]; statements: string[] }>()
  for (const round of rounds) {
    const current = groups.get(round.roleId)
    if (current === undefined) {
      groups.set(round.roleId, {
        roleName: round.roleName,
        sessionIds: [round.sessionId],
        statements: [...round.statements],
      })
      continue
    }
    if (!current.sessionIds.includes(round.sessionId)) current.sessionIds.push(round.sessionId)
    current.statements.push(...round.statements)
  }
  return [...groups.entries()].map(([roleId, group]) => ({
    roleId,
    roleName: group.roleName,
    sessionIds: group.sessionIds,
    statements: group.statements,
  }))
}
