/**
 * `agent_bind` 的行为测：两个常驻会话号写进 `.spec/agents.yaml`，互不顶掉。
 *
 * 会话号是运行时标识，命令只落盘不回查宿主；失效由界面重找或重建后再写。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { afterAll, describe, expect, it } from 'vitest'

import { createAgentBindCommand } from '../src/commands/agent-bind.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): { repo: string; root: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-agent-bind-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return { repo, root }
}

function invocation(repo: string, rawInput: string) {
  return { rawInput, agent: { session: { header: { cwd: repo, id: 'session-A' } } } }
}

describe('agent_bind', () => {
  it('分别写两个角色，第二个不动第一个', () => {
    const { repo, root } = makeSpec()
    const command = createAgentBindCommand(join(repo, '.spec'))

    expect(command.handler(invocation(repo, 'scheduler scheduler-session')).kind).toBe('success')
    expect(command.handler(invocation(repo, 'flow flow-session')).kind).toBe('success')

    const file = parseYaml(readFileSync(join(root, 'agents.yaml'), 'utf8')) as Record<string, unknown>
    expect(file).toEqual({ schedulerSession: 'scheduler-session', flowSession: 'flow-session' })
  })

  it('重复写同一个会话号是成功空操作', () => {
    const { repo, root } = makeSpec()
    const command = createAgentBindCommand(join(repo, '.spec'))
    command.handler(invocation(repo, 'scheduler scheduler-session'))
    const before = readFileSync(join(root, 'agents.yaml'), 'utf8')

    const again = command.handler(invocation(repo, 'scheduler scheduler-session'))
    expect(again.kind).toBe('success')
    expect(again.text).toContain('无需重复写入')
    expect(readFileSync(join(root, 'agents.yaml'), 'utf8')).toBe(before)
  })

  it('未知角色、会话号形态不对、没有规格库时拒绝', () => {
    const { repo, root } = makeSpec()
    const command = createAgentBindCommand(join(repo, '.spec'))

    expect(command.handler(invocation(repo, 'pm some-session')).kind).toBe('error')
    expect(command.handler(invocation(repo, 'flow 有空格 的号')).kind).toBe('error')
    expect(command.handler(invocation(repo, 'flow')).kind).toBe('error')

    const empty = mkdtempSync(join(tmpdir(), 'lcoder-agent-bind-nospec-'))
    dirs.push(empty)
    const noSpec = createAgentBindCommand(join(empty, '.spec'))
    expect(noSpec.handler(invocation(empty, 'flow some-session')).kind).toBe('error')
    expect(root).not.toBe('')
  })

  it('文件里有不认识的键时拒绝覆盖写，原文件保持不动', () => {
    const { repo, root } = makeSpec()
    const path = join(root, 'agents.yaml')
    writeFileSync(path, 'schedulerSession: old\nmystery: 1\n', 'utf8')
    const before = readFileSync(path, 'utf8')
    const command = createAgentBindCommand(join(repo, '.spec'))

    const result = command.handler(invocation(repo, 'flow flow-session'))
    expect(result.kind).toBe('error')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
