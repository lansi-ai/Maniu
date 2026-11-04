/**
 * 任务↔会话归属与卡片状态的纯判定。
 *
 * 这两条判据决定了卡片会不会说谎：会话只按标题精确等于任务号来认，
 * 而「在跑」「等人回答」只有宿主推流说了才算——快照读不到时不能拿空闲冒充失败。
 */
import { describe, expect, it } from 'vitest'

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { taskCardStatus, taskSessionOf } from '../src/client/task-session.ts'
import type { TaskSessionRow } from '../src/client/task-session.ts'

const id = (value: string): SessionId => value as SessionId

function row(overrides: Omit<Partial<TaskSessionRow>, 'sessionId'> & { sessionId: string }): TaskSessionRow {
  return {
    sessionId: id(overrides.sessionId),
    title: overrides.title,
    running: overrides.running ?? false,
    blank: overrides.blank ?? false,
    updatedAt: overrides.updatedAt ?? 0,
  }
}

describe('任务到会话的归属', () => {
  it('标题精确等于任务号才算这条任务的会话', () => {
    const sessions = [row({ sessionId: 's-1', title: 'DEMO-03' }), row({ sessionId: 's-2', title: 'DEMO-04' })]
    expect(taskSessionOf('DEMO-03', sessions)?.sessionId).toBe(id('s-1'))
  })

  it('没有标题相等的会话时返回 null，不拿最新活动的那条兜底', () => {
    const sessions = [row({ sessionId: 's-1', title: '别的会话', updatedAt: 90 })]
    expect(taskSessionOf('DEMO-03', sessions)).toBeNull()
  })

  it('前缀相同不等于同一任务，避免 T-1 认领 T-10 的会话', () => {
    expect(taskSessionOf('T-1', [row({ sessionId: 's-1', title: 'T-10' })])).toBeNull()
  })

  it('人起的会话名不当外键', () => {
    expect(taskSessionOf('DEMO-03', [row({ sessionId: 's-1', title: 'DEMO-03 修好了' })])).toBeNull()
  })

  it('同一任务多条会话时取最近活动的一条', () => {
    const sessions = [
      row({ sessionId: 's-old', title: 'DEMO-03', updatedAt: 100 }),
      row({ sessionId: 's-new', title: 'DEMO-03', updatedAt: 200 }),
    ]
    expect(taskSessionOf('DEMO-03', sessions)?.sessionId).toBe(id('s-new'))
  })

  it('没有标题的会话行不参与归属（宿主还没投影出标题）', () => {
    expect(taskSessionOf('DEMO-03', [row({ sessionId: 's-1', updatedAt: 500 })])).toBeNull()
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

  it('改名不算内容：还没有 turn/start 的会话是未开始', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', blank: true, title: 'DEMO-03' }) })).toBe('unstarted')
  })

  it('快照也读不到、也没有 running 的会话只说空闲，不猜失败', () => {
    expect(taskCardStatus({ session: row({ sessionId: 's-1', blank: false }) })).toBe('idle')
  })
})
