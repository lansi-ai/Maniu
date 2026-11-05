// @vitest-environment jsdom
/**
 * 审批/提问弹窗的渲染与回传：卡片自己只做选择收集，
 * 结算仍交给上游对象提供的 answer()。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh } from '../src/client/locales.ts'
import { ChatTranscript, PendingInteractionCard } from '../src/client/shell/ChatPanel.tsx'
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import type { ShellApprovalPending, ShellQuestionPending } from '../src/client/shell/pending.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

describe('待处理交互弹窗', () => {
  it('审批卡显示工具名，点允许一次回传 allowed-once', async () => {
    const answer = vi.fn(() => Promise.resolve())
    const pending: ShellApprovalPending = {
      key: 'approval:1',
      kind: 'approval',
      sessionId: SessionId('s-1'),
      toolName: 'file_edit',
      reason: '写配置',
      answerable: true,
      answer,
    }

    render(<PendingInteractionCard pending={pending} t={t} />)

    expect(screen.getByText('file_edit')).toBeTruthy()
    expect(screen.getByText('写配置')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.allowOnce'] }))
    await waitFor(() => { expect(answer).toHaveBeenCalledWith('allowed-once') })
  })

  it('提问卡把选项与自定义回答折成整批回答再提交', async () => {
    const answer = vi.fn(() => Promise.resolve())
    const pending: ShellQuestionPending = {
      key: 'question:1',
      kind: 'question',
      sessionId: SessionId('s-1'),
      questions: [{
        id: 'q1',
        question: '走哪条路线？',
        options: [{ label: '复用上游' }, { label: '自造渲染' }],
      }],
      answer,
    }

    render(<PendingInteractionCard pending={pending} t={t} />)

    expect(screen.getByText('走哪条路线？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '自造渲染' }))
    fireEvent.change(screen.getByPlaceholderText(zh['shell.customAnswer']), { target: { value: '补一句说明' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.submitAnswer'] }))
    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith({
        answers: [{ id: 'q1', selected: ['自造渲染'], custom: '补一句说明' }],
      })
    })
  })
})

describe('正文与折叠', () => {
  it('真实用户消息照常展开，注入上下文默认折叠且切换后可展开', () => {
    const messages: readonly ShellMessage[] = [
      { role: 'user', text: '真实发言' },
      { role: 'context', text: 'Current runtime context 很长的一段注入正文', label: 'runtime-context' },
    ]

    render(<ChatTranscript messages={messages} running={false} t={t} />)

    expect(screen.getByText('真实发言')).toBeTruthy()
    expect(screen.queryByText(/Current runtime context/)).toBeNull()
    const row = screen.getByRole('button', { name: /上下文注入/ })
    fireEvent.click(row)
    expect(screen.getByText(/Current runtime context/)).toBeTruthy()
  })

  it('思考块默认折叠，只露首行摘要，展开后看到完整正文', () => {
    const messages: readonly ShellMessage[] = [{
      role: 'assistant',
      blocks: [
        { kind: 'reasoning', text: '先想清楚\n再写下来' },
        { kind: 'text', text: '## 结论' },
      ],
    }]

    render(<ChatTranscript messages={messages} running={false} t={t} />)

    expect(screen.queryByText(/再写下来/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /思考过程/ }))
    expect(screen.getByText(/再写下来/)).toBeTruthy()
  })
})

describe('提问卡的多题、多选与计划评审', () => {
  it('多题逐题收集，多选保留全部勾选项', async () => {
    const answer = vi.fn(() => Promise.resolve())
    const pending: ShellQuestionPending = {
      key: 'question:2',
      kind: 'question',
      sessionId: SessionId('s-1'),
      questions: [
        { id: 'q1', question: '走哪条路线？', options: [{ label: '复用上游' }, { label: '自造渲染' }] },
        { id: 'q2', question: '要哪些能力？', multiSelect: true, options: [{ label: 'markdown' }, { label: '折叠' }] },
      ],
      answer,
    }

    render(<PendingInteractionCard pending={pending} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '自造渲染' }))
    fireEvent.click(screen.getByRole('button', { name: 'markdown' }))
    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.submitAnswer'] }))

    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith({
        answers: [
          { id: 'q1', selected: ['自造渲染'] },
          { id: 'q2', selected: ['markdown', '折叠'] },
        ],
      })
    })
  })

  it('plan-review 渲染计划正文，批准按钮回传批准选项', async () => {
    const answer = vi.fn(() => Promise.resolve())
    const pending: ShellQuestionPending = {
      key: 'plan-review:1',
      kind: 'plan-review',
      sessionId: SessionId('s-1'),
      questions: [{
        id: 'plan-1',
        question: '按这份计划改吗？',
        detail: '## 计划\n\n- 第一项\n- 第二项',
        options: [{ label: '批准' }, { label: '再改改' }],
      }],
      answer,
    }

    render(<PendingInteractionCard pending={pending} t={t} />)

    expect(screen.getByText('按这份计划改吗？')).toBeTruthy()
    expect(screen.getByText('第一项')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.submitAnswer'] }))

    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith({ answers: [{ id: 'plan-1', selected: ['批准'] }] })
    })
  })
})
