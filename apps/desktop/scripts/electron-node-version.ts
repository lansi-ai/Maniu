/** Electron's bundled Node.js version, cached against the executable's identity. */

import { execFileSync } from 'node:child_process'
import { fileStamp, readCacheRecord, writeCacheRecord } from './development-cache.ts'

const NODE_VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u

/**
 * Resolve the Node.js version the Electron runtime reports.
 * @param executable - Electron executable resolved from the installed package.
 * @param recordPath - Cache record keyed by the executable path, size, and modification time.
 * @returns `process.versions.node` of the Electron runtime.
 */
export function electronNodeVersion(executable: string, recordPath: string): string {
  const stamp = fileStamp(executable)
  const record = readCacheRecord(recordPath)
  if (record?.executable === executable && record.stamp === stamp
    && typeof record.nodeVersion === 'string' && NODE_VERSION.test(record.nodeVersion)) {
    return record.nodeVersion
  }
  const nodeVersion = execFileSync(executable, ['-p', 'process.versions.node'],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim()
  if (!NODE_VERSION.test(nodeVersion)) {
    throw new Error(`desktop development: ${executable} reported an unusable Node version ${JSON.stringify(nodeVersion)}`)
  }
  writeCacheRecord(recordPath, { executable, stamp, nodeVersion })
  return nodeVersion
}
