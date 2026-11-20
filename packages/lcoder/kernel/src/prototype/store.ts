/**
 * 原型附件的持久化：把参考图写进 `.spec/prototypes/<编号>/refs/`，并支持清除。
 *
 * 与聊天附件不同，这些文件是需求原型的持久产物，不属于任何会话回执。
 * 文件名一律清洗成叶子名，路径仍经过 `prototypePath` 的越界校验。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { loadRequirement, saveRequirement } from '../kernel/requirement-store.js'
import { prototypePath } from './paths.js'

/** 单张参考图的体积上限（字节）。 */
export const MAX_REF_BYTES = 2 * 1024 * 1024

/** 参考附件落盘的根目录段。 */
const REFS_DIR = 'refs'

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
