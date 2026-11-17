/**
 * 人机命令 `task_contract` 的行为测：只在契约签署有效时，把起草态推到已签约。
 *
 * 这里钉的是四道闸的顺序与代价：状态不对不写、没契约不写、AI 自签三闸不成立不算、
 * 签后改过的正文不算。任何一道不过都只回一句话，任务文件一个字节不动。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createTaskContractCommand } from '../src/commands/task-contract.js'
import { contractHash, contractPath, saveContract } from '../src/kernel/contract.js'
import { openTask, saveTask, taskPath } from '../src/kernel/task-store.js'
import { Contract, Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** 一个带 `.spec/tasks` 与 `.spec/contracts` 的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-contract-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'contracts'), { recursive: true })
  return root
}

function writeTask(root: string, state: Task['state'] = 'drafting'): Task {
  const task = Task.parse({
    ...openTask({ id: 'T-01', title: '佣金支持 0', grade: 'B', opened_at: '2026-11-04T10:00:00+08:00' }),
    state,
  })
  saveTask(root, task)
  return task
}

/** 写一份契约；`sig` 不给就是未签，`hashOf` 用来造「签完又改」。 */
function writeContract(root: string, sig: Record<string, unknown> | null): void {
  saveContract(root, Contract.parse({ id: 'T-01', change: ['x'], acceptance: ['y'], sig }))
}

/** 结构合法的 AI 自签：actor 与授权依据齐全，是否有效由三补偿闸判。 */
function agentSig(hash: string): Record<string, unknown> {
  return {
    by: 'agent',
    at: '2026-11-04T10:00:00+08:00',
    hash,
    actor: 'maniu-flow',
    authorization: { policy: 'automation.yaml', hash: 'sha256:策略', at: '2026-11-04T09:00:00+08:00' },
  }
}

/** 写一份把签署设为 auto 的策略，并给任务挂一条非空的评审复核证据。 */
function openSelfSignGates(root: string): void {
  writeFileSync(join(root, 'automation.yaml'), 'actions:\n  sign: auto\n', 'utf8')
  mkdirSync(join(root, 'evidence', 'T-01'), { recursive: true })
  writeFileSync(join(root, 'evidence', 'T-01', 'review.log'), '复核通过', 'utf8')
}

const bodyHash = (): string => contractHash(Contract.parse({ id: 'T-01', change: ['x'], acceptance: ['y'] }))

function run(root: string, rawInput: string, at = '2026-11-05T10:00:00+08:00') {
  return createTaskContractCommand(root, () => at).handler({ rawInput })
}

function stateOf(root: string): string {
  return Task.parse(parseYaml(readFileSync(taskPath(root, 'T-01'), 'utf8'))).state
}

describe('task_contract', () => {
  it('编号缺失或非法 → 报错并给出用法', () => {
    const root = makeSpec()
    expect(run(root, '')).toMatchObject({ kind: 'error' })
    expect((run(root, '随便').text ?? '')).toContain('非法的任务编号')
  })

  it('没有 .spec → 报没有可推进的任务', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-contract-empty-'))
    dirs.push(repo)
    expect((run(join(repo, '.spec'), 'T-01').text ?? '')).toContain('还没有 .spec')
  })

  it('任务文件不存在 → 报路径', () => {
    const root = makeSpec()
    expect((run(root, 'T-01').text ?? '')).toContain('.spec')
  })

  it('不是起草态 → 拒绝，并说清当前状态', () => {
    const root = makeSpec()
    writeTask(root, 'contracted')
    writeContract(root, { by: 'human', at: '2026-11-04T10:00:00+08:00', hash: bodyHash() })
    const r = run(root, 'T-01')
    expect(r.kind).toBe('error')
    expect(r.text).toContain('contracted')
    expect(stateOf(root)).toBe('contracted')
  })

  it('没有契约 → 拒绝', () => {
    const root = makeSpec()
    writeTask(root)
    expect((run(root, 'T-01').text ?? '')).toContain('找不到')
    expect(stateOf(root)).toBe('drafting')
  })

  it('契约未签 / AI 自签三闸不成立 / 签后改过 → 全部拒绝，状态不动', () => {
    const root = makeSpec()
    writeTask(root)
    writeContract(root, null)
    expect((run(root, 'T-01').text ?? '')).toContain('还没签')

    writeContract(root, agentSig(bodyHash()))
    expect((run(root, 'T-01').text ?? '')).toContain('AI 自签')

    writeContract(root, { by: 'human', at: '2026-11-04T10:00:00+08:00', hash: 'sha256:旧版' })
    expect((run(root, 'T-01').text ?? '')).toContain('签名作废')
    expect(stateOf(root)).toBe('drafting')
  })

  it('AI 自签三闸成立 → 推到已签约并注明签署方式', () => {
    const root = makeSpec()
    writeTask(root)
    openSelfSignGates(root)
    writeContract(root, agentSig(bodyHash()))

    const r = run(root, 'T-01')
    expect(r.kind).toBe('success')
    expect(r.text).toContain('AI 自签')
    expect(r.text).toContain('maniu-flow')
    expect(stateOf(root)).toBe('contracted')
  })

  it('人签且哈希覆盖当前正文 → 推到已签约并落盘', () => {
    const root = makeSpec()
    writeTask(root)
    writeContract(root, { by: 'human', at: '2026-11-04T10:00:00+08:00', hash: bodyHash() })

    const r = run(root, 'T-01')
    expect(r.kind).toBe('success')
    expect(r.text).toContain('已签约')
    expect(stateOf(root)).toBe('contracted')

    const onDisk = Task.parse(parseYaml(readFileSync(taskPath(root, 'T-01'), 'utf8')))
    expect(onDisk.closed_at).toBeNull()
  })

  it('只推这一条边：已签约之后不再接受', () => {
    const root = makeSpec()
    writeTask(root)
    writeContract(root, { by: 'human', at: '2026-11-04T10:00:00+08:00', hash: bodyHash() })
    expect(run(root, 'T-01').kind).toBe('success')
    expect(run(root, 'T-01').kind).toBe('error')
    expect(contractPath(root, 'T-01')).toContain('T-01.contract.yaml')
  })
})
