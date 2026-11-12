/**
 * 立项咒语的纯模板测：文档来源声明与缺失两种写法都要有下一步。
 *
 * 外壳按钮的行为证据走桌面端启动（`lcoder/RUN.md`）；这里钉住进模型的那段文本，
 * 因为它是模型可见输入，措辞变化会直接改变 agent 的调研路径。
 */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createDeveloperMessage, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { LlmAttemptId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { CompactionId } from '@deepseek-ai/dsh-compaction'

import { buildIntakePrompt, buildOnboardingPrompt, buildShellPrompt, messagesFromEntries, TASK_FLOW_MENTION_PREFIX } from '../src/client/shell/shell-data.ts'
import type { ShellOnboardingDocs, ShellTask } from '../src/client/shell/shell-data.ts'

const PROJECT = { name: 'Demo 商城', path: 'E:/Projects/demo', branch: 'main' }

const TASK: ShellTask = {
  id: 'T-01',
  title: '订单导出',
  description: '',
  attachments: [],
  state: 'drafting',
  grade: 'B',
  rules: ['R-01'],
  evidence: ['typecheck'],
  surface: 'file_read、task_read',
  paths: [],
  irreversible: [],
}

describe('咒语的仓内发送与仓外复制', () => {
  it('三段咒语正文都不带技能引用——本会话的模型没有名为 task-flow 的技能可解析', () => {
    expect(buildShellPrompt(PROJECT, TASK)).not.toContain('@task-flow')
    expect(buildIntakePrompt(PROJECT)).not.toContain('@task-flow')
    expect(buildOnboardingPrompt(PROJECT, { product: '', architecture: '', tests: '' })).not.toContain('@task-flow')
  })

  it('任务咒语首行是任务编号与标题，补上前缀后才是仓外开工的写法', () => {
    const sent = buildShellPrompt(PROJECT, TASK)
    expect(sent.split('\n')[0]).toBe('T-01：订单导出')
    expect(`${TASK_FLOW_MENTION_PREFIX}${sent}`.startsWith('T-01')).toBe(false)
    expect(`${TASK_FLOW_MENTION_PREFIX}${sent}`.startsWith('@task-flow T-01：订单导出')).toBe(true)
  })

  it('调度结论写进咒语：前置按住与建议会话都让模型看得见', () => {
    const routed = buildShellPrompt(
      PROJECT,
      { ...TASK, dependsOn: ['T-00'] },
      { blockedBy: true, sessionId: 'session-a', signals: ['同一方案 P-01'] },
    )

    expect(routed).toContain('- 前置：T-00（未收口，先按住）')
    expect(routed).toContain('- 调度：接着会话 session-a（同一方案 P-01）')
    expect(buildShellPrompt(PROJECT, TASK)).not.toContain('- 调度：')
  })
})

describe('已有资料档的立项咒语', () => {
  it('声明了交付文档时逐条给出路径，并要求先读资料再问缺口', () => {
    const docs: ShellOnboardingDocs = { product: 'docs/prd-and-design.md', architecture: 'docs/architecture.md', tests: '' }
    const text = buildOnboardingPrompt(PROJECT, docs)

    expect(text).toContain('已有资料立项：Demo 商城（E:/Projects/demo，main）')
    expect(text).toContain('- 产品文档：docs/prd-and-design.md')
    expect(text).toContain('- 架构文档：docs/architecture.md')
    expect(text).not.toContain('测试用例：')
    expect(text).toContain('先列出「从仓库已确认的事实」')
    expect(text).toContain('只问文档回答不了的')
    expect(text).toContain('用 ask_user_question 把 file_list 实际列出的候选做成选项')
  })

  it('没有声明交付文档时要求先自己找，再向用户确认，不编造路径', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: '', architecture: '', tests: '' })

    expect(text).toContain('先用 file_list 看仓库里有没有文档，再向用户确认产品文档在哪')
    expect(text).not.toContain('产品文档：')
    expect(text).not.toContain('架构文档：')
    expect(text).not.toContain('测试用例：')
  })

  it('两档共用同一份纪律：四分法、确认后才落盘、边界写死不签不推不改不改跑不提交', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: 'docs/prd-and-design.md', architecture: '', tests: '' })

    for (const label of ['【已确认】', '【AI 建议】', '【待确认】', '【暂不开发】']) expect(text).toContain(label)
    expect(text).toContain('等用户回复「确认需求」')
    expect(text).toContain('不签契约、不推进任务状态、不改业务代码、不跑命令、不提交、不推送、不部署')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
  })
})

describe('全新项目档的立项咒语', () => {
  const text = buildIntakePrompt(PROJECT)

  it('先看清空仓库，再按 7 问访谈，一次一问', () => {
    expect(text).toContain('全新项目立项：Demo 商城（E:/Projects/demo，main）')
    expect(text).toContain('用 file_list 看根目录与 .spec 是否存在')
    expect(text).toContain('缺的项标「尚未提供」')
    expect(text).toContain('一次只问一个问题，等到回答再问下一个')
    expect(text).toContain('用 ask_user_question 弹出选择框')
    expect(text).toContain('「其他（我自己说）」')
    expect(text).toContain('总数最多 7 问')
    for (let n = 1; n <= 7; n++) expect(text).toContain(`${n}. `)
    expect(text).not.toContain('8. ')
  })

  it('按 project_draft、spec_draft、task_draft 的顺序落盘，并给清三个必填的填法', () => {
    const project = text.indexOf('project_draft 登记 .spec/project.yaml')
    const rule = text.indexOf('spec_draft 登记一条 status 为 draft')
    const task = text.indexOf('task_draft 立一条 drafting 任务')
    expect(project).toBeGreaterThanOrEqual(0)
    expect(project).toBeLessThan(rule)
    expect(rule).toBeLessThan(task)
    expect(text).toContain('没有远端时填本仓库目录与 main')
    expect(text).toContain('文件已存在就只回读现值，不覆盖')
    expect(text).toContain('不改已有条目')
    expect(text).toContain('rules 只能填第 2 步真正落盘成功的编号')
    expect(text).toContain('回读核对')
  })

  it('出处允许引 project.yaml 或用户原话，空项目不再被判成死路', () => {
    expect(text).toContain('出处可以是 .spec/project.yaml 的字段')
    expect(text).toContain('来自第 N 问')
    expect(text).toContain('没有仓库内文档时不要编造路径')
  })

  it('需求基线有落盘出口，缺工具就如实说未写入', () => {
    expect(text).toContain('若你的工具面里有 proposal_draft')
    expect(text).toContain('尚未写入仓库')
    expect(text).toContain('不编造架构文档、测试脚本、技术选型或审批意见')
  })

  it('列的是立项面的工具，不承诺改代码与签字', () => {
    expect(text).toContain('project_draft')
    expect(text).toContain('spec_draft')
    expect(text).toContain('task_draft')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
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

/** 一条 tool/result 事件：按 call id 回填工具条目的成败（与可选的结果文本）。 */
function toolResultEntry(
  seq: number,
  callId: string,
  ok: boolean,
  turn = 1,
  step = 1,
  text = ok ? 'ok' : 'boom',
): SessionEventLikeEntry {
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
          content: [{ type: 'text', text }],
          source: { kind: 'tool', callId: id },
          toolCallId: id,
          ...(ok ? {} : { isError: true }),
        }),
      },
    },
  }
}

/** 一条 compaction/summary 事件：压缩完成后应在对话里留下一条可见标记。 */
function compactionEntry(seq: number, tokens: number, items: number, id = 'c-1'): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'compaction/summary',
      seq: SessionSeq(seq),
      time: 1,
      data: {
        compactionId: CompactionId(id),
        summary: [{ type: 'text', text: '摘要' }],
        shadowedRange: { start: SessionSeq(0), end: SessionSeq(seq - 1) },
        shadowedSeqs: Array.from({ length: items }, (_, index) => SessionSeq(index)),
        shadowedTokenCount: tokens,
        provider: 'test',
        model: 'test',
        rawOutput: [],
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

  it('两档立项咒语带 hidden 标记——正文不画，但入口仍按用户消息计数', () => {
    const intake = buildIntakePrompt(PROJECT)
    const onboarding = buildOnboardingPrompt(PROJECT, { product: '', architecture: '', tests: '' })
    const messages = messagesFromEntries([userEntry(0, intake), userEntry(1, onboarding)])

    expect(messages).toEqual([
      { role: 'user', text: intake, hidden: true },
      { role: 'user', text: onboarding, hidden: true },
    ])
  })

  it('前缀不完全相同就按用户发言处理，不误判成内置咒语', () => {
    const messages = messagesFromEntries([userEntry(0, '全新项目立项 这是我自己打的')])

    expect(messages).toEqual([{ role: 'user', text: '全新项目立项 这是我自己打的' }])
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

  it('立项问答工具留存结果文本，其余工具只记成败', () => {
    const messages = messagesFromEntries([
      assistantEntry(0, [
        { type: 'tool-call', id: ToolCallId('q1'), name: 'ask_user_question', arguments: '{"questions":[{"id":"q1"}]}' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'file_read', arguments: '{"path":"a.md"}' },
      ], 1, 1),
      toolResultEntry(1, 'q1', true, 1, 1, '{"answers":[{"id":"q1","selected":["A"]}]}'),
      toolResultEntry(2, 'c1', true, 1, 1, '整篇文件正文'),
      turnEndEntry(3, 1),
    ])

    const process = messages[0]
    expect(process?.role).toBe('process')
    if (process?.role !== 'process') throw new Error('expected a process segment')
    expect(process.items[0]).toEqual({
      kind: 'tool',
      callId: 'q1',
      name: 'ask_user_question',
      args: '{"questions":[{"id":"q1"}]}',
      ok: true,
      result: '{"answers":[{"id":"q1","selected":["A"]}]}',
    })
    expect(process.items[1]).toEqual({
      kind: 'tool',
      callId: 'c1',
      name: 'file_read',
      args: '{"path":"a.md"}',
      ok: true,
    })
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

  it('压缩事件在对话里留下可见标记，不静默换掉上下文', () => {
    const messages = messagesFromEntries([
      userEntry(0, '继续'),
      compactionEntry(1, 1234, 3),
      turnEndEntry(2, 1),
    ])

    expect(messages).toEqual([
      { role: 'user', text: '继续' },
      { role: 'compaction', items: 3, tokens: 1234 },
    ])
  })

  it('纯空白与空内容不产生消息行', () => {
    expect(messagesFromEntries([
      userEntry(0, '   '),
      developerEntry(1, ''),
      assistantEntry(2, []),
    ])).toEqual([])
  })
})

/** 一条客户端瞬态流式帧：不在 durable 序列里，跳过它就会等最终消息一次性出现。 */
function liveChunk(seq: number, text: string, kind: 'text-delta' | 'reasoning-delta' = 'text-delta'): SessionEventLikeEntry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq,
      time: 1,
      data: {
        attemptId: LlmAttemptId('attempt-1'),
        turn: 1,
        step: 1,
        chunk: { type: kind, index: 0, text },
      },
    },
  }
}

describe('流式增量', () => {
  it('最终消息到达前就把增量拼成一条答复', () => {
    const messages = messagesFromEntries([liveChunk(1, '你'), liveChunk(2, '好')])
    expect(messages).toEqual([{ role: 'assistant', text: '你好' }])
  })

  it('最终消息到达后以 durable 为准，不再重复叠加', () => {
    const messages = messagesFromEntries([
      liveChunk(1, '半句'),
      assistantEntry(10, [{ type: 'text', text: '整段答复' }]),
      turnEndEntry(11),
    ])
    const assistant = messages.filter(message => message.role === 'assistant')
    expect(assistant).toEqual([{ role: 'assistant', text: '整段答复' }])
  })

  it('思考增量进过程段，正文另起一条', () => {
    const messages = messagesFromEntries([liveChunk(1, '想一下', 'reasoning-delta'), liveChunk(2, '答案')])
    expect(messages[0]).toMatchObject({ role: 'process', items: [{ kind: 'reasoning', text: '想一下' }] })
    expect(messages[1]).toEqual({ role: 'assistant', text: '答案' })
  })
})
