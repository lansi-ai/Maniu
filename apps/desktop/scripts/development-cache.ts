/** Reuse records for repeated development launches, keyed by the inputs that produce each prepared artifact. */

import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Modification time and size of one path, used as its cache identity. */
export function fileStamp(path: string): string {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  return `${String(stat.mtimeMs)}:${String(stat.size)}`
}

/** Identity of the link itself; unlike {@link fileStamp} it does not follow a junction to its target. */
export function linkStamp(path: string): string {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  return `${stat.isSymbolicLink() ? 'link' : 'entry'}:${String(stat.mtimeMs)}:${String(stat.size)}`
}

/**
 * Digest the names, sizes, and modification times of a complete directory tree.
 * @param root - Directory whose contents identify one generated resource.
 * @returns SHA-256 digest independent of directory-listing order.
 */
export function treeDigest(root: string): string {
  const entries: string[] = []
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, relative)
      else entries.push(`${relative} ${fileStamp(path)}`)
    }
  }
  walk(root, '')
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

/**
 * Digest arbitrary cache inputs after stable serialization.
 * @param value - JSON-serializable inputs in a caller-controlled key order.
 * @returns SHA-256 digest of the serialized inputs.
 */
export function inputsDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Read one JSON object record.
 * @param path - Record location inside a build directory.
 * @returns The recorded fields, or `undefined` when the record is absent or unreadable JSON.
 */
export function readCacheRecord(path: string): Record<string, unknown> | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    // A record truncated by an interrupted launch only costs one rebuild.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Replace one JSON cache record atomically, so an interrupted launch never leaves a partial marker.
 * @param path - Record location inside a build directory.
 * @param record - Serializable fields describing the cached inputs.
 */
export function writeCacheRecord(path: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(record, undefined, 2)}\n`)
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
