/** Decide whether a development launch may reuse the workspace artifacts built by the previous one. */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readCacheRecord, writeCacheRecord } from './development-cache.ts'

/** Bump when the recorded input set or digest format changes. */
const RECORD_FORMAT = 1

/** Workspace trees every artifact build reads; `patches/` carries dependency patch sources. */
const INPUT_ROOTS = ['packages', 'apps', 'vendor', 'native', 'scripts', 'patches'] as const

/** Root configuration the build graph reads before compiling anything. */
const ROOT_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsdown.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.base.client.json',
  'tsconfig.client.json',
  'tsconfig.host.json',
  'tsconfig.node.base.json',
] as const

/** Outputs that must already exist before a recorded digest may skip the build. */
const REQUIRED_ARTIFACTS = [
  'apps/web/dist/index.html',
  '.dsh-build/client-build-environment.json',
  'apps/desktop/lib/main.js',
  'apps/desktop-host/lib/index.js',
] as const

/** Directory names that carry dependencies or build outputs rather than inputs. */
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'lib', 'dist', 'build', 'coverage', '.vite', '.desktop-build', 'obj', 'bin'])

/** Inputs of the recorded build, and where the record lives. */
export interface DevelopmentBuildInputs {
  /** Repository root whose artifacts the development launch runs. */
  readonly root: string
  /** Record written after the last complete artifact build. */
  readonly recordPath: string
  /** Digest of the inputs observed before this launch. */
  readonly digest: string
}

function isExcluded(relative: string): boolean {
  const name = relative.slice(relative.lastIndexOf('/') + 1)
  if (EXCLUDED_DIRECTORIES.has(name)) return true
  // Package tests compile in the aggregate check programs, never into artifacts.
  if (name === 'tests') return true
  // Development and packaging scripts run or ship artifacts; they do not change their bytes.
  return /^apps\/[^/]+\/scripts$/u.test(relative)
}

/**
 * Digest every workspace input the artifact build reads.
 * @param root - Repository root.
 * @returns SHA-256 over the digestable content of each input file.
 */
export function workspaceInputsDigest(root: string): string {
  const digest = createHash('sha256')
  const add = (relative: string): void => {
    digest.update(`${relative}\0`)
    try {
      digest.update(readFileSync(join(root, relative)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      digest.update('missing')
    }
  }
  const walk = (relative: string): void => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (!isExcluded(path)) walk(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        digest.update(`${path}\0link:${readlinkSync(join(root, path))}`)
        continue
      }
      if (entry.isFile()) add(path)
    }
  }
  for (const relative of ROOT_INPUTS) add(relative)
  for (const name of INPUT_ROOTS) {
    if (existsSync(join(root, name))) walk(name)
  }
  return digest.digest('hex')
}

/**
 * Decide whether the recorded build still describes the current inputs and left its outputs in place.
 * @param inputs - Repository root, record location, and the digest observed before this launch.
 * @returns `true` when the launch may skip `build:artifacts` and the Desktop bundle.
 */
export function recordedBuildReusable(inputs: DevelopmentBuildInputs): boolean {
  const record = readCacheRecord(inputs.recordPath)
  if (record?.format !== RECORD_FORMAT || record.inputs !== inputs.digest) return false
  return REQUIRED_ARTIFACTS.every(path => existsSync(join(inputs.root, path)))
}

/**
 * Record one complete artifact build so the next unchanged launch can skip it.
 * @param inputs - Repository root and record location.
 * @param digest - Digest observed before the build that just succeeded.
 */
export function recordSuccessfulBuild(inputs: Pick<DevelopmentBuildInputs, 'root' | 'recordPath'>, digest: string): void {
  writeCacheRecord(inputs.recordPath, { format: RECORD_FORMAT, inputs: digest, builtAt: new Date().toISOString() })
}
