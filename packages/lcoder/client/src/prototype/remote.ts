/** 原型 Remote 的浏览器侧面：只走主进程的窄 IPC，不让渲染端直连网络或写磁盘。 */

import type { RemoteResult } from '../contract.ts'

/** 一元调用；测试可注入假传输。 */
export type UnaryCall = (namespace: string, method: string, args: object) => Promise<RemoteResult>

/** 宿主回传的样式摘要。 */
export interface PrototypeStyleSummary {
  readonly url: string
  readonly title: string
  readonly headings: readonly string[]
  readonly text: string
  readonly colors: readonly string[]
  readonly font: string
  readonly layout: string
  readonly buttonStyle: string
  readonly truncated: boolean
}

/** 宿主回传的原型登记。 */
export interface PrototypeRegistration {
  readonly path: string
  readonly generatedAt: string
  readonly referenceSummary?: string
  readonly references: readonly string[]
}

/** 参考图上传回执。 */
export interface PrototypeRefReceipt {
  readonly path: string
  readonly bytes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap(entry => typeof entry === 'string' ? [entry] : []) : []
}

/**
 * 从 Remote 的 `ok` 结果里取值；失败抛带 code 的错误，界面按 code 分支。
 * @param answer - 一元调用结果。
 * @param fallback - 回执缺字段时的提示。
 * @returns 成功值。
 */
function unwrap<T>(answer: RemoteResult, fallback: string): T {
  if (!answer.ok) {
    const error = new Error(answer.error.message)
    error.name = answer.error.code
    throw error
  }
  if (!isRecord(answer.value)) throw new Error(fallback)
  return answer.value as T
}

/**
 * 抓一个网页 URL 的样式摘要；只回结构化纯文本，不回原始 HTML。
 * @param url - 网页地址。
 * @param call - 一元调用；默认走 preload。
 * @returns 样式摘要。
 */
export async function prefetchStyle(
  url: string,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<PrototypeStyleSummary> {
  const answer = await call('prototype', 'prefetch', { url })
  const value = unwrap<Record<string, unknown>>(answer, '样式摘要回执缺少字段')
  const urlText = text(value.url)
  const title = text(value.title)
  const bodyText = text(value.text)
  if (urlText === undefined || title === undefined || bodyText === undefined) {
    throw new Error('样式摘要回执缺少字段')
  }
  return {
    url: urlText,
    title,
    headings: stringList(value.headings),
    text: bodyText,
    colors: stringList(value.colors),
    font: text(value.font) ?? '',
    layout: text(value.layout) ?? '',
    buttonStyle: text(value.buttonStyle) ?? '',
    truncated: value.truncated === true,
  }
}

/**
 * 上传一张参考图到规格库的原型 refs 目录。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号。
 * @param name - 文件名。
 * @param base64 - 规范 base64 字节。
 * @param call - 一元调用。
 * @returns 落盘回执。
 */
export async function uploadPrototypeRef(
  sessionId: string,
  requirementId: string,
  name: string,
  base64: string,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<PrototypeRefReceipt> {
  const answer = await call('prototype', 'uploadRef', { sessionId, requirementId, name, data: base64 })
  const value = unwrap<Record<string, unknown>>(answer, '上传回执缺少字段')
  const path = text(value.path)
  if (path === undefined) throw new Error('上传回执缺少 path')
  return { path, bytes: typeof value.bytes === 'number' ? value.bytes : 0 }
}

/**
 * 清除一条需求的原型；二次确认由界面负责。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号。
 * @param call - 一元调用。
 */
export async function clearPrototype(
  sessionId: string,
  requirementId: string,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<void> {
  const answer = await call('prototype', 'clear', { sessionId, requirementId })
  unwrap<Record<string, unknown>>(answer, '清除回执缺少字段')
}

/**
 * 采纳原型：在需求的 prototype 登记上写采纳时刻。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号。
 * @param call - 一元调用。
 */
export async function adoptPrototype(
  sessionId: string,
  requirementId: string,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<void> {
  const answer = await call('prototype', 'adopt', { sessionId, requirementId })
  unwrap<Record<string, unknown>>(answer, '采纳回执缺少字段')
}

/**
 * 读取已落盘的原型 HTML 用于沙箱预览；走宿主文件通道。
 * @param sessionId - 作用域会话号。
 * @param registration - 需求上的原型登记。
 * @param call - 一元调用。
 * @returns HTML 原文。
 */
export async function readPrototypeHtml(
  sessionId: string,
  registration: PrototypeRegistration,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<string> {
  const relative = registration.path.replaceAll('\\', '/').replace(/^\.?\//, '')
  const answer = await call('workspaceFiles', 'read', {
    workspaceFileScopeId: sessionId,
    path: `.spec/${relative}`,
    range: { offset: 1, limit: 20000 },
  })
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
  if (!isRecord(answer.value) || typeof answer.value.text !== 'string') throw new Error('原型 HTML 回执缺少正文')
  return answer.value.text
}
