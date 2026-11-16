/**
 * 人才库服务的行为：注册/替换/跳过/撤回、未知插件与保留 id、整批回滚、
 * 会话引用查询。registry、包清单、会话查询与会话存储都用记录器替身，
 * 真实挂载证据走桌面端验收。
 */
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentTalents } from '../src/talents/service.ts'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { TalentApplyRequest } from '../src/talents/types.ts'

class FakePresets {
  readonly definitions = new Map<string, PresetDefinition>()
  readonly registers: PresetDefinition[] = []
  readonly disposals: string[] = []
  readonly broken = new Set<string>()
  readonly livePreset = new Map<string, string>()

  async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    this.definitions.set(definition.id, definition)
    this.registers.push(definition)
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      this.disposals.push(definition.id)
      this.definitions.delete(definition.id)
    }
  }

  definitionPlugins(id: string): PresetDefinition['plugins'] | undefined {
    return this.definitions.get(id)?.plugins
  }

  async resolve(id: string): Promise<{ id: string; broken?: string }> {
    if (!this.definitions.has(id)) throw new Error(`Unknown agent preset: ${id}`)
    return this.broken.has(id) ? { id, broken: 'activation exploded' } : { id }
  }

  presetForSession(session: { id: string }): string | null {
    return this.livePreset.get(session.id) ?? null
  }

  definitionScope(id: string): string | undefined {
    return this.definitions.has(id) ? `scope:${id}` : undefined
  }

  async list(): Promise<{ id: string; name?: string; broken?: string }[]> {
    return [...this.definitions.values()].map(definition => ({
      id: definition.id,
      ...definition.name === undefined ? {} : { name: definition.name },
      ...this.broken.has(definition.id) ? { broken: 'activation exploded' } : {},
    }))
  }

  async compositionInventory(): Promise<{
    id: string
    name?: string
    isDefault: boolean
    broken?: string
    rows: { moduleName: string; enabled: boolean }[]
  }[]> {
    return [...this.definitions.values()].map(definition => ({
      id: definition.id,
      ...definition.name === undefined ? {} : { name: definition.name },
      isDefault: definition.id === 'standard',
      ...this.broken.has(definition.id) ? { broken: 'activation exploded' } : {},
      rows: (definition.plugins ?? []).flatMap(row => 'name' in row && typeof row.name === 'string'
        ? [{ moduleName: row.name, enabled: true }]
        : []),
    }))
  }
}

interface Fixture {
  readonly ctx: Context
  readonly service: AgentTalents
  readonly presets: FakePresets
  readonly installed: Set<string>
  /** preset scope -> tool names the mounted preset exposes. */
  readonly tools: Map<string, string[]>
  records: { header: { id: string; agentPreset?: string } }[]
  live: Map<string, { id: string; header?: { agentPreset?: string } }> }

function fixture(base: PresetDefinition = {
  id: 'standard',
  plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '基础' } }],
}): Fixture {
  const presets = new FakePresets()
  presets.definitions.set(base.id, base)
  const installed = new Set(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-ask-user', '@lcoder/kernel'])
  const records: Fixture['records'] = []
  const live = new Map<string, { id: string; header?: { agentPreset?: string } }>()
  const tools = new Map<string, string[]>([[`scope:${base.id}`, ['read', 'write', 'edit']]])
  const ctx = new Context()
  ctx.provide('agentPresets', presets as never)
  ctx.provide('pluginPackages', {
    packageOf: (name: string) => installed.has(name) ? { name } : undefined,
  } as never)
  ctx.provide('sessions', { get: (id: string) => live.get(id) } as never)
  ctx.provide('sessionQuery', { listSessions: async () => records } as never)
  ctx.provide('tools', {
    definitions: (scope: string | undefined) => (scope === undefined ? [] : tools.get(scope) ?? ['read', 'write', 'edit'])
      .map(name => ({ name })),
  } as never)
  return { ctx, service: new AgentTalents(ctx), presets, installed, tools, records, live }
}

function talent(id: string, config: Record<string, unknown> = {}): TalentApplyRequest['talents'][number] {
  return { id, name: `人才 ${id}`, description: '说明', config: { version: 1, ...config } }
}

function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected a rejection') },
    (error: unknown) => {
      if (error instanceof RemoteError) return String(error.code)
      throw error
    },
  )
}

describe('talent registry service', () => {
  it('registers a talent over its base preset and folds runtime knobs into a policy row', async () => {
    const h = fixture()
    const result = await h.service.applyTalents({
      talents: [talent('a1', {
        basePreset: 'standard',
        persona: '人才人设',
        plugins: [{ name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'popup' } }],
        tools: ['read', 'write'],
        model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
        budget: { maxRequestsPerSession: 3 },
      })],
    })
    expect(result.applied).toEqual([{
      talentId: 'a1', presetId: 'talent-a1', basePreset: 'standard', replaced: false,
    }])
    const definition = h.presets.definitions.get('talent-a1')
    expect(definition?.name).toBe('人才 a1')
    expect(definition?.plugins).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '人才人设' } },
      { name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'popup' } },
      {
        id: 'talent-policy',
        name: '@lcoder/kernel/talents-policy',
        config: {
          talentId: 'a1',
          tools: ['read', 'write'],
          model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
        },
      },
    ])
  })

  it('rejects a whitelist naming a tool the preset does not expose', async () => {
    const h = fixture()
    await expect(h.service.applyTalents({
      talents: [talent('a1', { tools: ['read', 'bash'] })],
    })).rejects.toMatchObject({
      code: 'agent-talent/unknown-tool',
      details: { talentId: 'a1', tools: ['bash'] },
    })
    expect(h.presets.definitions.has('talent-a1')).toBe(false)
    expect(h.presets.disposals).toEqual(['talent-a1'])
  })

  it('treats an empty tool list as no restriction and still applies the model', async () => {
    const h = fixture()
    await h.service.applyTalents({
      talents: [talent('a1', { tools: [], model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' } })],
    })
    const plugins = h.presets.definitions.get('talent-a1')?.plugins ?? []
    expect(plugins.at(-1)).toEqual({
      id: 'talent-policy',
      name: '@lcoder/kernel/talents-policy',
      config: { talentId: 'a1', model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' } },
    })
  })

  it('maps a live session preset back to its registered talent id', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1')] })
    h.live.set('session-1', { id: 'session-1' })
    h.presets.livePreset.set('session-1', 'talent-a1')
    expect(h.service.talentIdForSession('session-1' as never)).toBe('a1')
    expect(h.service.talentIdForSession('session-missing' as never)).toBeUndefined()
    h.live.set('session-standard', { id: 'session-standard' })
    h.presets.livePreset.set('session-standard', 'standard')
    expect(h.service.talentIdForSession('session-standard' as never)).toBeUndefined()
  })

  it('replaces an edited talent, skips an unchanged resubmission, and keeps the base snapshot', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1', { plugins: [{ name: '@lcoder/kernel' }] })] })
    const [first] = h.presets.registers
    const skipped = await h.service.applyTalents({ talents: [talent('a1', { plugins: [{ name: '@lcoder/kernel' }] })] })
    expect(skipped.applied).toEqual([])
    expect(skipped.skipped).toEqual(['a1'])
    expect(h.presets.registers).toHaveLength(1)

    const replaced = await h.service.applyTalents({
      talents: [talent('a1', { plugins: [{ name: '@lcoder/kernel', config: { role: 'review' } }] })],
    })
    expect(replaced.applied[0]?.replaced).toBe(true)
    expect(h.presets.registers).toHaveLength(2)
    expect(h.presets.disposals).toEqual(['talent-a1'])
    expect(h.presets.registers[0]).toBe(first)
    expect(h.presets.definitions.get('talent-a1')?.plugins).toContainEqual({
      name: '@lcoder/kernel', config: { role: 'review' },
    })
  })

  it('rejects a plugin the host cannot resolve and never registers it', async () => {
    const h = fixture()
    await expect(h.service.applyTalents({
      talents: [talent('a1', { plugins: [{ name: '@evil/not-installed' }] })],
    })).rejects.toMatchObject({ code: 'agent-talent/unknown-plugin', details: { talentId: 'a1', plugin: '@evil/not-installed' } })
    expect(h.presets.registers).toEqual([])
  })

  it('refuses to take over a preset id declared outside the talent service', async () => {
    const h = fixture()
    h.presets.definitions.set('talent-taken', { id: 'talent-taken', plugins: [] })
    expect(await codeOf(h.service.applyTalents({ talents: [talent('taken')] }))).toBe('agent-talent/reserved')
    expect(h.presets.registers).toEqual([])
  })

  it('rolls back the whole batch when a later registration fails', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1', { plugins: [{ name: '@lcoder/kernel' }] })] })
    const previous = h.presets.definitions.get('talent-a1')
    h.presets.broken.add('talent-a2')
    await expect(h.service.applyTalents({
      talents: [
        talent('a1', { plugins: [{ name: '@lcoder/kernel', config: { role: 'review' } }] }),
        talent('a2', { plugins: [{ name: '@lcoder/kernel' }] }),
      ],
    })).rejects.toMatchObject({ code: 'agent-talent/invalid' })
    expect(h.presets.definitions.has('talent-a2')).toBe(false)
    expect(h.presets.definitions.get('talent-a1')).toEqual(previous)
  })

  it('refuses to remove a talent still referenced by a session and reports the ids', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1')] })
    h.records.push({ header: { id: 'session-1', agentPreset: 'talent-a1' } })
    expect(await codeOf(h.service.removeTalent('a1')))
      .toBe('agent-talent/referenced')
    expect(h.presets.disposals).toEqual([])

    const refs = await h.service.sessionRefs('a1')
    expect(refs).toEqual({ talentId: 'a1', presetId: 'talent-a1', sessionIds: ['session-1'] })
  })

  it('reads the live preset projection instead of a stale creation header', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1')] })
    h.records.push({ header: { id: 'session-live', agentPreset: 'standard' } })
    h.live.set('session-live', { id: 'session-live' })
    h.presets.livePreset.set('session-live', 'talent-a1')
    expect((await h.service.sessionRefs('a1')).sessionIds).toEqual(['session-live'])
  })

  it('removes an unreferenced talent and never touches unknown or built-in ids', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1')] })
    await expect(h.service.removeTalent('a1')).resolves.toEqual({ talentId: 'a1', presetId: 'talent-a1' })
    expect(h.presets.disposals).toEqual(['talent-a1'])
    expect(h.presets.definitions.has('standard')).toBe(true)
    expect(await codeOf(h.service.removeTalent('standard'))).toBe('agent-talent/not-found')
    expect(await codeOf(h.service.sessionRefs('standard'))).toBe('agent-talent/not-found')
  })

  it('unregisters every dynamic preset when the service unloads', async () => {
    const h = fixture()
    await h.service.applyTalents({ talents: [talent('a1'), talent('a2')] })
    await h.service.disposeTalents()
    expect(h.presets.disposals).toEqual(['talent-a1', 'talent-a2'])
    expect(h.presets.definitions.has('standard')).toBe(true)
  })
})

describe('talent catalog', () => {
  it('lists resolvable plugin rows and excludes talent presets from the base roster', async () => {
    const h = fixture({
      id: 'standard',
      name: '标准',
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona' },
        { id: 'todo', name: '@deepseek-ai/dsh-tool-todo' },
      ],
    })
    h.installed.add('@deepseek-ai/dsh-tool-todo')
    h.presets.definitions.set('talent-a1', { id: 'talent-a1', plugins: [{ name: '@lcoder/kernel' }] })
    h.presets.definitions.set('lcoder', { id: 'lcoder', name: '实施', plugins: [] })
    const catalog = await h.service.catalog()
    expect(catalog.presets).toEqual([
      { id: 'lcoder', name: '实施', isDefault: false },
      { id: 'standard', name: '标准', isDefault: true },
    ])
    expect(catalog.plugins.map(plugin => plugin.name)).toEqual([
      '@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-todo', '@lcoder/kernel',
    ])
  })

  it('drops a row the host cannot resolve and keeps broken presets visible', async () => {
    const h = fixture({
      id: 'standard',
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona' },
        { id: 'missing', name: '@fixture/not-installed' },
      ],
    })
    h.presets.broken.add('lcoder')
    h.presets.definitions.set('lcoder', { id: 'lcoder', plugins: [] })
    const catalog = await h.service.catalog()
    expect(catalog.plugins.map(plugin => plugin.name)).toEqual(['@deepseek-ai/dsh-persona'])
    expect(catalog.presets.find(preset => preset.id === 'lcoder')?.broken).toBe('activation exploded')
  })

  it('reads the tool surface of one base preset and explains an unusable one', async () => {
    const h = fixture()
    const tools = await h.service.presetTools('standard')
    expect(tools).toEqual({
      presetId: 'standard',
      tools: [
        { name: 'edit', description: undefined },
        { name: 'read', description: undefined },
        { name: 'write', description: undefined },
      ],
    })
    expect((await h.service.presetTools('absent')).broken).toContain('unknown agent preset')
    h.presets.broken.add('standard')
    expect((await h.service.presetTools('standard')).broken).toBe('activation exploded')
  })
})

describe('project identity', () => {
  function projectFixture(text?: string): { readonly root: string; readonly cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'lcoder-talent-project-'))
    mkdirSync(join(root, '.spec'), { recursive: true })
    if (text !== undefined) writeFileSync(join(root, '.spec', 'project.yaml'), text, 'utf8')
    return { root, cleanup: () => { rmSync(root, { recursive: true, force: true }) } }
  }

  const REGISTERED = 'kind: web\nrepo:\n  url: repo\n  branch: main\n'

  it('reads an existing projectId and never writes the file', async () => {
    const h = fixture()
    const project = projectFixture(`${REGISTERED}projectId: 0f4c2f3e-1f4a-4d5e-8a1b-2c3d4e5f6a7b\n`)
    try {
      expect(await h.service.projectIdentity({ path: project.root })).toEqual({
        projectId: '0f4c2f3e-1f4a-4d5e-8a1b-2c3d4e5f6a7b',
        state: 'ready',
      })
      const before = readFileSync(join(project.root, '.spec', 'project.yaml'), 'utf8')
      await h.service.projectIdentity({ path: project.root })
      expect(readFileSync(join(project.root, '.spec', 'project.yaml'), 'utf8')).toBe(before)
    } finally {
      project.cleanup()
    }
  })

  it('reports an unbound project, then writes a stable id only when asked', async () => {
    const h = fixture()
    const project = projectFixture(REGISTERED)
    try {
      expect((await h.service.projectIdentity({ path: project.root })).state).toBe('unbound')
      const written = await h.service.ensureProjectId({ path: project.root })
      expect(written.state).toBe('ready')
      expect(written.projectId).toMatch(/^[0-9a-f-]{36}$/u)
      expect(readFileSync(join(project.root, '.spec', 'project.yaml'), 'utf8')).toContain(String(written.projectId))
      expect((await h.service.ensureProjectId({ path: project.root })).projectId).toBe(written.projectId)
    } finally {
      project.cleanup()
    }
  })

  it('distinguishes a missing project file, an invalid file and missing context', async () => {
    const h = fixture()
    const empty = projectFixture()
    const invalid = projectFixture('kind: web\n')
    try {
      expect((await h.service.projectIdentity({ path: empty.root })).state).toBe('missing-project')
      expect((await h.service.projectIdentity({ path: invalid.root })).state).toBe('invalid')
      expect((await h.service.projectIdentity({})).state).toBe('missing-context')
      expect((await h.service.ensureProjectId({ path: empty.root })).state).toBe('missing-project')
    } finally {
      empty.cleanup()
      invalid.cleanup()
    }
  })
})
