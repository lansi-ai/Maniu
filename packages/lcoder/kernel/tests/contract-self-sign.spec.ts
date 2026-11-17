/**
 * AI 自签的行为测：三闸成立才写 `by: agent`，并把 actor 与策略授权依据钉进契约。
 *
 * 这里走真实文件：任务、策略、证据、契约都落在临时 `.spec` 里，再读回断言。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { selfSignContract } from '../src/commands/contract-sign.js'
import type { SignCommandResult } from '../src/commands/contract-sign.js'
import { automationPath } from '../src/kernel/automation.js'
import { contractPath, saveContract } from '../src/kernel/contract.js'
import { openTask, saveTask } from '../src/kernel/task-store.js'
import { Contract, Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** 一个带 tasks / contracts / evidence 的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-selfsign-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  mkdirSync(join(root, 'contracts'), { recursive: true })
  return root
}

function writeTask(root: string, over: Record<string, unknown> = {}): Task {
  const task = Task.parse({
    ...openTask({ id: 'T-01', title: '佣金支持 0', grade: 'B', opened_at: '2026-11-06T09:00:00+08:00' }),
    ...over,
  })
  saveTask(root, task)
  return task
}

function writeDraft(root: string): Contract {
  const contract = Contract.parse({ id: 'T-01', change: ['x'], acceptance: ['y'] })
  saveContract(root, contract)
  return contract
}

function writePolicy(root: string, text = 'actions:\n  sign: auto\n'): string {
  writeFileSync(automationPath(root), text, 'utf8')
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

function addReviewEvidence(root: string, name = 'review', content = '复核通过'): void {
  mkdirSync(join(root, 'evidence', 'T-01'), { recursive: true })
  writeFileSync(join(root, 'evidence', 'T-01', `${name}.log`), content, 'utf8')
}

function sign(root: string, actor = 'maniu-flow', at = '2026-11-06T10:00:00+08:00'): SignCommandResult {
  return selfSignContract(root, { taskId: 'T-01', actor }, () => at)
}

function errorText(result: SignCommandResult): string {
  expect(result.kind).toBe('error')
  return result.kind === 'error' ? result.text : ''
}

function successText(result: SignCommandResult): string {
  expect(result.kind).toBe('success')
  return result.kind === 'success' ? (result.text ?? '') : ''
}

function body(root: string): Contract {
  return Contract.parse(parseYaml(readFileSync(contractPath(root, 'T-01'), 'utf8')))
}

describe('selfSignContract', () => {
  it('三闸成立 → 写入 by agent、actor 与授权依据', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    const policyHash = writePolicy(root)
    addReviewEvidence(root)

    const text = successText(sign(root))
    expect(text).toContain('AI 自签')
    expect(text).toContain('maniu-flow')

    const signed = body(root)
    expect(signed.sig).toMatchObject({
      by: 'agent',
      at: '2026-11-06T10:00:00+08:00',
      actor: 'maniu-flow',
      authorization: { policy: 'automation.yaml', hash: policyHash },
    })
    expect(signed.sig?.hash).toMatch(/^sha256:/u)
    // 自签只写 sig，不改任务状态。
    expect(parseYaml(readFileSync(join(root, 'tasks', 'T-01.yaml'), 'utf8'))).toMatchObject({ state: 'drafting' })
  })

  it('没有策略文件（默认全手动）→ 拒绝', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    addReviewEvidence(root)
    expect(errorText(sign(root))).toContain('策略')
  })

  it('策略把签署设为 manual → 拒绝', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root, 'actions:\n  sign: manual\n')
    addReviewEvidence(root)
    expect(errorText(sign(root))).toContain('策略')
  })

  it('缺评审复核证据 → 拒绝；空文件也不算', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root)
    expect(errorText(sign(root))).toContain('评审')
    addReviewEvidence(root, 'review', '')
    expect(errorText(sign(root))).toContain('评审')
  })

  it('任务触及不可逆项 → 拒绝，即便另外两闸成立', () => {
    const root = makeSpec()
    writeTask(root, { scope: { irreversible: ['settlement_formula'], allowed_paths: [] } })
    writeDraft(root)
    writePolicy(root)
    addReviewEvidence(root)
    expect(errorText(sign(root))).toContain('不可逆项')
    expect(body(root).sig).toBeNull()
  })

  it('actor 缺失 → 拒绝，不写盘', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root)
    addReviewEvidence(root)
    expect(errorText(sign(root, '  '))).toContain('actor')
    expect(body(root).sig).toBeNull()
  })

  it('已由 AI 自签且正文未变 → 拒绝重复签署', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root)
    addReviewEvidence(root)
    successText(sign(root))
    expect(errorText(sign(root))).toContain('无需重复签署')
  })

  it('没有契约 → 拒绝并指向 contract_draft', () => {
    const root = makeSpec()
    writeTask(root)
    writePolicy(root)
    addReviewEvidence(root)
    expect(errorText(sign(root))).toContain('contract_draft')
  })
})
