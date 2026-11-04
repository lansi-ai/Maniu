/**
 * 失败分类与等待上限的纯测：超时与被拒绝必须是两条不同的路。
 */
import { describe, expect, it } from 'vitest'

import { WorkspaceOpenTimeoutError, describeOpenFailure, isOpenTimeout, withOpenDeadline } from '../src/client/open-failure.ts'

describe('打开仓库的等待上限', () => {
  it('在限内完成时原样返回结果', async () => {
    await expect(withOpenDeadline('workspace/create', Promise.resolve(7), 1000)).resolves.toBe(7)
  })

  it('超过上限抛超时错误，并带上卡住的步骤', async () => {
    await expect(withOpenDeadline('workspace/create', new Promise(() => {}), 10)).rejects.toBeInstanceOf(WorkspaceOpenTimeoutError)
    await expect(withOpenDeadline('session/create', new Promise(() => {}), 10)).rejects.toThrow(/session\/create/)
  })

  it('超时判定与细节提取分开两类失败', () => {
    const timeout = new WorkspaceOpenTimeoutError('workspace/create', 15000)
    expect(isOpenTimeout(timeout)).toBe(true)
    expect(isOpenTimeout(new Error('x'))).toBe(false)
    expect(describeOpenFailure(timeout)).toEqual({ key: 'shell.openTimeout', detail: 'workspace/create' })
    expect(describeOpenFailure(new Error('路径不存在'))).toEqual({ key: 'shell.openRejected', detail: '路径不存在' })
    expect(describeOpenFailure('字符串失败')).toEqual({ key: 'shell.openRejected', detail: '字符串失败' })
  })
})
