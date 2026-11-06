/**
 * 流程命令的行为测：`flow_status` 输出的计划、`flow_log` 的审计追加。
 *
 * 两条命令都走真实文件：判定读 `.spec`，流水写 `.spec/evidence/<任务>/flow.jsonl`。
 * 纯判定规则在 `flow.spec.ts`，磁盘装配在 `flow-store.spec.ts`。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createFlowLogCommand } from '../src/commands/flow-log.js'
import { createFlowStatusCommand } from '../src/commands/flow-status.js'
import { saveTask, openTask } from '../src/kernel/task-store.js'
import { Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): { repo: string; root: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-cmd-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return { repo, root }
}

function writeTask(root: string, over: Record<string, unknown> = {}): void {
  saveTask(root, Task.parse({
    ...openTask({ id: 'T-01', title: '佣金支持 0', grade: 'B', opened_at: '2026-11-06T09:00:00+08:00' }),
    ...over,
  }))
}

/** 命令调用：会话 cwd 指向仓库根，规格根因此是 `<repo>/.spec`。 */
function invocation(repo: string, rawInput: string, sessionId = 'session-A') {
  return { rawInput, agent: { session: { header: { cwd: repo, id: sessionId } } } }
}

describe('flow_status', () => {
  it('没有策略文件时按全手动，并给出逐任务计划', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    const command = createFlowStatusCommand(join(repo, '.spec'))

    const result = command.handler(invocation(repo, ''))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success' || result.text === undefined) throw new Error('没有输出')
    const payload = JSON.parse(result.text) as {
      policy: { source: string; actions: Record<string, string> }
      decision: { action: string; taskId: string }
      tasks: Array<{ id: string; state: string; startable: boolean; decision: { action: string } }>
      known: string[]
    }

    expect(payload.policy.source).toBe('default')
    expect(payload.policy.actions.sign).toBe('manual')
    expect(payload.decision).toMatchObject({ action: 'contract', taskId: 'T-01' })
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0]).toMatchObject({ id: 'T-01', state: 'drafting', startable: true })
    expect(payload.known).toEqual(['T-01'])
  })

  it('前置未收口 → 计划里不可开始，挡住原因带等哪几条', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    writeTask(root, { id: 'T-02', title: '第二条', depends_on: ['T-01'] })
    const command = createFlowStatusCommand(join(repo, '.spec'))

    const result = command.handler(invocation(repo, 'T-02'))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success' || result.text === undefined) throw new Error('没有输出')
    const payload = JSON.parse(result.text) as {
      tasks: Array<{ id: string; startable: boolean; dependsOn: string[]; decision: { blockers: Array<{ kind: string; detail: string }> } }>
    }

    expect(payload.tasks[0]?.startable).toBe(false)
    expect(payload.tasks[0]?.dependsOn).toEqual(['T-01'])
    expect(payload.tasks[0]?.decision.blockers[0]?.kind).toBe('dependency')
    expect(payload.tasks[0]?.decision.blockers[0]?.detail).toContain('T-01')
  })

  it('策略非法时返回错误，不输出一份看起来正常的空计划', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    writeFileSync(join(root, 'automation.yaml'), 'actions:\n  push: auto\n', 'utf8')
    const command = createFlowStatusCommand(join(repo, '.spec'))

    const result = command.handler(invocation(repo, ''))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('读不懂')
  })

  it('任务编号不合法直接拒绝', () => {
    const { repo } = makeSpec()
    const command = createFlowStatusCommand(join(repo, '.spec'))
    expect(command.handler(invocation(repo, 'T-x')).kind).toBe('error')
  })

  it('没有 .spec 时仍可求值：任务为空，下一步是起草任务', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-cmd-empty-'))
    dirs.push(repo)
    const command = createFlowStatusCommand(join(repo, '.spec'))

    const result = command.handler(invocation(repo, ''))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success' || result.text === undefined) throw new Error('没有输出')
    const payload = JSON.parse(result.text) as { decision: { action: string }; tasks: unknown[] }
    expect(payload.decision.action).toBe('draft')
    expect(payload.tasks).toEqual([])
  })
})

describe('flow_log', () => {
  it('把动作追加到任务证据目录，带上会话号与时刻', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    const command = createFlowLogCommand(join(repo, '.spec'), () => '2026-11-06T12:00:00.000Z')

    const result = command.handler(invocation(repo, 'T-01 {"action":"implement","result":"success","reason":"开工"}'))
    expect(result.kind).toBe('success')

    const path = join(root, 'evidence', 'T-01', 'flow.jsonl')
    expect(existsSync(path)).toBe(true)
    const row = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>
    expect(row).toMatchObject({
      taskId: 'T-01',
      at: '2026-11-06T12:00:00.000Z',
      by: 'session-A',
      action: 'implement',
      result: 'success',
      reason: '开工',
    })
  })

  it('只追加不改旧记录', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    const command = createFlowLogCommand(join(repo, '.spec'), () => '2026-11-06T12:00:00.000Z')
    command.handler(invocation(repo, 'T-01 {"action":"contract","result":"success"}'))
    command.handler(invocation(repo, 'T-01 {"action":"sign","result":"held"}'))

    const lines = readFileSync(join(root, 'evidence', 'T-01', 'flow.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const second = JSON.parse(lines[1]!) as { action?: string }
    expect(second.action).toBe('sign')
  })

  it('动作不合法、任务不存在或没有规格库时拒绝写盘', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    const command = createFlowLogCommand(join(repo, '.spec'))

    expect(command.handler(invocation(repo, 'T-01 {"action":"deploy"}')).kind).toBe('error')
    expect(command.handler(invocation(repo, 'T-99 {"action":"implement"}')).kind).toBe('error')

    const empty = mkdtempSync(join(tmpdir(), 'lcoder-flow-cmd-nospec-'))
    dirs.push(empty)
    const noSpec = createFlowLogCommand(join(empty, '.spec'))
    expect(noSpec.handler(invocation(empty, 'T-01 {"action":"implement"}')).kind).toBe('error')
  })

  it('结果值不认识时拒绝', () => {
    const { repo, root } = makeSpec()
    writeTask(root)
    const command = createFlowLogCommand(join(repo, '.spec'))
    expect(command.handler(invocation(repo, 'T-01 {"action":"implement","result":"maybe"}')).kind).toBe('error')
  })
})
