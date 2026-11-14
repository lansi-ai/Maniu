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

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

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

/** 本探针占用的三个调试端口。 */
const DEBUG_PORTS = [9822, 9829, 9830]

/**
 * 列出仍被占用的调试端口。
 * @returns 有进程监听的端口。
 */
async function busyPorts() {
  const busy = []
  for (const port of DEBUG_PORTS) {
    try {
      await fetch(`http://127.0.0.1:${String(port)}/json/version`, { signal: AbortSignal.timeout(800) })
      busy.push(port)
    } catch {
      // 连不上即空闲。
    }
  }
  return busy
}

/**
 * 异常收尾时杀掉整个 Electron 进程树，避免宿主子进程占住会话库与端口。
 * @param child - 探针启动的 Electron 主进程。
 */
function killTree(child) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGKILL')
}

function resolveElectron() {
  const requireFromApp = createRequire(join(APP_ROOT, 'package.json'))
  const resolved = requireFromApp('electron')
  assert(typeof resolved === 'string', '找不到 Electron 可执行文件')
  return resolved
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

async function connectCdp(logPath) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      if (existsSync(logPath) && readFileSync(logPath, 'utf8').includes('Cannot start http server for devtools')) {
        throw new Error('DevTools 端口绑定失败')
      }
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
  // 只发关窗命令，不在命令送达前断开 CDP：渲染端忙时提前断链会把排队中的命令丢掉，
  // 窗口不关、宿主被 SIGTERM 截断，重启后就读不到刚落盘的历史。
  page.fire("window.lcoder.window('close')")
  // 等窗口目标从调试列表消失再断链：这是“命令已送达且窗口已销毁”的确定信号，
  // 也避免调试连接把已销毁窗口的渲染进程继续挂在进程表里。
  const started = Date.now()
  const deadline = started + 10_000
  while (Date.now() < deadline) {
    let targets
    try {
      targets = await (await fetch(`http://127.0.0.1:${String(RENDERER_PORT)}/json/list`)).json()
    } catch {
      log(`渲染调试端口已关闭（${String(Date.now() - started)} 毫秒），断开 CDP`)
      page.socket.close()
      return
    }
    if (!targets.some(target => target.type === 'page' && target.url.startsWith('file://'))) {
      log(`窗口目标已消失（${String(Date.now() - started)} 毫秒），断开 CDP`)
      page.socket.close()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  log('窗口目标 10 秒内没有消失，保留 CDP 直接等退出')
}

async function waitExit(child, milliseconds, onTimeout) {
  const exited = new Promise(resolve => {
    if (child.exitCode !== null) { resolve(true); return }
    child.once('exit', () => { resolve(true) })
  })
  let timer
  const timed = new Promise(resolve => { timer = setTimeout(() => { resolve(false) }, milliseconds) })
  const ok = await Promise.race([exited, timed])
  clearTimeout(timer)
  if (!ok) {
    if (onTimeout !== undefined) await onTimeout().catch(() => undefined)
    child.kill('SIGTERM')
  }
  return ok
}

/**
 * 读取一个会话的 durable 日志：事件条数、assistant 正文与文件大小。
 * 会话目录按工作区（cwd 派生）分桶，所以逐桶找 `session-<id>`。
 * @param sessionId - 渲染端使用的会话标识（与目录名相同）。
 * @returns 日志摘要；会话还没有落盘文件时返回 undefined。
 */
function readSessionLog(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const root = join(HOME, 'sessions')
  if (!existsSync(root)) return undefined
  for (const bucket of readdirSync(root)) {
    const file = join(root, bucket, sessionId, 'session.v4.jsonl.zstd')
    if (!existsSync(file)) continue
    const buffer = readFileSync(file)
    const frames = []
    for (let index = 0; index <= buffer.length - 4; index += 1) {
      if (buffer[index] === 0x28 && buffer[index + 1] === 0xb5 && buffer[index + 2] === 0x2f && buffer[index + 3] === 0xfd) {
        frames.push(index)
      }
    }
    frames.push(buffer.length)
    let text = ''
    for (let index = 0; index < frames.length - 1; index += 1) {
      try {
        text += zstdDecompressSync(buffer.subarray(frames[index], frames[index + 1])).toString('utf8')
      } catch {
        // 帧边界可能落在压缩块中间；保留已解出的记录即可。
      }
    }
    const counts = {}
    let assistant = ''
    for (const line of text.split('\n')) {
      if (line === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const event = record.event ?? record
      const type = typeof event?.type === 'string' ? event.type : '?'
      counts[type] = (counts[type] ?? 0) + 1
      if (type === 'assistant/message' && Array.isArray(event?.data?.message?.content)) {
        assistant = event.data.message.content
          .filter(block => block?.type === 'text' && typeof block.text === 'string')
          .map(block => block.text)
          .join('')
      }
    }
    return { path: file, size: statSync(file).size, counts, assistant }
  }
  return undefined
}

/**
 * 读日志文件末尾若干行；文件不存在时返回空数组。
 * @param path - 日志路径。
 * @param count - 行数。
 * @returns 末尾行。
 */
function tailLines(path, count = 30) {
  try {
    return readFileSync(path, 'utf8').trimEnd().split(/\r?\n/u).slice(-count)
  } catch {
    return []
  }
}

/** 本探针调试端口的监听行。 */
function portRows() {
  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 8_000 })
  return (netstat.stdout ?? '').split(/\r?\n/u)
    .filter(line => /:98(?:22|29|30)\s/u.test(line))
    .map(line => line.trim())
}

/** 当前所有 Electron 进程（PID/父 PID/命令行）。 */
function electronRows() {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "electron.exe" } | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress',
  ], { encoding: 'utf8', timeout: 8_000 })
  return (ps.stdout ?? '').trim()
}

/**
 * 关窗等待超时的现场：主进程是否存活、端口被哪个 PID 占着、Electron 进程表与主进程日志尾部。
 * @param child - 探针启动的 Electron 主进程。
 * @param logPath - 该实例的 stdout/stderr 日志。
 * @param label - 实例阶段。
 */
async function dumpQuitHang(child, logPath, label) {
  log(`--- 关窗未退出：${label}（pid ${String(child.pid)}）`)
  let alive = false
  try {
    process.kill(child.pid, 0)
    alive = true
  } catch {
    alive = false
  }
  log(`主进程仍存活=${alive ? '是' : '否'} exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}`)
  const ports = portRows()
  log(`调试端口占用：${ports.length === 0 ? '无' : ''}`)
  for (const row of ports) log(`  | ${row}`)
  const table = electronRows()
  log(`Electron 进程：${table === '' ? '读不到' : ''}`)
  if (table !== '') log(`  | ${table}`)
  log(`主进程日志尾部（${logPath}）：`)
  for (const line of tailLines(logPath)) log(`  | ${line}`)
}

/**
 * 读取页面上的会话列表与聊天区摘要，用于失败现场。
 * @param page - CDP 页面。
 * @returns 可打印的摘要。
 */
async function pageSummary(page) {
  return await page.evaluate(`JSON.stringify({
    active: document.querySelector('[data-testid="active-session"]')?.textContent ?? null,
    sessions: [...document.querySelectorAll('[data-testid="session-item"]')].map(node => node.dataset.sessionId),
    messages: [...document.querySelectorAll('[data-testid="message-user"], [data-testid="message-assistant"]')]
      .map(node => ({
        role: node.dataset.testid === 'message-user' ? 'user' : 'assistant',
        live: node.dataset.live === 'true',
        text: (node.textContent ?? '').slice(0, 40),
      })),
    streamError: document.querySelector('[data-testid="stream-error"]')?.textContent ?? null,
    notice: document.querySelector('[data-testid="notice"]')?.textContent ?? null,
  })`)
}

/**
 * 打印失败现场：会话标识、durable 日志、页面摘要与两条实例日志尾部。
 * @param page - 当前页面；页面已关时传 undefined。
 * @param sessionId - 目标会话。
 * @param label - 失败阶段。
 */
async function dumpFailure(page, sessionId, label) {
  log(`--- 失败现场：${label}`)
  log(`目标会话：${sessionId ?? '尚未分配'}`)
  if (page !== undefined) {
    try {
      log(`页面摘要：${await pageSummary(page)}`)
    } catch (error) {
      log(`页面摘要读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const durable = readSessionLog(sessionId)
  if (durable === undefined) {
    log('会话日志：不存在')
  } else {
    log(`会话日志：${durable.path}（${String(durable.size)} 字节）事件 ${JSON.stringify(durable.counts)}`)
    log(`会话日志 assistant 正文：${JSON.stringify(durable.assistant.slice(0, 80))}`)
  }
  for (const name of ['first', 'restart']) {
    log(`${name} 实例日志尾部（${join(LOGS, `t187-probe-${name}.log`)}）：`)
    for (const line of tailLines(join(LOGS, `t187-probe-${name}.log`))) log(`  | ${line}`)
  }
}

/**
 * 等聊天区出现一条**已提交**的 assistant 记录（不是流式草稿），并记录流式文本出现的时间。
 * 关窗必须在回合提交之后：流式文本只证明渲染端收到了 chunk，durable 历史要等
 * `assistant/message` 落盘。
 * @param page - CDP 页面。
 * @param milliseconds - 等待上限。
 * @param label - 等待阶段。
 * @returns 已提交正文与两段时间。
 */
async function watchAssistant(page, milliseconds, label) {
  const started = Date.now()
  let liveAt
  while (Date.now() - started < milliseconds) {
    const state = JSON.parse(await page.evaluate(`JSON.stringify({
      live: document.querySelector('[data-testid="message-assistant"][data-live="true"]')?.textContent ?? '',
      committed: [...document.querySelectorAll('[data-testid="message-assistant"]:not([data-live])')]
        .map(node => node.textContent ?? ''),
      error: document.querySelector('[data-testid="stream-error"]')?.textContent ?? '',
    })`))
    if (state.live !== '' && liveAt === undefined) liveAt = Date.now() - started
    const committed = state.committed.find(text => text.includes('仓库结构'))
    if (committed !== undefined) {
      return { text: committed, liveAt, committedAt: Date.now() - started }
    }
    if (state.error !== '') throw new Error(`${label}流错误：${state.error}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
  }
  throw new Error(`等待超时：${label}（${String(milliseconds)} 毫秒内没有已提交的 assistant 记录；`
    + `${liveAt === undefined ? '也没有流式文本' : `流式文本在 ${String(liveAt)} 毫秒出现`}）`)
}

async function launchResilient(label) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const launched = await launch(label)
    try {
      return { ...launched, page: await connectCdp(launched.logPath) }
    } catch (error) {
      lastError = error
      log(`${label} 第 ${attempt} 次启动未拿到 CDP：${error instanceof Error ? error.message : String(error)}`)
      killTree(launched.child)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3_000))
    }
  }
  throw lastError
}

async function firstRun() {
  const launched = await launchResilient('first')
  let page = launched.page
  let sessionId
  try {
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready')
    const gate = await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state')", 30_000, '门禁判定')
    assert(gate === 'ready', `登录门禁没有放行：${String(gate)}（${await page.evaluate("document.body.innerText.slice(0,200)")}）`)
    await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null", 10_000, '会话列表')
    const before = JSON.parse(await page.evaluate(
      "JSON.stringify([...document.querySelectorAll('[data-testid=\"session-item\"]')].map(node => node.dataset.sessionId))",
    ))
    await page.evaluate("document.querySelector('[data-testid=\"new-session\"]').click()")
    // 复用 home 时列表里已有旧会话；只认点击之后新出现的会话，避免把旧会话的历史当成新回合。
    sessionId = await page.waitFor(`(() => {
      const before = new Set(${JSON.stringify(before)});
      const active = document.querySelector('[data-testid="session-item"].active')?.dataset.sessionId;
      if (typeof active === 'string' && !before.has(active)) return active;
      return [...document.querySelectorAll('[data-testid="session-item"]')]
        .map(node => node.dataset.sessionId)
        .find(id => !before.has(id)) ?? '';
    })()`, 30_000, '新建会话')
    log(`新建会话 ${sessionId}（点击前已有 ${String(before.length)} 条）`)
    await page.evaluate("(() => { const input = document.querySelector('[data-testid=\"composer\"]'); input.value = '你好，请用一句话说明你读到了什么。'; input.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
    const assistant = await watchAssistant(page, 60_000, 'assistant 文本')
    assert(assistant.text.includes('仓库结构'), `assistant 文本不符合 mock 预期：${String(assistant.text).slice(0, 120)}`)
    log(`assistant 已提交：流式 ${String(assistant.liveAt)} 毫秒、落盘 ${String(assistant.committedAt)} 毫秒，`
      + `正文 ${JSON.stringify(String(assistant.text).slice(0, 40))}…`)
    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000, () =>
      dumpQuitHang(launched.child, launched.logPath, '首次实例'))
    page.socket.close()
    page = undefined
    if (!exited) await dumpFailure(undefined, sessionId, '首次实例关窗后退出')
    assert(exited, '首次实例关窗后退出')
    log('首次实例已退出')
    const durable = readSessionLog(sessionId)
    assert(durable !== undefined, `首次实例退出后找不到会话日志 ${sessionId}`)
    assert((durable.counts['assistant/message'] ?? 0) > 0,
      `首次实例退出后会话日志没有 assistant/message（${JSON.stringify(durable.counts)}）`)
    assert(durable.assistant.includes('仓库结构'),
      `首次实例退出后会话日志的 assistant 正文不含 mock 文本：${JSON.stringify(durable.assistant.slice(0, 80))}`)
    log(`会话日志已落盘：${String(durable.size)} 字节，事件 ${JSON.stringify(durable.counts)}`)
    return sessionId
  } catch (error) {
    if (page !== undefined) {
      await dumpFailure(page, sessionId, '首次实例')
      await closeApp(page)
      page.socket.close()
    }
    if (launched.child.exitCode === null) launched.child.kill('SIGTERM')
    throw error
  }
}

async function restartRun(sessionId) {
  const launched = await launchResilient('restart')
  let page = launched.page
  try {
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready（重启）')
    await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 30_000, '门禁放行（重启）')
    const selector = `[data-testid="session-item"][data-session-id="${sessionId}"]`
    try {
      await page.waitFor(`document.querySelector('${selector}') !== null`, 20_000, '重启后的会话列表')
    } catch (error) {
      await dumpFailure(page, sessionId, '重启后的会话列表')
      throw error
    }
    await page.evaluate(`document.querySelector('${selector}').click()`)
    let assistant
    try {
      assistant = await watchAssistant(page, 30_000, '重启后的历史')
    } catch (error) {
      await dumpFailure(page, sessionId, '重启后的历史')
      throw error
    }
    assert(assistant.text.includes('仓库结构'), '重启后没有从 follow snapshot 读到历史 assistant 文本')
    log(`重启后同一会话已重读历史（提交 ${String(assistant.committedAt)} 毫秒）`)
    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000, () =>
      dumpQuitHang(launched.child, launched.logPath, '重启实例'))
    page.socket.close()
    page = undefined
    if (!exited) await dumpFailure(undefined, sessionId, '重启实例关窗后退出')
    assert(exited, '重启实例关窗后退出')
  } catch (error) {
    if (page !== undefined) { await dumpFailure(page, sessionId, '重启实例'); await closeApp(page); page.socket.close() }
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
  const busy = await busyPorts()
  assert(busy.length === 0, `调试端口空闲（占用：${busy.join(', ') || '无'}）；先关掉本工作树正在运行的实例`)
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
