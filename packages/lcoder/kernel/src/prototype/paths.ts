/**
 * 原型产物的路径规则：所有写入都落在 `.spec/prototypes/<需求编号>/` 之下。
 *
 * 路径来自模型（工具入参）或界面（上传文件名），都不可信：绝对路径、`..`
 * 越界和空段一律拒绝。这里只判定「目标是否仍在指定需求的原型目录内」，
 * 不创建目录，也不读取内容。
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** 原型目录在规格根下的固定段。 */
export const PROTOTYPES_DIR = 'prototypes'

/** 单份 HTML 的体积上限（字节）。 */
export const MAX_HTML_BYTES = 512 * 1024

/** 暂存原型的固定文件名。 */
export const STAGED_FILE = 'staged.json'

/** 历史快照的固定目录段。 */
export const HISTORY_DIR = 'history'

/** 历史快照最多保留份数；归档新快照后淘汰最旧的。 */
export const MAX_SNAPSHOTS = 10

/** 快照编号：13 位毫秒时间戳 + 同毫秒内的 1~4 位序号，零填充保证字典序等于时间序。 */
const SNAPSHOT_ID = /^\d{13}-\d{1,4}$/

/**
 * 解析一个原型目录下的目标路径，并确认它没有跳出该目录。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号；调用方已用 `assertRequirementId` 校验。
 * @param segments - 原型目录内的相对段，如 `index.html`、`refs/logo.png`。
 * @returns 目标绝对路径。
 * @throws 绝对路径、`..` 越界或空段。
 */
export function prototypePath(specRoot: string, requirementId: string, ...segments: readonly string[]): string {
  const base = resolve(specRoot, PROTOTYPES_DIR, requirementId)
  const target = resolve(base, ...segments)
  const inside = relative(base, target)
  const escaped = inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || (segments.length > 0 && inside === '')
  if (escaped) {
    throw new Error(`prototype: 路径越界，目标必须位于 ${PROTOTYPES_DIR}/${requirementId}/ 内`)
  }
  return target
}

/**
 * 校验一个「规格根相对路径」是否位于指定需求的原型目录内。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号。
 * @param value - 待校验的相对路径，如 `prototypes/REQ-01/refs/a.png`。
 * @returns 规格根相对路径（统一 `/` 分隔）。
 * @throws 绝对路径、`..` 越界或不在该需求的原型目录内。
 */
export function assertPrototypeRelativePath(specRoot: string, requirementId: string, value: string): string {
  const normalized = value.trim()
  if (normalized === '' || isAbsolute(normalized)) {
    throw new Error(`prototype: 引用路径必须是 ${PROTOTYPES_DIR}/${requirementId}/ 下的相对路径`)
  }
  const base = resolve(specRoot, PROTOTYPES_DIR, requirementId)
  const target = resolve(specRoot, normalized)
  const inside = relative(base, target)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`prototype: 引用路径越界，必须位于 ${PROTOTYPES_DIR}/${requirementId}/ 内`)
  }
  return normalized.replaceAll('\\', '/')
}

/**
 * 暂存原型的落点：`.spec/prototypes/<需求编号>/staged.json`。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号；调用方已校验。
 * @returns 暂存文件的绝对路径。
 */
export function prototypeStagedPath(specRoot: string, requirementId: string): string {
  return prototypePath(specRoot, requirementId, STAGED_FILE)
}

/**
 * 历史快照目录：`.spec/prototypes/<需求编号>/history/`。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号；调用方已校验。
 * @returns 快照目录的绝对路径。
 */
export function prototypeHistoryDir(specRoot: string, requirementId: string): string {
  return prototypePath(specRoot, requirementId, HISTORY_DIR)
}

/**
 * 校验快照编号：只允许固定的「毫秒-序号」形态，拒绝 `..` 与任何路径分隔符。
 * @param value - 来自界面或历史列表的编号。
 * @returns 原样返回校验过的编号。
 * @throws 编号不是安全形态。
 */
export function assertSnapshotId(value: string): string {
  const id = value.trim()
  if (id === '' || id === '.' || id === '..' || !SNAPSHOT_ID.test(id)) {
    throw new Error('prototype: 快照编号不合法')
  }
  return id
}

/**
 * 快照的落点：`.spec/prototypes/<需求编号>/history/<编号>.html`。
 * @param specRoot - 规格根。
 * @param requirementId - 需求编号；调用方已校验。
 * @param snapshotId - 已通过 `assertSnapshotId` 的编号。
 * @returns 快照文件的绝对路径。
 */
export function prototypeSnapshotPath(specRoot: string, requirementId: string, snapshotId: string): string {
  return prototypePath(specRoot, requirementId, HISTORY_DIR, `${assertSnapshotId(snapshotId)}.html`)
}
