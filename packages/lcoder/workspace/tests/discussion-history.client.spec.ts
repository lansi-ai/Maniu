/**
 * 讨论历史：方案编号过滤、角色标记解析、preset 兜底与按角色分组。
 *
 * 全是纯函数；这里只喂消息与候选会话，不碰宿主状态。
 */
import { describe, expect, it } from 'vitest'
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import {
  DISCUSSION_SESSION_PRESETS, groupDiscussionHistory, isDiscussionPreset, mentionsProposal,
  parseMeetingRole, roleOfPreset, selectDiscussionHistory, statementsOf,
} from '../src/client/shell/discussion-history.ts'
import type { DiscussionHistoryCandidate } from '../src/client/shell/discussion-history.ts'

/** 一条带身份标记的会议指令；与 buildMeetingPrompt 的写法一致。 */
function meetingPrompt(roleName: string, roleId: string, proposal = 'P-01'): ShellMessage {
  return {
    role: 'user',
    text: `方案讨论：需求 ${proposal} 已按轨拆分。\n参会身份：${roleName}（${roleId}）\n《项目需求概要》（.spec/requirements/${proposal}.md）`,
  }
}

function assistant(text: string): ShellMessage {
  return { role: 'assistant', text }
}

describe('方案编号与角色识别', () => {
  it('方案编号按边界匹配，P-01 不命中 P-010', () => {
    expect(mentionsProposal([meetingPrompt('项目经理', 'pm')], 'P-01')).toBe(true)
    expect(mentionsProposal([assistant('见 .spec/requirements/P-010.md')], 'P-01')).toBe(false)
    expect(mentionsProposal([assistant('需求 P-2 已拆')], 'P-01')).toBe(false)
  })

  it('从会议指令里读回身份标记；读不到时返回 null', () => {
    expect(parseMeetingRole([meetingPrompt('需求分析师', 'analyst')]))
      .toEqual({ roleName: '需求分析师', roleId: 'analyst' })
    expect(parseMeetingRole([assistant('没有标记。')])).toBeNull()
  })

  it('preset 兜底映射讨论角色；未知 preset 不猜', () => {
    expect(roleOfPreset('lcoder-intake')).toEqual({ roleId: 'analyst', roleName: '需求分析师' })
    expect(roleOfPreset('lcoder-pm')).toEqual({ roleId: 'pm', roleName: '项目经理' })
    expect(roleOfPreset('lcoder-manager')).toEqual({ roleId: 'manager', roleName: '研发经理' })
    expect(roleOfPreset('lcoder-architect')).toEqual({ roleId: 'architect', roleName: '架构师' })
    expect(roleOfPreset('lcoder')).toEqual({ roleId: 'track', roleName: '技术岗位' })
    expect(roleOfPreset('lcoder-review')).toBeUndefined()
    expect(isDiscussionPreset('lcoder')).toBe(true)
    expect(isDiscussionPreset('lcoder-review')).toBe(false)
    expect(DISCUSSION_SESSION_PRESETS).toContain('lcoder-manager')
  })

  it('只收助手答复作为发言，指令与注入上下文不进历史', () => {
    expect(statementsOf([
      meetingPrompt('项目经理', 'pm'),
      assistant('  先拆基础框架。  '),
      { role: 'context', text: '上下文', label: 'runtime' },
      { role: 'process', items: [] },
      assistant('  '),
    ])).toEqual(['先拆基础框架。'])
  })
})

describe('历史定位与分组', () => {
  const candidates: readonly DiscussionHistoryCandidate[] = [
    {
      sessionId: 's-1',
      preset: 'lcoder-intake',
      messages: [meetingPrompt('需求分析师', 'analyst'), assistant('功能清单已覆盖。')],
    },
    {
      sessionId: 's-2',
      preset: 'lcoder-pm',
      messages: [meetingPrompt('项目经理', 'pm'), assistant('按三条任务拆分。')],
    },
    {
      sessionId: 's-3',
      preset: 'lcoder-architect',
      messages: [meetingPrompt('架构师', 'architect'), assistant('契约要点如下。')],
    },
    {
      sessionId: 's-9',
      preset: 'lcoder-pm',
      messages: [meetingPrompt('项目经理', 'pm', 'P-02'), assistant('别的需求。')],
    },
    {
      sessionId: 's-10',
      preset: 'lcoder-review',
      messages: [assistant('无关会话。')],
    },
  ]

  it('只挑提到这个方案的会话；别的方案与无关会话都不进结果', () => {
    const selection = selectDiscussionHistory(candidates, 'P-01')
    expect(selection.found).toBe(true)
    expect(selection.rounds.map(round => round.sessionId)).toEqual(['s-1', 's-2', 's-3'])
  })

  it('定位不到时 found 为 false，不瞎凑', () => {
    expect(selectDiscussionHistory(candidates, 'P-03')).toEqual({ rounds: [], found: false })
  })

  it('同一角色跨会话合并，保持首次出现顺序', () => {
    const groups = groupDiscussionHistory([
      { sessionId: 's-1', roleId: 'analyst', roleName: '需求分析师', statements: ['覆盖完整。'] },
      { sessionId: 's-2', roleId: 'pm', roleName: '项目经理', statements: ['三条任务。'] },
      { sessionId: 's-3', roleId: 'analyst', roleName: '需求分析师', statements: ['另一次发言。'] },
    ])
    expect(groups.map(group => group.roleId)).toEqual(['analyst', 'pm'])
    expect(groups[0]?.statements).toEqual(['覆盖完整。', '另一次发言。'])
    expect(groups[0]?.sessionIds).toEqual(['s-1', 's-3'])
  })

  it('有标记时以标记为准，没有标记才退回 preset', () => {
    const selection = selectDiscussionHistory([
      {
        sessionId: 's-1',
        preset: 'lcoder', // preset 兜底只会得到「技术岗位」
        messages: [meetingPrompt('H5 前端工程师', 'track-h5'), assistant('表单先定字段。')],
      },
      {
        sessionId: 's-2',
        preset: 'lcoder-architect',
        messages: [{ role: 'user', text: '需求 P-01 的讨论' }, assistant('契约要点。')],
      },
    ], 'P-01')
    expect(selection.rounds[0]).toMatchObject({ roleId: 'track-h5', roleName: 'H5 前端工程师' })
    expect(selection.rounds[1]).toMatchObject({ roleId: 'architect', roleName: '架构师' })
  })
})
