/** 立项会话标题：改名走现有 session rename 通道，失败只给可读原因。 */
import { describe, expect, it, vi } from 'vitest'
import type { LcoderApi } from '../src/contract.ts'
import { titleIntakeSession } from '../src/intake/session-title.ts'

type Call = LcoderApi['call']

describe('titleIntakeSession', () => {
  it('把标题交给 session rename', async () => {
    const call = vi.fn<Call>(async () => ({ ok: true, value: null }))
    await expect(titleIntakeSession(call, 'session-1', '需求分析')).resolves.toBeNull()
    expect(call).toHaveBeenCalledWith('session', 'rename', {
      request: { sessionId: 'session-1', title: '需求分析' },
    })
  })

  it('失败时给出可读原因而不抛出', async () => {
    const call = vi.fn<Call>(async () => ({
      ok: false,
      error: { code: 'not_found', message: '会话不存在' },
    }))
    await expect(titleIntakeSession(call, 'session-2', 'Requirement analysis'))
      .resolves.toBe('not_found: 会话不存在')
  })
})
