/** 开发启动器：解析 Electron、检查产物、带本槽位 inspector 端口启动新壳。 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(APP_ROOT, '..', '..', '..')
const home = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home'))
const userData = join(home, 'electron-user-data')
mkdirSync(userData, { recursive: true })

function port(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} 必须是 1..65535 的整数`)
  return value
}

const mainPort = port('DSH_DESKTOP_MAIN_INSPECT_PORT', 9829)
const rendererPort = port('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9822)
const hostPort = port('DSH_DESKTOP_HOST_INSPECT_PORT', 9830)

for (const path of [
  join(APP_ROOT, 'lib', 'types', 'main.js'),
  join(APP_ROOT, 'lib', 'preload.cjs'),
  join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html'),
]) {
  if (!existsSync(path)) throw new Error(`缺少构建产物 ${path}；先跑 pnpm --filter @lcoder/desktop --filter @lcoder/client run build`)
}

const electron = createRequire(import.meta.url)('electron')
if (typeof electron !== 'string') throw new Error('找不到 Electron 可执行文件')

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
Object.assign(environment, {
  DSH_HOME: home,
  DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
  ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
})

console.log(`lcoder desktop: DSH_HOME=${home}`)
console.log(`lcoder desktop: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)

const child = spawn(electron, [
  `--inspect=127.0.0.1:${String(mainPort)}`,
  `--remote-debugging-port=${String(rendererPort)}`,
  `--user-data-dir=${userData}`,
  APP_ROOT,
], { cwd: APP_ROOT, env: environment, stdio: 'inherit' })

child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
