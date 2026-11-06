/**
 * 立项会话的识别、重开动作与结果页取数。
 *
 * 这里只测纯判断：档位只认两档咒语前缀，计数零也如实，重开只发给新会话。
 */
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProposalRow } from '../src/client/projection.ts'
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import { INTAKE_PROMPT_HEAD, ONBOARDING_PROMPT_HEAD } from '../src/client/shell/shell-data.ts'
import {
  intakeArtifactsOf, intakeTierOfMessages, latestProposal, runIntakeRestart,
} from '../src/client/shell/intake.ts'

/** 一条用户消息；`hidden` 是外壳自动发出的咒语在窗口里的样子。 */
function userMessage(text: string, hidden = false): ShellMessage {
  return hidden ? { role: 'user', text, hidden: true } : { role: 'user', text }
}

/** 一份最小方案；只填结果页与排序用到的字段。 */
function proposalOf(id: string, title: string): ProposalRow {
  return {
    id,
    title,
    problem: `${title}的问题`,
    options: [],
    recommendation: `${title}的推荐`,
    decision: 'draft',
    decidedAt: null,
  }
}

const PROJECT = { name: 'demo', path: 'E:/demo', branch: 'main' }
const DOCS = { product: 'product-spec.md', architecture: '', tests: '' }

describe('立项会话识别', () => {
  it('全新项目档：内置咒语即使被标成 hidden 也仍能认出来', () => {
    const messages = [userMessage(`${INTAKE_PROMPT_HEAD}demo`, true)]
    expect(intakeTierOfMessages(messages)).toBe('new')
  })

  it('已有资料档按另一条前缀认出', () => {
    expect(intakeTierOfMessages([userMessage(`${ONBOARDING_PROMPT_HEAD}demo`)]))
      .toBe('docs')
  })

  it('非立项会话与空窗口都返回 null，不猜档位', () => {
    expect(intakeTierOfMessages([userMessage('帮我看看这个报错')])).toBeNull()
    expect(intakeTierOfMessages([])).toBeNull()
  })

  it('助手消息与注入上下文不算立项咒语', () => {
    expect(intakeTierOfMessages([
      { role: 'assistant', text: `${INTAKE_PROMPT_HEAD}demo` },
      { role: 'context', text: `${ONBOARDING_PROMPT_HEAD}demo`, label: 'developer' },
    ])).toBeNull()
  })
})

describe('重开确认框的计数', () => {
  it('项目未登记、0 任务、0 方案都如实记零', () => {
    expect(intakeArtifactsOf({ info: null, rules: 0, tasks: [], proposals: 0 })).toEqual({
      projectRegistered: false,
      rules: 0,
      tasks: 0,
      drafting: 0,
      proposals: 0,
    })
  })

  it('按状态数出起草中的任务', () => {
    const artifacts = intakeArtifactsOf({
      info: null,
      rules: 3,
      tasks: [{ state: 'drafting' }, { state: 'drafting' }, { state: 'closed' }],
      proposals: 2,
    })
    expect(artifacts.rules).toBe(3)
    expect(artifacts.tasks).toBe(3)
    expect(artifacts.drafting).toBe(2)
    expect(artifacts.proposals).toBe(2)
    expect(artifacts.projectRegistered).toBe(false)
  })

  it('项目信息读到时标为已登记', () => {
    const artifacts = intakeArtifactsOf({
      info: { kind: 'web', repoUrl: '', branch: 'main', docs: { product: '', architecture: '', tests: '' }, environments: [] },
      rules: 1,
      tasks: [],
      proposals: 1,
    })
    expect(artifacts.projectRegistered).toBe(true)
  })
})

describe('默认方案', () => {
  it('编号按数字比较，P-02 大于 P-01，P-10 大于 P-09', () => {
    expect(latestProposal([proposalOf('P-01', '一'), proposalOf('P-02', '二')])?.id).toBe('P-02')
    expect(latestProposal([proposalOf('P-09', '九'), proposalOf('P-10', '十')])?.id).toBe('P-10')
  })

  it('没有方案时返回 undefined', () => {
    expect(latestProposal([])).toBeUndefined()
  })
})

describe('重新开始', () => {
  it('按原档位重建咒语，新建会话后只发给新会话', async () => {
    const created = SessionId('s-new')
    const createSession = vi.fn(async () => created)
    const sendPrompt = vi.fn(async () => {})
    const outcome = await runIntakeRestart({
      tier: 'docs', project: PROJECT, docs: DOCS, path: PROJECT.path, createSession, sendPrompt,
    })

    expect(outcome.kind).toBe('started')
    if (outcome.kind !== 'started') return
    expect(outcome.sessionId).toBe(created)
    expect(outcome.prompt.startsWith(ONBOARDING_PROMPT_HEAD)).toBe(true)
    expect(outcome.prompt).toContain('product-spec.md')
    expect(createSession).toHaveBeenCalledWith('E:/demo')
    expect(sendPrompt).toHaveBeenCalledWith(created, outcome.prompt)
  })

  it('全新项目档重建的是七问咒语', async () => {
    const outcome = await runIntakeRestart({
      tier: 'new',
      project: PROJECT,
      docs: DOCS,
      path: PROJECT.path,
      createSession: async () => SessionId('s-new'),
      sendPrompt: async () => {},
    })
    expect(outcome.kind).toBe('started')
    if (outcome.kind !== 'started') return
    expect(outcome.prompt.startsWith(INTAKE_PROMPT_HEAD)).toBe(true)
  })

  it('建会话失败时不再发送，旧状态不受影响', async () => {
    const sendPrompt = vi.fn(async () => {})
    const outcome = await runIntakeRestart({
      tier: 'new',
      project: PROJECT,
      docs: DOCS,
      path: PROJECT.path,
      createSession: async () => { throw new Error('create failed: transport') },
      sendPrompt,
    })
    expect(outcome).toEqual({ kind: 'create-failed', error: 'Error: create failed: transport' })
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('发送失败时新会话号仍交回来，错误原文保留', async () => {
    const created = SessionId('s-new')
    const outcome = await runIntakeRestart({
      tier: 'new',
      project: PROJECT,
      docs: DOCS,
      path: PROJECT.path,
      createSession: async () => created,
      sendPrompt: async () => { throw new Error('host refused') },
    })
    expect(outcome.kind).toBe('send-failed')
    if (outcome.kind !== 'send-failed') return
    expect(outcome.sessionId).toBe(created)
    expect(outcome.error).toBe('Error: host refused')
    expect(outcome.prompt.startsWith(INTAKE_PROMPT_HEAD)).toBe(true)
  })
})
