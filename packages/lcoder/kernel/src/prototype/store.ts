/**
 * 原型附件的持久化：把参考图写进 `.spec/prototypes/<编号>/refs/`，并支持清除。
 *
 * 与聊天附件不同，这些文件是需求原型的持久产物，不属于任何会话回执。
 * 文件名一律清洗成叶子名，路径仍经过 `prototypePath` 的越界校验。
 *
 * 暂存/快照也在本模块：`staged.json` 是尚未落盘的打磨，`history/<编号>.html`
 * 是每次覆盖正式版前的旧版归档。二者都不改需求正文；正文同步只在提交时按
 * 需求状态与评审处置情况受控进行。
 *
 * 作用域是需求编号或项目级统一活原型的 `__project__`。项目级读取在项目主原型
 * 尚未落盘时回退到最近一条需求的产物；写入始终落在请求的作用域目录，不会改到
 * 某条需求的独立原型。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { listRequirementIds, loadRequirement, patchRequirementDraft, saveRequirement } from '../kernel/requirement-store.js'
import type { RequirementPrototype } from '../schema/spec.js'
import { PrototypeError } from './summary.js'
import {
  isProjectScopeDir, MAX_SNAPSHOTS, PROJECT_SCOPE_DIR, prototypeHistoryDir, prototypePath, prototypeSnapshotPath,
  prototypeStagedPath,
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
 * @param scopeDir - 作用域目录名。
 */
function pruneSnapshots(specRoot: string, scopeDir: string): void {
  const dir = prototypeHistoryDir(specRoot, scopeDir)
  if (!existsSync(dir)) return
  const files = readdirSync(dir).filter(name => SNAPSHOT_FILE.test(name)).sort()
  for (const name of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    rmSync(join(dir, name), { force: true })
  }
}

/** 一次按作用域回退命中的读取：命中的作用域目录与实际值。 */
interface ScopedRead<T> {
  readonly scopeDir: string
  readonly value: T
}

/**
 * 按顺序取第一份命中的读取结果。
 * @param scopes - 已排序的作用域目录。
 * @param read - 单作用域读取；没有该产物时返回 undefined。
 * @returns 命中的作用域与值；全都没有时返回 undefined。
 */
function firstScoped<T>(
  scopes: readonly string[],
  read: (scopeDir: string) => T | undefined,
): ScopedRead<T> | undefined {
  for (const scopeDir of scopes) {
    const value = read(scopeDir)
    if (value !== undefined) return { scopeDir, value }
  }
  return undefined
}

/**
 * 项目级读取的作用域顺序：项目主原型已落盘时只读它，否则先读项目级目录，再按编号
 * 从新到旧读需求目录（最近的需求原型排在最前）。需求级作用域只读它自己。
 *
 * 回退只影响读取：写入始终落在请求的作用域目录。
 * @param specRoot - 规格根。
 * @param scopeDir - 请求的作用域目录名。
 * @returns 按优先级排列的作用域目录。
 */
export function prototypeReadScopes(specRoot: string, scopeDir: string): string[] {
  if (!isProjectScopeDir(scopeDir)) return [scopeDir]
  if (existsSync(prototypePath(specRoot, PROJECT_SCOPE_DIR, 'index.html'))) return [PROJECT_SCOPE_DIR]
  return [PROJECT_SCOPE_DIR, ...listRequirementIds(specRoot).reverse()]
}

/**
 * 读一个作用域目录自己的正式版 HTML，不回溯。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名。
 * @returns HTML 原文，或 undefined。
 */
function readPrototypeHtmlAt(specRoot: string, scopeDir: string): string | undefined {
  const path = prototypePath(specRoot, scopeDir, 'index.html')
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * 读一个作用域目录自己的暂存原型，不回溯；文件不存在返回 undefined，形状不合按失败抛出。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名。
 * @returns 暂存原型，或 undefined。
 */
function readStagedPrototypeAt(specRoot: string, scopeDir: string): StagedPrototype | undefined {
  const path = prototypeStagedPath(specRoot, scopeDir)
  if (!existsSync(path)) return undefined
  return StagedPrototypeSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * 删掉一个作用域目录自己的暂存文件；没有时是无操作。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名。
 */
function discardStagedAt(specRoot: string, scopeDir: string): void {
  rmSync(prototypeStagedPath(specRoot, scopeDir), { force: true })
}

/**
 * 列出单个作用域目录自己的历史快照，按时间倒序、最多 10 条。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名。
 * @returns 快照元数据。
 */
function listSnapshotsAt(specRoot: string, scopeDir: string): PrototypeSnapshotMeta[] {
  const dir = prototypeHistoryDir(specRoot, scopeDir)
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
 * 读取正式版原型 HTML；没有文件时返回 undefined。
 *
 * 项目级作用域在主原型尚未落盘时回退到需求原型，避免升级后既有数据在项目视图里丢失。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @returns HTML 原文，或 undefined。
 */
export function readPrototypeHtml(specRoot: string, scopeDir: string): string | undefined {
  return firstScoped(prototypeReadScopes(specRoot, scopeDir), dir => readPrototypeHtmlAt(specRoot, dir))?.value
}

/**
 * 原子写一份暂存原型；只落 `staged.json`，不碰正式版与需求正文。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @param staged - 待暂存的完整原型。
 */
export function writeStagedPrototype(specRoot: string, scopeDir: string, staged: StagedPrototype): void {
  const parsed = StagedPrototypeSchema.parse(staged)
  writeAtomic(prototypeStagedPath(specRoot, scopeDir), JSON.stringify(parsed, null, 2))
}

/**
 * 读暂存原型；文件不存在返回 null，形状不合按失败抛出，不静默降级。
 *
 * 项目级作用域回退顺序与正式版一致，界面因此能看到既有需求的暂存改动。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @returns 暂存原型或 null。
 */
export function readStagedPrototype(specRoot: string, scopeDir: string): StagedPrototype | null {
  return firstScoped(prototypeReadScopes(specRoot, scopeDir), dir => readStagedPrototypeAt(specRoot, dir))?.value ?? null
}

/**
 * 丢弃当前可见的暂存原型；没有暂存时是无操作。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 */
export function discardStagedPrototype(specRoot: string, scopeDir: string): void {
  const hit = firstScoped(prototypeReadScopes(specRoot, scopeDir), (dir) => {
    const path = prototypeStagedPath(specRoot, dir)
    return existsSync(path) ? dir : undefined
  })
  if (hit !== undefined) discardStagedAt(specRoot, hit.value)
}

/**
 * 把一份旧版 HTML 归档进历史；归档后保留最多 10 份。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @param html - 旧版正文；没有旧版时不归档。
 * @returns 新快照编号，或 undefined。
 */
export function saveSnapshot(specRoot: string, scopeDir: string, html: string | undefined): string | undefined {
  if (html === undefined || html === '') return undefined
  const dir = prototypeHistoryDir(specRoot, scopeDir)
  mkdirSync(dir, { recursive: true })
  const snapshotId = nextSnapshotId(dir)
  writeFileSync(prototypeSnapshotPath(specRoot, scopeDir, snapshotId), html, 'utf8')
  pruneSnapshots(specRoot, scopeDir)
  return snapshotId
}

/**
 * 列出历史快照，按时间倒序，最多 10 条。
 *
 * 项目级作用域先读自己的历史，为空时回退到需求原型的历史。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @returns 快照元数据。
 */
export function listSnapshots(specRoot: string, scopeDir: string): PrototypeSnapshotMeta[] {
  for (const candidate of prototypeReadScopes(specRoot, scopeDir)) {
    const items = listSnapshotsAt(specRoot, candidate)
    if (items.length > 0) return items
  }
  return []
}

/**
 * 恢复一份历史快照：当前正式版先归档，再把快照原子写回 `index.html`；
 * 需求级作用域同步刷新 YAML 登记，项目级作用域不碰任何需求文件。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @param snapshotId - 历史列表给出的安全编号。
 * @returns 恢复时刻与恢复后的 HTML。
 */
export function restoreSnapshot(
  specRoot: string,
  scopeDir: string,
  snapshotId: string,
): PrototypeRestoreSnapshotValue {
  const hit = firstScoped(prototypeReadScopes(specRoot, scopeDir), (dir) => {
    const path = prototypeSnapshotPath(specRoot, dir, snapshotId)
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  })
  if (hit === undefined) {
    throw new PrototypeError('这份快照不存在', 'PROTOTYPE/SNAPSHOT_NOT_FOUND')
  }
  const html = hit.value
  saveSnapshot(specRoot, scopeDir, readPrototypeHtml(specRoot, scopeDir))
  writeAtomic(prototypePath(specRoot, scopeDir, 'index.html'), html)
  const restoredAt = new Date().toISOString()
  if (!isProjectScopeDir(scopeDir)) {
    const requirement = loadRequirement(specRoot, scopeDir)
    if (requirement.prototype !== undefined) {
      saveRequirement(specRoot, {
        ...requirement,
        prototype: { ...requirement.prototype, generatedAt: restoredAt },
      })
    }
  }
  return { restoredAt, html }
}

/**
 * 提交暂存：归档旧版、原子写新版；需求级作用域再写 YAML 登记并按状态受控回写正文，
 * 项目级作用域不关联需求，只落原型本身。
 *
 * 正文基线冲突时抛结构化错误且保留 `staged.json`，原型本身已经落盘；
 * 有未决评审或已过审锁定只跳过正文同步，不阻断原型落盘。
 * @param specRoot - 规格根。
 * @param scopeDir - 作用域目录名；需求编号或 `__project__`。
 * @param options - 是否应用正文提案、提案模式（wire 契约字段）。
 * @returns 提交回执。
 */
export function commitStagedPrototype(
  specRoot: string,
  scopeDir: string,
  options: PrototypeCommitOptions = {},
): PrototypeCommitResult {
  const stagedHit = firstScoped(prototypeReadScopes(specRoot, scopeDir), dir => readStagedPrototypeAt(specRoot, dir))
  if (stagedHit === undefined) {
    throw new PrototypeError('当前作用域还没有暂存原型，无法提交', 'PROTOTYPE/NO_STAGED')
  }
  const staged = stagedHit.value
  const committedAt = new Date().toISOString()

  const snapshotId = saveSnapshot(specRoot, scopeDir, readPrototypeHtml(specRoot, scopeDir))
  writeAtomic(prototypePath(specRoot, scopeDir, 'index.html'), staged.html)

  if (isProjectScopeDir(scopeDir)) {
    discardStagedAt(specRoot, stagedHit.scopeDir)
    return {
      committedAt,
      ...(snapshotId === undefined ? {} : { snapshotId }),
      requirementSync: 'none',
      message: '项目级统一活原型不关联需求正文，本次没有改动任何需求。',
    }
  }

  const requirement = loadRequirement(specRoot, scopeDir)
  const prior = requirement.prototype
  const prototype: RequirementPrototype = {
    path: `prototypes/${scopeDir}/index.html`,
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
        patchRequirementDraft(specRoot, scopeDir, diff.baseContent, diff.proposedContent)
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

  discardStagedAt(specRoot, stagedHit.scopeDir)
  return {
    committedAt,
    ...(snapshotId === undefined ? {} : { snapshotId }),
    requirementSync,
    ...(message === undefined ? {} : { message }),
  }
}
