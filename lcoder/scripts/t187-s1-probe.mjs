/**
 * T-187 S1 端到端探针。
 *
 * 只跑本工作树的实例：先确保本机 mock 云端可用，登录一个专用测试号并把令牌
 * 写进仓内 home 的凭据文件；再启动新壳，经 CDP 断言「窗口起来 → 宿主 ready →
 * 会话列表非空 → 发一条 → 出现 assistant 文本」，最后重启一次验证历史重读。
 *
 * 用法：node lcoder/scripts/t187-s1-probe.mjs
 * 前置：客户端与主进程产物已构建（pnpm --filter @lcoder/desktop --filter @lcoder/client run build）。
 * 端口：渲染 9822、主进程 9829、宿主 9830、mock 云端 5091。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const APP_ROOT = join(REPO_ROOT, 'packages', 'lcoder', 'desktop')
const HOME = process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const MOCK_PORT = 5091
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}/v1`
const RENDERER_PORT = 9822
const PHONE = '+8613900000001'
const PASSWORD = 'lcoder-s1-pass'
mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null

function log(message) {
  console.log(`[t187] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function checkMock() {
  try {
    const response = await fetch(`${MOCK_BASE}/models`, { signal: AbortSignal.timeout(1500) })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

async function ensureMock() {
  if (await checkMock()) return
  log('启动本机 mock 云端')
  const out = await import('node:fs').then(fs => fs.openSync(join(LOGS, 't187-probe-mock.log'), 'w'))
  mockChild = spawn(process.execPath, [join(REPO_ROOT, 'lcoder', 'scripts', 'mock-cloud.mjs')], {
    cwd: REPO_ROOT, stdio: ['ignore', out, out],
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await checkMock()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('mock 云端未在 10 秒内就绪')
}

async function post(path, body) {
  const response = await fetch(`${MOCK_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function seedCredential() {
  let session = await post('/auth/login/password', { phone: PHONE, password: PASSWORD })
  if (session.status !== 200) {
    await post('/auth/sms/send', { phone: PHONE, purpose: 'register' })
    session = await post('/auth/register', { phone: PHONE, code: '123456', password: PASSWORD, displayName: 'S1 Probe' })
  }
  assert(session.status === 200, `云端测试号不可用（HTTP ${String(session.status)}）`)
  assert(typeof session.body.accessToken === 'string' && typeof session.body.refreshToken === 'string', '云端没有返回令牌')
  mkdirSync(HOME, { recursive: true })
  writeFileSync(join(HOME, '.credentials.yaml'), [
    'version: 1',
    'refs:',
    `  LCODER_CLOUD_ACCESS_TOKEN: ${JSON.stringify(session.body.accessToken)}`,
    `  LCODER_CLOUD_REFRESH_TOKEN: ${JSON.stringify(session.body.refreshToken)}`,
    '',
  ].join('\n'))
  log('已写入云端测试号令牌')
}

function resolveElectron() {
  const requireFromApp = createRequire(join(APP_ROOT, 'package.json'))
  const resolved = requireFromApp('electron')
  assert(typeof resolved === 'string', '找不到 Electron 可执行文件')
  return resolved
}

async function portInUse() {
  try {
    await fetch(`http://127.0.0.1:${String(RENDERER_PORT)}/json/version`, { signal: AbortSignal.timeout(800) })
    return true
  } catch {
    return false
  }
}

async function launch(label) {
  const logPath = join(LOGS, `t187-probe-${label}.log`)
  const out = await import('node:fs').then(fs => fs.openSync(logPath, 'w'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  Object.assign(environment, {
    DSH_HOME: HOME,
    LCODER_CLOUD_BASE_URL: MOCK_BASE,
    DSH_DESKTOP_RENDERER_DEBUG_PORT: String(RENDERER_PORT),
    DSH_DESKTOP_MAIN_INSPECT_PORT: '9829',
    DSH_DESKTOP_HOST_INSPECT_PORT: '9830',
    ELECTRON_ENABLE_LOGGING: '0',
  })
  const child = spawn(electron, [
    '--inspect=127.0.0.1:9829',
    `--remote-debugging-port=${String(RENDERER_PORT)}`,
    `--user-data-dir=${join(HOME, 'electron-user-data')}`,
    APP_ROOT,
  ], { cwd: APP_ROOT, env: environment, stdio: ['ignore', out, out] })
  log(`已启动 ${label}（pid ${String(child.pid)}），日志 ${logPath}`)
  return { child, logPath }
}

async function connectCdp() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(RENDERER_PORT)}/json/list`)).json()
      const page = list.find(target => target.type === 'page' && target.url.startsWith('file://'))
      if (page !== undefined && typeof page.webSocketDebuggerUrl === 'string') return await attach(page.webSocketDebuggerUrl)
    } catch {
      // 端口未就绪时继续轮询。
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('60 秒内没有等到渲染端 CDP 目标')
}

async function attach(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (answer.result?.exceptionDetails !== undefined) {
      throw new Error(`页面脚本失败：${answer.result.exceptionDetails.text}`)
    }
    return answer.result?.result?.value
  }
  const waitFor = async (expression, milliseconds, label) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const value = await evaluate(expression)
      if (value !== undefined && value !== null && value !== false && value !== '') return value
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`等待超时：${label}`)
  }
  const fire = (expression) => {
    socket.send(JSON.stringify({ id: ++nextId, method: 'Runtime.evaluate', params: { expression } }))
  }
  return { socket, evaluate, waitFor, fire }
}

async function closeApp(page) {
  // 只发关窗命令，不主动断开 CDP：渲染端忙时提前断链会把排队中的命令丢掉，
  // 窗口不关、宿主被 SIGTERM 截断，重启后就读不到刚落盘的历史。
  page.fire("window.lcoder.window('close')")
}

async function waitExit(child, milliseconds) {
  const exited = new Promise(resolve => {
    if (child.exitCode !== null) { resolve(true); return }
    child.once('exit', () => { resolve(true) })
  })
  let timer
  const timed = new Promise(resolve => { timer = setTimeout(() => { resolve(false) }, milliseconds) })
  const ok = await Promise.race([exited, timed])
  clearTimeout(timer)
  if (!ok) child.kill('SIGTERM')
  return ok
}

async function firstRun() {
  const launched = await launch('first')
  let page
  try {
    page = await connectCdp()
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready')
    const gate = await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state')", 30_000, '门禁判定')
    assert(gate === 'ready', `登录门禁没有放行：${String(gate)}（${await page.evaluate("document.body.innerText.slice(0,200)")}）`)
    await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null", 10_000, '会话列表')
    await page.evaluate("document.querySelector('[data-testid=\"new-session\"]').click()")
    await page.waitFor("document.querySelectorAll('[data-testid=\"session-item\"]').length > 0", 20_000, '新建会话')
    const sessionId = await page.waitFor(
      "document.querySelector('[data-testid=\"session-item\"].active')?.dataset.sessionId ?? document.querySelector('[data-testid=\"session-item\"]')?.dataset.sessionId",
      10_000, '会话标识',
    )
    log(`会话列表非空，选中 ${sessionId}`)
    await page.evaluate("(() => { const input = document.querySelector('[data-testid=\"composer\"]'); input.value = '你好，请用一句话说明你读到了什么。'; input.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
    const assistant = await page.waitFor("document.querySelector('[data-testid=\"message-assistant\"]')?.textContent || ''", 60_000, 'assistant 文本')
    assert(assistant.includes('仓库结构'), `assistant 文本不符合 mock 预期：${String(assistant).slice(0, 120)}`)
    log(`assistant 文本已出现：${JSON.stringify(String(assistant).slice(0, 40))}…`)
    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000)
    page.socket.close()
    page = undefined
    assert(exited, '首次实例关窗后退出')
    log('首次实例已退出')
    return sessionId
  } catch (error) {
    if (page !== undefined) await closeApp(page)
    if (launched.child.exitCode === null) launched.child.kill('SIGTERM')
    throw error
  }
}

async function restartRun(sessionId) {
  const launched = await launch('restart')
  let page
  try {
    page = await connectCdp()
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready（重启）')
    await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 30_000, '门禁放行（重启）')
    const selector = `[data-testid="session-item"][data-session-id="${sessionId}"]`
    await page.waitFor(`document.querySelector('${selector}') !== null`, 20_000, '重启后的会话列表')
    await page.evaluate(`document.querySelector('${selector}').click()`)
    const assistant = await page.waitFor("document.querySelector('[data-testid=\"message-assistant\"]')?.textContent || ''", 30_000, '重启后的历史')
    assert(assistant.includes('仓库结构'), '重启后没有从 follow snapshot 读到历史 assistant 文本')
    log('重启后同一会话已重读历史')
    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000)
    page.socket.close()
    page = undefined
    assert(exited, '重启实例关窗后退出')
  } catch (error) {
    if (page !== undefined) { await closeApp(page); page.socket.close() }
    if (launched.child.exitCode === null) launched.child.kill('SIGTERM')
    throw error
  }
}

async function main() {
  for (const path of [
    join(APP_ROOT, 'lib', 'types', 'main.js'),
    join(APP_ROOT, 'lib', 'preload.cjs'),
    join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html'),
  ]) {
    assert(existsSync(path), `缺少构建产物 ${path}`)
  }
  assert(!await portInUse(), `渲染调试端口 ${String(RENDERER_PORT)} 已被占用；先关掉本工作树正在运行的实例`)
  electron = resolveElectron()
  await ensureMock()
  await seedCredential()
  const sessionId = await firstRun()
  await restartRun(sessionId)
  log('PASS：窗口、宿主、门禁、会话列表、发送与流式正文、重启历史全部通过')
}

main().catch((error) => {
  console.error('[t187] FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
