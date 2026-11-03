import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterAll, describe, expect, it } from 'vitest'

import { resolveRoot, sessionSpecRoot } from '../src/kernel/spec-root.js'
import type { SpecRootContext } from '../src/kernel/spec-root.js'
import { createEditTools } from '../src/tools/edit-tools.js'
import { createSpecTools } from '../src/tools/spec-tools.js'
import { createTaskTools } from '../src/tools/task-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-spec-root-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  return repo
}

/** 一个不含 agent 的合法执行上下文：走备案根，不伪造 Agent 结构。 */
function runContext(name: string): Parameters<ToolDefinition['execute']>[1] {
  const callId = 'lcoder-spec-root-call' as Parameters<ToolDefinition['execute']>[1]['callId']
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol(name) as Parameters<ToolDefinition['execute']>[1]['token'],
    deferContext() {},
    concludeTurn() {},
  }
}

function call(tools: readonly ToolDefinition[], name: string, args: Record<string, unknown>) {
  const tool = tools.find(t => t.name === name)
  if (!tool) throw new Error(`没有这个工具：${name}`)
  return tool.execute(args, runContext(name)) as Promise<Record<string, unknown>>
}

describe('规格根解析', () => {
  it('有会话 cwd 时取 <cwd>/.spec', () => {
    expect(sessionSpecRoot({ agent: { session: { header: { cwd: 'E:/repo' } } } }, 'E:/fallback/.spec'))
      .toBe(join('E:/repo', '.spec'))
  })

  it('没有会话或 cwd 为空时退回备案根', () => {
    expect(sessionSpecRoot(undefined, 'E:/fallback/.spec')).toBe('E:/fallback/.spec')
    expect(sessionSpecRoot({ agent: { session: { header: {} } } }, 'E:/fallback/.spec'))
      .toBe('E:/fallback/.spec')
    expect(sessionSpecRoot({ agent: { session: { header: { cwd: '' } } } }, 'E:/fallback/.spec'))
      .toBe('E:/fallback/.spec')
  })

  it('字符串根原样返回，函数根按上下文求值', () => {
    const context: SpecRootContext = { agent: { session: { header: { cwd: 'E:/repo' } } } }
    expect(resolveRoot('E:/fixed/.spec')).toBe('E:/fixed/.spec')
    expect(resolveRoot(ctx => sessionSpecRoot(ctx, 'E:/fallback/.spec'), context))
      .toBe(join('E:/repo', '.spec'))
  })
})

describe('工具按每次调用取根', () => {
  it('同一个工具实例在根变化后读新的 .spec', async () => {
    const first = makeRepo()
    const second = makeRepo()
    const taskFile = join(second, '.spec', 'tasks', 'T-01.yaml')
    writeFileSync(
      taskFile,
      readFileSync(taskFile, 'utf8').replace(/^title: .*$/m, 'title: 第二个仓库的任务'),
      'utf8',
    )

    let current = join(first, '.spec')
    const tools = createTaskTools(() => current)

    const one = await call(tools, 'task_read', { task_id: 'T-01' })
    current = join(second, '.spec')
    const two = await call(tools, 'task_read', { task_id: 'T-01' })

    expect(one.title).toBe('佣金支持 0（自营免佣）')
    expect(two.title).toBe('第二个仓库的任务')
  })

  it('规格工具与编辑工具跟随同一解析函数', async () => {
    const repo = makeRepo()
    const root = () => join(repo, '.spec')
    const specTools = createSpecTools(root)
    const editTools = createEditTools(root)

    const found = await call(specTools, 'spec_query', {})
    expect((found.rules as { id: string }[]).length).toBeGreaterThan(0)

    const evidence = await call(editTools, 'evidence_attach', {
      task_id: 'T-01',
      kind: 'test',
      content: 'ok',
    })
    expect(evidence.path).toBe('evidence/T-01/test.log')
    expect(existsSync(join(repo, '.spec', 'evidence', 'T-01', 'test.log'))).toBe(true)
  })
})
