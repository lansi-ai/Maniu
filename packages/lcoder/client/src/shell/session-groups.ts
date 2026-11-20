/** 对话页会话列表的可见性与分组判定：纯函数，供界面与单测共用。 */

import type { SessionSummary } from '../store.ts'
import type { ProjectScope, WorkspaceRow } from '../workspace/use-workspaces.ts'
import { isFlowPreset, isFlowSeedText, isIntakePreset } from '../talents/model.ts'

/**
 * 归一化路径：反斜杠转正斜杠、去末尾斜杠、大小写不敏感。
 * @param path - 会话 cwd 或项目路径。
 * @returns 可比较两个路径的字符串。
 */
export function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}

/**
 * 对话页可见会话：只留当前项目且不是非活动空白壳的会话。
 * 没有当前项目时只过滤空白壳，保持登录门禁前的列表可用。
 * @param sessions - 完整会话列表。
 * @param project - 当前项目；未选择时为 null。
 * @param workspaces - 项目行，提供会话 id 归属。
 * @param active - 当前选中的会话 id。
 * @returns 过滤后的会话。
 */
export function visibleSessionsOf(
  sessions: readonly SessionSummary[],
  project: ProjectScope | null,
  workspaces: readonly WorkspaceRow[],
  active: string | null,
): SessionSummary[] {
  const notBlankShell = (session: SessionSummary): boolean =>
    !session.blank || session.sessionId === active
  if (project === null) return sessions.filter(notBlankShell)
  const row = workspaces.find(item => item.workspaceId === project.workspaceId)
  const ids = new Set(row?.sessionIds ?? [])
  const target = normalizedPath(project.path)
  return sessions.filter((session) => {
    if (!notBlankShell(session)) return false
    return ids.has(session.sessionId)
      || (session.cwd !== undefined && normalizedPath(session.cwd) === target)
      || session.sessionId === active
      || session.cwd === undefined
  })
}

/**
 * 会话是否归入「流程执行记录」组。
 * @param session - 会话摘要。
 * @returns 后台流程会话为 true。
 */
export function isFlowSession(session: SessionSummary): boolean {
  return isFlowPreset(session.agentPreset)
}

/**
 * 首条系统种子是否收起：立项整行隐藏，其它后台角色或模板开头的指令同样收起。
 * @param session - 当前选中的会话摘要；未选中时为 null。
 * @param firstUserText - 首条用户消息正文；没有时为 ''。
 * @returns 需要收起时为 true。
 */
export function seedHiddenOf(session: SessionSummary | null, firstUserText: string): boolean {
  if (session === null) return false
  return isIntakePreset(session.agentPreset)
    || isFlowPreset(session.agentPreset)
    || isFlowSeedText(firstUserText)
}
