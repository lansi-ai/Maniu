/**
 * 常驻会话解析：配置号 → 同 preset 的现存会话 → 新建。
 *
 * 失效覆盖换机器、删会话与编号对不上三种情形；读不到 preset 时不否决配置号，
 * 避免投影还没加载就在同一仓库里再造一条。
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_ROLES, liveAgentSession, resolveAgentSession, titleNeedsFix,
} from '../src/client/singleton.ts'

describe('常驻会话解析', () => {
  it('两个角色的 preset、字段与标题键成对出现', () => {
    expect(AGENT_ROLES.scheduler).toMatchObject({
      preset: 'maniu-scheduler', key: 'schedulerSession', titleKey: 'shell.scheduler',
    })
    expect(AGENT_ROLES.flow).toMatchObject({
      preset: 'maniu-flow', key: 'flowSession', titleKey: 'shell.flowAgent',
    })
  })

  it('配置号还在且 preset 对得上 → 直接复用', () => {
    const resolved = resolveAgentSession('scheduler', 's-1', [
      { sessionId: 's-1', agentPreset: 'maniu-scheduler' },
      { sessionId: 's-2', agentPreset: 'maniu-flow' },
    ])
    expect(resolved).toEqual({ kind: 'use', sessionId: 's-1', configured: true })
  })

  it('配置号读不到 preset 时仍复用，不在同一仓库里再造一条', () => {
    expect(resolveAgentSession('flow', 's-1', [{ sessionId: 's-1' }]))
      .toEqual({ kind: 'use', sessionId: 's-1', configured: true })
  })

  it('配置号失效 → 找同 preset 的现存会话', () => {
    const resolved = resolveAgentSession('scheduler', 'gone', [
      { sessionId: 's-2', agentPreset: 'maniu-flow' },
      { sessionId: 's-3', agentPreset: 'maniu-scheduler' },
    ])
    expect(resolved).toEqual({ kind: 'use', sessionId: 's-3', configured: false })
  })

  it('配置号指向别的 preset → 按失效处理', () => {
    const resolved = resolveAgentSession('scheduler', 's-1', [
      { sessionId: 's-1', agentPreset: 'maniu-flow' },
      { sessionId: 's-2', agentPreset: 'maniu-scheduler' },
    ])
    expect(resolved).toEqual({ kind: 'use', sessionId: 's-2', configured: false })
  })

  it('都没有 → 新建', () => {
    expect(resolveAgentSession('flow', undefined, [{ sessionId: 's-1', agentPreset: 'maniu' }]))
      .toEqual({ kind: 'create' })
  })

  it('只读入口找不到时不触发新建', () => {
    expect(liveAgentSession('flow', undefined, [])).toBeUndefined()
    expect(liveAgentSession('flow', 's-1', [{ sessionId: 's-1', agentPreset: 'maniu-flow' }])).toBe('s-1')
  })

  it('标题缺失或不是角色名才需要校正', () => {
    expect(titleNeedsFix(undefined, '智能调度')).toBe(true)
    expect(titleNeedsFix('LCoder 1', '智能调度')).toBe(true)
    expect(titleNeedsFix('智能调度', '智能调度')).toBe(false)
  })
})
