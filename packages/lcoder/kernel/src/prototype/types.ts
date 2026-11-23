/** 原型 Remote 的线类型；只含纯 JSON 数据。 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

import { z } from 'zod'

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

/** 一次暂存改动的性质：`visual` 只动表现，`business` 涉及业务口径。 */
export type PrototypeChangeKind = 'visual' | 'business'

/** 落盘后需求正文的同步结果；`skipped_*` 都保留原正文不改。 */
export type RequirementSyncStatus = 'none' | 'patched' | 'amended' | 'skipped_pending' | 'skipped_locked'

/** 暂存原型携带的需求正文改动提案；正文基线始终由宿主读盘取得。 */
export interface PrototypeRequirementDiff {
  readonly baseContent: string
  readonly proposedContent: string
  readonly summary: string
}

/**
 * 一次尚未落盘的原型打磨：只写 `staged.json`，不碰正式版 `index.html` 与需求正文。
 */
export interface StagedPrototype {
  readonly requirementId: string
  readonly html: string
  readonly changeKind: PrototypeChangeKind
  /** 1–4 条给人读的改动摘要。 */
  readonly summary: readonly string[]
  readonly changedDomPaths: readonly string[]
  readonly requirementDiff?: PrototypeRequirementDiff | undefined
  readonly createdAt: string
}

/** 一份历史快照的展示元数据。 */
export interface PrototypeSnapshotMeta {
  readonly snapshotId: string
  readonly createdAt: string
  readonly bytes: number
}

/** `getStaged` 的回执：暂存视图与当前正式版 HTML。 */
export interface PrototypeStagedView {
  readonly staged: StagedPrototype | null
  readonly committedHtml: string | null
}

/** `commitStaged` 的回执：落盘时刻、归档编号与需求正文同步结果。 */
export interface PrototypeCommitResult {
  readonly committedAt: string
  readonly snapshotId?: string
  readonly requirementSync: RequirementSyncStatus
  readonly message?: string
}

/** `listSnapshots` 的回执：按时间倒序、最多 10 条。 */
export interface PrototypeListSnapshotsValue {
  readonly snapshots: readonly PrototypeSnapshotMeta[]
}

/** `restoreSnapshot` 的回执。 */
export interface PrototypeRestoreSnapshotValue {
  readonly restoredAt: string
  readonly html: string
}

/** `getStaged` / `discardStaged` / `listSnapshots` 的输入。 */
export interface PrototypeScopeInput {
  readonly sessionId: SessionId
  readonly requirementId: string
}

/** `commitStaged` 的输入；`applyRequirementDiff` 为真才允许改需求正文。 */
export interface PrototypeCommitStagedInput extends PrototypeScopeInput {
  readonly applyRequirementDiff?: boolean
  readonly requirementAmendMode?: 'patch' | 'amend'
}

/** `restoreSnapshot` 的输入。 */
export interface PrototypeRestoreSnapshotInput extends PrototypeScopeInput {
  readonly snapshotId: string
}

/** `commitStaged` 的存储层选项。 */
export interface PrototypeCommitOptions {
  readonly applyRequirementDiff?: boolean
  readonly requirementAmendMode?: 'patch' | 'amend'
}

/** 暂存回写提案的 wire 校验；正文基线非空才能进入受控回写。 */
export const PrototypeRequirementDiffSchema = z.object({
  baseContent: z.string(),
  proposedContent: z.string(),
  summary: z.string().min(1),
}).strict()

/** 暂存原型的 wire 校验；摘要必须 1–4 条。 */
export const StagedPrototypeSchema = z.object({
  requirementId: z.string().regex(/^REQ-\d{2,}$/),
  html: z.string(),
  changeKind: z.enum(['visual', 'business']),
  summary: z.array(z.string().min(1)).min(1).max(4),
  changedDomPaths: z.array(z.string()),
  requirementDiff: PrototypeRequirementDiffSchema.optional(),
  createdAt: z.string().min(1),
}).strict()

/** 快照元数据的 wire 校验。 */
export const PrototypeSnapshotMetaSchema = z.object({
  snapshotId: z.string().min(1),
  createdAt: z.string().min(1),
  bytes: z.number().int().min(0),
}).strict()

/** `getStaged` 的 wire 输入校验。 */
export const PrototypeScopeInputSchema = z.object({
  sessionId: z.string().min(1),
  requirementId: z.string().regex(/^REQ-\d{2,}$/),
}).strict()

/** `commitStaged` 的 wire 输入校验。 */
export const PrototypeCommitStagedInputSchema = PrototypeScopeInputSchema.extend({
  applyRequirementDiff: z.boolean().optional(),
  requirementAmendMode: z.enum(['patch', 'amend']).optional(),
}).strict()

/** `restoreSnapshot` 的 wire 输入校验；快照编号必须是不含分隔符的安全形态。 */
export const PrototypeRestoreSnapshotInputSchema = PrototypeScopeInputSchema.extend({
  snapshotId: z.string().regex(/^\d{13}-\d{1,4}$/),
}).strict()

/** `getStaged` 的 wire 输出校验。 */
export const PrototypeStagedViewSchema = z.object({
  staged: StagedPrototypeSchema.nullable(),
  committedHtml: z.string().nullable(),
}).strict()

/** `commitStaged` 的 wire 输出校验。 */
export const PrototypeCommitResultSchema = z.object({
  committedAt: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  requirementSync: z.enum(['none', 'patched', 'amended', 'skipped_pending', 'skipped_locked']),
  message: z.string().optional(),
}).strict()

/** `listSnapshots` 的 wire 输出校验。 */
export const PrototypeListSnapshotsValueSchema = z.object({
  snapshots: z.array(PrototypeSnapshotMetaSchema),
}).strict()

/** `restoreSnapshot` 的 wire 输出校验。 */
export const PrototypeRestoreSnapshotValueSchema = z.object({
  restoredAt: z.string().min(1),
  html: z.string(),
}).strict()
