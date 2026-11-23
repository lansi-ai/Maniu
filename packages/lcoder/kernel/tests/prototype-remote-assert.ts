/** 原型 Remote 的失败断言：一次调用必须抛出带指定 code 的 `RemoteError`。 */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { expect } from 'vitest'

import type { PrototypeErrorCode } from '../src/prototype/summary.js'

/**
 * 断言一次 Remote 调用以指定 code 的 RemoteError 失败。
 * @param run - 待观察的 Remote 调用。
 * @param code - 期望透传过 wire 的错误码。
 * @returns 抛出的 RemoteError。
 */
export async function rejectsWithCode(run: Promise<unknown>, code: PrototypeErrorCode): Promise<RemoteError> {
  try {
    await run
  } catch (thrown: unknown) {
    expect(thrown).toBeInstanceOf(RemoteError)
    if (!(thrown instanceof RemoteError)) throw new Error(`期望 RemoteError，实际是 ${String(thrown)}`)
    expect(thrown.code).toBe(code)
    return thrown
  }
  throw new Error(`本应以 ${code} 失败，实际调用成功了`)
}
