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
import { PendingInteractionCard } from '../src/client/shell/ChatPanel.tsx'
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
