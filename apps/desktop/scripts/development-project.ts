/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'
import { DESKTOP_RUNTIME_FILE, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'
import { desktopTargetPlatform } from './desktop-build-paths.mjs'
// lcoder: 输入指纹复用，避免每次启动重建整个项目目录。改什么、为什么见 lcoder/UPSTREAM-BASELINE.md 第 3 节。
import { fileStamp, inputsDigest, linkStamp, readCacheRecord, writeCacheRecord } from './development-cache.ts'

/** Record of the inputs that produced the current project directory. */
const CACHE_FILE = '.development-inputs.json'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
  /** Build target whose prepared payload the disposable project runs against. */
  readonly target: DesktopAutoUpdateTarget
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function mirrorDependencyLinks(sourceRoot: string, destinationRoot: string): string[] {
  const entries = dependencyLinkEntries(sourceRoot)
  for (const entry of entries) linkDirectory(entry.path, join(destinationRoot, entry.name))
  return entries.map(entry => entry.name)
}

/** One hoisted package link mirrored into the disposable project. */
interface DependencyLinkEntry {
  /** Package name, including its scope when present. */
  readonly name: string
  /** Existing hoisted path the project links to. */
  readonly path: string
}

function dependencyLinkEntries(sourceRoot: string): DependencyLinkEntry[] {
  const entries: DependencyLinkEntry[] = []
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        entries.push({ name: `${entry.name}/${scoped.name}`, path: join(source, scoped.name) })
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) entries.push({ name: entry.name, path: source })
  }
  return entries
}

/** Configured workspace plugins must resolve from the profile even when pnpm does not hoist them. */
function mirrorWorkspaceDependencies(roots: readonly string[], destinationRoot: string): string[] {
  const names: string[] = []
  const visited = new Set<string>()
  const visit = (directory: string): void => {
    const source = realpathSync(directory)
    if (visited.has(source)) return
    visited.add(source)
    const manifest = readManifest(join(source, 'package.json'))
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      if (!specifier.startsWith('workspace:')) continue
      const dependency = join(source, 'node_modules', ...name.split('/'))
      if (!existsSync(dependency)) {
        throw new Error(`desktop development: ${name} is missing from ${source}; run pnpm install`)
      }
      const destination = join(destinationRoot, ...name.split('/'))
      removeOwnedPath(destination)
      linkDirectory(dependency, destination)
      names.push(name)
      visit(dependency)
    }
  }
  for (const directory of roots) visit(directory)
  return names
}

/**
 * Identify the workspace links the disposable project mirrors without creating them.
 * @param roots - Workspace packages whose dependencies are mirrored.
 * @returns Name and identity of every reachable workspace dependency.
 */
function workspaceDependencyStamps(roots: readonly string[]): string[] {
  const stamps: string[] = []
  const visited = new Set<string>()
  const visit = (directory: string): void => {
    const source = realpathSync(directory)
    if (visited.has(source)) return
    visited.add(source)
    const manifest = readManifest(join(source, 'package.json'))
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      if (!specifier.startsWith('workspace:')) continue
      const dependency = join(source, 'node_modules', ...name.split('/'))
      stamps.push(existsSync(dependency)
        ? `${name} ${realpathSync(dependency)} ${fileStamp(join(dependency, 'package.json'))}`
        : `${name} missing`)
      if (existsSync(dependency)) visit(dependency)
    }
  }
  for (const directory of roots) visit(directory)
  return stamps.sort()
}

function linkedTo(link: string, target: string): boolean {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  return stat.isSymbolicLink() && realpathSync(link) === realpathSync(target)
}

function projectInputsDigest(
  options: DevelopmentProjectOptions, cliManifest: PackageManifest, hostManifest: PackageManifest,
): string {
  return inputsDigest({
    format: 1,
    release: options.release,
    target: options.target,
    platform: desktopTargetPlatform(options.target),
    cli: `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    host: `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    dependencyLinks: dependencyLinkEntries(options.dependencyDir).map(entry => `${entry.name} ${linkStamp(entry.path)}`).sort(),
    workspaceDependencies: workspaceDependencyStamps([options.cliDir, options.hostDir]),
    hostEntry: fileStamp(join(options.hostDir, 'lib', 'index.js')),
    generator: [join(import.meta.dirname, 'development-project.ts'), join(import.meta.dirname, 'development-cache.ts'),
      join(import.meta.dirname, '..', 'src', 'project-manager.ts'), join(import.meta.dirname, '..', 'src', 'runtime-tree.ts')]
      .map(path => `${path} ${fileStamp(path)}`),
  })
}

function projectReusable(options: DevelopmentProjectOptions, digest: string): boolean {
  if (readCacheRecord(join(options.projectDir, CACHE_FILE))?.inputs !== digest) return false
  const modules = join(options.projectDir, 'node_modules')
  return existsSync(join(options.projectDir, 'package.json'))
    && existsSync(join(options.projectDir, DESKTOP_RUNTIME_FILE))
    && linkedTo(join(modules, '@deepseek-ai', 'dsh'), options.cliDir)
    && linkedTo(join(modules, '@deepseek-ai', 'dsh-desktop-host'), options.hostDir)
}

/**
 * Replace one disposable project with links to the current built workspace.
 * An unchanged input set reuses the previous directory: links address workspace packages in place,
 * so only added, removed, or retargeted links change the result.
 * @param options - Project destination, CLI package, release identity, and build target.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @deepseek-ai/dsh@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@deepseek-ai/dsh-desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @deepseek-ai/dsh-desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }
  const digest = projectInputsDigest(options, cliManifest, hostManifest)
  if (projectReusable(options, digest)) return options.projectDir

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  const names = [
    ...mirrorDependencyLinks(options.dependencyDir, destinationModules),
    ...mirrorWorkspaceDependencies([options.cliDir, options.hostDir], destinationModules),
  ]
  const dshLink = join(destinationModules, '@deepseek-ai', 'dsh')
  removeOwnedPath(dshLink)
  linkDirectory(options.cliDir, dshLink)
  const hostLink = join(destinationModules, '@deepseek-ai', 'dsh-desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  const sharedPackages = [...new Set([...names, '@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'])].flatMap((name) => {
    const manifest = readManifest(join(destinationModules, name, 'package.json'))
    return typeof manifest.version === 'string' ? [{ name, version: manifest.version, path: `node_modules/${name}` }] : []
  })
  const runtime: DesktopRuntimeDescriptor = { schemaVersion: 1, release: options.release,
    ...desktopTargetPlatform(options.target), sharedPackages, files: [] }
  writeFileSync(join(options.projectDir, DESKTOP_RUNTIME_FILE), `${JSON.stringify(runtime, undefined, 2)}\n`)
  writeCacheRecord(join(options.projectDir, CACHE_FILE), { inputs: digest })
  return options.projectDir
}
