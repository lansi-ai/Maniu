/**
 * Harness 层 `max-tokens` 自动续跑单测：配置校验、持久化事件推导、同回合 steer 续跑上限与插件接入。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  MAX_TOKENS_RECOVERY_SOURCE_KIND,
  countRecoveriesInTurn,
  lastAssistantEndedWithMaxTokens,
  maybeRecoverMaxTokens,
  resolveMaxTokensAutoContinue,
  type RecoveryAgentLike,
  type RecoveryEventLike,
  type RecoveryUserMessage,
} from '../src/kernel/max-tokens-recovery.js'
import { apply } from '../src/plugin.js'

function assistantEvent(turn: number, finishKind: 'max-tokens' | 'stop'): RecoveryEventLike {
  return {
    type: 'assistant/message',
    data: {
      turn,
      step: 1,
      stream: [
        { type: 'text-chunks', texts: ['partial'] },
        { type: 'chunk', time: 100, chunk: { type: 'finish', reason: { kind: finishKind } } },
      ],
    },
  }
}

function recoveryUserEvent(): RecoveryEventLike {
  return {
    type: 'user/message',
    data: {
      source: { kind: MAX_TOKENS_RECOVERY_SOURCE_KIND },
      content: [{ type: 'text', text: 'continue' }],
    },
  }
}

describe('resolveMaxTokensAutoContinue', () => {
  it('缺省返回 1，支持 0 或正整数，非法配置立刻抛错', () => {
    expect(resolveMaxTokensAutoContinue(undefined)).toBe(1)
    expect(resolveMaxTokensAutoContinue(0)).toBe(0)
    expect(resolveMaxTokensAutoContinue(2)).toBe(2)
    expect(() => resolveMaxTokensAutoContinue(-1)).toThrow(RangeError)
    expect(() => resolveMaxTokensAutoContinue(1.5)).toThrow(RangeError)
    expect(() => resolveMaxTokensAutoContinue(Number.NaN)).toThrow(RangeError)
  })
})

describe('maybeRecoverMaxTokens', () => {
  it('命中 max-tokens 且未达上限时同回合 steer 冻结续跑消息，达到上限后不再续跑', () => {
    const events: RecoveryEventLike[] = [
      { type: 'turn/start', data: { turn: 1 } },
      assistantEvent(1, 'max-tokens'),
    ]
    const steered: RecoveryUserMessage[] = []
    const agent: RecoveryAgentLike = {
      session: { snapshotEvents: () => events },
      steer: (message) => {
        steered.push(message)
        events.push({ type: 'user/message', data: { source: message.source, content: message.content } })
      },
    }

    expect(lastAssistantEndedWithMaxTokens(events, 1)).toBe(true)
    expect(maybeRecoverMaxTokens({ agent, turn: 1 }, { role: 'prototype', maxAutoContinues: 1 })).toBe(true)
    expect(steered).toHaveLength(1)
    expect(steered[0]?.role).toBe('user')
    expect(steered[0]?.source.kind).toBe(MAX_TOKENS_RECOVERY_SOURCE_KIND)
    expect(steered[0]?.content[0].text).toContain('prototype_draft')
    expect(Object.isFrozen(steered[0])).toBe(true)
    expect(countRecoveriesInTurn(events, 1)).toBe(1)

    // 第 2 步再次命中 max-tokens 时，本回合已用完 1 次额度，不再循环。
    events.push(assistantEvent(1, 'max-tokens'))
    expect(maybeRecoverMaxTokens({ agent, turn: 1 }, { role: 'prototype', maxAutoContinues: 1 })).toBe(false)
    expect(steered).toHaveLength(1)

    // 新回合（turn 2）计数独立清零，可再次恢复。
    events.push({ type: 'turn/start', data: { turn: 2 } }, assistantEvent(2, 'max-tokens'))
    expect(maybeRecoverMaxTokens({ agent, turn: 2 }, { role: 'pm', maxAutoContinues: 1 })).toBe(true)
    expect(steered).toHaveLength(2)
    expect(steered[1]?.content[0].text).not.toContain('prototype_draft')
  })

  it('正常 stop 结束或 maxAutoContinues 为 0 时不触发 steer', () => {
    const steer = vi.fn()
    const agent: RecoveryAgentLike = {
      session: {
        snapshotEvents: () => [
          { type: 'turn/start', data: { turn: 1 } },
          assistantEvent(1, 'stop'),
        ],
      },
      steer,
    }
    expect(maybeRecoverMaxTokens({ agent, turn: 1 }, { role: 'prototype', maxAutoContinues: 1 })).toBe(false)
    expect(steer).not.toHaveBeenCalled()

    const truncatedAgent: RecoveryAgentLike = {
      session: {
        snapshotEvents: () => [
          { type: 'turn/start', data: { turn: 1 } },
          assistantEvent(1, 'max-tokens'),
          recoveryUserEvent(),
        ],
      },
      steer,
    }
    expect(maybeRecoverMaxTokens({ agent: truncatedAgent, turn: 1 }, { role: 'prototype', maxAutoContinues: 0 })).toBe(false)
    expect(steer).not.toHaveBeenCalled()
  })
})

describe('plugin apply 挂载 agent/turn-stopping 恢复钩子', () => {
  it('默认注册 agent/turn-stopping 监听器；配 0 时跳过；非法值直接抛错', () => {
    const listeners: ((payload: { readonly agent: RecoveryAgentLike; readonly turn: number }) => void)[] = []
    const makeCtx = () => ({
      tools: { register: () => () => {} },
      commands: { register: () => () => {} },
      on: (_event: 'agent/turn-stopping', listener: (payload: { readonly agent: RecoveryAgentLike; readonly turn: number }) => void) => {
        listeners.push(listener)
        return () => {}
      },
    })

    apply(makeCtx(), { role: 'prototype', selfCheck: false })
    expect(listeners).toHaveLength(1)

    const steer = vi.fn()
    listeners[0]?.({
      turn: 1,
      agent: {
        session: { snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }, assistantEvent(1, 'max-tokens')] },
        steer,
      },
    })
    expect(steer).toHaveBeenCalledTimes(1)

    listeners.length = 0
    apply(makeCtx(), { role: 'prototype', selfCheck: false, maxTokensAutoContinue: 0 })
    expect(listeners).toHaveLength(0)

    expect(() => {
      apply(makeCtx(), { role: 'prototype', selfCheck: false, maxTokensAutoContinue: -1 })
    }).toThrow(RangeError)
  })
})
