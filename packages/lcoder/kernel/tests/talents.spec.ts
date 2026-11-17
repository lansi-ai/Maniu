/**
 * 人才配置的 wire 校验与组合折叠：未知插件以外的结构问题都在这里挡下，
 * 且只接受静态 JSON；组合规则钉住“继承基础行、同名覆盖、其余追加”。
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  composeTalentPlugins, PERSONA_PLUGIN, TALENT_POLICY_PLUGIN, TALENT_POLICY_ROW, talentPolicyConfig,
} from '../src/talents/compose.ts'
import {
  presetIdOf, talentIdOfPreset, toStaticJson, validateApplyRequest,
} from '../src/talents/validate.ts'
import type { TalentApplyRequest } from '../src/talents/types.ts'

function talent(id: string, config: Record<string, unknown> = {}): TalentApplyRequest['talents'][number] {
  return { id, name: `人才 ${id}`, description: '测试人才', config: { version: 1, ...config } }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error: unknown) {
    if (error instanceof RemoteError) return String(error.code)
    throw error
  }
  throw new Error('expected a RemoteError')
}

describe('talent input validation', () => {
  it('normalizes a complete talent and maps the preset id', () => {
    const selection = validateApplyRequest({
      talents: [talent('abc-123', {
        basePreset: 'maniu',
        persona: '你是测试人才。',
        plugins: [{ name: '@deepseek-ai/dsh-persona', config: { prefix: 'x' } }],
        tools: ['file_read'],
        model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
        budget: { maxRequestsPerSession: 10 },
      })],
    })
    expect(selection.talents).toHaveLength(1)
    expect(selection.talents[0]?.presetId).toBe('talent-abc-123')
    expect(presetIdOf('abc')).toBe('talent-abc')
    expect(talentIdOfPreset('talent-abc')).toBe('abc')
    expect(talentIdOfPreset('maniu')).toBeUndefined()
    expect(talentIdOfPreset('talent-')).toBeUndefined()
  })

  it('rejects unknown config and plugin fields, including external package sources', () => {
    expect(codeOf(() => validateApplyRequest({ talents: [talent('a', { url: 'https://example.com/p.js' })] })))
      .toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({
      talents: [talent('a', { plugins: [{ name: '@maniu/kernel', package: 'evil' }] })],
    }))).toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({
      talents: [talent('a', { plugins: [{ name: '@maniu/kernel', config: { nested: { __jsExpr: 'process.exit(1)' } } }] })],
    }))).toBe('agent-talent/invalid')
  })

  it('rejects duplicate plugin names and duplicate talent ids', () => {
    expect(codeOf(() => validateApplyRequest({
      talents: [talent('a', { plugins: [{ name: '@maniu/kernel' }, { name: '@maniu/kernel' }] })],
    }))).toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({ talents: [talent('dup'), talent('dup')] })))
      .toBe('agent-talent/invalid')
  })

  it('rejects non-JSON values and over-deep configuration', () => {
    expect(codeOf(() => toStaticJson({ when: new Date(0) }, 'a', 'config.plugins[0].config')))
      .toBe('agent-talent/invalid')
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let index = 0; index < 40; index++) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }
    expect(codeOf(() => toStaticJson(deep, 'a', 'config'))).toBe('agent-talent/invalid')
  })

  it('rejects an unsupported version, a bad base preset, and a self-referential base', () => {
    expect(codeOf(() => validateApplyRequest({ talents: [talent('a', { version: 2 })] })))
      .toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({ talents: [talent('a', { basePreset: 'Bad Id' })] })))
      .toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({
      talents: [talent('a', { basePreset: 'talent-a' })],
    }))).toBe('agent-talent/invalid')
  })

  it('rejects budget shapes that declare no bound', () => {
    expect(codeOf(() => validateApplyRequest({ talents: [talent('a', { budget: {} })] })))
      .toBe('agent-talent/invalid')
    expect(codeOf(() => validateApplyRequest({
      talents: [talent('a', { budget: { maxRequestsPerSession: 0 } })],
    }))).toBe('agent-talent/invalid')
  })
})

describe('talent composition', () => {
  const base = [
    { id: 'persona', name: PERSONA_PLUGIN, config: { prefix: '基础人设' } },
    { id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'compaction', name: 'cordis:group', group: true, config: [] as unknown[] },
  ]

  function compose(config: Record<string, unknown>, talentId = 'a1', rows: typeof base = base) {
    return composeTalentPlugins(rows, { talentId, config: { version: 1, ...config } })
  }

  it('clones base rows and does not mutate the declaration', () => {
    const rows = compose({ plugins: [{ name: '@deepseek-ai/dsh-tool-ask-user', config: { x: 1 } }] })
    expect(rows).not.toBe(base)
    expect(rows[1]).not.toBe(base[1])
    expect(base[1]).toEqual({ id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user' })
  })

  it('overrides persona and a same-named plugin row in place, appends new plugins', () => {
    const rows = compose({
      persona: '人才人设',
      plugins: [
        { name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'popup' } },
        { name: '@deepseek-ai/dsh-tool-todo' },
      ],
    })
    expect(rows[0]).toEqual({ id: 'persona', name: PERSONA_PLUGIN, config: { prefix: '人才人设' } })
    expect(rows[1]).toEqual({ id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'popup' } })
    expect(rows[2]).toEqual({ id: 'compaction', name: 'cordis:group', group: true, config: [] })
    expect(rows[3]).toEqual({ name: '@deepseek-ai/dsh-tool-todo' })
  })

  it('adds a persona row when the base declares none', () => {
    const rows = compose({ persona: '只有人设' }, 'a1', [])
    expect(rows).toEqual([{ name: PERSONA_PLUGIN, config: { prefix: '只有人设' } }])
  })

  it('removes the inherited config when the talent names the plugin without one', () => {
    const rows = composeTalentPlugins(
      [{ id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user', config: { inherited: true } }],
      { talentId: 'a1', config: { version: 1, plugins: [{ name: '@deepseek-ai/dsh-tool-ask-user' }] } },
    )
    expect(rows).toEqual([{ id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user' }])
  })

  it('appends the runtime policy row for tools and model, and nothing for empty tools', () => {
    const rows = compose({
      tools: ['read'],
      model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
    })
    expect(rows.at(-1)).toEqual({
      id: TALENT_POLICY_ROW,
      name: TALENT_POLICY_PLUGIN,
      config: { talentId: 'a1', tools: ['read'], model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' } },
    })
    expect(compose({ tools: ['read'] }).at(-1)).toEqual({
      id: TALENT_POLICY_ROW, name: TALENT_POLICY_PLUGIN, config: { talentId: 'a1', tools: ['read'] },
    })
    expect(compose({ tools: [] })).toHaveLength(base.length)
    expect(compose({ budget: { maxRequestsPerSession: 3 } })).toHaveLength(base.length)
  })

  it('builds the policy config from the validated talent only', () => {
    expect(talentPolicyConfig('a1', { version: 1 })).toBeUndefined()
    expect(talentPolicyConfig('a1', { version: 1, tools: [] })).toBeUndefined()
    expect(talentPolicyConfig('a1', { version: 1, tools: ['read'] })).toEqual({ talentId: 'a1', tools: ['read'] })
  })
})
