/** 会话可见性与分组：项目归属三条件、空白壳过滤、后台流程归组与种子收起。 */
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '../src/store.ts'
import type { ProjectScope, WorkspaceRow } from '../src/workspace/use-workspaces.ts'
import { isFlowSession, normalizedPath, seedHiddenOf, visibleSessionsOf } from '../src/shell/session-groups.ts'
import { sessionLabel } from '../src/shell/chat-view.tsx'

function row(sessionId: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { sessionId, updatedAt: 1, running: false, blank: false, ...extra }
}

const PROJECT: ProjectScope = {
  workspaceId: 'ws-1',
  path: 'E:\\Repo\\',
  title: 'Repo',
  scopeSessionId: 'scope',
}

const WORKSPACES: readonly WorkspaceRow[] = [
  { workspaceId: 'ws-1', path: PROJECT.path, title: 'Repo', sessionIds: ['by-id', 'flow-by-id'] },
  { workspaceId: 'ws-2', path: 'E:/other', title: 'Other', sessionIds: [] },
]

describe('normalizedPath', () => {
  it('忽略斜杠方向、末尾斜杠与大小写', () => {
    expect(normalizedPath('E:\\Repo\\')).toBe(normalizedPath('e:/repo'))
    expect(normalizedPath('E:/Repo///')).toBe('e:/repo')
  })
})

describe('visibleSessionsOf', () => {
  it('按工作区会话 id、归一化 cwd、活动会话与无 cwd 四项保留当前项目会话', () => {
    const sessions = [
      row('by-id', { cwd: 'E:/another-project' }),
      row('by-cwd', { cwd: 'e:/REPO' }),
      row('active', { cwd: 'E:/elsewhere' }),
      row('fresh'),
    ]
    const visible = visibleSessionsOf(sessions, PROJECT, WORKSPACES, 'active')
    expect(visible.map(item => item.sessionId)).toEqual(['by-id', 'by-cwd', 'active', 'fresh'])
  })

  it('隐藏别的 cwd 的会话与非活动的空白壳', () => {
    const sessions = [
      row('other-project', { cwd: 'E:/other' }),
      row('scope', { cwd: 'E:\\Repo', blank: true }),
      row('blank-shell', { blank: true }),
      row('blank-active', { blank: true, cwd: 'E:/Repo' }),
      row('keep', { cwd: 'E:/Repo' }),
    ]
    const visible = visibleSessionsOf(sessions, PROJECT, WORKSPACES, 'blank-active')
    expect(visible.map(item => item.sessionId)).toEqual(['blank-active', 'keep'])
  })

  it('未选项目时只过滤非活动空白壳', () => {
    const sessions = [row('shell', { blank: true }), row('keep', { cwd: 'E:/any' })]
    expect(visibleSessionsOf(sessions, null, WORKSPACES, null).map(item => item.sessionId)).toEqual(['keep'])
  })

  it('后台发起成功的运行中会话已脱离空白壳，对话页不再过滤它', () => {
    const sessions = [
      row('prototype-run', { blank: false, running: true, agentPreset: 'maniu-prototype', cwd: 'E:/Repo' }),
      row('blank-run', { blank: true, running: true, cwd: 'E:/Repo' }),
    ]
    expect(visibleSessionsOf(sessions, PROJECT, WORKSPACES, null).map(item => item.sessionId)).toEqual(['prototype-run'])
  })
})

describe('isFlowSession', () => {
  it('有归一化角色 id 且不是工作台默认聊天时归入流程组', () => {
    expect(isFlowSession(row('pm', { agentPreset: 'maniu-pm' }))).toBe(true)
    expect(isFlowSession(row('old-intake', { agentPreset: 'lcoder-intake' }))).toBe(true)
    expect(isFlowSession(row('workbench', { agentPreset: 'maniu-workbench' }))).toBe(false)
    expect(isFlowSession(row('old-workbench', { agentPreset: 'lcoder-workbench' }))).toBe(false)
    expect(isFlowSession(row('chat'))).toBe(false)
  })
})

describe('seedHiddenOf', () => {
  it('立项、其它流程角色与模板开头指令都收起首条', () => {
    expect(seedHiddenOf(row('intake', { agentPreset: 'maniu-intake' }), '')).toBe(true)
    expect(seedHiddenOf(row('pm', { agentPreset: 'maniu-pm' }), '')).toBe(true)
    expect(seedHiddenOf(row('chat'), '需求评审：请对 REQ-01 做评审')).toBe(true)
    expect(seedHiddenOf(row('chat'), '你好，帮我看下代码')).toBe(false)
    expect(seedHiddenOf(null, '需求拆分：请把 REQ-02 拆开')).toBe(false)
  })
})

describe('sessionLabel', () => {
  it('优先使用实时标题，其次使用列表投影自带的 title，最后回退 cwd 尾段', () => {
    expect(sessionLabel(row('s1', { title: '投影标题', cwd: 'E:/seed-sandbox' }), { s1: '最新改名' })).toBe('最新改名')
    expect(sessionLabel(row('s1', { title: '投影标题', cwd: 'E:/seed-sandbox' }), {})).toBe('投影标题')
    expect(sessionLabel(row('s1', { cwd: 'E:/seed-sandbox' }), {})).toBe('seed-sandbox')
  })
})
