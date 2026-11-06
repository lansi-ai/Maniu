/**
 * 「立项分析」按钮的幂等判定。
 *
 * 要钉住的是判据跟着会话事实走：受理过提示词的会话再点只开浮层，刷新后读到的还是同一份
 * 事实；读不到会话行时不能把「不知道」当成「发过」，否则全新仓库第一次点就发不出去。
 */
import { describe, expect, it } from 'vitest'

import { onboardingAction } from '../src/client/onboarding.ts'
import type { OnboardingFacts } from '../src/client/onboarding.ts'

const idle: OnboardingFacts = {
  hasSession: true,
  hasModel: true,
  sending: false,
  blank: true,
  userMessages: 0,
  awaitingFirstTurn: false,
}

describe('立项分析的幂等判定', () => {
  it('会话还没受理过提示词 → 发', () => {
    expect(onboardingAction(idle)).toEqual({ kind: 'send' })
  })

  it('会话行说已受理过（blank 已落）→ 只开浮层', () => {
    expect(onboardingAction({ ...idle, blank: false })).toEqual({ kind: 'open' })
  })

  it('事件窗口里已有用户消息 → 只开浮层，不依赖 blank', () => {
    expect(onboardingAction({ ...idle, blank: true, userMessages: 2 })).toEqual({ kind: 'open' })
    expect(onboardingAction({ ...idle, blank: undefined, userMessages: 1 })).toEqual({ kind: 'open' })
  })

  it('首条提示已收下、正等首个回合 → 只开浮层', () => {
    expect(onboardingAction({ ...idle, awaitingFirstTurn: true })).toEqual({ kind: 'open' })
  })

  it('正在发时再点 → 只开浮层，不排第二条咒语', () => {
    expect(onboardingAction({ ...idle, sending: true })).toEqual({ kind: 'open' })
  })

  it('同一份会话事实重复判定结果不变（关掉浮层再点也一样）', () => {
    const started: OnboardingFacts = { ...idle, blank: false }
    expect(onboardingAction(started)).toEqual({ kind: 'open' })
    expect(onboardingAction(started)).toEqual({ kind: 'open' })
  })

  it('读不到会话行且没有消息 → 照常发，不把「不知道」当「发过」', () => {
    expect(onboardingAction({ ...idle, blank: undefined })).toEqual({ kind: 'send' })
  })

  it('没有会话 → 拦下并说明缺会话', () => {
    expect(onboardingAction({ ...idle, hasSession: false })).toEqual({ kind: 'block', reason: 'no-session' })
  })

  it('没有模型 → 拦下并说明缺模型，即便已经发过', () => {
    expect(onboardingAction({ ...idle, hasModel: false })).toEqual({ kind: 'block', reason: 'no-model' })
    expect(onboardingAction({ ...idle, hasModel: false, blank: false })).toEqual({ kind: 'block', reason: 'no-model' })
  })
})
