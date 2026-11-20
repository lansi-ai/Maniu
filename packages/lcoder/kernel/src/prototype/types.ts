/** 原型 Remote 的线类型；只含纯 JSON 数据。 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'


/** 原型调用的结构化结果；业务失败走 `ok: false`，不抛到界面。 */
export type PrototypeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 网页 URL 预取的输入。 */
export interface PrototypePrefetchInput {
  readonly url: string
}

/** 参考图上传的输入；字节是规范 base64。 */
export interface PrototypeUploadInput {
  readonly sessionId: SessionId
  readonly requirementId: string
  readonly name: string
  readonly data: string
}

/** 清除原型的输入。 */
export interface PrototypeClearInput {
  readonly sessionId: SessionId
  readonly requirementId: string
}

/** 采纳原型的输入。 */
export interface PrototypeAdoptInput {
  readonly sessionId: SessionId
  readonly requirementId: string
}

/** 参考图上传成功的回执。 */
export interface PrototypeRefValue {
  readonly path: string
  readonly bytes: number
}

/** 只表示动作成功。 */
export interface PrototypeOkValue {
  readonly ok: true
}
