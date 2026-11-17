/**
 * 配齐过审门槛的行为测：有 flow.yaml 时评审节点逐岗署名，无配置保持至少一轮。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createFlowSaveCommand } from '../src/commands/flow-save.js'
import { createRequirementApproveCommand } from '../src/commands/requirement-approve.js'
import { flowConfigPath } from '../src/kernel/flow-config.js'
import { loadRequirement, saveRequirement } from '../src/kernel/requirement-store.js'
import { Requirement } from '../src/schema/spec.js'
import type { RequirementReview } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const AT = '2026-11-17T12:00:00+08:00'

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-gate-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'requirements'), { recursive: true })
  return root
}

function writeRequirement(root: string, reviews: readonly RequirementReview[] = []): void {
  saveRequirement(root, Requirement.parse({
    id: 'REQ-01',
    title: '佣金改造',
    state: 'draft',
    opened_at: '2026-11-17T09:00:00+08:00',
    reviews,
  }))
  writeFileSync(join(root, 'requirements', 'REQ-01.md'), '# 佣金改造\n', 'utf8')
}

function review(round: number, role?: string): RequirementReview {
  return {
    round,
    at: '2026-11-17T10:00:00+08:00',
    report: `requirements/REQ-01/reviews/R${String(round)}.md`,
    ...(role === undefined ? {} : { role }),
  }
}

function configureFlow(root: string, roles: readonly string[]): void {
  const result = createFlowSaveCommand(root).handler({
    rawInput: JSON.stringify({ nodes: [{ node: 'review', roles, auto: true }] }),
  })
  if (result.kind !== 'success') throw new Error(`配置失败：${result.text}`)
}

const approve = (root: string) => createRequirementApproveCommand(root, () => AT).handler({ rawInput: 'REQ-01' })

describe('有流程配置：逐岗署名配齐才许过审', () => {
  it('每个配置岗位都有署名评审时过审', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1, 'maniu-pm'), review(2, 'maniu-review')])
    configureFlow(root, ['maniu-pm', 'maniu-review'])

    const result = approve(root)
    expect(result.kind).toBe('success')
    expect(loadRequirement(root, 'REQ-01').state).toBe('confirmed')
  })

  it('缺一个岗位就拒绝，提示列出缺哪些岗位，状态不动', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1, 'maniu-pm')])
    configureFlow(root, ['maniu-pm', 'maniu-review'])

    const result = approve(root)
    expect(result.kind).toBe('error')
    const text = result.kind === 'error' ? result.text : ''
    expect(text).toContain('还没配齐')
    expect(text).toContain('maniu-review')
    expect(text).not.toContain('maniu-pm')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('旧评审无署名按未配齐拒绝', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1), review(2)])
    configureFlow(root, ['maniu-pm'])

    const result = approve(root)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('maniu-pm')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('署名要精确匹配配置 id，相近名字不算', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1, 'maniu-pm-2')])
    configureFlow(root, ['maniu-pm'])

    expect(approve(root).kind).toBe('error')
  })

  it('一轮评审都没有时仍先报缺评审', () => {
    const root = makeSpec()
    writeRequirement(root)
    configureFlow(root, ['maniu-pm'])

    const result = approve(root)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('还没有评审记录')
  })

  it('配置里没有 review 节点时保持至少一轮的旧门槛', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1)])
    const saved = createFlowSaveCommand(root).handler({
      rawInput: '{"nodes":[{"node":"split","roles":["maniu-manager"],"auto":false}]}',
    })
    expect(saved.kind).toBe('success')

    expect(approve(root).kind).toBe('success')
  })

  it('flow.yaml 读不懂时拒绝过审并给可读原因', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1, 'maniu-pm')])
    writeFileSync(flowConfigPath(root), 'nodes: [', 'utf8')

    const result = approve(root)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('读流程配置失败')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })
})

describe('无流程配置：旧门槛不变', () => {
  it('没有 flow.yaml 时一轮无署名评审即可过审', () => {
    const root = makeSpec()
    writeRequirement(root, [review(1)])

    expect(approve(root).kind).toBe('success')
    expect(loadRequirement(root, 'REQ-01').state).toBe('confirmed')
  })

  it('没有 flow.yaml 时没有评审仍拒绝', () => {
    const root = makeSpec()
    writeRequirement(root)

    expect(approve(root).kind).toBe('error')
  })
})
