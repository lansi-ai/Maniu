/**
 * Environment, build, profile, and process plumbing for `lcoder/scripts/smoke.cmd`.
 *
 * Everything stays inside this checkout: the desktop development home, Electron
 * user data, logs, and the dev mock are all under `apps/desktop/.desktop-build`
 * or `lcoder/logs`. Nothing writes AppData, the registry, or another checkout;
 * the only cross-checkout read is the `-Repair` copy of electron/runtime caches.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
export const DESKTOP_BUILD = join(ROOT, 'apps', 'desktop', '.desktop-build')
export const DEVELOPMENT = join(DESKTOP_BUILD, 'development')
export const HOME = join(DEVELOPMENT, 'home')
export const PROFILE = join(HOME, 'profiles', 'desktop')
export const USER_DATA = join(DEVELOPMENT, 'electron-user-data')
export const DOCS_DIR = join(DEVELOPMENT, 'docs')
export const LOGS = join(ROOT, 'lcoder', 'logs')
export const DESKTOP_LOG = join(LOGS, 'smoke-desktop.log')
export const MOCK_LOG = join(LOGS, 'smoke-mock.log')
export const LOCK_FILE = join(LOGS, 'smoke.lock')

export function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

/** Port defaults for this line; every one has an environment override. */
export function resolvePorts(environment) {
  const read = (name, fallback) => {
    const raw = environment[name]
    if (raw === undefined || raw === '') return fallback
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`${name} must be an integer from 1 through 65535, got ${JSON.stringify(raw)}`)
    }
    return value
  }
  return {
    renderer: read('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9582),
    main: read('DSH_DESKTOP_MAIN_INSPECT_PORT', 9589),
    host: read('DSH_DESKTOP_HOST_INSPECT_PORT', 9590),
    cloud: read('DSH_SMOKE_CLOUD_PORT', 9583),
  }
}

/** Environment shared by every child process; keeps the run in-repo and offline. */
export function childEnvironment(ports, environment = process.env) {
  const pnpmBin = join(environment.USERPROFILE ?? '', '.pnpm', 'bin')
  const path = existsSync(pnpmBin) ? `${pnpmBin};${environment.PATH ?? ''}` : environment.PATH ?? ''
  return {
    ...environment,
    PATH: path,
    DSH_DESKTOP_MAIN_INSPECT_PORT: String(ports.main),
    DSH_DESKTOP_RENDERER_DEBUG_PORT: String(ports.renderer),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(ports.host),
    DSH_DESKTOP_SKIP_RUNTIME_SMOKE: '1',
    LCODER_CLOUD_BASE_URL: environment.LCODER_CLOUD_BASE_URL ?? `http://127.0.0.1:${ports.cloud}/v1`,
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
}

function fail(message) {
  throw new Error(message)
}

/** The checkout this worktree was created from; used only for read-only repair copies. */
function mainCheckout() {
  const configured = process.env.LCODER_MAIN_CHECKOUT
  if (configured !== undefined && configured !== '') return configured
  return ROOT.includes(`${join('.worktrees', '')}`) ? resolve(ROOT, '..', '..') : ROOT
}

function findDirectory(parent, predicate) {
  let entries
  try { entries = readdirSync(parent, { withFileTypes: true }) } catch { return undefined }
  return entries.filter(entry => entry.isDirectory() && predicate(entry.name)).map(entry => join(parent, entry.name))
}

function electronDirectory() {
  const candidates = findDirectory(join(ROOT, 'node_modules', '.pnpm'), name => name.startsWith('electron@'))
  const found = candidates?.find(directory => existsSync(join(directory, 'node_modules', 'electron', 'package.json')))
  if (found === undefined) fail('electron package is missing from node_modules; run pnpm install')
  return join(found, 'node_modules', 'electron')
}
/**
 * Check the known-new-worktree breakages before spending minutes on a build.
 * @param {{repair: boolean, log: (message: string) => void}} options - repair copies missing binaries/caches from the main checkout.
 */
export function checkEnvironment({ repair, log }) {
  if (process.platform !== 'win32') fail('smoke.cmd currently supports Windows only')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 9)) {
    fail(`Node >=24.9 is required, found ${process.versions.node}; put ~/.pnpm/bin first on PATH`)
  }
  if (!existsSync(join(ROOT, 'node_modules'))) fail('node_modules is missing; run pnpm install')

  const oarRoots = findDirectory(join(ROOT, 'node_modules', '.pnpm'), name => name.startsWith('@botiverse+oar@0.67.0_patch_'))
  const declaration = oarRoots === undefined
    ? undefined
    : join(oarRoots[0], 'node_modules', '@botiverse', 'oar', 'dist', 'contracts', 'installation.d.ts')
  if (declaration === undefined || !existsSync(declaration)) {
    fail('patched @botiverse/oar is missing; run pnpm install')
  }
  if (!/InstallationProbe\s*=\s*\([^)]*options\?/.test(readFileSync(declaration, 'utf8'))) {
    fail('pnpm did not apply the @botiverse/oar patch (PITFALLS W-09); run pnpm install --force')
  }

  const electron = electronDirectory()
  const electronReady = existsSync(join(electron, 'path.txt')) && existsSync(join(electron, 'dist', 'electron.exe'))
  if (!electronReady) {
    if (!repair) fail(`electron binary is missing in ${electron} (PITFALLS W-14); rerun with -Repair`)
    const key = relative(join(ROOT, 'node_modules', '.pnpm'), electron).split(sep)[0]
    const mainRoot = join(mainCheckout(), 'node_modules', '.pnpm')
    const source = [join(mainRoot, key, 'node_modules', 'electron')]
      .concat(findDirectory(mainRoot, name => name.startsWith('electron@'))?.map(root =>
        join(root, 'node_modules', 'electron')) ?? [])
      .find(candidate => existsSync(join(candidate, 'path.txt')) && existsSync(join(candidate, 'dist', 'electron.exe')))
    if (source === undefined) fail('electron binary is missing here and in the main checkout')
    cpSync(join(source, 'path.txt'), join(electron, 'path.txt'))
    cpSync(join(source, 'dist'), join(electron, 'dist'), { recursive: true })
    log(`repair: copied electron binary from ${source}`)
  }

  const downloads = join(DESKTOP_BUILD, 'downloads')
  const runtime = join(DESKTOP_BUILD, 'targets', 'win-x64', 'runtime')
  if (!existsSync(downloads) || !existsSync(runtime)) {
    if (!repair) {
      fail('desktop runtime caches are missing (.desktop-build/downloads or targets/win-x64/runtime); rerun with -Repair')
    }
    const sourceBuild = join(mainCheckout(), 'apps', 'desktop', '.desktop-build')
    for (const relative of [join('downloads'), join('targets', 'win-x64')]) {
      const source = join(sourceBuild, relative)
      const destination = join(DESKTOP_BUILD, relative)
      if (!existsSync(source)) fail(`main checkout has no ${source}; cannot repair offline`)
      cpSync(source, destination, { recursive: true })
      log(`repair: copied ${relative} from the main checkout`)
    }
  }
}

function listSources(directory) {
  const files = []
  let entries
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return files }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listSources(path))
    else files.push(path)
  }
  return files
}

function newestMtime(directory) {
  let newest = 0
  for (const file of listSources(directory)) {
    try { newest = Math.max(newest, statSync(file).mtimeMs) } catch { /* vanished */ }
  }
  return newest
}

function runPnpm(args, label, environment) {
  const line = `pnpm ${args.join(' ')}`
  const started = Date.now()
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', line], {
    cwd: ROOT, env: environment, stdio: 'inherit', windowsHide: true,
  })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? 'signal'})`)
  return `${label} ok (${elapsed}s)`
}

/**
 * Build only what is missing or stale.
 * @param {{mode: 'auto'|'force'|'skip', environment: Record<string, string>, log: (message: string) => void}} options - build policy.
 */
export function ensureBuild({ mode, environment, log }) {
  if (mode === 'skip') { log('build: skipped (-NoBuild)'); return }
  const baseMissing = !existsSync(join(ROOT, 'apps', 'desktop-host', 'lib', 'index.js'))
    || !existsSync(join(ROOT, 'apps', 'web', 'dist', 'index.html'))
    || !existsSync(join(ROOT, 'packages', 'boot', 'app-boot', 'lib', 'index.js'))
  const rebuilt = []
  if (mode === 'force' || baseMissing) {
    log(runPnpm(['run', 'build:artifacts'], 'build:artifacts', environment))
    rebuilt.push('base')
  }
  const layers = [
    { name: 'kernel', source: join(ROOT, 'packages', 'lcoder', 'kernel', 'src'), artifact: join(ROOT, 'packages', 'lcoder', 'kernel', 'lib', 'index.js'), filter: '@lcoder/kernel' },
    { name: 'workspace', source: join(ROOT, 'packages', 'lcoder', 'workspace', 'src'), artifact: join(ROOT, 'packages', 'lcoder', 'workspace', 'lib', 'client.js'), filter: '@lcoder/workspace' },
  ]
  for (const layer of layers) {
    const stale = !existsSync(layer.artifact) || newestMtime(layer.source) > statSync(layer.artifact).mtimeMs
    if (!stale && !baseMissing && mode !== 'force') continue
    if (baseMissing && mode !== 'force') continue
    log(runPnpm(['--filter', layer.filter, 'run', 'bundle'], `${layer.name} bundle`, environment))
    rebuilt.push(layer.name)
  }
  const desktopArtifact = join(ROOT, 'apps', 'desktop', 'lib', 'main.js')
  const desktopStale = !existsSync(desktopArtifact)
    || newestMtime(join(ROOT, 'apps', 'desktop', 'src')) > statSync(desktopArtifact).mtimeMs
  if (mode === 'force' || baseMissing || desktopStale) {
    log(runPnpm(['--filter', '@deepseek-ai/dsh-desktop', 'run', 'build'], 'desktop build', environment))
    rebuilt.push('desktop')
  }
  if (rebuilt.length === 0) log('build: artifacts are current')
}

const PROFILE_LOCAL = `
# ── 本机运行副本的本地段（不在装配源里）────────────────────────
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard
    performanceUsage: detailed
- id: ui-settings
  name: "@deepseek-ai/dsh-client-ui-settings"
  config:
    enabled: true
`

function linkDirectory(target, link) {
  try {
    const stat = lstatSync(link)
    if (stat.isDirectory() && !stat.isSymbolicLink()) rmSync(link, { recursive: true, force: true })
    else unlinkSync(link)
  } catch { /* absent */ }
  symlinkSync(target, link, 'junction')
}

/** Materialize the committed profile assembly source into this worktree's desktop home. */
export function prepareProfile({ log }) {
  mkdirSync(PROFILE, { recursive: true })
  mkdirSync(DOCS_DIR, { recursive: true })
  const source = readFileSync(join(ROOT, 'lcoder', 'desktop-profile.patch.yml'), 'utf8')
  const documentsDirectory = `'${DOCS_DIR.replaceAll("'", "''")}'`
  const replaced = source.replace(/^(\s*documentsDirectory:\s*).*$/m, `$1${documentsDirectory}`)
  if (replaced === source && !source.includes(DOCS_DIR)) {
    fail('desktop-profile.patch.yml has no documentsDirectory line to point at this worktree (PITFALLS W-08)')
  }
  writeFileSync(join(PROFILE, 'cordis.patch.yml'), `${replaced.trimEnd()}\n${PROFILE_LOCAL}`)
  const link = packagePath => `link:${packagePath.replaceAll('\\', '/')}`
  const manifest = {
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {
      '@lcoder/kernel': link(join(ROOT, 'packages', 'lcoder', 'kernel')),
      '@lcoder/workspace': link(join(ROOT, 'packages', 'lcoder', 'workspace')),
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }
  writeFileSync(join(PROFILE, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const scoped = join(PROFILE, 'node_modules', '@lcoder')
  mkdirSync(scoped, { recursive: true })
  linkDirectory(join(ROOT, 'packages', 'lcoder', 'kernel'), join(scoped, 'kernel'))
  linkDirectory(join(ROOT, 'packages', 'lcoder', 'workspace'), join(scoped, 'workspace'))
  log(`profile: ${PROFILE}`)
}

function ownProcessIds() {
  const script = [
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.CommandLine -ne $null -and (',
    "    ($_.Name -eq 'electron.exe' -and $_.CommandLine -like ('*' + $env:SMOKE_USER_DATA + '*')) -or",
    "    ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $env:SMOKE_ROOT + '*') -and $_.CommandLine -like '*scripts*dev.ts*')",
    '  )',
    '} | ForEach-Object { $_.ProcessId }',
  ].join('\n')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, SMOKE_USER_DATA: USER_DATA, SMOKE_ROOT: ROOT },
  })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/u).map(line => Number.parseInt(line.trim(), 10)).filter(Number.isSafeInteger)
}

/** Stop only processes this worktree owns: its Electron user-data directory or its dev launcher. */
export function stopOwnInstances({ log }) {
  const ids = ownProcessIds()
  if (ids.length === 0) return 0
  log(`stop: ${ids.length} leftover process(es) of this worktree`)
  for (const id of ids) {
    try { spawnSync('taskkill.exe', ['/PID', String(id), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* already gone */ }
    log(`stop: taskkill PID ${id}`)
  }
  return ids.length
}

function assertPortFree(port, label) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', error => reject(new Error(`${label} port ${port} is busy (${error.code}); stop the owner or override the port`)))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise()))
  })
}

export async function assertPortsFree(ports) {
  await Promise.all([
    assertPortFree(ports.renderer, 'renderer'),
    assertPortFree(ports.main, 'main'),
    assertPortFree(ports.host, 'host'),
    assertPortFree(ports.cloud, 'mock cloud'),
  ])
}

export function acquireLock() {
  mkdirSync(LOGS, { recursive: true })
  if (existsSync(LOCK_FILE)) {
    const owner = Number.parseInt(readFileSync(LOCK_FILE, 'utf8').trim(), 10)
    let alive = false
    if (Number.isSafeInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); alive = true } catch (error) { alive = error.code !== 'ESRCH' }
    }
    if (alive) fail(`another smoke run is active (PID ${owner}); wait for it or remove ${LOCK_FILE}`)
    unlinkSync(LOCK_FILE)
  }
  writeFileSync(LOCK_FILE, `${process.pid}\n`)
}

export function releaseLock() {
  try { unlinkSync(LOCK_FILE) } catch { /* absent */ }
}

export function startDesktop({ environment }) {
  mkdirSync(LOGS, { recursive: true })
  const descriptor = openSync(DESKTOP_LOG, 'w')
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm run start:desktop'], {
    cwd: ROOT, env: environment, stdio: ['ignore', descriptor, descriptor], windowsHide: true,
  })
  // Lifecycle is owned explicitly (killTree / stopOwnInstances); an unref'd child
  // must not keep the smoke process alive, especially with -KeepRunning.
  child.unref()
  return { child, descriptor }
}

export async function waitReady({ child, log, timeoutMs = 240_000 }) {
  const deadline = Date.now() + timeoutMs
  let exited
  child.once('exit', code => { exited = code ?? -1 })
  while (Date.now() < deadline) {
    if (existsSync(DESKTOP_LOG)) {
      const text = readFileSync(DESKTOP_LOG, 'utf8')
      const matches = [...text.matchAll(/dsh web:\s*(http:\/\/\S+)/gu)]
      if (matches.length > 0) return matches.at(-1)[1]
      if (/entries did not activate|failed to import|Electron failed to install|missing built artifact|fatal/u.test(text)) {
        throw new Error(`desktop failed before readiness:\n${tail(text)}`)
      }
    }
    if (exited !== undefined) throw new Error(`desktop launcher exited ${exited}:\n${tail(readFileSync(DESKTOP_LOG, 'utf8'))}`)
    await sleep(400)
  }
  throw new Error(`desktop did not print a ready URL in ${timeoutMs} ms; see ${DESKTOP_LOG}`)
}

export function tail(text, lines = 20) {
  return text.trimEnd().split(/\r?\n/u).slice(-lines).join('\n')
}

export function startMock({ ports, environment, log }) {
  const descriptor = openSync(MOCK_LOG, 'w')
  const child = spawn(process.execPath, [join(ROOT, 'lcoder', 'scripts', 'mock-cloud.mjs')], {
    cwd: ROOT,
    env: { ...environment, MOCK_CLOUD_PORT: String(ports.cloud) },
    stdio: ['ignore', descriptor, descriptor],
    windowsHide: true,
  })
  child.unref()
  log(`mock cloud: 127.0.0.1:${ports.cloud}`)
  return { child, descriptor }
}

export async function waitMock(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/_mock/state`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch { /* not listening yet */ }
    await sleep(200)
  }
  throw new Error(`mock cloud did not answer on 127.0.0.1:${port}; see ${MOCK_LOG}`)
}

export async function resetMock(port) {
  const response = await fetch(`http://127.0.0.1:${port}/_mock/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset: true }),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`mock cloud reset HTTP ${response.status}`)
}

export function killTree(target) {
  if (target === undefined) return
  const child = target.child ?? target
  if (child?.pid !== undefined) {
    try { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* gone */ }
  }
  if (target.descriptor !== undefined) {
    try { closeSync(target.descriptor) } catch { /* closed */ }
  }
}
