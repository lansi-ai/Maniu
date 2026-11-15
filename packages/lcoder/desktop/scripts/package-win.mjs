/**
 * 产出 Maniu Windows 未签名安装包与 win-unpacked。
 *
 * 步骤：staging 壳产物 → 复制发布 profile 与图标 → pnpm deploy 宿主依赖树
 * → electron-builder（NSIS per-user）→ 打印字节。
 *
 * 用法：node packages/lcoder/desktop/scripts/package-win.mjs
 * 环境：LCODER_RELEASE_VERSION（默认 0.1.0）、LCODER_SKIP_DEPLOY=1 复用已部署树。
 * 签名、时间戳与 feed 不在本脚本内，见 lcoder/windows-packaging.md。
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createWindowsConfig, ARTIFACTS_DIR, BUILD_ROOT, IDENTITY } from './package-config.mjs'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..', '..')
const APP_DIR = join(BUILD_ROOT, 'app')
const DEPLOY_DIR = join(BUILD_ROOT, 'deploy')
const PROFILE_DIR = join(BUILD_ROOT, 'profile')
const CLIENT_DIST_DIR = join(BUILD_ROOT, 'client-dist')
const ICON_SOURCE = join(REPO_ROOT, 'apps', 'desktop', 'resources', 'icon-windows.png')
const TRAY_SOURCE = join(PACKAGE_ROOT, 'resources', 'tray-windows.ico')
const RUNTIME_DIR = join(REPO_ROOT, 'apps', 'desktop', '.desktop-build', 'targets', 'win-x64', 'runtime')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const RELEASE_VERSION = process.env.LCODER_RELEASE_VERSION ?? '0.1.0'

function log(message) {
  console.log(`[package-win] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: REPO_ROOT, ...options })
  if (result.status !== 0) throw new Error(`${command} 退出码 ${String(result.status)}`)
}

/** 直接跑 pnpm：Windows 上 CMD 外壳脚本不能由 spawn 直接执行，优先用 Corepack 的 JS 入口。 */
function runPnpm(args) {
  const entry = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js')
  if (existsSync(entry)) {
    run(process.execPath, [entry, ...args])
    return
  }
  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { shell: true })
}

function bytesOf(path) {
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? bytesOf(child) : statSync(child).size
  }
  return total
}

function stageApp() {
  rmSync(APP_DIR, { recursive: true, force: true })
  mkdirSync(join(APP_DIR, 'lib', 'types'), { recursive: true })
  const types = join(PACKAGE_ROOT, 'lib', 'types')
  assert(existsSync(join(types, 'main.js')), '缺少 lib/types/main.js；先 pnpm --filter @lcoder/desktop run build')
  for (const entry of readdirSync(types, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) cpSync(join(types, entry.name), join(APP_DIR, 'lib', 'types', entry.name))
  }
  cpSync(join(PACKAGE_ROOT, 'lib', 'preload.cjs'), join(APP_DIR, 'lib', 'preload.cjs'))
  writeFileSync(join(APP_DIR, 'package.json'), `${JSON.stringify({
    name: '@lcoder/desktop',
    productName: IDENTITY.productName,
    version: RELEASE_VERSION,
    description: 'Maniu 自研 Electron 壳',
    main: 'lib/types/main.js',
    type: 'module',
    author: 'Maniu',
    license: 'MIT',
  }, null, 2)}\n`)
  log(`staging 完成：${APP_DIR}`)
}

function stageResources() {
  rmSync(PROFILE_DIR, { recursive: true, force: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  for (const file of ['desktop-profile.patch.yml', 'host-only-profile.patch.yml', 'host-only-minimal.patch.yml', 'host-workbench.patch.yml']) {
    cpSync(join(REPO_ROOT, 'lcoder', file), join(PROFILE_DIR, file))
  }
  rmSync(CLIENT_DIST_DIR, { recursive: true, force: true })
  const clientDist = join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist')
  assert(existsSync(join(clientDist, 'index.html')), '缺少 client dist；先 pnpm --filter @lcoder/client run build')
  cpSync(clientDist, CLIENT_DIST_DIR, { recursive: true })
  assert(existsSync(ICON_SOURCE), `缺少应用图标 ${ICON_SOURCE}`)
  assert(existsSync(TRAY_SOURCE), `缺少托盘图标 ${TRAY_SOURCE}`)
}

function deployRuntimeTree() {
  if (process.env.LCODER_SKIP_DEPLOY === '1' && existsSync(join(DEPLOY_DIR, 'node_modules'))) {
    log(`复用已部署宿主依赖：${DEPLOY_DIR}`)
  } else {
    rmSync(DEPLOY_DIR, { recursive: true, force: true })
    mkdirSync(DEPLOY_DIR, { recursive: true })
    runPnpm(['--filter', '@lcoder/desktop', 'deploy', '--prod', '--legacy',
      '--config.node-linker=hoisted', '--config.allow-unused-patches=true', DEPLOY_DIR])
  }
  assert(existsSync(join(DEPLOY_DIR, 'node_modules', '@deepseek-ai', 'dsh')), '部署树缺少 @deepseek-ai/dsh')
  assert(existsSync(join(DEPLOY_DIR, 'lib', 'types', 'host-entry.js')), '部署树缺少 host-entry.js')
  const fixed = fixWorkspaceLinks(DEPLOY_DIR)
  log(`工作区链接保留 ${String(fixed)} 个，其余无关链接已删除`)
  const pruned = pruneDeploy(DEPLOY_DIR)
  log(`删除与发布 profile 无关的载荷 ${String(pruned.length)} 项`)
  refreshLcoderPackages(DEPLOY_DIR)
  assertDeployClean(DEPLOY_DIR)
}

/**
 * 部署树里的 LCoder 包是 pnpm 按 package.json `files` 拷的快照，代码分块可能漏项；
 * 从仓内源码目录整体刷新这两个包，保证宿主的入口与分块一致。
 * @param deployDir - 部署树根目录。
 */
function refreshLcoderPackages(deployDir) {
  for (const name of ['kernel', 'desktop']) {
    const source = join(REPO_ROOT, 'packages', 'lcoder', name)
    const target = join(deployDir, 'node_modules', '@lcoder', name)
    if (!existsSync(join(source, 'package.json')) || !existsSync(target)) continue
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: candidate => !['node_modules', '.desktop-build', 'tests'].includes(basename(candidate)),
    })
  }
}

/** 发布 profile 不加载的载荷：浏览器客户端、Office 转换、上游桌面端与实验包。 */
const PRUNED_PACKAGES = new Set([
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-shortcuts',
  '@deepseek-ai/dsh-client-resources',
  '@deepseek-ai/dsh-client-product-analytics',
  '@deepseek-ai/dsh-client-test-runtime',
  '@deepseek-ai/dsh-message-quotes',
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-deliverable-file-references',
  '@deepseek-ai/dsh-office-to-pdf',
  '@deepseek-ai/dsh-desktop',
])

function prunedByName(name) {
  return PRUNED_PACKAGES.has(name)
    || name.startsWith('@deepseek-ai/dsh-client-ui-')
    || name.startsWith('@deepseek-ai/dsh-experimental-')
    || name.startsWith('@deepseek-ai/dsh-cua')
    || name.startsWith('@deepseek-ai/dsh-browser-use')
    || name === '@deepseek-ai/dsh-python-runtime-closure'
    || name.startsWith('libreoffice-kit')
    || name.startsWith('@deepseek-ai/libreoffice-kit')
}

/**
 * hoisted deploy 会把 workspace 依赖留成指向 `.desktop-build/` 外的相对链接，
 * 并把无关 workspace 项目也挂进 node_modules。只保留 `@lcoder/desktop` 依赖
 * 闭包里的链接，并把它们复制成实体目录；其余链接删除。
 * @param deployDir - 部署树根目录。
 * @returns 保留并实体化的包数。
 */
function fixWorkspaceLinks(deployDir) {
  const modules = join(deployDir, 'node_modules')
  const manifest = JSON.parse(readFileSync(join(deployDir, 'package.json'), 'utf8'))
  const queue = Object.keys(manifest.dependencies ?? {})
  const visited = new Set()
  const sources = new Map()
  while (queue.length > 0) {
    const name = queue.pop()
    if (visited.has(name)) continue
    visited.add(name)
    const path = join(modules, name)
    let manifestPath
    if (isLink(path)) {
      const source = resolve(dirname(path), readlinkSync(path))
      if (!existsSync(join(source, 'package.json'))) continue
      manifestPath = join(source, 'package.json')
      sources.set(name, source)
    } else if (existsSync(join(path, 'package.json'))) {
      manifestPath = join(path, 'package.json')
    } else {
      continue
    }
    const packageManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    queue.push(...Object.keys(packageManifest.dependencies ?? {}))
    queue.push(...Object.keys(packageManifest.peerDependencies ?? {}))
  }
  let kept = 0
  for (const [name, source] of sources) {
    const path = join(modules, name)
    if (prunedByName(name)) continue
    rmSync(path, { force: true })
    cpSync(source, path, {
      recursive: true,
      dereference: true,
      filter: candidate => basename(candidate) !== 'node_modules',
    })
    kept += 1
  }
  // 依赖闭包之外的 workspace 链接（shared lockfile 会挂上全部 workspace 项目）一律删除；
  // 即使链接目标在当前机器上存在，它也不会随安装包分发。
  const dropUnreachable = parent => {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name)
      if (entry.isSymbolicLink()) {
        rmSync(path, { force: true })
      } else if (entry.isDirectory() && entry.name !== '.pnpm') {
        dropUnreachable(path)
      }
    }
  }
  dropUnreachable(modules)
  return kept
}

/** 是否是链接（含 junction）。 */
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * 删除发布 profile 永远不会 import 的包：它们的行在 `host-only-*` 里被禁用。
 * @param deployDir - 部署树根目录。
 * @returns 被删除的包名。
 */
function pruneDeploy(deployDir) {
  const modules = join(deployDir, 'node_modules')
  const removed = []
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('@')) {
      const scope = join(modules, entry.name)
      for (const child of readdirSync(scope, { withFileTypes: true })) {
        const name = `${entry.name}/${child.name}`
        if (!prunedByName(name)) continue
        rmSync(join(scope, child.name), { recursive: true, force: true })
        removed.push(name)
      }
      if (readdirSync(scope).length === 0) rmSync(scope, { recursive: true, force: true })
      continue
    }
    if (!prunedByName(entry.name)) continue
    rmSync(join(modules, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed
}

/**
 * 打包硬断言：这些载荷一旦出现就说明依赖闭包又长回去了。
 * @param deployDir - 部署树根目录。
 */
function assertDeployClean(deployDir) {
  const offenders = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        if (entry.name !== '.pnpm') offenders.push(`链接：${path}`)
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.pnpm') continue
        if (prunedByName(entry.name)) {
          offenders.push(path)
          continue
        }
        visit(path)
        continue
      }
      if (entry.name === 'electron.exe' || entry.name === 'node.exe') offenders.push(path)
    }
  }
  visit(deployDir)
  assert(offenders.length === 0, `部署树含禁止载荷：\n${offenders.join('\n')}`)
}

async function main() {
  const { build, Platform, Arch } = await import('electron-builder')
  stageApp()
  stageResources()
  deployRuntimeTree()
  const runtimeDir = existsSync(join(RUNTIME_DIR, 'primary-runtime', 'runtime.json')) ? RUNTIME_DIR : undefined
  if (runtimeDir === undefined) log(`跳过运行时载荷：未找到 ${RUNTIME_DIR}（工具命令可用的前提）`)
  const electronRoot = join(PACKAGE_ROOT, 'node_modules', 'electron')
  assert(existsSync(join(electronRoot, 'package.json')), '缺少 electron 依赖')
  const electronVersion = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).version
  rmSync(ARTIFACTS_DIR, { recursive: true, force: true })
  const config = createWindowsConfig({
    appDir: APP_DIR,
    deployDir: DEPLOY_DIR,
    profileDir: PROFILE_DIR,
    clientDistDir: CLIENT_DIST_DIR,
    iconPath: ICON_SOURCE,
    trayPath: TRAY_SOURCE,
    runtimeDir,
    version: RELEASE_VERSION,
    electronVersion,
    electronDist: join(electronRoot, 'dist'),
  })
  const started = Date.now()
  await build({ config, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64) })
  log(`electron-builder 完成（${String(Math.round((Date.now() - started) / 1000))} 秒）`)

  const unpacked = join(ARTIFACTS_DIR, 'win-unpacked')
  const installer = readdirSync(ARTIFACTS_DIR).find(name => name.endsWith('.exe'))
  assert(installer !== undefined, '没有产出安装包')
  const weight = {
    version: RELEASE_VERSION,
    installer: { path: join(ARTIFACTS_DIR, installer), bytes: bytesOf(join(ARTIFACTS_DIR, installer)) },
    winUnpacked: { path: unpacked, bytes: bytesOf(unpacked) },
    appAsar: { path: join(unpacked, 'resources', 'app.asar'), bytes: bytesOf(join(unpacked, 'resources', 'app.asar')) },
    deployTree: { path: DEPLOY_DIR, bytes: bytesOf(DEPLOY_DIR) },
    runtime: runtimeDir === undefined ? null : { path: runtimeDir, bytes: bytesOf(runtimeDir) },
    measuredAt: new Date().toISOString(),
  }
  mkdirSync(LOGS, { recursive: true })
  writeFileSync(join(LOGS, 't197-package-weight.json'), `${JSON.stringify(weight, null, 2)}\n`)
  console.log(JSON.stringify(weight, null, 2))
}

await main()
