/** Reuse an unchanged prepared primary runtime across development launches. */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { fileStamp, inputsDigest, readCacheRecord, writeCacheRecord } from './development-cache.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const LOCK_PATH = join(REPOSITORY_ROOT, 'scripts', 'primary-runtime', 'lock.json')
const CACHE_PATH = join(APP_ROOT, '.desktop-build', 'development', 'primary-runtime.json')
/** Bump when the reuse record's fields change meaning. */
const CACHE_FORMAT = 2

/** Sources whose edits change payload bytes without changing the locked inputs. */
const ASSEMBLY_SOURCES = [
  join(REPOSITORY_ROOT, 'scripts', 'primary-runtime', 'prepare.ts'),
  join(REPOSITORY_ROOT, 'scripts', 'primary-runtime', 'prune-python-tests.ts'),
  join(REPOSITORY_ROOT, 'packages', 'skill', 'tool-workspace-dependencies', 'src', 'index.ts'),
  join(APP_ROOT, 'scripts', 'prepare-primary-runtime.ts'),
]

interface PrimaryRuntimeLock {
  readonly nodeVersion: string
}

/** Fields the prepared payload's `runtime.json` must record for the current inputs. */
export interface PayloadIdentity {
  readonly desktopVersion: string
  readonly platform: string
  readonly arch: string
  readonly node: string
  readonly pnpm: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pnpmIdentity(): { version: string; path: string; manifest: string } {
  const manifest = createRequire(import.meta.url).resolve('pnpm')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  return { version, path: realpathSync(dirname(manifest)), manifest: fileStamp(manifest) }
}

function cacheInputs(
  target: string, desktopVersion: string, pnpm: ReturnType<typeof pnpmIdentity>,
): Record<string, unknown> {
  return {
    format: CACHE_FORMAT,
    target,
    desktopVersion,
    pnpm,
    lock: JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as Record<string, unknown>,
    lockStamp: fileStamp(LOCK_PATH),
    assembly: ASSEMBLY_SOURCES.map(path => `${path} ${fileStamp(path)}`),
  }
}

function recordedIdentity(runtimeRoot: string): Record<string, unknown> | undefined {
  let text: string
  try {
    text = readFileSync(join(runtimeRoot, 'primary-runtime', 'runtime.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

function payloadEntries(runtimeRoot: string, identity: PayloadIdentity): string[] {
  const payload = join(runtimeRoot, 'primary-runtime')
  const windows = identity.platform === 'win32'
  return [
    join(payload, 'runtime.json'),
    join(payload, 'dependencies', 'node', 'bin', windows ? 'node.exe' : 'node'),
    join(payload, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
  ]
}

/**
 * Decide whether the prepared payload still matches the inputs that produced it.
 * Content is not re-hashed; `-Smoke` executes the payload and every assembly input is part of the digest.
 * @param runtimeRoot - Target runtime directory holding `primary-runtime/`.
 * @param identity - Versions and platform the payload must record and provide.
 * @returns `true` when the recorded manifest matches and every entry point exists.
 */
export function payloadReusable(runtimeRoot: string, identity: PayloadIdentity): boolean {
  const recorded = recordedIdentity(runtimeRoot)
  if (recorded === undefined) return false
  for (const field of ['desktopVersion', 'platform', 'arch', 'node', 'pnpm'] as const) {
    if (recorded[field] !== identity[field]) return false
  }
  for (const path of payloadEntries(runtimeRoot, identity)) {
    if (!existsSync(path)) return false
  }
  return true
}

/**
 * Ensure the development launch's primary runtime matches the locked inputs.
 * @param options - Native-target smoke checks run unless the caller defers them.
 */
export async function prepareDevelopmentRuntime(options: { deferSmoke: boolean }): Promise<void> {
  const target = resolveDesktopBuildTarget()
  const paths = resolveDesktopTargetBuildPaths()
  const platform = desktopTargetPlatform(target)
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const pnpm = pnpmIdentity()
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as PrimaryRuntimeLock
  const identity: PayloadIdentity = {
    desktopVersion: version, ...platform, node: lock.nodeVersion, pnpm: pnpm.version,
  }
  const digest = inputsDigest(cacheInputs(target, version, pnpm))
  const payload = join(paths.runtime, 'primary-runtime')
  if (readCacheRecord(CACHE_PATH)?.inputs !== digest || !payloadReusable(paths.runtime, identity)) {
    const { preparePrimaryRuntime } = await import('./prepare-primary-runtime.ts')
    await preparePrimaryRuntime({ deferSmoke: true })
    writeCacheRecord(CACHE_PATH, { inputs: digest, target, preparedAt: new Date().toISOString() })
  }
  if (!options.deferSmoke) {
    const { smokePrimaryRuntime } = await import('./prepare-primary-runtime.ts')
    smokePrimaryRuntime(payload)
  }
}
