/** 输入区的纯判定：模型、上下文用量、图片上限与待发附件。 */

/** 图片管线接受的格式；与宿主 `ImageMediaType` 同一组字面量。 */
export type ChatImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 宿主随会话投影广播的图片上限。 */
export interface ChatImageLimits {
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
  readonly maxImagePixels: number
  readonly maxImageDimension: number
  readonly mediaTypes: readonly string[]
}

/** 读不到投影时的保守上限；不把「不知道」当成无限。 */
export const CHAT_FALLBACK_IMAGE_LIMITS: ChatImageLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 65_535,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 取会话投影里的图片上限；结构不完整时退回保守值。
 * @param projected - `imageLimits` 投影值。
 * @returns 当前生效的上限。
 */
export function imageLimitsOf(projected: unknown): ChatImageLimits {
  if (!isRecord(projected)) return CHAT_FALLBACK_IMAGE_LIMITS
  const mediaTypes = stringsOf(projected.mediaTypes)
  const maxImageBytes = finiteNumber(projected.maxImageBytes)
  const maxImagesPerMessage = finiteNumber(projected.maxImagesPerMessage)
  const maxMessageImageBytes = finiteNumber(projected.maxMessageImageBytes)
  if (mediaTypes.length === 0 || maxImageBytes === undefined || maxImagesPerMessage === undefined
    || maxMessageImageBytes === undefined) return CHAT_FALLBACK_IMAGE_LIMITS
  return {
    maxImageBytes,
    maxImagesPerMessage,
    maxMessageImageBytes,
    maxImagePixels: finiteNumber(projected.maxImagePixels) ?? CHAT_FALLBACK_IMAGE_LIMITS.maxImagePixels,
    maxImageDimension: finiteNumber(projected.maxImageDimension) ?? CHAT_FALLBACK_IMAGE_LIMITS.maxImageDimension,
    mediaTypes,
  }
}

/** 一条模型选择；provider 与 model 都是宿主目录里的原文。 */
export interface ChatModelChoice {
  readonly provider: string
  readonly model: string
}

/** 选择来源：会话自己记过，或退回目录默认。 */
export type ChatModelSource = 'session' | 'default'

/** 输入区要显示的当前模型。 */
export interface ChatModelSelectionView extends ChatModelChoice {
  readonly source: ChatModelSource
}

/**
 * 当前模型：会话投影的 `next` 优先；没记过就退回目录默认并标明来源。
 * @param recorded - `modelSelection.next`，null 表示本会话还没有记录。
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

function choiceOf(value: unknown): ChatModelChoice | undefined {
  if (!isRecord(value) || typeof value.provider !== 'string' || typeof value.model !== 'string') return undefined
  return { provider: value.provider, model: value.model }
}

/**
 * 会话投影里的 `modelSelection.next`。
 * @param projected - `modelSelection` 投影值。
 * @returns 记录过的选择；没有记录时为 null。
 */
export function recordedModelOf(projected: unknown): ChatModelChoice | null {
  if (!isRecord(projected)) return null
  return choiceOf(projected.next) ?? null
}

/** 目录里一条可选模型。 */
export interface ChatModelOption extends ChatModelChoice {
  readonly providerName: string
  readonly modelName: string
}

/** `session/modelCatalog` 里本页用到的部分。 */
export interface ChatModelCatalog {
  readonly defaultChoice?: ChatModelChoice
  readonly options: readonly ChatModelOption[]
  readonly failures: readonly { readonly name: string; readonly message: string }[]
}

/**
 * 折成模型 chip 的选项；只列有模型的路线。
 * @param value - `session/modelCatalog` 返回值。
 * @returns 默认选择、选项与失败说明。
 */
export function modelCatalogOf(value: unknown): ChatModelCatalog {
  if (!isRecord(value)) return { options: [], failures: [] }
  const options: ChatModelOption[] = []
  if (Array.isArray(value.groups)) {
    for (const group of value.groups) {
      if (!isRecord(group) || typeof group.id !== 'string') continue
      const providerName = typeof group.name === 'string' ? group.name : group.id
      if (!Array.isArray(group.models)) continue
      for (const model of group.models) {
        if (!isRecord(model) || typeof model.id !== 'string') continue
        options.push({
          provider: group.id,
          model: model.id,
          providerName,
          modelName: typeof model.name === 'string' ? model.name : model.id,
        })
      }
    }
  }
  const failures = Array.isArray(value.failures)
    ? value.failures.flatMap((failure) => {
      if (!isRecord(failure) || typeof failure.message !== 'string') return []
      return [{ name: typeof failure.name === 'string' ? failure.name : '', message: failure.message }]
    })
    : []
  const defaultChoice = choiceOf(value.default)
  return {
    ...(defaultChoice === undefined ? {} : { defaultChoice }),
    options,
    failures,
  }
}

/** 模型目录的三态：可用、明确为空、查询失败。 */
export type ChatModelAvailability =
  | { readonly kind: 'ready' }
  | { readonly kind: 'empty'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string }

/**
 * 目录是否还有能跑的模型；`routableProviders` 与分组任一有内容即可。
 * @param value - `session/modelCatalog` 返回值。
 * @returns 三态之一；查询本身失败由调用方另给 `unknown`。
 */
export function modelAvailabilityOf(value: unknown): ChatModelAvailability {
  const catalog = modelCatalogOf(value)
  const routable = isRecord(value) ? stringsOf(value.routableProviders) : []
  if (routable.length > 0 || catalog.options.length > 0) return { kind: 'ready' }
  return {
    kind: 'empty',
    detail: catalog.failures.map(failure => `${failure.name === '' ? '?' : failure.name}: ${failure.message}`).join('；'),
  }
}

/** 上下文占用的可显示值。 */
export interface ChatContextUsage {
  readonly used?: number
  readonly window?: number
}

/**
 * 读 `contextPressure` 投影的占用与容量；字段互相独立，缺什么就少显示什么。
 * @param projected - `contextPressure` 投影值。
 * @returns 已用与容量。
 */
export function contextUsageOf(projected: unknown): ChatContextUsage {
  if (!isRecord(projected)) return {}
  const used = finiteNumber(projected.projectedTokens) ?? finiteNumber(projected.pressureTokens)
  const window = finiteNumber(projected.contextWindow)
  return {
    ...(used === undefined ? {} : { used }),
    ...(window === undefined ? {} : { window }),
  }
}

/**
 * token 数写成人话；大数用 k/M 缩写。
 * @param tokens - token 数。
 * @returns 例如 `980`、`12.3k`、`1.05M`。
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(Math.max(0, Math.round(tokens)))
}

/**
 * 字节数写成人话；用于附件大小与上限。
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

/** 一张待发图片；`data` 是规范的 base64，不带 data URL 前缀。 */
export interface ChatPendingImage {
  readonly id: string
  readonly kind: 'image'
  readonly name: string
  readonly bytes: number
  readonly mediaType: ChatImageMediaType
  readonly data: string
}

/** 一支待发文件；`receiptId` 由宿主上传面铸造。 */
export interface ChatPendingFile {
  readonly id: string
  readonly kind: 'file'
  readonly name: string
  readonly bytes: number
  readonly status: 'uploading' | 'ready' | 'failed'
  readonly receiptId?: string
  readonly error?: string
}

/** 输入区里的一条附件。 */
export type ChatPendingAttachment = ChatPendingImage | ChatPendingFile

/** 宿主上传面的结果。 */
export type ChatUploadResult =
  | { readonly ok: true; readonly receiptId: string }
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
  if (!limits.mediaTypes.includes(mediaType)) return { kind: 'unsupported-type', mediaTypes: [...limits.mediaTypes] }
  if (bytes > limits.maxImageBytes) return { kind: 'too-large', limit: limits.maxImageBytes }
  if (existing.length + 1 > limits.maxImagesPerMessage) return { kind: 'too-many', limit: limits.maxImagesPerMessage }
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
export function uploadedFile(id: string, name: string, bytes: number, result: ChatUploadResult): ChatPendingFile {
  if (!result.ok) {
    return { id, kind: 'file', name, bytes, status: 'failed', error: `${result.code}: ${result.message}` }
  }
  return { id, kind: 'file', name, bytes, status: 'ready', receiptId: result.receiptId }
}

/**
 * 所有文件都上传完成才能发送；失败项不能被悄悄跳过。
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

/** 一支部队发给 `session/prompt` 的内容块。 */
export type ChatPromptPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: string }

/**
 * 一次提示的正文：文本在前，图片其次，文件最后；各类内部保持加入顺序。
 * @param text - 已裁剪的文本。
 * @param attachments - 待发附件。
 * @returns 交给 `session.prompt` 的内容。
 * @throws 文件还没上传完成时拒绝拼装，避免静默丢附件。
 */
export function buildPromptContent(text: string, attachments: readonly ChatPendingAttachment[]): ChatPromptPart[] {
  const parts: ChatPromptPart[] = []
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue
    parts.push({
      type: 'image',
      mediaType: attachment.mediaType,
      data: attachment.data,
      ...(attachment.name === '' ? {} : { name: attachment.name }),
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
