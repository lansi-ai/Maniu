/** 人才策略行：白名单按 Agent 收窄、未知工具报错、默认模型只定新会话。 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/talents/policy.ts'
import type { TalentPolicyConfig } from '../src/talents/policy.ts'

interface FakeAgent {
  readonly ctx: { readonly preset: string; readonly tools: { restrict: (filter: { allow: string[] }) => void } }
  readonly model: { select: (selection: { provider: string; model: string }) => void }
}

function harness(config: TalentPolicyConfig): { ctx: Context; emit: (agent: FakeAgent, source: string) => void } {
  const ctx = new Context()
  ctx.provide('agentPresets', {
    composedPreset: (agentCtx: { preset: string }) => agentCtx.preset,
  } as never)
  apply(ctx, config)
  return {
    ctx,
    emit: (agent, source) => { ctx.emit('agent/created', { agent, source } as never) },
  }
}

function agent(preset: string, restrict = vi.fn()): FakeAgent {
  return { ctx: { preset, tools: { restrict } }, model: { select: vi.fn() } }
}

describe('talent policy row', () => {
  it('restricts the agent tool surface to the whitelist', () => {
    const restrict = vi.fn()
    const h = harness({ talentId: 'a1', tools: ['read', 'write'] })
    h.emit(agent('talent-a1', restrict), 'startup')
    expect(restrict).toHaveBeenCalledWith({ allow: ['read', 'write'] })
  })

  it('never touches an agent bound to another preset', () => {
    const restrict = vi.fn()
    const h = harness({ talentId: 'a1', tools: ['read'] })
    h.emit(agent('standard', restrict), 'startup')
    expect(restrict).not.toHaveBeenCalled()
  })

  it('selects the talent model for a new session and leaves a resumed one alone', () => {
    const h = harness({ talentId: 'a1', model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' } })
    const fresh = agent('talent-a1')
    h.emit(fresh, 'startup')
    expect(fresh.model.select).toHaveBeenCalledWith({ provider: 'lcoder-cloud', model: 'deepseek-flash' })
    const resumed = agent('talent-a1')
    h.emit(resumed, 'resume')
    expect(resumed.model.select).not.toHaveBeenCalled()
  })

  it('reports an unknown tool as a talent failure', () => {
    const h = harness({ talentId: 'a1', tools: ['read'] })
    const restrict = vi.fn(() => { throw new Error('tools.restrict() names unknown global tool "read"') })
    expect(() => { h.emit(agent('talent-a1', restrict), 'startup') })
      .toThrow(/talent a1: tools\.restrict\(\) names unknown global tool/)
  })

  it('does nothing at all without tools or model', () => {
    const restrict = vi.fn()
    const h = harness({ talentId: 'a1' })
    const talent = agent('talent-a1', restrict)
    h.emit(talent, 'startup')
    expect(restrict).not.toHaveBeenCalled()
    expect(talent.model.select).not.toHaveBeenCalled()
  })
})
