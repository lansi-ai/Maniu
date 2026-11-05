/**
 * 任务↔会话的归属与卡片状态的纯判定。
 *
 * 归属的权威是 `.spec/tasks/<ID>.yaml` 的 `session` 字段，不是会话标题：可被人改写的
 * 显示字段承载归属就违反 `.spec` 单源。状态侧要钉住的是「读不到不冒充」——快照没物化
 * 时不能把不知道画成空闲或失败。
 */
import { describe, expect, it } from 'vitest'

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { claimTaskSession, taskCardStatus } from '../src/client/task-session.ts'
import type { TaskSessionRow } from '../src/client/task-session.ts'

const id = (value: string): SessionId => value as SessionId

function row(overrides: Omit<Partial<TaskSessionRow>, 'sessionId'> & { sessionId: string }): TaskSessionRow {
  return {
    sessionId: id(overrides.sessionId),
    running: overrides.running ?? false,
    blank: overrides.blank ?? false,
  }
}

describe('任务到会话的归属', () => {
  it('字段等于会话标识才认领这条会话', () => {
    const sessions = [row({ sessionId: 's-1' }), row({ sessionId: 's-2' })]
    expect(claimTaskSession('s-1', sessions)?.sessionId).toBe(id('s-1'))
  })

  it('字段没写就是未绑定，不挑一条看起来最像的会话', () => {
    expect(claimTaskSession(undefined, [row({ sessionId: 's-1' })])).toBeNull()
  })

  it('字段是空串时同样算未绑定', () => {
    expect(claimTaskSession('', [row({ sessionId: 's-1' })])).toBeNull()
  })

  it('字段指向不在本工作区名册里的会话时不冒充认领成功', () => {
    expect(claimTaskSession('session-elsewhere', [row({ sessionId: 's-1' })])).toBeNull()
  })

  it('标识按精确相等比，前缀相同不算同一条会话', () => {
    expect(claimTaskSession('session-1', [row({ sessionId: 'session-10' })])).toBeNull()
  })
})

describe('卡片状态', () => {
  it('没有会话 → 未开始', () => {
    expect(taskCardStatus({ session: null })).toBe('unstarted')
  })

  it('宿主说在跑 → 在跑', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1' }), hostRunning: true })).toBe('running')
  })

  it('宿主没这条会话时退回会话行的 running', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', running: true }) })).toBe('running')
  })

  it('宿主的推流比会话行新：宿主说没在跑就不画在跑', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', running: true }), hostRunning: false })).toBe('idle')
  })

  it('等人回答压过在跑，因为回合正停在人身上', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1' }), hostRunning: true, awaitingInteraction: true }))
      .toBe('awaitingInteraction')
  })

  it('没起回合时把「等首个回合」画出来，不显示成空闲', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1' }), awaitingFirstTurn: true })).toBe('awaitingFirstTurn')
  })

  it('快照读得到的失败单独成态，且排在等首个回合之后', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1' }), failed: true })).toBe('failed')
    expect(taskCardStatus({ session: row({ sessionId: 's-1' }), awaitingFirstTurn: true, failed: true }))
      .toBe('awaitingFirstTurn')
  })

  it('会话建了但还没起过回合（blank）是未开始，不画空闲', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', blank: true }) })).toBe('unstarted')
  })

  it('快照也读不到、也没有 running 的会话只说空闲，不猜失败', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', blank: false }) })).toBe('idle')
  })
})
