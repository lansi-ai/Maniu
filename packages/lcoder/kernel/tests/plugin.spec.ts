/**
 * `apply` 的工具面装配测：注册了哪些工具、每个状态下谁可见、解除句柄在哪。
 *
 * 这里用结构满足 `ToolRegistry` 的桩，不启动 Loader——真实装配证据按 LCoder 的
 * 既有做法走桌面端启动（`lcoder/RUN.md`），本测钉住插件自身的判定：
 * 空看板最小面、按任务状态收放、每次求值重读磁盘、注册的解除能力。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/plugin.js'
import type { SpecRootContext } from '../src/kernel/spec-root.js'
import { SURFACE, UNSCOPEED_SURFACE } from '../src/kernel/surface.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

const TOOL_NAMES = [
  'cmd_run',
  'contract_draft',
  'evidence_attach',
  'file_edit',
  'file_list',
  'file_read',
  'git_commit',
  'git_diff',
  'git_status',
  'project_draft',
  'proposal_draft',
  'spec_bind',
  'spec_draft',
  'spec_query',
  'task_close',
  'task_draft',
  'task_read',
]

/** 把 fixture 复制成临时仓库；`spec` 是它的 `.spec` 目录，里面有一个 drafting 任务。 */
function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-plugin-'))
  dirs.push(repo)
  cpSync(fileURLToPath(new URL('../fixtures/demo', import.meta.url)), repo, { recursive: true })
  return { repo, spec: join(repo, '.spec') }
}

/** 只有产品文档、还没有 `.spec` 的仓库：立项流程的起点。 */
function makeUnscopedRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-plugin-unscoped-'))
  dirs.push(repo)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'prd.md'), '# 产品文档\n', 'utf8')
  return { repo, spec: join(repo, '.spec') }
}

interface Registration {
  readonly name: string
  readonly when: (context: SpecRootContext) => boolean
  readonly dispose: () => void
}

interface Harness {
  readonly ctx: Parameters<typeof apply>[0]
  readonly registrations: Registration[]
  /** 命令面收到的定义，用来证明签署走的是人机命令而不是工具。 */
  readonly commands: Array<{ readonly name: string }>
  readonly effectLabels: string[]
  /** 逐个跑 effect，返回每个 effect 交出的解除句柄。 */
  runEffects(): Array<() => void>
}

/** 结构满足插件所需的最小 ctx；`withEffect: false` 时不注入 effect 面。 */
function makeHarness(options: { withEffect?: boolean } = {}): Harness {
  const registrations: Registration[] = []
  const commands: Array<{ readonly name: string }> = []
  const effects: Array<{ label: string; run: () => () => void }> = []
  const ctx = {
    tools: {
      register(definition: unknown, config?: { when?: (context: SpecRootContext) => boolean }): () => void {
        const dispose = vi.fn()
        registrations.push({
          name: (definition as { name: string }).name,
          when: config?.when ?? (() => true),
          dispose,
        })
        return dispose
      },
    },
    commands: {
      register(definition: unknown): () => void {
        const dispose = vi.fn()
        commands.push(definition as { name: string })
        return dispose
      },
    },
  }
  const harness: Harness = {
    ctx:
      options.withEffect === false
        ? ctx
        : {
          ...ctx,
          effect(callback: () => () => void, label?: string): void {
            effects.push({ label: label ?? '', run: callback })
          },
        },
    registrations,
    commands,
    get effectLabels(): string[] {
      return effects.map(effect => effect.label)
    },
    runEffects: () => effects.map(effect => effect.run()),
  }
  return harness
}

function sessionAt(cwd: string, sessionId?: string): SpecRootContext {
  return { agent: { session: { header: sessionId === undefined ? { cwd } : { cwd, id: sessionId } } } }
}

/** 装载并跑完 effect，返回真正挂上去的注册表。 */
function mounted(harness: Harness, config: Parameters<typeof apply>[1]): Registration[] {
  apply(harness.ctx, config)
  harness.runEffects()
  return harness.registrations
}

/** 某个会话环境下可见的工具名，按名字排序以便与掩码表逐项比对。 */
function visible(registrations: readonly Registration[], context: SpecRootContext): string[] {
  return registrations.filter(registration => registration.when(context)).map(r => r.name).sort()
}

function sorted(names: readonly string[]): string[] {
  return [...names].sort()
}

/** 改写已有任务的状态，模拟契约签署或状态推进。 */
function setState(repo: string, state: string): void {
  const path = join(repo, '.spec', 'tasks', 'T-01.yaml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: .*$/m, `state: ${state}`), 'utf8')
}

/** 追加一个指定状态的任务文件。 */
function addTask(repo: string, id: string, state: string): void {
  writeFileSync(
    join(repo, '.spec', 'tasks', `${id}.yaml`),
    [
      `id: ${id}`,
      `title: ${id} 的标题`,
      'grade: C',
      `state: ${state}`,
      'rules: []',
      'scope:',
      '  irreversible: []',
      '  allowed_paths: []',
      'evidence_required: []',
      'opened_at: 2026-11-02T15:00:00+08:00',
      'closed_at: null',
      '',
    ].join('\n'),
    'utf8',
  )
}

/** 给任务写上认领会话号，模拟 `/task_bind` 落盘后的形状。 */
function setSession(repo: string, id: string, sessionId: string): void {
  const path = join(repo, '.spec', 'tasks', `${id}.yaml`)
  writeFileSync(path, `${readFileSync(path, 'utf8')}session: ${sessionId}\n`, 'utf8')
}

describe('插件装配', () => {
  it('注册十七个工具，其中包含 task_draft、proposal_draft 与 git_commit', () => {
    const { spec } = makeRepo()
    const harness = makeHarness()
    apply(harness.ctx, { root: spec, selfCheck: false })

    expect(harness.effectLabels.sort()).toEqual(
      [
        ...TOOL_NAMES.map(name => `lcoder.tool(${name})`),
        'lcoder.command(contract_sign)',
        'lcoder.command(task_bind)',
        'lcoder.command(task_contract)',
        'lcoder.command(proposal_approve)',
        'lcoder.command(deploy)',
      ].sort(),
    )
    harness.runEffects()
    expect(harness.registrations.map(r => r.name).sort()).toEqual(TOOL_NAMES)
    expect(harness.commands.map(c => c.name)).toEqual(['contract_sign', 'task_bind', 'task_contract', 'proposal_approve', 'deploy'])
  })

  it('签署不是工具：contract_sign 只进命令面', () => {
    const { spec } = makeRepo()
    const harness = makeHarness()
    apply(harness.ctx, { root: spec, selfCheck: false })
    harness.runEffects()

    expect(harness.registrations.map(r => r.name)).not.toContain('contract_sign')
    expect(harness.commands.map(c => c.name)).toContain('contract_sign')
  })

  it('角色装配：评审在已签契约状态下仍动不了代码', () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'contracted')
    const harness = makeHarness()
    const registrations = mounted(harness, { root: spec, role: 'review', selfCheck: false })

    const shown = visible(registrations, sessionAt(repo))
    expect(shown).not.toContain('file_edit')
    expect(shown).not.toContain('cmd_run')
    expect(shown).toContain('file_read')
    expect(shown).toContain('task_read')
  })

  it('角色与状态同时收：起草态的评审只剩四个读工具', () => {
    const { repo, spec } = makeRepo()
    const harness = makeHarness()
    const registrations = mounted(harness, { root: spec, role: 'review', selfCheck: false })

    expect(visible(registrations, sessionAt(repo))).toEqual(['file_list', 'file_read', 'spec_query', 'task_read'])
  })

  it('不配角色时状态表原样生效，保持单维旧行为', () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'contracted')
    const harness = makeHarness()
    const registrations = mounted(harness, { root: spec, selfCheck: false })

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(SURFACE.contracted))
  })

  it('配错角色名在装载时就响，不静默按无角色装配', () => {
    const { spec } = makeRepo()
    const harness = makeHarness()

    expect(() => { apply(harness.ctx, { root: spec, role: 'qa' }) }).toThrow('未知角色')
  })

  it('两条会话各按自己认领的任务装面，互不顶掉', () => {
    const { repo, spec } = makeRepo()
    addTask(repo, 'T-02', 'verifying')
    setSession(repo, 'T-02', 'session-B')
    const harness = makeHarness()
    const registrations = mounted(harness, { root: spec, selfCheck: false })

    // 认领了 verifying 任务的会话拿到收口与编辑。
    expect(visible(registrations, sessionAt(repo, 'session-B'))).toContain('task_close')
    expect(visible(registrations, sessionAt(repo, 'session-B'))).toContain('file_edit')
    // 另一条会话仍按看板第一条（drafting），拿不到编辑。
    const other = visible(registrations, sessionAt(repo, 'session-A'))
    expect(other).not.toContain('file_edit')
    expect(other).toContain('task_draft')
    // 无会话号（headless、启动自检）也按看板第一条。
    expect(visible(registrations, sessionAt(repo))).toEqual(other)
  })

  it('认领会话号失效时回落配置任务，不按认领处理', () => {
    const { repo, spec } = makeRepo()
    addTask(repo, 'T-02', 'verifying')
    setSession(repo, 'T-02', 'session-B')
    const harness = makeHarness()
    const registrations = mounted(harness, { root: spec, taskId: 'T-02', selfCheck: false })

    // 这条会话没有认领关系，但装配层指定了 T-02。
    expect(visible(registrations, sessionAt(repo, 'session-gone'))).toContain('task_close')
  })

  it('effect 交出的句柄能解除注册', () => {
    const { spec } = makeRepo()
    const harness = makeHarness()
    apply(harness.ctx, { root: spec, selfCheck: false })

    for (const dispose of harness.runEffects()) dispose()

    expect(harness.registrations).toHaveLength(TOOL_NAMES.length)
    for (const registration of harness.registrations) expect(registration.dispose).toHaveBeenCalledTimes(1)
  })

  it('没有 ctx.effect 时立即注册，不排队', () => {
    const { spec } = makeRepo()
    const harness = makeHarness({ withEffect: false })
    apply(harness.ctx, { root: spec, selfCheck: false })

    expect(harness.registrations.map(r => r.name)).toHaveLength(TOOL_NAMES.length)
  })

  it('仓库还没有 .spec 时只放开七个立项工具', () => {
    const { repo, spec } = makeUnscopedRepo()
    const registrations = mounted(makeHarness(), { root: spec, selfCheck: false })

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(UNSCOPEED_SURFACE))
  })

  it('有 drafting 任务时给起草面，仍不放 file_edit 与 cmd_run', () => {
    const { repo, spec } = makeRepo()
    const registrations = mounted(makeHarness(), { root: spec, selfCheck: false })

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(SURFACE.drafting))
  })

  it('任务状态改了，下一次求值就跟着变', () => {
    const { repo, spec } = makeRepo()
    const registrations = mounted(makeHarness(), { root: spec, selfCheck: false })
    setState(repo, 'contracted')

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(SURFACE.contracted))
  })

  it('config.taskId 指定按哪个任务取面', () => {
    const { repo, spec } = makeRepo()
    addTask(repo, 'T-09', 'closed')
    const registrations = mounted(makeHarness(), { root: spec, selfCheck: false, taskId: 'T-09' })

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(SURFACE.closed))
  })

  it('规格库读坏了就退回空看板最小面，并说明原因', () => {
    const { repo, spec } = makeRepo()
    writeFileSync(join(spec, 'tasks', 'broken.yaml'), 'id: [\n  unclosed\n', 'utf8')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registrations = mounted(makeHarness(), { root: spec, selfCheck: false })

    expect(visible(registrations, sessionAt(repo))).toEqual(sorted(UNSCOPEED_SURFACE))
    expect(logged.mock.calls.map(call => String(call[0])).join('\n')).toContain('读任务状态失败')
  })

  it('启动自检报出注册的十七个工具，且没有掩码缺口', () => {
    const { spec } = makeRepo()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const harness = makeHarness()
    apply(harness.ctx, { root: spec })
    harness.runEffects()

    const text = logged.mock.calls.map(call => String(call[0])).join('\n')
    expect(text).toContain('已注册 17 个工具')
    expect(text).not.toContain('掩码声明了但未注册')
    expect(text).not.toContain('任何状态都看不到')
  })
})
