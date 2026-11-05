/**
 * 立项咒语的纯模板测：文档来源声明与缺失两种写法都要有下一步。
 *
 * 外壳按钮的行为证据走桌面端启动（`lcoder/RUN.md`）；这里钉住进模型的那段文本，
 * 因为它是模型可见输入，措辞变化会直接改变 agent 的调研路径。
 */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createDeveloperMessage, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

import { buildIntakePrompt, buildOnboardingPrompt, messagesFromEntries } from '../src/client/shell/shell-data.ts'
import type { ShellOnboardingDocs } from '../src/client/shell/shell-data.ts'

const PROJECT = { name: 'Demo 商城', path: 'E:/Projects/demo', branch: 'main' }

describe('立项咒语', () => {
  it('声明了交付文档时逐条给出路径，并要求先读再立项', () => {
    const docs: ShellOnboardingDocs = { product: 'docs/prd-and-design.md', architecture: 'docs/architecture.md', tests: '' }
    const text = buildOnboardingPrompt(PROJECT, docs)

    expect(text).toContain('@task-flow 立项分析：Demo 商城（E:/Projects/demo）')
    expect(text).toContain('- 规格根：E:/Projects/demo/.spec')
    expect(text).toContain('- 项目：Demo 商城（E:/Projects/demo，main）')
    expect(text).toContain('- 产品文档：docs/prd-and-design.md')
    expect(text).toContain('- 架构文档：docs/architecture.md')
    expect(text).not.toContain('测试用例：')
    expect(text).toContain('先 task_read 确认空看板，再 file_read 逐个读上面的文档')
    expect(text).toContain('每个任务调一次 task_draft，状态固定 drafting')
    expect(text).toContain('rules 只填 spec_query 查得到的编号')
  })

  it('没有声明交付文档时要求先问用户，不编造路径', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: '', architecture: '', tests: '' })

    expect(text).toContain('先向用户确认产品文档在哪')
    expect(text).not.toContain('产品文档：')
    expect(text).not.toContain('架构文档：')
    expect(text).not.toContain('测试用例：')
  })

  it('不承诺模型能改代码或自己签契约', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: 'docs/prd-and-design.md', architecture: '', tests: '' })

    expect(text).toContain('不要改业务代码，不要给自己签契约')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
  })
})

describe('空文件夹的项目引导咒语', () => {
  const text = buildIntakePrompt(PROJECT)

  it('从项目身份问起，一次一问且硬上限 7 问', () => {
    expect(text).toContain('@task-flow 项目引导：Demo 商城（E:/Projects/demo）')
    expect(text).toContain('E:/Projects/demo/.spec 还不存在')
    expect(text).toContain('一次只问一问，拿到回答再问下一问，总数不超过 7 问')
    for (let n = 1; n <= 7; n++) expect(text).toContain(`${n}. `)
    expect(text).not.toContain('8. ')
  })

  it('按 project_draft、spec_draft、task_draft 的顺序落盘', () => {
    const project = text.indexOf('project_draft 登记 .spec/project.yaml')
    const rule = text.indexOf('spec_draft 登记一条 status 为 draft')
    const task = text.indexOf('task_draft 立一条 drafting 任务')
    expect(project).toBeGreaterThanOrEqual(0)
    expect(project).toBeLessThan(rule)
    expect(rule).toBeLessThan(task)
    expect(text).toContain('文件已存在就只回读现值，不覆盖')
    expect(text).toContain('绝不改已登记的条目')
  })

  it('列的是立项面的工具，不承诺改代码与签字', () => {
    expect(text).toContain('file_read、project_draft、spec_query、spec_draft、task_read、task_draft')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
    expect(text).toContain('不起草契约')
    expect(text).toContain('绝不给自己签字')
    expect(text).toContain('不要留半截文件')
  })
})

/** 一条 user/message 事件；source.kind 决定它是人说的话还是注入上下文。 */
function userEntry(seq: number, text: string, kind: 'user' | 'system-prompt' = 'user'): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq: SessionSeq(seq),
      time: 1,
      surfaceOp: 'append',
      data: createUserMessage({
        content: [{ type: 'text', text }],
        source: kind === 'user' ? { kind: 'user' as const } : { kind: 'system-prompt' as const },
      }),
    },
  }
}

/** 一条 developer/message 事件：工具面增删的注入行。 */
function developerEntry(seq: number, text: string): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'developer/message',
      seq: SessionSeq(seq),
      time: 1,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: createDeveloperMessage({ content: [{ type: 'text', text }], source: { kind: 'system-prompt' } }),
      },
    },
  }
}

/** 一条 assistant/message 事件；内容块按 text / reasoning / tool-call 交给浮层拆分。 */
function assistantEntry(
  seq: number,
  content: readonly ContentBlock[],
  turn = 1,
  step = 1,
): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq: SessionSeq(seq),
      time: 1,
      surfaceOp: 'append',
      data: {
        turn,
        step,
        message: createAssistantMessage({ content, source: { provider: 'test', model: 'test' } }),
        stream: [],
      },
    },
  }
}

/** 一条 tool/result 事件：按 call id 回填工具条目的成败。 */
function toolResultEntry(seq: number, callId: string, ok: boolean, turn = 1, step = 1): SessionEventLikeEntry {
  const id = ToolCallId(callId)
  return {
    type: 'event',
    event: {
      type: 'tool/result',
      seq: SessionSeq(seq),
      time: 1,
      surfaceOp: 'append',
      data: {
        turn,
        step,
        message: createMessage({
          role: 'tool',
          content: [{ type: 'text', text: ok ? 'ok' : 'boom' }],
          source: { kind: 'tool', callId: id },
          toolCallId: id,
          ...(ok ? {} : { isError: true }),
        }),
      },
    },
  }
}

/** 一条 turn/end 事件：回合收口时把过程组与答复一起落到消息列表。 */
function turnEndEntry(seq: number, turn = 1): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'turn/end',
      seq: SessionSeq(seq),
      time: 1,
      data: { turn, reason: { kind: 'completed' } },
    },
  }
}

describe('会话消息投影', () => {
  it('只把 source.kind 为 user 的 user/message 画成用户消息', () => {
    const messages = messagesFromEntries([
      userEntry(0, '真实发言'),
      userEntry(1, 'Current runtime context…', 'system-prompt'),
    ])

    expect(messages).toEqual([
      { role: 'user', text: '真实发言' },
      { role: 'context', text: 'Current runtime context…', label: 'system-prompt' },
    ])
  })

  it('developer/message 归入可折叠的上下文，不画成用户消息', () => {
    const messages = messagesFromEntries([developerEntry(0, 'tool changes')])

    expect(messages).toEqual([{ role: 'context', text: 'tool changes', label: 'developer' }])
  })

  it('同一回合的思考与工具收进一个过程组，正文另起答复', () => {
    const messages = messagesFromEntries([
      assistantEntry(0, [
        { type: 'reasoning', text: '先读任务' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'task_read', arguments: '{"task_id":"T-02"}' },
        { type: 'tool-call', id: ToolCallId('c2'), name: 'working_directory', arguments: '{}' },
        { type: 'tool-call', id: ToolCallId('c3'), name: 'spec_query', arguments: '{}' },
      ], 1, 1),
      assistantEntry(3, [
        { type: 'reasoning', text: '再读规格' },
        { type: 'text', text: '## 结论' },
        { type: 'tool-removal', toolName: 'demo' },
        { type: 'text', text: '正文' },
      ], 1, 2),
      toolResultEntry(4, 'c1', true),
      toolResultEntry(5, 'c2', false),
      turnEndEntry(6, 1),
    ])

    expect(messages).toEqual([
      {
        role: 'process',
        items: [
          { kind: 'reasoning', text: '先读任务' },
          { kind: 'tool', callId: 'c1', name: 'task_read', args: '{"task_id":"T-02"}', ok: true },
          { kind: 'tool', callId: 'c2', name: 'working_directory', args: '{}', ok: false },
          { kind: 'tool', callId: 'c3', name: 'spec_query', args: '{}', ok: undefined },
          { kind: 'reasoning', text: '再读规格' },
        ],
      },
      { role: 'assistant', text: '## 结论\n\n正文' },
    ])
  })

  it('两个回合各成一组，用户消息把前后回合分开', () => {
    const messages = messagesFromEntries([
      userEntry(0, '开始'),
      assistantEntry(1, [
        { type: 'reasoning', text: '先想' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'cmd_run', arguments: '{"command":"ls"}' },
      ], 1, 1),
      toolResultEntry(2, 'c1', true),
      turnEndEntry(3, 1),
      userEntry(4, '继续'),
      assistantEntry(5, [{ type: 'text', text: '答复' }], 2, 1),
      turnEndEntry(6, 2),
    ])

    expect(messages.map(message => message.role)).toEqual(['user', 'process', 'user', 'assistant'])
    expect(messages[1]).toEqual({
      role: 'process',
      items: [
        { kind: 'reasoning', text: '先想' },
        { kind: 'tool', callId: 'c1', name: 'cmd_run', args: '{"command":"ls"}', ok: true },
      ],
    })
  })

  it('纯空白与空内容不产生消息行', () => {
    expect(messagesFromEntries([
      userEntry(0, '   '),
      developerEntry(1, ''),
      assistantEntry(2, []),
    ])).toEqual([])
  })
})
