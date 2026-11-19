/**
 * 草稿修改会话的宿主执行层装配证据。
 *
 * 角色不是测试里手挑的：从真实桌面 profile 的 `preset-maniu-requirement-editor`
 * 里读出 kernel 的 role，再按这个 role 挂载插件并用 `when`（executor 的描述、PTC 绑定与执行
 * 共用的判定）核对——该会话只能拿到读工具与 requirement_patch_propose，
 * 任何直接写正文的工具与其它写入口都拿不到。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { apply } from '../src/plugin.js'
import type { SpecRootContext } from '../src/kernel/spec-root.js'

const PROFILE = readFileSync(new URL('../../../../lcoder/desktop-profile.patch.yml', import.meta.url), 'utf8')
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

interface PresetConfig {
  readonly id: string
  readonly config: {
    readonly plugins: readonly { readonly name: string; readonly config?: { readonly role?: string } }[]
  }
}

/** 从真实装配源里取草稿修改 preset 的 kernel role；缺一行就让测试失败，而不是退回手填值。 */
function editorRole(): string {
  const entries = parse(PROFILE) as unknown
  const found = (value: unknown): PresetConfig | undefined => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const hit = found(entry)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (record.id === 'preset-maniu-requirement-editor') return record as unknown as PresetConfig
    for (const nested of Object.values(record)) {
      const hit = found(nested)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const preset = found(entries)
  expect(preset).toBeDefined()
  const role = preset?.config.plugins.find(plugin => plugin.name === '@maniu/kernel')?.config?.role
  expect(role).toBe('requirement-editor')
  return role ?? ''
}

interface Registration {
  readonly name: string
  readonly when: (context: SpecRootContext) => boolean
  readonly dispose: () => void
}

function mount(role: string): { registrations: Registration[]; commands: string[] } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-patch-surface-'))
  dirs.push(repo)
  const registrations: Registration[] = []
  const commands: string[] = []
  const effects: Array<() => () => void> = []
  apply(
    {
      tools: {
        register(definition: unknown, options?: { when?: (context: SpecRootContext) => boolean }): () => void {
          const dispose = vi.fn()
          registrations.push({
            name: (definition as { name: string }).name,
            when: options?.when ?? (() => true),
            dispose,
          })
          return dispose
        },
      },
      commands: {
        register(definition: unknown): () => void {
          const dispose = vi.fn()
          commands.push((definition as { name: string }).name)
          return dispose
        },
      },
      effect(callback: () => () => void): void {
        effects.push(callback)
      },
    },
    { root: join(repo, '.spec'), role, selfCheck: false },
  )
  for (const effect of effects) effect()
  return { registrations, commands }
}

describe('草稿修改会话的宿主执行层', () => {
  const role = editorRole()
  const { registrations, commands } = mount(role)
  const context: SpecRootContext = { agent: { session: { header: { cwd: dirs[dirs.length - 1] ?? '' } } } }
  const visible = registrations.filter(entry => entry.when(context)).map(entry => entry.name)

  it('只放开读工具与生成修改提案的入口', () => {
    expect(visible).toContain('requirement_patch_propose')
    for (const read of ['file_read', 'file_list', 'spec_query', 'task_read']) expect(visible).toContain(read)
  })

  it('拒绝一切直接写正文与其它写入口（执行层 when，不是提示词）', () => {
    for (const write of [
      'requirement_revise',
      'requirement_draft',
      'requirement_propose',
      'requirement_review_draft',
      'requirement_split_plan',
      'file_edit',
      'cmd_run',
      'spec_draft',
      'spec_bind',
      'project_draft',
      'task_draft',
      'proposal_draft',
      'git_commit',
    ]) {
      expect(visible, `${write} 不该对草稿修改会话开放`).not.toContain(write)
    }
  })

  it('应用仍由人机命令做，不在模型工具面', () => {
    expect(visible).not.toContain('proposal_approve')
    expect(visible).not.toContain('proposal_reject')
    expect(commands).toContain('proposal_approve')
    expect(commands).toContain('proposal_reject')
  })
})
