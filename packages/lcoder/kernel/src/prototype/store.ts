/**
 * 原型附件的持久化：把参考图写进 `.spec/prototypes/<编号>/refs/`，并支持清除。
 *
 * 与聊天附件不同，这些文件是需求原型的持久产物，不属于任何会话回执。
 * 文件名一律清洗成叶子名，路径仍经过 `prototypePath` 的越界校验。
 *
 * 暂存/快照也在本模块：`staged.json` 是尚未落盘的打磨，`history/<编号>.html`
 * 是每次覆盖正式版前的旧版归档。二者都不改需求正文；正文同步只在提交时按
 * 需求状态与评审处置情况受控进行。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { loadRequirement, patchRequirementDraft, saveRequirement } from '../kernel/requirement-store.js'
import type { RequirementPrototype } from '../schema/spec.js'
import { PrototypeError } from './summary.js'
import {
  MAX_SNAPSHOTS, prototypeHistoryDir, prototypePath, prototypeSnapshotPath, prototypeStagedPath,
} from './paths.js'
import { StagedPrototypeSchema } from './types.js'
import type {
  PrototypeCommitOptions, PrototypeCommitResult, PrototypeRestoreSnapshotValue,
  PrototypeSnapshotMeta, RequirementSyncStatus, StagedPrototype,
} from './types.js'

/** 单张参考图的体积上限（字节）。 */
export const MAX_REF_BYTES = 2 * 1024 * 1024

/** 参考附件落盘的根目录段。 */
const REFS_DIR = 'refs'

/** 快照文件名：`毫秒-序号.html`，与 `assertSnapshotId` 的形态一致。 */
const SNAPSHOT_FILE = /^\d{13}-\d{1,4}\.html$/

/**
 * 整块原子写：先写同目录临时文件再 rename，避免读方看到半截 JSON 或 HTML。
 * @param target - 目标绝对路径。
 * @param content - UTF-8 文本。
 */
function writeAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.tmp-${String(process.pid)}-${Date.now().toString(36)}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, target)
  } catch (error) {
    // 临时文件残留没有读方，但要清掉，免得在原型目录里堆积垃圾。
    rmSync(temp, { force: true })
    throw error
  }
}

/**
 * 取下一个快照编号：同毫秒内按序号递增，字典序就是时间序。
 * @param dir - 已存在的快照目录。
 * @returns 形如 `001769000000000-0` 的编号。
 */
function nextSnapshotId(dir: string): string {
  const ms = String(Date.now()).padStart(13, '0')
  const existing = new Set(readdirSync(dir).filter(name => SNAPSHOT_FILE.test(name)).map(name => name.slice(0, -5)))
  let sequence = 0
  let id = `${ms}-${String(sequence)}`
  while (existing.has(id)) {
    sequence += 1
    id = `${ms}-${String(sequence)}`
  }
  return id
}

/**
 * 归档后淘汰超出上限的最旧快照。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 */
function pruneSnapshots(specRoot: string, requirementId: string): void {
  const dir = prototypeHistoryDir(specRoot, requirementId)
  if (!existsSync(dir)) return
  const files = readdirSync(dir).filter(name => SNAPSHOT_FILE.test(name)).sort()
  for (const name of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    rmSync(join(dir, name), { force: true })
  }
}

/**
 * 把参考图的 base64 字节写入规格库。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param name - 原始文件名；只取叶子名，去掉路径分隔符。
 * @param data - 规范 base64（不带 data URL 前缀）。
 * @returns 规格根相对路径与实际字节数。
 */
export function writePrototypeRef(
  specRoot: string,
  requirementId: string,
  name: string,
  data: string,
): { readonly path: string; readonly bytes: number } {
  const leaf = basename(name.trim().replaceAll('\\', '/'))
  if (leaf === '' || leaf === '.' || leaf === '..') {
    throw new Error('prototype: 参考图文件名不合法')
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0) throw new Error('prototype: 参考图内容为空')
  if (bytes.length > MAX_REF_BYTES) throw new Error('prototype: 参考图超过 2MB 上限')
  const target = prototypePath(specRoot, requirementId, REFS_DIR, leaf)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  return { path: `prototypes/${requirementId}/${REFS_DIR}/${leaf}`, bytes: bytes.length }
}

/**
 * 清除一条需求的原型：先移除 YAML 的 prototype 字段，再删除原型目录。
 * 目录删除失败不会回滚字段——残留的空目录比指向已删除文件的字段危害小。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 */
export function clearPrototype(specRoot: string, requirementId: string): void {
  const requirement = loadRequirement(specRoot, requirementId)
  if (requirement.prototype === undefined) return
  const { prototype: _removed, ...rest } = requirement
  saveRequirement(specRoot, rest)
  rmSync(prototypePath(specRoot, requirementId), { recursive: true, force: true })
}

/**
 * 人采纳原型：只在已有原型的登记上写采纳时刻，不改 HTML 与参考。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param at - 采纳时刻。
 */
export function adoptPrototype(specRoot: string, requirementId: string, at: string): void {
  const requirement = loadRequirement(specRoot, requirementId)
  if (requirement.prototype === undefined) {
    throw new Error('prototype: 这条需求还没有原型，无法采纳')
  }
  saveRequirement(specRoot, {
    ...requirement,
    prototype: { ...requirement.prototype, adoptedAt: at },
  })
}

/**
 * 读取已落盘的原型 HTML；没有文件时返回 undefined。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @returns HTML 原文，或 undefined。
 */
export function readPrototypeHtml(specRoot: string, requirementId: string): string | undefined {
  const path = prototypePath(specRoot, requirementId, 'index.html')
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * 原子写一份暂存原型；只落 `staged.json`，不碰正式版与需求正文。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param staged - 待暂存的完整原型。
 */
export function writeStagedPrototype(specRoot: string, requirementId: string, staged: StagedPrototype): void {
  const parsed = StagedPrototypeSchema.parse(staged)
  writeAtomic(prototypeStagedPath(specRoot, requirementId), JSON.stringify(parsed, null, 2))
}

/**
 * 读暂存原型；文件不存在返回 null，形状不合按失败抛出，不静默降级。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @returns 暂存原型或 null。
 */
export function readStagedPrototype(specRoot: string, requirementId: string): StagedPrototype | null {
  const path = prototypeStagedPath(specRoot, requirementId)
  if (!existsSync(path)) return null
  return StagedPrototypeSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * 丢弃暂存原型；没有暂存时是无操作。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 */
export function discardStagedPrototype(specRoot: string, requirementId: string): void {
  rmSync(prototypeStagedPath(specRoot, requirementId), { force: true })
}

/**
 * 把一份旧版 HTML 归档进历史；归档后保留最多 10 份。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param html - 旧版正文；没有旧版时不归档。
 * @returns 新快照编号，或 undefined。
 */
export function saveSnapshot(specRoot: string, requirementId: string, html: string | undefined): string | undefined {
  if (html === undefined || html === '') return undefined
  const dir = prototypeHistoryDir(specRoot, requirementId)
  mkdirSync(dir, { recursive: true })
  const snapshotId = nextSnapshotId(dir)
  writeFileSync(prototypeSnapshotPath(specRoot, requirementId, snapshotId), html, 'utf8')
  pruneSnapshots(specRoot, requirementId)
  return snapshotId
}

/**
 * 列出历史快照，按时间倒序，最多 10 条。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @returns 快照元数据。
 */
export function listSnapshots(specRoot: string, requirementId: string): PrototypeSnapshotMeta[] {
  const dir = prototypeHistoryDir(specRoot, requirementId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => SNAPSHOT_FILE.test(name))
    .map((name) => {
      const snapshotId = name.slice(0, -5)
      return {
        snapshotId,
        createdAt: new Date(Number.parseInt(snapshotId.slice(0, 13), 10)).toISOString(),
        bytes: statSync(join(dir, name)).size,
      }
    })
    .sort((left, right) => right.snapshotId.localeCompare(left.snapshotId))
    .slice(0, MAX_SNAPSHOTS)
}

/**
 * 恢复一份历史快照：当前正式版先归档，再把快照原子写回 `index.html`；
 * 需求 YAML 已有 prototype 登记时同步刷新生成时刻。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param snapshotId - 历史列表给出的安全编号。
 * @returns 恢复时刻与恢复后的 HTML。
 */
export function restoreSnapshot(
  specRoot: string,
  requirementId: string,
  snapshotId: string,
): PrototypeRestoreSnapshotValue {
  const path = prototypeSnapshotPath(specRoot, requirementId, snapshotId)
  if (!existsSync(path)) {
    throw new PrototypeError('这份快照不存在', 'PROTOTYPE/SNAPSHOT_NOT_FOUND')
  }
  const html = readFileSync(path, 'utf8')
  saveSnapshot(specRoot, requirementId, readPrototypeHtml(specRoot, requirementId))
  writeAtomic(prototypePath(specRoot, requirementId, 'index.html'), html)
  const restoredAt = new Date().toISOString()
  const requirement = loadRequirement(specRoot, requirementId)
  if (requirement.prototype !== undefined) {
    saveRequirement(specRoot, {
      ...requirement,
      prototype: { ...requirement.prototype, generatedAt: restoredAt },
    })
  }
  return { restoredAt, html }
}

/**
 * 提交暂存：归档旧版、原子写新版与 YAML 登记，再按状态受控回写需求正文。
 *
 * 正文基线冲突时抛结构化错误且保留 `staged.json`，原型本身已经落盘；
 * 有未决评审或已过审锁定只跳过正文同步，不阻断原型落盘。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param options - 是否应用正文提案、提案模式（wire 契约字段）。
 * @returns 提交回执。
 */
export function commitStagedPrototype(
  specRoot: string,
  requirementId: string,
  options: PrototypeCommitOptions = {},
): PrototypeCommitResult {
  const staged = readStagedPrototype(specRoot, requirementId)
  if (staged === null) {
    throw new PrototypeError('这条需求还没有暂存原型，无法提交', 'PROTOTYPE/NO_STAGED')
  }
  const requirement = loadRequirement(specRoot, requirementId)
  const committedAt = new Date().toISOString()

  const snapshotId = saveSnapshot(specRoot, requirementId, readPrototypeHtml(specRoot, requirementId))
  writeAtomic(prototypePath(specRoot, requirementId, 'index.html'), staged.html)
  const prior = requirement.prototype
  const prototype: RequirementPrototype = {
    path: `prototypes/${requirementId}/index.html`,
    generatedAt: committedAt,
    references: prior === undefined ? [] : [...prior.references],
    ...(prior?.referenceSummary === undefined || prior.referenceSummary === '' ? {} : { referenceSummary: prior.referenceSummary }),
    ...(prior?.quality === undefined ? {} : { quality: prior.quality }),
    ...(prior?.adoptedAt === undefined ? {} : { adoptedAt: prior.adoptedAt }),
  }
  saveRequirement(specRoot, { ...requirement, prototype })

  let requirementSync: RequirementSyncStatus = 'none'
  let message: string | undefined
  const diff = staged.requirementDiff
  if (options.applyRequirementDiff === true && diff !== undefined) {
    const hasPending = requirement.reviews.some(review =>
      review.decision === undefined || review.decision === 'pending',
    )
    if (requirement.state === 'confirmed') {
      requirementSync = 'skipped_locked'
      message = options.requirementAmendMode === 'amend'
        ? '需求已确认（签署后锁定），amend 模式也不改需求正文；原型已落盘，正文变更请走正式流程。'
        : '需求已确认（签署后锁定），原型已落盘但需求正文未改；正文变更请走正式流程。'
    } else if (hasPending) {
      requirementSync = 'skipped_pending'
      message = '这条需求有未处置的评审，原型已落盘但需求正文未改；请先处置评审再同步正文。'
    } else if (requirement.state === 'draft') {
      try {
        patchRequirementDraft(specRoot, requirementId, diff.baseContent, diff.proposedContent)
        requirementSync = 'patched'
      } catch (error) {
        throw new PrototypeError(
          `需求正文回写失败：${error instanceof Error ? error.message : String(error)}`,
          'PROTOTYPE/REQUIREMENT_BASELINE_CONFLICT',
        )
      }
    } else {
      requirementSync = 'skipped_locked'
      message = `需求当前处于「${requirement.state}」，原型已落盘但需求正文未改。`
    }
  }

  discardStagedPrototype(specRoot, requirementId)
  return {
    committedAt,
    ...(snapshotId === undefined ? {} : { snapshotId }),
    requirementSync,
    ...(message === undefined ? {} : { message }),
  }
}
