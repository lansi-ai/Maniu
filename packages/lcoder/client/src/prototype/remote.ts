/** 原型 Remote 的浏览器侧面：只走主进程的窄 IPC，不让渲染端直连网络或写磁盘。 */

import type { RemoteResult } from '../contract.ts'
import { WORKSPACE_READ_LINES } from '../spec/files.ts'

/*
 * 宿主生成的 strict descriptor 里，这些原型方法的唯一参数名是 `input`，
 * 所以线上字段必须包一层 `{ input }`，与 `cloudFace` 的 `{ input }` / `{ query }` 一致；
 * 直接把入参字段摊在顶层会被 `assertExactArguments` 判为 unexpected。
 */

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

/** 一次暂存改动的性质：visual 只动表现，business 涉及业务口径。 */
export type PrototypeChangeKind = 'visual' | 'business'

/** 落盘后需求正文的同步结果；`skipped_*` 都保留原正文不改。 */
export type RequirementSyncStatus = 'none' | 'patched' | 'amended' | 'skipped_pending' | 'skipped_locked'

/** 暂存原型携带的需求正文改动提案；正文基线始终由宿主读盘取得。 */
export interface PrototypeRequirementDiff {
  readonly baseContent: string
  readonly proposedContent: string
  readonly summary: string
}

/** 一条尚未落盘的原型打磨：只写 staged.json，不碰正式版与需求正文。 */
export interface StagedPrototype {
  /** 作用域标识：需求编号（`REQ-01`）或项目级统一活原型的 `__project__`。 */
  readonly requirementId: string
  readonly html: string
  readonly changeKind: PrototypeChangeKind
  /** 1–4 条给人读的改动摘要。 */
  readonly summary: readonly string[]
  readonly changedDomPaths: readonly string[]
  readonly requirementDiff?: PrototypeRequirementDiff
  readonly createdAt: string
}

/** 一份历史快照的展示元数据。 */
export interface PrototypeSnapshotMeta {
  readonly snapshotId: string
  readonly createdAt: string
  readonly bytes: number
}

/** `prototype/getStaged` 的回执：暂存视图与当前正式版 HTML。 */
export interface PrototypeStagedView {
  readonly staged: StagedPrototype | null
  readonly committedHtml: string | null
}

/** `prototype/commitStaged` 的输入；`applyRequirementDiff` 为真才允许改需求正文。 */
export interface PrototypeCommitStagedInput {
  readonly sessionId: string
  /** 需求编号；缺省表示项目级统一活原型。 */
  readonly requirementId?: string | undefined
  readonly applyRequirementDiff?: boolean
  readonly requirementAmendMode?: 'patch' | 'amend'
}

/** `prototype/commitStaged` 的回执。 */
export interface PrototypeCommitResult {
  readonly committedAt: string
  readonly snapshotId?: string
  readonly requirementSync: RequirementSyncStatus
  readonly message?: string
}

/** `prototype/restoreSnapshot` 的回执。 */
export interface PrototypeRestoreSnapshotValue {
  readonly restoredAt: string
  readonly html: string
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
function unwrap(answer: RemoteResult, fallback: string): Record<string, unknown> {
  if (!answer.ok) {
    const error = new Error(answer.error.message)
    error.name = answer.error.code
    throw error
  }
  if (!isRecord(answer.value)) throw new Error(fallback)
  return answer.value
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
  const answer = await call('prototype', 'prefetch', { input: { url } })
  const value = unwrap(answer, '样式摘要回执缺少字段')
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
  const answer = await call('prototype', 'uploadRef', { input: { sessionId, requirementId, name, data: base64 } })
  const value = unwrap(answer, '上传回执缺少字段')
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
  const answer = await call('prototype', 'clear', { input: { sessionId, requirementId } })
  unwrap(answer, '清除回执缺少字段')
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
  const answer = await call('prototype', 'adopt', { input: { sessionId, requirementId } })
  unwrap(answer, '采纳回执缺少字段')
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
    range: { offset: 1, limit: WORKSPACE_READ_LINES },
  })
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
  if (!isRecord(answer.value) || typeof answer.value.text !== 'string') throw new Error('原型 HTML 回执缺少正文')
  return answer.value.text
}

const SYNC_STATUSES: readonly RequirementSyncStatus[] = ['none', 'patched', 'amended', 'skipped_pending', 'skipped_locked']

/** 需求同步状态只认宿主枚举；未知值按 none 处理，不误报成功。 */
function syncStatusOf(value: unknown): RequirementSyncStatus {
  return SYNC_STATUSES.find(status => status === value) ?? 'none'
}

/**
 * 解析需求正文提案；字段不全时按没有提案处理，不把半成品画进 Diff。
 * @param value - 暂存条目上的 requirementDiff 字段。
 * @returns 正文提案或 undefined。
 */
function requirementDiffOf(value: unknown): PrototypeRequirementDiff | undefined {
  if (!isRecord(value)) return undefined
  const baseContent = text(value.baseContent)
  const proposedContent = text(value.proposedContent)
  const summary = text(value.summary)
  if (baseContent === undefined || proposedContent === undefined || summary === undefined) return undefined
  return { baseContent, proposedContent, summary }
}

/**
 * 解析一条暂存改动；字段不全时返回 null，界面按「没有暂存」处理。
 * @param value - 回执里的 staged 字段。
 * @returns 暂存原型或 null。
 */
function stagedOf(value: unknown): StagedPrototype | null {
  if (!isRecord(value)) return null
  const requirementId = text(value.requirementId)
  const html = text(value.html)
  const createdAt = text(value.createdAt)
  const changeKind = value.changeKind === 'business' || value.changeKind === 'visual' ? value.changeKind : undefined
  if (requirementId === undefined || html === undefined || createdAt === undefined || changeKind === undefined) return null
  const requirementDiff = requirementDiffOf(value.requirementDiff)
  return {
    requirementId,
    html,
    changeKind,
    summary: stringList(value.summary),
    changedDomPaths: stringList(value.changedDomPaths),
    ...(requirementDiff === undefined ? {} : { requirementDiff }),
    createdAt,
  }
}

/**
 * 解析一份快照元数据；字段不全的条目直接丢弃。
 * @param value - 快照列表里的一项。
 * @returns 快照元数据或 undefined。
 */
function snapshotOf(value: unknown): PrototypeSnapshotMeta | undefined {
  if (!isRecord(value)) return undefined
  const snapshotId = text(value.snapshotId)
  const createdAt = text(value.createdAt)
  if (snapshotId === undefined || createdAt === undefined || typeof value.bytes !== 'number') return undefined
  return { snapshotId, createdAt, bytes: value.bytes }
}

/**
 * 组装暂存/快照 Remote 的作用域输入：需求编号缺省或空白时按项目级统一活原型处理，
 * 不把空串发给只接受需求编号形态的 wire 校验。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号；`undefined` 或空白表示项目级。
 * @returns wire 上的 input 字段。
 */
function scopeInput(sessionId: string, requirementId: string | undefined): { sessionId: string; requirementId?: string } {
  const id = requirementId?.trim() ?? ''
  return id === '' ? { sessionId } : { sessionId, requirementId: id }
}

/**
 * 读暂存原型与当前正式版 HTML；需求编号缺省时读项目级统一活原型。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号；`undefined` 表示项目级。
 * @param call - 一元调用；默认走 preload。
 * @returns 暂存视图；没有暂存或没有正式版时对应字段为 null。
 */
export async function getStagedPrototype(
  sessionId: string,
  requirementId: string | undefined,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<PrototypeStagedView> {
  const answer = await call('prototype', 'getStaged', { input: scopeInput(sessionId, requirementId) })
  const value = unwrap(answer, '暂存视图回执缺少字段')
  return {
    staged: stagedOf(value.staged),
    committedHtml: text(value.committedHtml) ?? null,
  }
}

/**
 * 提交暂存：归档旧版、写回正式版，并按需求状态受控同步正文。
 * @param input - 会话号、需求编号与可选的正文回写开关。
 * @param call - 一元调用；默认走 preload。
 * @returns 落盘时刻、归档编号与正文同步结果。
 */
export async function commitStagedPrototype(
  input: PrototypeCommitStagedInput,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<PrototypeCommitResult> {
  const answer = await call('prototype', 'commitStaged', { input })
  const value = unwrap(answer, '落盘回执缺少字段')
  const committedAt = text(value.committedAt)
  if (committedAt === undefined) throw new Error('落盘回执缺少 committedAt')
  const snapshotId = text(value.snapshotId)
  const message = text(value.message)
  return {
    committedAt,
    ...(snapshotId === undefined ? {} : { snapshotId }),
    requirementSync: syncStatusOf(value.requirementSync),
    ...(message === undefined ? {} : { message }),
  }
}

/**
 * 丢弃暂存原型；正式版与需求正文不受影响。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号；`undefined` 表示项目级。
 * @param call - 一元调用；默认走 preload。
 */
export async function discardStagedPrototype(
  sessionId: string,
  requirementId: string | undefined,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<void> {
  const answer = await call('prototype', 'discardStaged', { input: scopeInput(sessionId, requirementId) })
  unwrap(answer, '放弃回执缺少字段')
}

/**
 * 列历史快照，按时间倒序、最多 10 条；需求编号缺省时列项目级作用域。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号；`undefined` 表示项目级。
 * @param call - 一元调用；默认走 preload。
 * @returns 快照元数据列表。
 */
export async function listPrototypeSnapshots(
  sessionId: string,
  requirementId: string | undefined,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<readonly PrototypeSnapshotMeta[]> {
  const answer = await call('prototype', 'listSnapshots', { input: scopeInput(sessionId, requirementId) })
  const value = unwrap(answer, '快照列表回执缺少字段')
  return Array.isArray(value.snapshots) ? value.snapshots.flatMap(entry => snapshotOf(entry) ?? []) : []
}

/**
 * 恢复一份历史快照：当前正式版先归档，再把快照写回；需求级作用域同时刷新 YAML 登记。
 * @param sessionId - 作用域会话号。
 * @param requirementId - 需求编号；`undefined` 表示项目级。
 * @param snapshotId - 快照编号。
 * @param call - 一元调用；默认走 preload。
 * @returns 恢复时刻与恢复后的 HTML。
 */
export async function restorePrototypeSnapshot(
  sessionId: string,
  requirementId: string | undefined,
  snapshotId: string,
  call: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args),
): Promise<PrototypeRestoreSnapshotValue> {
  const answer = await call('prototype', 'restoreSnapshot', { input: { ...scopeInput(sessionId, requirementId), snapshotId } })
  const value = unwrap(answer, '恢复回执缺少字段')
  const restoredAt = text(value.restoredAt)
  const html = text(value.html)
  if (restoredAt === undefined || html === undefined) throw new Error('恢复回执缺少字段')
  return { restoredAt, html }
}
