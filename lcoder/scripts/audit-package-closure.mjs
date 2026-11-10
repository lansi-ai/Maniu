#!/usr/bin/env node
/**
 * 只读闭包审计：扫描 pnpm workspace 的全部包，按运行时 / 构建 / 测试三闭包分类。
 *
 * 口径：
 * - 运行时根：desktop profile 的 bundle、core package set 根（@deepseek-ai/dsh 与
 *   dsh-desktop-host）、apps/desktop 与 desktop-host 的依赖、profile 里的插件名，
 *   再沿 dependencies / peerDependencies / optionalDependencies 与包内 cordis 补丁递归。
 * - 构建根：根 tsconfig.host/client 的 references 与 include、根 tsdown workspace、
 *   build / run-gates 驱动脚本以及 electron-builder 与 prepare-* 脚本的 workspace import。
 * - 测试根：包内 tests、测试文件导入的包、snapshots、website、benchmarks、python 运行时闭包。
 * - 候选：三闭包都不可达的包。分类优先级为运行时 > 构建 > 测试。
 *
 * 用法：
 *   node lcoder/scripts/audit-package-closure.mjs [--json <path>] [--no-dates] [--no-links] [--check]
 *
 * `--check` 会重复执行一次比对结果并校验分类不变量（确定性自测），不写任何文件。
 * 脚本只读仓库；唯一的写操作是显式传入的 `--json` 输出路径。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..', '..')

const RUNTIME_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies']
const ALL_SECTIONS = [...RUNTIME_SECTIONS, 'devDependencies']
const QUOTED_WORKSPACE_NAME = /['"](@(?:deepseek-ai|lcoder)\/[a-z0-9][a-z0-9._~-]*(?:\/[a-z0-9._~-]+)*)['"]/gu
const UNQUOTED_WORKSPACE_NAME = /(?:^|\s)name:\s*(@(?:deepseek-ai|lcoder)\/[a-z0-9][a-z0-9._~-]*(?:\/[a-z0-9._~-]+)*)/gmu

/** 构建驱动文件：它们的 workspace import 计入构建闭包。 */
const BUILD_DRIVER_FILES = [
  'scripts/build.ts',
  'scripts/compile-referenced-projects.ts',
  'scripts/generate-typert.ts',
  'scripts/run-gates.ts',
  'scripts/run-oxlint.ts',
  'scripts/publint-all.ts',
  'scripts/client-build-environment.ts',
  'tsdown.config.ts',
  'packages/tsdown.worker.ts',
  'apps/desktop/tsdown.config.ts',
  'apps/desktop/electron-builder.config.mjs',
  'apps/desktop/scripts/electron-builder-config.mjs',
  'apps/desktop/scripts/desktop-build-paths.mjs',
  'apps/desktop/scripts/package-target.ts',
  'apps/desktop/scripts/dev.ts',
  'native/system/scripts/build.ts',
]

/** 构建入口扫描目录：electron-builder 与 prepare / packaging 脚本的 import。 */
const BUILD_DRIVER_DIRS = ['apps/desktop/scripts']

/** 运行时插件名来源：可提交的 profile 源与生成的运行副本（存在才读）。 */
const PROFILE_FILES = [
  'lcoder/desktop-profile.patch.yml',
  'lcoder/cordis.patch.yml',
]

function toPosix(value) {
  return value.split(sep).join('/')
}

function repoPath(absPath) {
  const rel = toPosix(relative(ROOT, absPath))
  return rel === '' ? '.' : rel
}

function parseArgs(argv) {
  const options = { json: undefined, dates: true, links: true, check: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--json':
        index += 1
        if (argv[index] === undefined) throw new Error('--json 需要一个输出路径')
        options.json = resolve(argv[index])
        break
      case '--no-dates':
        options.dates = false
        break
      case '--no-links':
        options.links = false
        break
      case '--check':
        options.check = true
        break
      case '--help':
      case '-h':
        console.log('用法：node lcoder/scripts/audit-package-closure.mjs [--json <path>] [--no-dates] [--no-links] [--check]')
        process.exit(0)
        break
      default:
        throw new Error(`未知选项 ${JSON.stringify(arg)}`)
    }
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * 去掉 tsconfig 的行注释与块注释，保留字符串内容。
 * @param {string} text - JSONC 文本。
 * @returns {string} 可交给 JSON.parse 的文本。
 */
function stripJsonComments(text) {
  let output = ''
  let index = 0
  let inString = false
  let quote = ''
  let inLineComment = false
  let inBlockComment = false
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        output += char
      }
      index += 1
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 2
        continue
      }
      index += 1
      continue
    }
    if (inString) {
      output += char
      if (char === '\\') {
        output += next ?? ''
        index += 2
        continue
      }
      if (char === quote) inString = false
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      inLineComment = true
      index += 2
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 2
      continue
    }
    output += char
    index += 1
  }
  return output
}

function parseJsonc(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8')))
}

/** 读取 pnpm-workspace.yaml 的 `packages` 列表；只处理这个单层列表。 */
function workspacePatterns() {
  const lines = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/u)
  const patterns = []
  let inPackages = false
  for (const line of lines) {
    if (/^packages:\s*$/u.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const item = /^\s+-\s+(.+?)\s*$/u.exec(line)
    if (item !== null) {
      patterns.push(item[1].replace(/^['"]|['"]$/gu, ''))
      continue
    }
    if (/^\S/u.test(line)) break
  }
  if (patterns.length === 0) throw new Error('pnpm-workspace.yaml 没有 packages 列表')
  return patterns
}

function packageGroup(dir) {
  if (dir.startsWith('packages/')) return dir.split('/')[1]
  if (dir.startsWith('vendor/')) return 'vendor'
  if (dir.startsWith('native/')) return 'native'
  if (dir.startsWith('apps/')) return 'apps'
  return dir.split('/')[0]
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(2)} ${unit}`
}

export function discoverPackages() {
  const patterns = workspacePatterns()
  const dirs = new Set()
  for (const pattern of patterns) {
    for (const packageJson of globSync(`${pattern}/package.json`, { cwd: ROOT })) {
      dirs.add(toPosix(dirname(packageJson)))
    }
  }
  const packages = new Map()
  const byDir = new Map()
  const add = (dir, manifest, origin) => {
    if (typeof manifest.name !== 'string' || manifest.name === '') {
      throw new Error(`${dir}/package.json 没有包名`)
    }
    if (packages.has(manifest.name)) throw new Error(`workspace 包名重复: ${manifest.name}`)
    const pkg = {
      name: manifest.name,
      dir,
      abs: dir === '.' ? ROOT : join(ROOT, dir),
      origin,
      group: packageGroup(dir),
      private: manifest.private === true,
      manifest,
      files: 0,
      bytes: 0,
      testFiles: 0,
      edges: [],
      runtimeEdges: [],
      devEdges: [],
      incomingEdges: 0,
      incomingLinks: 0,
    }
    packages.set(pkg.name, pkg)
    byDir.set(dir, pkg)
  }
  for (const dir of [...dirs].sort()) {
    add(dir, readJson(join(ROOT, dir, 'package.json')), 'workspace')
  }
  add('.', readJson(join(ROOT, 'package.json')), 'root')
  return { patterns, packages, byDir }
}

/** 最长前缀匹配：把一个仓库内路径（文件或目录）映射到所属包目录。 */
export function ownerDirForPath(file, byDir) {
  const parts = file.split('/')
  for (let end = parts.length; end >= 1; end -= 1) {
    const candidate = parts.slice(0, end).join('/')
    if (byDir.has(candidate)) return candidate
  }
  return '.'
}

export function attachDependencyEdges(packages, byDir) {
  for (const pkg of packages.values()) {
    for (const section of ALL_SECTIONS) {
      const entries = pkg.manifest[section]
      if (entries === undefined || entries === null) continue
      if (typeof entries !== 'object' || Array.isArray(entries)) {
        throw new Error(`${pkg.dir}/package.json 的 ${section} 不是对象`)
      }
      for (const [name, spec] of Object.entries(entries)) {
        const edge = { name, section, spec: String(spec) }
        pkg.edges.push(edge)
        const target = packages.get(name)
        if (target === undefined) continue
        edge.workspace = true
        target.incomingEdges += 1
        if (section === 'devDependencies') pkg.devEdges.push(edge)
        else pkg.runtimeEdges.push(edge)
      }
    }
  }
  // 根清单不是可删除的包，但它声明的 workspace 边同样会在 install 时落成链接。
  return byDir
}

/** 用一次 git ls-files 建立「文件 → 所属包」映射，统计受版本控制的文件数与字节数。 */
export function attachFileStats(packages, byDir) {
  const output = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '.'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const files = output.split('\0').filter(file => file !== '')
  const testFilePattern = /^(?:packages\/[^/]+\/[^/]+\/tests\/|apps\/[^/]+\/tests\/|website\/tests\/|snapshots\/|benchmarks\/|scripts\/.*\.spec\.(?:ts|tsx)$)/u
  for (const file of files) {
    const dir = ownerDirForPath(file, byDir)
    const pkg = byDir.get(dir)
    if (pkg === undefined) continue
    let bytes = 0
    try {
      bytes = statSync(join(ROOT, file)).size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    pkg.files += 1
    pkg.bytes += bytes
    if (testFilePattern.test(file)) pkg.testFiles += 1
  }
  return files
}

/** 统计实际 node_modules 里指向 workspace 包的符号链接；没有安装时返回 null。 */
export function countWorkspaceLinks(packages, byDir) {
  const scopeNames = ['@deepseek-ai', '@lcoder']
  const links = []
  for (const pkg of packages.values()) {
    const modules = join(pkg.abs, 'node_modules')
    if (!existsSync(modules)) continue
    for (const scope of scopeNames) {
      const scopeDir = join(modules, scope)
      if (!existsSync(scopeDir)) continue
      for (const entry of globSync('*', { cwd: scopeDir })) {
        const linkPath = join(scopeDir, entry)
        let stat
        try {
          stat = lstatSync(linkPath)
        } catch {
          continue
        }
        if (!stat.isSymbolicLink()) continue
        let target
        try {
          target = repoPath(realpathSync(linkPath))
        } catch {
          continue
        }
        const targetDir = ownerDirForPath(target, byDir)
        const targetPackage = byDir.get(targetDir)
        if (targetPackage === undefined || targetPackage.dir === '.') continue
        targetPackage.incomingLinks += 1
        links.push({ from: pkg.dir, to: targetPackage.name })
      }
    }
  }
  return links
}

/** 把 import / YAML 里的包名截短到 workspace 中真实存在的最长包名。 */
export function resolveWorkspaceName(spec, packages) {
  let candidate = spec
  while (candidate.length > 0) {
    if (packages.has(candidate)) return candidate
    const slash = candidate.lastIndexOf('/')
    if (slash <= 0) return undefined
    candidate = candidate.slice(0, slash)
  }
  return undefined
}

/** 从一个文本文件里收集所有能解析到 workspace 包的裸包名。 */
export function workspaceNamesInText(text, packages) {
  const names = new Set()
  for (const pattern of [QUOTED_WORKSPACE_NAME, UNQUOTED_WORKSPACE_NAME]) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const resolved = resolveWorkspaceName(match[1], packages)
      if (resolved !== undefined) names.add(resolved)
    }
  }
  return names
}

/** 读取文件；不存在或过大时返回 undefined。 */
function readTextIfPresent(path, maxBytes = 2 * 1024 * 1024) {
  if (!existsSync(path)) return undefined
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > maxBytes) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 包内运行时插件名：包根与 presets 下的 cordis / patch YAML。 */
export function packagePluginNames(pkg, packages, cache) {
  if (cache.has(pkg.name)) return cache.get(pkg.name)
  const names = new Set()
  if (pkg.dir !== '.') {
    const candidates = [
      ...globSync('*.yml', { cwd: pkg.abs }),
      ...globSync('*.yaml', { cwd: pkg.abs }),
      ...globSync('presets/*.yml', { cwd: pkg.abs }),
    ]
    for (const file of candidates.sort()) {
      const text = readTextIfPresent(join(pkg.abs, file))
      if (text === undefined) continue
      for (const name of workspaceNamesInText(text, packages)) names.add(name)
    }
  }
  cache.set(pkg.name, names)
  return names
}

/** profile 源文本、生成的运行副本与 official bundle 清单里的插件 / bundle 名。 */
export function profileRuntimeNames(packages) {
  const reasons = new Map()
  const addText = (text, reason) => {
    if (text === undefined) return
    for (const name of workspaceNamesInText(text, packages)) {
      if (!reasons.has(name)) reasons.set(name, reason)
    }
  }
  for (const file of PROFILE_FILES) addText(readTextIfPresent(join(ROOT, file)), `profile:${file}`)
  for (const profileJson of globSync('apps/desktop/.desktop-build/**/profiles/*/package.json', { cwd: ROOT })) {
    const text = readTextIfPresent(join(ROOT, toPosix(profileJson)))
    if (text === undefined) continue
    try {
      const manifest = JSON.parse(text)
      for (const bundle of manifest?.dsh?.profile?.bundles ?? []) {
        const name = resolveWorkspaceName(String(bundle), packages)
        if (name !== undefined && !reasons.has(name)) reasons.set(name, 'profile bundle')
      }
      for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
        const name = resolveWorkspaceName(dependency, packages)
        if (name !== undefined && !reasons.has(name)) reasons.set(name, 'profile link dependency')
      }
    } catch {
      // 生成目录里的损坏副本不参与闭包；运行副本不是审计数据源。
    }
  }
  // 只要 Desktop profile 实际装载的 bundle；OPTIONAL 由 @deepseek-ai/dsh 的依赖覆盖，
  // ON_DEMAND 是从 npm 现装的插件，不在 core package set 里。
  const bundles = readTextIfPresent(join(ROOT, 'packages/util/official-bundles/src/bundles.ts'))
  if (bundles !== undefined) {
    const webTemplate = /web:\s*\{[^}]*bundles:\s*\[([^\]]*)\]/u.exec(bundles)
    if (webTemplate !== null) addText(webTemplate[1], 'PROFILE_TEMPLATES.web')
  }
  return reasons
}

/** 构建驱动与打包脚本里 import 的 workspace 包。 */
export function buildDriverNames(packages) {
  const names = new Map()
  const addFile = (relPath) => {
    const text = readTextIfPresent(join(ROOT, relPath))
    if (text === undefined) return
    for (const name of workspaceNamesInText(text, packages)) {
      if (!names.has(name)) names.set(name, `build-driver:${relPath}`)
    }
  }
  for (const file of BUILD_DRIVER_FILES) addFile(file)
  for (const dir of BUILD_DRIVER_DIRS) {
    for (const file of globSync('*.{ts,mjs,mts}', { cwd: join(ROOT, dir) }).sort()) {
      addFile(`${dir}/${toPosix(file)}`)
    }
  }
  return names
}

/**
 * 把根 tsconfig 的 references 与 include 映射到包。
 * @returns {Map<string, string>} 包名 → 原因。
 */
export function buildConfigNames(packages, byDir) {
  const names = new Map()
  const addOwner = (pattern, reason) => {
    const literal = pattern.replace(/\/?\*.*$/u, '').replace(/\/+$/u, '')
    const dir = ownerDirForPath(literal === '' ? '.' : literal, byDir)
    const pkg = byDir.get(dir)
    if (pkg !== undefined && pkg.dir !== '.') {
      if (!names.has(pkg.name)) names.set(pkg.name, reason)
    }
  }
  for (const face of ['host', 'client']) {
    const configPath = join(ROOT, `tsconfig.${face}.json`)
    if (!existsSync(configPath)) continue
    const config = parseJsonc(configPath)
    for (const reference of config.references ?? []) {
      const abs = resolve(ROOT, reference.path)
      const dir = existsSync(abs) && statSync(abs).isFile() ? dirname(abs) : abs
      const pkg = byDir.get(repoPath(dir))
      if (pkg !== undefined && pkg.dir !== '.') {
        if (!names.has(pkg.name)) names.set(pkg.name, `tsconfig.${face}.references`)
      }
    }
    for (const include of config.include ?? []) addOwner(String(include), `tsconfig.${face}.include`)
  }
  return names
}

/** 根 tsdown 配置把 packages/* 与 vendor/* 全部列进 workspace，逐包产出 lib。 */
export function tsdownWorkspaceNames(packages) {
  const names = new Map()
  const text = readTextIfPresent(join(ROOT, 'tsdown.config.ts'))
  if (text === undefined) return names
  for (const pattern of ['packages/*/*', 'vendor/*']) {
    if (!text.includes(`${pattern}/package.json`)) continue
    for (const pkg of packages.values()) {
      if (pkg.dir.startsWith('packages/') || pkg.dir.startsWith('vendor/')) {
        if (!names.has(pkg.name)) names.set(pkg.name, `tsdown workspace ${pattern}`)
      }
    }
  }
  for (const app of ['apps/cli', 'apps/desktop-host']) {
    const pkg = packages.get(readJson(join(ROOT, app, 'package.json')).name)
    if (pkg !== undefined && !names.has(pkg.name)) names.set(pkg.name, `tsdown workspace ${app}`)
  }
  return names
}

/** 广度优先闭包；原因取第一次到达的路径，保证输出稳定。 */
export function transitiveClosure(seedNames, expand) {
  const reached = new Map(seedNames)
  const queue = [...reached.keys()]
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index]
    for (const [target, reason] of expand(name)) {
      if (reached.has(target)) continue
      reached.set(target, reason)
      queue.push(target)
    }
  }
  return reached
}

/** 运行时闭包：profile / core package set / Desktop 应用 / 插件名，再沿运行时依赖递归。 */
export function runtimeClosure(packages, byDir, profileNames) {
  const seeds = new Map()
  const add = (name, reason) => {
    if (name !== undefined && packages.has(name) && !seeds.has(name)) seeds.set(name, reason)
  }
  add('@deepseek-ai/dsh-root', 'install root')
  for (const dir of ['apps/desktop', 'apps/desktop-host']) {
    const pkg = byDir.get(dir)
    if (pkg === undefined) continue
    add(pkg.name, `desktop app ${dir}`)
    for (const section of ['dependencies', 'devDependencies']) {
      for (const dependency of Object.keys(pkg.manifest[section] ?? {})) add(dependency, `${dir} ${section}`)
    }
  }
  for (const dir of ['apps/cli', 'packages/bundle/base', 'packages/bundle/web-app', 'packages/lcoder/kernel', 'packages/lcoder/workspace']) {
    const pkg = byDir.get(dir)
    if (pkg !== undefined) add(pkg.name, `runtime root ${dir}`)
  }
  add('@deepseek-ai/dsh', 'core package set root')
  add('@deepseek-ai/dsh-desktop-host', 'core package set root')
  for (const [name, reason] of profileNames) add(name, reason)
  const pluginCache = new Map()
  return transitiveClosure(seeds, (name) => {
    const pkg = packages.get(name)
    if (pkg === undefined) return []
    const out = []
    for (const edge of pkg.runtimeEdges) out.push([edge.name, `dependency:${name}`])
    for (const plugin of packagePluginNames(pkg, packages, pluginCache)) out.push([plugin, `plugin:${pkg.dir}`])
    return out
  })
}

/** 测试 / 文档 / Python 运行时专用包，即使被 tsconfig include 覆盖也归测试类。 */
const TEST_OWNED_DIRS = new Set(['website', 'benchmarks', 'python/sdk-runtime'])

/** core package set：打包脚本只从 @deepseek-ai/dsh 与 dsh-desktop-host 的 dependencies / peer / optional 求闭包。 */
export function corePackageSetClosure(packages) {
  const seeds = new Map([
    ['@deepseek-ai/dsh', 'core package set root'],
    ['@deepseek-ai/dsh-desktop-host', 'core package set root'],
  ])
  return transitiveClosure(seeds, (name) => {
    const pkg = packages.get(name)
    if (pkg === undefined) return []
    return pkg.runtimeEdges.map(edge => [edge.name, `dependency:${name}`])
  })
}

/** 构建闭包：tsconfig 聚合、tsdown workspace、构建驱动与打包脚本的 import、native 构建。 */
export function buildClosure(packages, byDir) {
  const seeds = new Map()
  const merge = (source) => {
    for (const [name, reason] of source) {
      if (TEST_OWNED_DIRS.has(packages.get(name)?.dir ?? '')) continue
      if (!seeds.has(name)) seeds.set(name, reason)
    }
  }
  merge(buildConfigNames(packages, byDir))
  merge(buildDriverNames(packages))
  merge(tsdownWorkspaceNames(packages))
  for (const pkg of packages.values()) {
    if (pkg.dir === 'native/system' || pkg.dir.startsWith('native/system/packages/')) {
      if (!seeds.has(pkg.name)) seeds.set(pkg.name, 'native build')
    }
    if (['apps/desktop', 'apps/desktop-host', 'apps/cli', 'apps/web'].includes(pkg.dir)) {
      if (!seeds.has(pkg.name)) seeds.set(pkg.name, 'application build')
    }
  }
  return seeds
}

/** 测试闭包：包内 tests、测试文件导入、snapshots / website / benchmarks / python。 */
export function testClosure(packages, files) {
  const seeds = new Map()
  const add = (name, reason) => {
    if (name !== undefined && packages.has(name) && !seeds.has(name)) seeds.set(name, reason)
  }
  for (const pkg of packages.values()) {
    if (pkg.testFiles > 0) add(pkg.name, 'own tests')
    // 测试 fixture 目录之外的 apps/tests、snapshots 与脚本测试也计入测试面。
    if (pkg.dir === 'website' || pkg.dir === 'benchmarks' || pkg.dir === 'python/sdk-runtime') {
      add(pkg.name, `test/docs/release package ${pkg.dir}`)
    }
  }
  const testFilePattern = /^(?:packages\/[^/]+\/[^/]+\/tests\/|apps\/[^/]+\/tests\/|website\/tests\/|snapshots\/|benchmarks\/|scripts\/.*\.spec\.(?:ts|tsx)$)/u
  for (const file of files) {
    if (!testFilePattern.test(file)) continue
    if (!/\.(?:ts|tsx|mjs)$/u.test(file)) continue
    const text = readTextIfPresent(join(ROOT, file), 1024 * 1024)
    if (text === undefined) continue
    for (const name of workspaceNamesInText(text, packages)) add(name, `imported by ${file}`)
  }
  return transitiveClosure(seeds, (name) => {
    const pkg = packages.get(name)
    if (pkg === undefined) return []
    // 测试运行时只需要包声明的运行时依赖；devDependencies 是各包自己的测试工具，
    // 全量递归会把整个工作区都算成测试面，失去区分度。
    return pkg.runtimeEdges.map(edge => [edge.name, `dependency:${name}`])
  })
}

function emptyStats() {
  return {
    packages: 0,
    files: 0,
    bytes: 0,
    testFiles: 0,
    edges: 0,
    runtimeEdges: 0,
    devEdges: 0,
    workspaceEdges: 0,
    workspaceRuntimeEdges: 0,
    workspaceDevEdges: 0,
    incomingEdges: 0,
    incomingLinks: 0,
  }
}

function addToStats(stats, pkg) {
  stats.packages += 1
  stats.files += pkg.files
  stats.bytes += pkg.bytes
  stats.testFiles += pkg.testFiles
  stats.edges += pkg.edges.length
  stats.runtimeEdges += pkg.runtimeEdges.length
  stats.devEdges += pkg.devEdges.length
  stats.workspaceEdges += pkg.edges.filter(edge => edge.workspace === true).length
  stats.workspaceRuntimeEdges += pkg.runtimeEdges.filter(edge => edge.workspace === true).length
  stats.workspaceDevEdges += pkg.devEdges.filter(edge => edge.workspace === true).length
  stats.incomingEdges += pkg.incomingEdges
  stats.incomingLinks += pkg.incomingLinks
}

function lastChangeDate(dir, enabled) {
  if (!enabled) return undefined
  try {
    const output = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%cs', '--', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output === '' ? undefined : output
  } catch {
    return undefined
  }
}

/**
 * 执行一次完整审计。
 * @param {{dates: boolean, links: boolean}} options - 是否读取 git 日期与实测 node_modules 链接。
 * @returns {object} 分类、统计与逐包明细。
 */
export function analyze(options) {
  const { patterns, packages, byDir } = discoverPackages()
  attachDependencyEdges(packages, byDir)
  const files = attachFileStats(packages, byDir)
  if (options.links) countWorkspaceLinks(packages, byDir)
  else for (const pkg of packages.values()) pkg.incomingLinks = 0
  const profileNames = profileRuntimeNames(packages)
  const runtime = runtimeClosure(packages, byDir, profileNames)
  const coreSet = corePackageSetClosure(packages)
  const build = buildClosure(packages, byDir)
  const test = testClosure(packages, files)
  const coreStats = emptyStats()
  const coreMissing = []
  for (const name of coreSet.keys()) {
    const pkg = packages.get(name)
    if (pkg === undefined) {
      coreMissing.push(name)
      continue
    }
    if (pkg.dir !== '.') addToStats(coreStats, pkg)
  }
  const coreOutsideRuntime = [...coreSet.keys()].filter(name => !runtime.has(name))

  const classOf = (name) => {
    if (runtime.has(name)) return 'runtime'
    if (build.has(name)) return 'build'
    if (test.has(name)) return 'test'
    return 'candidate'
  }
  const stats = { runtime: emptyStats(), build: emptyStats(), test: emptyStats(), candidate: emptyStats() }
  const records = []
  const candidateRecords = []
  const nonRuntime = []
  for (const pkg of [...packages.values()].sort((left, right) => left.dir.localeCompare(right.dir))) {
    const cls = pkg.dir === '.' ? 'root' : classOf(pkg.name)
    if (cls !== 'root') addToStats(stats[cls], pkg)
    const record = {
      name: pkg.name,
      dir: pkg.dir,
      group: pkg.group,
      private: pkg.private,
      class: cls,
      files: pkg.files,
      bytes: pkg.bytes,
      testFiles: pkg.testFiles,
      edges: pkg.edges.length,
      runtimeEdges: pkg.runtimeEdges.length,
      devEdges: pkg.devEdges.length,
      workspaceEdges: pkg.edges.filter(edge => edge.workspace === true).length,
      incomingEdges: pkg.incomingEdges,
      incomingLinks: pkg.incomingLinks,
      reasons: {
        runtime: runtime.get(pkg.name),
        build: build.get(pkg.name),
        test: test.get(pkg.name),
      },
    }
    records.push(record)
    if (cls === 'candidate') candidateRecords.push(record)
    if (pkg.dir !== '.' && cls !== 'runtime') {
      nonRuntime.push({
        name: pkg.name,
        dir: pkg.dir,
        group: pkg.group,
        class: cls,
        files: pkg.files,
        bytes: pkg.bytes,
        incomingEdges: pkg.incomingEdges,
        incomingLinks: pkg.incomingLinks,
        lastChange: lastChangeDate(pkg.dir, options.dates),
      })
    }
  }
  for (const record of candidateRecords) {
    record.lastChange = lastChangeDate(record.dir, options.dates)
  }
  nonRuntime.sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name))

  const nonRootNames = [...packages.values()].filter(pkg => pkg.dir !== '.').map(pkg => pkg.name)
  const overlap = (left, right) => nonRootNames.filter(name => left.has(name) && right.has(name)).length
  const only = (set, ...others) => nonRootNames.filter(name => set.has(name) && others.every(other => !other.has(name))).length
  const workspaceEdgeSections = {}
  for (const section of ALL_SECTIONS) workspaceEdgeSections[section] = 0
  for (const pkg of packages.values()) {
    for (const edge of pkg.edges) {
      if (edge.workspace === true) workspaceEdgeSections[edge.section] += 1
    }
  }
  const linkStats = {
    nodeModulesPresent: [...packages.values()].some(pkg => existsSync(join(pkg.abs, 'node_modules'))),
    measuredLinks: [...packages.values()].reduce((sum, pkg) => sum + pkg.incomingLinks, 0),
    manifestWorkspaceEdges: Object.values(workspaceEdgeSections).reduce((sum, value) => sum + value, 0),
    sections: workspaceEdgeSections,
  }
  const classTotals = {
    runtime: stats.runtime.packages,
    build: stats.build.packages,
    test: stats.test.packages,
    candidate: candidateRecords.length,
  }
  const overlaps = {
    runtimeBuild: overlap(runtime, build),
    runtimeTest: overlap(runtime, test),
    buildTest: overlap(build, test),
    allThree: nonRootNames.filter(name => runtime.has(name) && build.has(name) && test.has(name)).length,
    onlyRuntime: only(runtime, build, test),
    onlyBuild: only(build, runtime, test),
    onlyTest: only(test, runtime, build),
  }
  return {
    workspace: { patterns, packages: nonRootNames.length, root: 1, total: nonRootNames.length + 1 },
    classTotals,
    stats,
    overlaps,
    linkStats,
    corePackageSet: {
      packages: coreStats.packages,
      files: coreStats.files,
      bytes: coreStats.bytes,
      missing: coreMissing,
      outsideRuntime: coreOutsideRuntime,
    },
    profileRoots: Object.fromEntries(profileNames),
    records,
    candidates: candidateRecords,
    nonRuntime,
  }
}

function formatTable(rows, headers) {
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...rows.map(row => String(row[column]).length),
  ))
  const line = (cells) => cells.map((cell, column) => String(cell).padEnd(widths[column])).join('  ')
  return [line(headers), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

function printStats(label, stats, runtimeSize) {
  const rows = [[
    label,
    stats.packages,
    stats.files,
    formatBytes(stats.bytes),
    stats.runtimeEdges,
    stats.devEdges,
    stats.workspaceEdges,
    stats.incomingEdges,
    stats.incomingLinks,
  ]]
  if (runtimeSize !== undefined) {
    // 运行时行把根清单也计入包数，但文件和字节只统计可删除的包。
    rows[0][1] = stats.packages + runtimeSize
  }
  console.log(formatTable(rows, ['分类', '包数', '文件数', '字节', '运行时边', 'dev 边', 'workspace 边', 'workspace 入边', '实测入链']))
}

/** 打印人读报告；返回打印前的分析对象。 */
export function printReport(analysis) {
  console.log('LCoder 包闭包审计（只读）')
  console.log(`工作区清单 ${analysis.workspace.packages} 个包 + 根清单 = ${analysis.workspace.total} 个 pnpm 工程（patterns: ${analysis.workspace.patterns.join(', ')}）`)
  console.log('')
  console.log('分类（优先级 运行时 > 构建 > 测试；文件与字节只统计可删除的包）')
  printStats('运行时', analysis.stats.runtime, 1)
  printStats('构建', analysis.stats.build)
  printStats('测试', analysis.stats.test)
  printStats('候选', analysis.stats.candidate)
  console.log('')
  console.log(`闭包包数（不含根清单）：运行时 ${analysis.classTotals.runtime}，构建 ${analysis.classTotals.build}，测试 ${analysis.classTotals.test}，候选 ${analysis.classTotals.candidate}`)
  const coreSet = analysis.corePackageSet
  console.log(`core package set（@deepseek-ai/dsh 与 dsh-desktop-host 的打包依赖闭包）：${coreSet.packages} 包，${coreSet.files} 文件，${formatBytes(coreSet.bytes)}`)
  if (coreSet.missing.length > 0) console.log(`  core package set 缺失根：${coreSet.missing.join(', ')}`)
  if (coreSet.outsideRuntime.length > 0) console.log(`  core package set 有 ${coreSet.outsideRuntime.length} 个包不在运行时分类里`)
  console.log(`重叠：运行时∩构建 ${analysis.overlaps.runtimeBuild}，运行时∩测试 ${analysis.overlaps.runtimeTest}，构建∩测试 ${analysis.overlaps.buildTest}，三者 ${analysis.overlaps.allThree}`)
  console.log(`独占：只运行时 ${analysis.overlaps.onlyRuntime}，只构建 ${analysis.overlaps.onlyBuild}，只测试 ${analysis.overlaps.onlyTest}`)
  console.log('')
  console.log('运行时不发布（次口径，删除仍需同步构建 / 测试配置）前 20 个，按字节降序')
  if (analysis.nonRuntime.length === 0) {
    console.log('  （无）')
  } else {
    const rows = analysis.nonRuntime.slice(0, 20).map(entry => [
      entry.name,
      entry.class,
      entry.files,
      formatBytes(entry.bytes),
      entry.incomingEdges,
      entry.incomingLinks,
      entry.lastChange ?? '-',
    ])
    console.log(formatTable(rows, ['包名', '类', '文件', '字节', 'workspace 入边', '实测入链', '最后变更']))
  }
  console.log('')
  console.log(`严格候选（三闭包都不可达）：${analysis.candidates.length} 个`)
  for (const candidate of analysis.candidates) {
    console.log(`  ${candidate.name}  ${candidate.dir}  文件 ${candidate.files}  ${formatBytes(candidate.bytes)}  最后变更 ${candidate.lastChange ?? '-'}`)
  }
  console.log('')
  const { linkStats } = analysis
  const ratio = linkStats.manifestWorkspaceEdges === 0
    ? 'n/a'
    : (linkStats.measuredLinks / linkStats.manifestWorkspaceEdges).toFixed(3)
  console.log(`链接关系：manifest 里指向 workspace 的边 ${linkStats.manifestWorkspaceEdges}（${Object.entries(linkStats.sections).map(([section, count]) => `${section} ${count}`).join('，')}）`)
  console.log(`实测 node_modules 中指向 workspace 包的符号链接 ${linkStats.measuredLinks}（node_modules ${linkStats.nodeModulesPresent ? '存在' : '不存在'}，比值 ${ratio}）`)
  console.log('')
  console.log('收益口径：安装包来自 core package set（@deepseek-ai/dsh 与 dsh-desktop-host 的打包闭包），')
  console.log('删除不进该闭包的源码不会改变安装包；源码删除只影响检出体积与构建 / 测试面。')
  return analysis
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.check) {
    const first = analyze({ dates: false, links: false })
    const second = analyze({ dates: false, links: false })
    const failures = []
    const nonRoot = first.records.filter(record => record.class !== 'root')
    if (nonRoot.length !== first.workspace.packages) failures.push('分类记录数与工作区包数不一致')
    for (const record of nonRoot) {
      if (!['runtime', 'build', 'test', 'candidate'].includes(record.class)) failures.push(`${record.name} 没有分类`)
      const expected = record.reasons.runtime !== undefined
        ? 'runtime'
        : record.reasons.build !== undefined
          ? 'build'
          : record.reasons.test !== undefined ? 'test' : 'candidate'
      if (record.class !== expected) failures.push(`${record.name} 分类 ${record.class} 与优先级结果 ${expected} 不一致`)
    }
    const sum = first.stats.runtime.packages + first.stats.build.packages + first.stats.test.packages + first.stats.candidate.packages
    if (sum !== first.workspace.packages) failures.push(`分类合计 ${sum} 不等于 ${first.workspace.packages}`)
    if (first.records.find(record => record.dir === '.')?.class !== 'root') failures.push('根清单必须单独标记')
    if (first.candidates.length !== first.stats.candidate.packages) failures.push('候选清单与候选统计不一致')
    const firstJson = JSON.stringify(first)
    const secondJson = JSON.stringify(second)
    if (firstJson !== secondJson) failures.push('两次运行结果不一致')
    printReport(first)
    console.log('')
    if (failures.length > 0) {
      console.log(`自测失败 ${failures.length} 项：`)
      for (const failure of failures) console.log(`  - ${failure}`)
      return 1
    }
    console.log('自测通过：分类互斥、合计等于包数、根清单单列、两次运行结果逐字节一致。')
    return 0
  }
  const analysis = analyze(options)
  printReport(analysis)
  if (options.json !== undefined) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(dirname(options.json), { recursive: true })
    writeFileSync(options.json, `${JSON.stringify(analysis, null, 2)}\n`)
    console.log(`\nJSON 已写入 ${options.json}`)
  }
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
