/**
 * 自动化策略的行为测：缺省全手动、按动作开关、停止条件、以及「外部动作永不进配置」。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { automationPath, DEFAULT_AUTOMATION_POLICY, loadAutomationPolicy } from '../src/kernel/automation.js'
import { AutomationPolicy } from '../src/schema/spec.js'
import { validateSpec } from '../src/schema/validate.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-automation-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(root, { recursive: true })
  return root
}

describe('automation schema', () => {
  it('空对象 = 全部动作手动、不设停止条件、管全部任务', () => {
    const policy = AutomationPolicy.parse({})
    expect(Object.values(policy.actions).every(mode => mode === 'manual')).toBe(true)
    expect(policy.limits).toEqual({})
    expect(policy.tasks).toEqual([])
  })

  it('按动作单独开关，缺省项仍是手动', () => {
    const policy = AutomationPolicy.parse({ actions: { sign: 'auto', implement: 'auto' } })
    expect(policy.actions).toMatchObject({ sign: 'auto', implement: 'auto', contract: 'manual', close: 'manual' })
  })

  it('外部不可逆动作写进 actions → 判非法', () => {
    expect(() => AutomationPolicy.parse({ actions: { push: 'auto' } })).toThrow(/push/u)
    expect(() => AutomationPolicy.parse({ actions: { deploy: 'auto' } })).toThrow(/deploy/u)
  })

  it('外部不可逆动作写进顶层 → 判非法', () => {
    expect(() => AutomationPolicy.parse({ push: 'auto' })).toThrow(/push/u)
  })

  it('停止条件必须是正整数或非负整数', () => {
    expect(AutomationPolicy.parse({ limits: { token_budget: 10, max_consecutive_failures: 0 } }).limits)
      .toEqual({ token_budget: 10, max_consecutive_failures: 0 })
    expect(() => AutomationPolicy.parse({ limits: { token_budget: 0 } })).toThrow()
    expect(() => AutomationPolicy.parse({ limits: { max_parallel: -1 } })).toThrow()
  })
})

describe('loadAutomationPolicy', () => {
  it('缺文件 → 全手动默认值，来源记为 default', () => {
    const root = makeSpec()
    const fact = loadAutomationPolicy(root)
    expect(fact.source).toBe('default')
    expect(fact.hash).toBeNull()
    expect(fact.at).toBeNull()
    expect(fact.policy).toEqual(DEFAULT_AUTOMATION_POLICY)
    expect(fact.policy.actions.sign).toBe('manual')
    expect(fact.path).toBe(automationPath(root))
  })

  it('读到文件 → 返回内容哈希与文件时间；改写后下一次读到新值', () => {
    const root = makeSpec()
    writeFileSync(automationPath(root), 'actions:\n  sign: auto\n', 'utf8')
    const first = loadAutomationPolicy(root)
    expect(first.source).toBe('file')
    expect(first.policy.actions.sign).toBe('auto')
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(Number.isNaN(Date.parse(first.at ?? ''))).toBe(false)

    writeFileSync(automationPath(root), 'actions:\n  sign: manual\n', 'utf8')
    const second = loadAutomationPolicy(root)
    expect(second.policy.actions.sign).toBe('manual')
    expect(second.hash).not.toBe(first.hash)
  })

  it('配置文件含 push → 抛错并点出这个键', () => {
    const root = makeSpec()
    writeFileSync(automationPath(root), 'actions:\n  push: auto\n', 'utf8')
    expect(() => loadAutomationPolicy(root)).toThrow(/不允许的键 push/u)
  })
})

describe('validateSpec 认识 automation.yaml', () => {
  /** env.yaml 与 spec/rules.yaml 是校验器的必需文件；这里只把它们填到合法。 */
  function seed(root: string): void {
    mkdirSync(join(root, 'spec'), { recursive: true })
    writeFileSync(join(root, 'spec', 'rules.yaml'), 'rules: []\n', 'utf8')
    writeFileSync(
      join(root, 'env.yaml'),
      'repo:\n  url: https://example.com/repo.git\n  branch: main\n  push_mode: direct\ncommands: []\n',
      'utf8',
    )
  }

  it('合法策略计入 loaded，不再被当成未覆盖文件', () => {
    const root = makeSpec()
    seed(root)
    writeFileSync(automationPath(root), 'actions:\n  sign: auto\nlimits:\n  max_parallel: 1\n', 'utf8')
    const result = validateSpec(root)
    expect(result.ok).toBe(true)
    expect(result.loaded.map(file => file.file)).toContain('automation.yaml')
    expect(result.issues.some(issue => issue.file === 'automation.yaml')).toBe(false)
  })

  it('外部动作键 → error', () => {
    const root = makeSpec()
    seed(root)
    writeFileSync(automationPath(root), 'actions:\n  deploy: auto\n', 'utf8')
    const result = validateSpec(root)
    expect(result.ok).toBe(false)
    const issue = result.issues.find(item => item.file === 'automation.yaml')
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('deploy')
  })
})
