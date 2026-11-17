/** 立项会话的固定标题：创建成功后立刻走现有 rename 通道落下。 */

import type { LcoderApi } from '../contract.ts'

/**
 * 把立项会话的标题改成给定文案。
 * @param call - 宿主一元 Remote 调用。
 * @param sessionId - 刚创建的会话。
 * @param title - 已经本地化的标题。
 * @returns 成功为 null；失败为可读的 `code: message`，由调用方提示而不阻断进入对话。
 */
export async function titleIntakeSession(
  call: LcoderApi['call'],
  sessionId: string,
  title: string,
): Promise<string | null> {
  const answer = await call('session', 'rename', { request: { sessionId, title } })
  return answer.ok ? null : `${answer.error.code}: ${answer.error.message}`
}
