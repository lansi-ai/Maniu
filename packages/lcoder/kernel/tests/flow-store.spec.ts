/**
 * 流程快照的真实文件探针：写一份 `.spec`，读回下一动作；改策略与状态后再读。
 *
 * 这里验证的是「磁盘事实 → 判定」的装配，纯判定规则在 `flow.spec.ts`。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { selfSignContract } from '../src/commands/contract-sign.js'
import { automationPath } from '../src/kernel/automation.js'
import { saveContract } from '../src/kernel/contract.js'
import { loadFlowSnapshot } from '../src/kernel/flow-store.js'
import { openTask, saveTask } from '../src/kernel/task-store.js'
import { Contract, Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-store-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  mkdirSync(join(root, 'contracts'), { recursive: true })
  mkdirSync(join(root, 'evidence', 'T-01'), { recursive: true })
  return root
}

function writeTask(root: string, over: Record<string, unknown> = {}): void {
  saveTask(root, Task.parse({
    ...openTask({ id: 'T-01', title: '佣金支持 0', grade: 'B', opened_at: '2026-11-06T09:00:00+08:00' }),
    ...over,
  }))
}

function writeDraft(root: string): void {
  saveContract(root, Contract.parse({ id: 'T-01', change: ['x'], acceptance: ['y'] }))
}

function writePolicy(root: string, text: string): void {
  writeFileSync(automationPath(root), text, 'utf8')
}

describe('loadFlowSnapshot', () => {
  it('未签契约 + 三闸成立 → 下一步是 AI 自签', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root, 'actions:\n  sign: auto\n  implement: auto\n')
    writeFileSync(join(root, 'evidence', 'T-01', 'review.log'), '复核通过', 'utf8')

    const snapshot = loadFlowSnapshot(root)
    expect(snapshot.policy.source).toBe('file')
    expect(snapshot.decision).toMatchObject({ action: 'sign', taskId: 'T-01', mode: 'auto' })
    expect(snapshot.decision.reason).toContain('AI 自签')
  })

  it('签完再读 → 下一步变成确认进入已签约；推到 contracted 后变成实施', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)
    writePolicy(root, 'actions:\n  sign: auto\n  implement: auto\n')
    writeFileSync(join(root, 'evidence', 'T-01', 'review.log'), '复核通过', 'utf8')

    expect(selfSignContract(root, { taskId: 'T-01', actor: 'lcoder-flow' }).kind).toBe('success')
    expect(loadFlowSnapshot(root).decision).toMatchObject({ action: 'sign', taskId: 'T-01' })

    writeTask(root, { state: 'contracted' })
    expect(loadFlowSnapshot(root).decision).toMatchObject({ action: 'implement', mode: 'auto' })
  })

  it('缺策略文件 → 全手动，未签契约要人签', () => {
    const root = makeSpec()
    writeTask(root)
    writeDraft(root)

    const snapshot = loadFlowSnapshot(root)
    expect(snapshot.policy.source).toBe('default')
    expect(snapshot.decision).toMatchObject({ action: 'sign', mode: 'manual' })
    expect(snapshot.decision.blockers[0]).toMatchObject({ kind: 'signature' })
  })

  it('策略文件非法 → 抛错，不按全手动静默继续', () => {
    const root = makeSpec()
    writeTask(root)
    writePolicy(root, 'actions:\n  push: auto\n')
    expect(() => loadFlowSnapshot(root)).toThrow(/push/u)
  })

  it('依赖与证据进入事实：前置未收口则停，证据齐则收口', () => {
    const root = makeSpec()
    writeTask(root, { depends_on: ['T-00'] })
    writeTask(root, { id: 'T-00' })
    const snapshot = loadFlowSnapshot(root)
    // T-00 比 T-01 小，先驱动 T-00；T-01 的依赖挡住它自己。
    expect(snapshot.decision.taskId).toBe('T-00')
    expect(snapshot.tasks.find(task => task.id === 'T-01')?.dependsOn).toEqual(['T-00'])
  })
})
