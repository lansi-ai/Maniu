/**
 * 卡片状态的纯折取。
 *
 * 要钉住的是「读不到不冒充」：快照没物化时不能把不知道画成空闲或失败，
 * 而等人回答要压过在跑——回合本来就停在人身上，画在跑等于让人去看进度条。
 * 归属判定不在这里（主干的 `liveSessionOf` 按 `.spec` 的 `session` 字段反查），
 * 本模块只接一个 `claimed`。
 */
import { describe, expect, it } from 'vitest'

import { taskCardStatus } from '../src/client/task-session.ts'
import type { TaskCardSignals } from '../src/client/task-session.ts'

function signals(overrides: Partial<TaskCardSignals>): TaskCardSignals {
  return { claimed: true, running: false, blank: false, ...overrides }
}

describe('卡片状态', () => {
  it('没被认领 → 未开始，不看其他信号', () => {
    expect(taskCardStatus({ claimed: false, running: true, blank: false })).toBe('unstarted')
  })

  it('在跑 → 在跑', () => {
    expect(taskCardStatus(signals({ running: true }))).toBe('running')
  })

  it('等人回答压过在跑，因为回合正停在人身上', () => {
    expect(taskCardStatus(signals({ running: true, awaitingInteraction: true }))).toBe('awaitingInteraction')
  })

  it('没起回合时把「等首个回合」画出来，不显示成空闲', () => {
    expect(taskCardStatus(signals({ awaitingFirstTurn: true }))).toBe('awaitingFirstTurn')
  })

  it('在跑优先于等首个回合：已经跑起来就不说还在等', () => {
    expect(taskCardStatus(signals({ running: true, awaitingFirstTurn: true }))).toBe('running')
  })

  it('快照读得到的失败单独成态，且排在等首个回合之后', () => {
    expect(taskCardStatus(signals({ failed: true }))).toBe('failed')
    expect(taskCardStatus(signals({ awaitingFirstTurn: true, failed: true }))).toBe('awaitingFirstTurn')
  })

  it('认领了但还没有 turn/start → 未开始，不画空闲', () => {
    expect(taskCardStatus(signals({ blank: true }))).toBe('unstarted')
  })

  it('三个可选位都没取到时只说空闲，不猜失败', () => {
    expect(taskCardStatus(signals({}))).toBe('idle')
  })

  it('可选位显式给 undefined 与缺省同义', () => {
    expect(taskCardStatus(signals({ awaitingFirstTurn: undefined, failed: undefined }))).toBe('idle')
  })
})
