/**
 * 浮层输入区的纯判定：模型面板状态机、当前模型解析、附件校验与提示词拼装。
 *
 * 这一层不碰 React、DOM 与远程调用，所以面板开关、选中态、上限与错误分支都能
 * 被单测钉死；`Shell.tsx` 只负责读文件、调远程与渲染。
 */

import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelSettingsSnapshot } from './model-settings.ts'
import { rowUsable } from './model-settings.ts'

/** 图片管线接受的格式；与宿主 `ImageMediaType` 同一组字面量。 */
export type ChatImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 宿主随会话广播的图片上限；字段与 `ImageAttachmentLimits` 一致。 */
export interface ChatImageLimits {
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
  readonly maxImagePixels: number
  readonly maxImageDimension: number
  readonly mediaTypes: readonly string[]
}

/**
 * 读不到会话投影时的保守上限。宿主默认是单张 50MB、单条消息 20 张，
 * 这里收紧到单张 10MB、最多 4 张、合计 20MB，并在界面上写明当前采用的值。
 */
export const CHAT_FALLBACK_IMAGE_LIMITS: ChatImageLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 65_535,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/**
 * 取会话投影里的上限；结构不完整时退回保守值，不把「不知道」当成无限。
 * @param projected - 会话投影广播的上限，缺省表示还没读到。
 * @returns 当前生效的上限。
 */
export function resolveImageLimits(projected: ChatImageLimits | undefined): ChatImageLimits {
  if (projected === undefined) return CHAT_FALLBACK_IMAGE_LIMITS
  if (projected.mediaTypes.length === 0) return CHAT_FALLBACK_IMAGE_LIMITS
  return projected
}

/** 一条模型选择；provider 与 model 都是宿主目录里的原文。 */
export interface ChatModelChoice {
  readonly provider: string
  readonly model: string
}

/** 选择来源：会话自己记过，或退回目录默认。 */
export type ChatModelSource = 'session' | 'default'

/** 浮层要显示的当前模型。 */
export interface ChatModelSelectionView extends ChatModelChoice {
  readonly source: ChatModelSource
}

/**
 * 当前模型：会话投影的 `next` 优先；没记过就退回目录默认并标明来源。
 * @param recorded - 会话投影里的 `next`，`null` 表示本会话还没有记录。
 * @param fallback - 目录默认选择。
 * @returns 当前选择，或两者都没有时的 undefined。
 */
export function currentChatModel(
  recorded: ChatModelChoice | null | undefined,
  fallback: ChatModelChoice | undefined,
): ChatModelSelectionView | undefined {
  if (recorded !== null && recorded !== undefined) return { ...recorded, source: 'session' }
  if (fallback !== undefined) return { ...fallback, source: 'default' }
  return undefined
}

/** 目录里一个可展示的服务商及其模型。 */
export interface ChatModelProviderView {
  readonly provider: string
  readonly name: string
  readonly usable: boolean
  readonly reason?: 'error' | 'inactive' | 'account' | 'no-key'
  readonly models: readonly { readonly id: string; readonly name: string }[]
}

/** 面板的目录状态；三态分开，不把查询失败说成没有凭据。 */
export type ChatModelAvailability =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly detail: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'no-credential' }
  | { readonly kind: 'ready' }

/**
 * 目录快照折成服务商行。只保留有模型的路线，不可用的照常列出并带原因。
 * @param snapshot - 设置页数据面的快照。
 * @returns 服务商行，顺序沿用快照。
 */
export function chatModelProviders(snapshot: ModelSettingsSnapshot | null): readonly ChatModelProviderView[] {
  if (snapshot === null || snapshot.status !== 'ready') return []
  return snapshot.rows
    .filter(row => row.models.length > 0)
    .map((row) => {
      const reason = row.error !== undefined
        ? 'error' as const
        : !row.active
          ? 'inactive' as const
          : row.account && !row.accountAvailable
            ? 'account' as const
            : rowUsable(row) ? undefined : 'no-key' as const
      return {
        provider: row.provider,
        name: row.displayName,
        usable: reason === undefined,
        ...reason === undefined ? {} : { reason },
        models: row.models.map(model => ({ id: model.id, name: model.name })),
      }
    })
}

/**
 * 面板的三态判定：查询失败、目录为空、无可用凭据分开。
 * @param snapshot - 目录快照；null 表示还在读。
 * @returns 可直接选择文案的状态。
 */
export function chatModelAvailability(snapshot: ModelSettingsSnapshot | null): ChatModelAvailability {
  if (snapshot === null) return { kind: 'loading' }
  if (snapshot.status === 'error') return { kind: 'error', detail: snapshot.error ?? '' }
  const providers = chatModelProviders(snapshot)
  if (providers.length === 0) return { kind: 'empty' }
  if (!providers.some(provider => provider.usable)) return { kind: 'no-credential' }
  return { kind: 'ready' }
}

/**
 * 面板里一条模型按钮的键；provider 与 model 都可能含分隔符，用报文不可见字符。
 * @param provider - 服务商路线。
 * @param model - 模型 id。
 * @returns 这条选择的唯一键。
 */
export function modelChoiceKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/**
 * 这条模型是不是当前选择。
 * @param selection - 当前选择。
 * @param provider - 待比较的服务商。
 * @param model - 待比较的模型 id。
 * @returns 服务商与模型都一致时为 true。
 */
export function isCurrentModel(
  selection: ChatModelChoice | undefined,
  provider: string,
  model: string,
): boolean {
  return selection !== undefined && selection.provider === provider && selection.model === model
}

/** 面板状态；选中期间锁住单条按钮，避免连点发出两次切换。 */
export interface ChatModelPanelState {
  readonly open: boolean
  readonly loading: boolean
  readonly snapshot: ModelSettingsSnapshot | null
  readonly failure: string | null
  readonly busyKey: string | null
}

/** 面板初始状态。 */
export const INITIAL_MODEL_PANEL: ChatModelPanelState = {
  open: false,
  loading: false,
  snapshot: null,
  failure: null,
  busyKey: null,
}

/** 面板动作。 */
export type ChatModelPanelAction =
  | { readonly type: 'toggle' }
  | { readonly type: 'close' }
  | { readonly type: 'load'; readonly snapshot: ModelSettingsSnapshot }
  | { readonly type: 'fail'; readonly detail: string }
  | { readonly type: 'pick'; readonly key: string }
  | { readonly type: 'picked'; readonly snapshot: ModelSettingsSnapshot }
  | { readonly type: 'pick-failed'; readonly detail: string }

/**
 * 面板状态机。打开即进入 loading；选中成功后关闭并换上刷新后的目录；
 * 失败只清忙碌位并留一句原话，不关面板。
 * @param state - 当前状态。
 * @param action - 一次动作。
 * @returns 新状态；无变化时返回原对象。
 */
export function reduceModelPanel(
  state: ChatModelPanelState,
  action: ChatModelPanelAction,
): ChatModelPanelState {
  switch (action.type) {
    case 'toggle':
      if (state.open) return { ...state, open: false, loading: false, busyKey: null, failure: null }
      return { ...state, open: true, loading: state.snapshot === null || state.failure !== null, failure: null }
    case 'close':
      return state.open || state.loading || state.busyKey !== null || state.failure !== null
        ? { ...state, open: false, loading: false, busyKey: null, failure: null }
        : state
    case 'load':
      return { ...state, loading: false, snapshot: action.snapshot, failure: null }
    case 'fail':
      return { ...state, loading: false, failure: action.detail, busyKey: null }
    case 'pick':
      return state.busyKey === action.key ? state : { ...state, busyKey: action.key, failure: null }
    case 'picked':
      return { ...state, open: false, busyKey: null, failure: null, loading: false, snapshot: action.snapshot }
    case 'pick-failed':
      return { ...state, busyKey: null, failure: action.detail }
  }
}

/** 一张待发图片；`data` 是规范的 base64，不带 data URL 前缀。 */
export interface ChatPendingImage {
  readonly id: string
  readonly kind: 'image'
  readonly name: string
  readonly bytes: number
  readonly mediaType: ChatImageMediaType
  readonly data: string
}

/** 一支待发文件；receiptId 由宿主的文件上传面铸造。 */
export type ChatReceiptId = Extract<PromptContentPart, { readonly type: 'file' }>['receiptId']

/** 一条待发文件。上传中与失败都留在列表里，发送按钮据此禁用。 */
export interface ChatPendingFile {
  readonly id: string
  readonly kind: 'file'
  readonly name: string
  readonly bytes: number
  readonly status: 'uploading' | 'ready' | 'failed'
  readonly receiptId?: ChatReceiptId
  readonly errorCode?: string
  readonly error?: string
}

/** 输入区里的一条附件。 */
export type ChatPendingAttachment = ChatPendingImage | ChatPendingFile

/** 宿主文件上传面的结果；失败保留原始 code 与 message。 */
export type ChatUploadResult =
  | { readonly ok: true; readonly receiptId: ChatReceiptId }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** 图片被拒绝的原因；上限值一并带出，界面据此说清数字。 */
export type ChatImageRejection =
  | { readonly kind: 'unsupported-type'; readonly mediaTypes: readonly string[] }
  | { readonly kind: 'too-large'; readonly limit: number }
  | { readonly kind: 'too-many'; readonly limit: number }
  | { readonly kind: 'total-too-large'; readonly limit: number }

/**
 * 发送前检查一张图片。
 * @param mediaType - 浏览器报告的类型。
 * @param bytes - 解码后的字节数。
 * @param existing - 已经在列表里的图片。
 * @param limits - 当前生效的上限。
 * @returns 拒绝原因，或 null 表示可以加入。
 */
export function checkImageCandidate(
  mediaType: string,
  bytes: number,
  existing: readonly ChatPendingImage[],
  limits: ChatImageLimits,
): ChatImageRejection | null {
  if (!limits.mediaTypes.includes(mediaType)) {
    return { kind: 'unsupported-type', mediaTypes: [...limits.mediaTypes] }
  }
  if (bytes > limits.maxImageBytes) return { kind: 'too-large', limit: limits.maxImageBytes }
  if (existing.length + 1 > limits.maxImagesPerMessage) {
    return { kind: 'too-many', limit: limits.maxImagesPerMessage }
  }
  const total = existing.reduce((sum, image) => sum + image.bytes, 0) + bytes
  if (total > limits.maxMessageImageBytes) return { kind: 'total-too-large', limit: limits.maxMessageImageBytes }
  return null
}

/**
 * 把一次上传结果折成列表项；失败保留宿主原话，不谎报成功。
 * @param id - 列表项稳定性标识。
 * @param name - 文件名。
 * @param bytes - 文件字节数。
 * @param result - 上传面结果。
 * @returns ready 或 failed 的列表项。
 */
export function uploadedFile(
  id: string,
  name: string,
  bytes: number,
  result: ChatUploadResult,
): ChatPendingFile {
  if (!result.ok) {
    return { id, kind: 'file', name, bytes, status: 'failed', errorCode: result.code, error: result.message }
  }
  return { id, kind: 'file', name, bytes, status: 'ready', receiptId: result.receiptId }
}

/**
 * 所有文件都上传完成，才允许发送；失败项不能被悄悄跳过。
 * @param attachments - 待发附件。
 * @returns 每支文件都是 ready 时为 true。
 */
export function attachmentsReady(attachments: readonly ChatPendingAttachment[]): boolean {
  return attachments.every(attachment => attachment.kind === 'image' || attachment.status === 'ready')
}

/**
 * 没有文本也没有附件时不发。
 * @param text - 输入框文本。
 * @param attachments - 待发附件。
 * @returns 裁剪后无文本且没有附件时为 true。
 */
export function promptIsEmpty(text: string, attachments: readonly ChatPendingAttachment[]): boolean {
  return text.trim().length === 0 && attachments.length === 0
}

/**
 * 一次提示的正文：文本在前，图片其次，文件最后；各类内部保持加入顺序。
 * @param text - 已裁剪的文本。
 * @param attachments - 待发附件。
 * @returns 交给 `session.prompt` 的内容。
 * @throws 文件还没上传完成时拒绝拼装，避免静默丢附件。
 */
export function buildPromptContent(
  text: string,
  attachments: readonly ChatPendingAttachment[],
): PromptContentPart[] {
  const parts: PromptContentPart[] = []
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue
    parts.push({
      type: 'image',
      mediaType: attachment.mediaType,
      data: attachment.data,
      name: attachment.name,
    })
  }
  for (const attachment of attachments) {
    if (attachment.kind !== 'file') continue
    if (attachment.status !== 'ready' || attachment.receiptId === undefined) {
      throw new Error(`attachment "${attachment.name}" is not uploaded yet`)
    }
    parts.push({ type: 'file', receiptId: attachment.receiptId })
  }
  return parts
}

/** 宿主拒绝了这次提示；code 与 details.reason 原样保留供界面分流。 */
export class ChatPromptError extends Error {
  /**
   * @param code - 远程失败的判别码。
   * @param message - 宿主给出的原话。
   * @param reason - `details.reason`，没有时为空串。
   */
  constructor(
    readonly code: string,
    message: string,
    readonly reason: string = '',
  ) {
    super(message)
    this.name = 'ChatPromptError'
  }
}

/** 一次发送失败的归一化结果。 */
export interface ChatPromptFailure {
  readonly code: string
  readonly reason: string
  readonly message: string
}

/**
 * 把发送异常折成 code、reason 与原话。
 * @param error - 捕获到的异常。
 * @returns 可直接分流的失败。
 */
export function promptFailureOf(error: unknown): ChatPromptFailure {
  if (error instanceof ChatPromptError) {
    return { code: error.code, reason: error.reason, message: error.message }
  }
  if (error instanceof Error) return { code: 'unknown', reason: '', message: error.message }
  return { code: 'unknown', reason: '', message: String(error) }
}

/**
 * 字节数写成人话；用于上限与附件大小。
 * @param bytes - 字节数。
 * @returns 以 MB 为主、KB 兜底的文本。
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024
    return `${Number.isInteger(kb) ? String(kb) : kb.toFixed(1)}KB`
  }
  return `${String(bytes)}B`
}
