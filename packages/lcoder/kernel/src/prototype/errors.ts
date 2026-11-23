/**
 * 原型 Remote 的失败词汇：把宿主侧的 `PrototypeError` 折成 typert 的
 * `RemoteError`，让 `PROTOTYPE/*` 码原样过 wire。
 *
 * typert 的 Gateway 只对 `RemoteError` 保留 code 与 message；其它抛出物一律
 * 折成 `gateway/internal`。所以每个 Remote 方法的失败都必须先经过这里，
 * 界面才能按 `answer.error.code` 分支。
 */
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

import { PrototypeError } from './summary.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 会话不存在，或它没有工作区，解析不出规格根。 */
    'PROTOTYPE/NO_WORKSPACE': Record<string, never>
    /** 这条需求还没有暂存原型，无法提交。 */
    'PROTOTYPE/NO_STAGED': Record<string, never>
    /** 历史列表里的快照编号在磁盘上不存在。 */
    'PROTOTYPE/SNAPSHOT_NOT_FOUND': Record<string, never>
    /** 需求正文的磁盘基线已被改动，受控回写被拒。 */
    'PROTOTYPE/REQUIREMENT_BASELINE_CONFLICT': Record<string, never>
    /** 网页地址不是可抓取的 http/https 公网地址。 */
    'PROTOTYPE/INVALID_URL': Record<string, never>
    /** 宿主没有启用网页抓取服务。 */
    'PROTOTYPE/WEB_UNAVAILABLE': Record<string, never>
    /** 抓取结果不是 HTML，没有样式可抽取。 */
    'PROTOTYPE/UNSUPPORTED_CONTENT': Record<string, never>
    /** 未分类的原型失败；`message` 带原始原因。 */
    'PROTOTYPE/FAILED': Record<string, never>
  }
}

/**
 * 把一个原型失败折成 typert 的 RemoteError；已是 RemoteError 的原样返回。
 *
 * 原型失败的 details 统一为空对象：可分支的信息在 code 上，可读的原因在
 * message 上，这里没有额外字段可带。
 * @param error - 抛出物，来自 Remote 方法体内任意一步。
 * @returns 带稳定 code 的 RemoteError。
 */
export function toRemoteError(error: unknown): RemoteError {
  const remote = remoteErrorOf(error)
  if (remote !== undefined) return remote
  if (error instanceof PrototypeError) return new RemoteError(error.code, error.message, {})
  return new RemoteError(
    'PROTOTYPE/FAILED',
    error instanceof Error ? error.message : String(error),
    {},
    { cause: error },
  )
}
