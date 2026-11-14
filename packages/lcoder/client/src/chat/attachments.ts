/** 附件的浏览器侧读写：图片读成 base64、文件上传、已提交图片取回预览。 */

import type { ChatUploadResult } from './composer.ts'
import type { ChatImageAttachment } from '../store.ts'
import type { RemoteResult } from '../contract.ts'

/** 一次一元调用；默认走 preload，测试可注入假传输。 */
export type UnaryCall = (namespace: string, method: string, args: object) => Promise<RemoteResult>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function base64Of(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * 读一张图片为 base64；宿主只接受规范 base64，不带 data URL 前缀。
 * @param file - 浏览器选中的文件。
 * @returns base64 原文；读取失败时抛出原始异常。
 */
export async function readImageBase64(file: File): Promise<string> {
  return base64Of(new Uint8Array(await file.arrayBuffer()))
}

/**
 * 上传一支文件；宿主返回的 receiptId 只能在同一会话里使用。
 * @param sessionId - 接收附件回执的会话。
 * @param data - 规范的 base64 文件字节。
 * @param name - 显示名；宿主会清洗成安全的叶子名。
 * @returns 上传结果；失败保留宿主原话。
 */
export async function uploadAttachment(
  sessionId: string,
  data: string,
  name: string,
): Promise<ChatUploadResult> {
  const answer = await window.lcoder.call('fileUploads', 'upload', {
    agentId: sessionId,
    request: { data, name },
  })
  if (!answer.ok) return { ok: false, code: answer.error.code, message: answer.error.message }
  const value = answer.value
  if (!isRecord(value) || typeof value.receiptId !== 'string') {
    return { ok: false, code: 'lcoder/invalid-response', message: '上传回执缺少 receiptId' }
  }
  return { ok: true, receiptId: value.receiptId }
}

/**
 * 取回一条已提交图片的预览地址。
 * @param sessionId - 图片所属会话；回执权限按会话作用域校验。
 * @param image - 消息里的图片引用。
 * @param call - 一元调用；默认走 preload。
 * @returns 可直接放进 `<img src>` 的 data URL；失败时抛出宿主原话。
 */
export async function attachmentImageUrl(
  sessionId: string,
  image: ChatImageAttachment,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<string> {
  const answer = await call('session', 'attachment', {
    request: {
      sessionId,
      attachment: {
        attachmentId: image.attachmentId,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
      },
    },
  })
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
  const value = answer.value
  if (!isRecord(value) || typeof value.data !== 'string') throw new Error('图片回执缺少字节')
  const mediaType = isRecord(value.attachment) && typeof value.attachment.mediaType === 'string'
    ? value.attachment.mediaType
    : image.mediaType
  return `data:${mediaType};base64,${value.data}`
}
