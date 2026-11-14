/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { electronNodeVersion } from './electron-node-version.ts'
import { prepareDevelopmentRuntime } from './prepare-development-runtime.ts'
import { recordedBuildReusable, recordSuccessfulBuild, workspaceInputsDigest } from './development-build-cache.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

async function launchElectron(): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    // lcoder: 产物输入未变时跳过构建（默认启动占 52 秒的那一步）；判据见 development-build-cache.ts。
    const build = { root: REPOSITORY_ROOT, recordPath: join(DEVELOPMENT_ROOT, 'build-inputs.json'),
      digest: workspaceInputsDigest(REPOSITORY_ROOT) }
    if (recordedBuildReusable(build)) {
      console.log('desktop development: workspace inputs unchanged; reusing built artifacts')
    } else {
      await runPackageScript('build:artifacts', REPOSITORY_ROOT)
      await runPackageScript('build', APP_ROOT)
      recordSuccessfulBuild(build, build.digest)
    }
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const electron = createRequire(import.meta.url)('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: electronNodeVersion(electron, join(DEVELOPMENT_ROOT, 'electron-node-version.json')),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  // lcoder: 运行时冒烟（打包 python 三条检查加 Office 往返）是发布验收的口径，每次开发启动
  // 跑一遍要百秒级；产物没变、只想开窗时可用 DSH_DESKTOP_SKIP_RUNTIME_SMOKE=1 跳过。
  // 运行时内容未变的复用由 prepareDevelopmentRuntime 决定，跳过冒烟不等于跳过产物就绪检查。
  await prepareDevelopmentRuntime({ deferSmoke: process.env.DSH_DESKTOP_SKIP_RUNTIME_SMOKE === '1' })
  await launchElectron()
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
