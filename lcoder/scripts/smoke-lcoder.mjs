/**
 * T-199 C4 十二条切换冒烟：新客户端（packages/lcoder/desktop + client）的验收口径。
 *
 * 一项一条断言，逐项打印 PASS/FAIL 与依据（DOM、会话日志或 mock 状态）；任一项
 * 失败即非零退出。只跑本工作树的实例：渲染 9822、主进程 9829、宿主 9830、
 * mock 云端 5091；DSH_HOME 用本树 `lcoder/logs/smoke-lcoder-home`，每次重建。
 *
 * 用法：node lcoder/scripts/smoke-lcoder.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`
 *
 * 十二项：
 *   1 窗口与宿主就绪        2 登录门禁              3 六页导航
 *   4 六列看板与列表切换    5 任务详情与契约        6 Markdown 阅读器与缩放
 *   7 需求详情与讨论历史    8 立项向导与结果页      9 发送、流式与工具卡
 *  10 审批通过与拒绝回执   11 提问回执、附件预览、模型用量
 *  12 重启历史、关窗确认、停止与改名
 *
 * 讨论历史的正样本由本脚本经宿主 IPC 造一条 `lcoder-pm` 会话：界面目前没有创建
 * 讨论角色会话的入口，但历史聚合读的是真实 durable 事件，不是合成帧。
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const APP_ROOT = join(REPO_ROOT, 'packages', 'lcoder', 'desktop')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const HOME = join(LOGS, 'smoke-lcoder-home')
const SCRATCH_REPO = join(LOGS, 'smoke-lcoder-scratch')
const MOCK_PORT = 5091
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}/v1`
const MOCK_ORIGIN = `http://127.0.0.1:${String(MOCK_PORT)}`
const RENDERER_PORT = 9822
const MAIN_PORT = 9829
const HOST_PORT = 9830
const PHONE = '+8613900000099'
const PASSWORD = 'lcoder-t199-pass'
const RENAMED = 'T199 smoke session'
const QUESTION_LABEL = '继续（推荐）'
const REQ_MARKER = 'T199-REQ-BODY'
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const ITEM_NAMES = [
  '窗口与宿主就绪',
  '登录门禁',
  '六页导航',
  '六列看板与列表切换',
  '任务详情与契约',
  'Markdown 阅读器与缩放',
  '需求详情与讨论历史',
  '立项向导与结果页',
  '发送、流式与工具卡',
  '审批通过与拒绝回执',
  '提问回执、附件预览、模型用量',
  '重启历史、关窗确认、停止与改名',
]

mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null
let checks = 0
const results = new Map()
const context = { child: null, page: null, launched: null, sessionId: null, scratchOpen: false, scope: null }

function log(message) {
  console.log(`[smoke] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  checks += 1
}

/** 记一项结果；evidence 是 PASS 的依据，失败由 step 捕获。 */
function record(id, ok, detail) {
  results.set(id, { ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${String(id).padStart(2, '0')}. ${ITEM_NAMES[id - 1]} — ${detail}`)
}

/** 跑一项；失败不中断后面的项，最后统一汇总。 */
async function step(id, run) {
  const started = Date.now()
  try {
    const evidence = await run()
    record(id, true, `${evidence}（${String(Date.now() - started)} 毫秒）`)
  } catch (error) {
    record(id, false, error instanceof Error ? error.message : String(error))
  }
}

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

const q = value => JSON.stringify(value)

async function checkMock() {
  try {
    const response = await fetch(`${MOCK_BASE}/models`, { signal: AbortSignal.timeout(1500) })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

/** 只认本脚本拉起的 mock：端口被占时直接失败，避免把旧代码的 mock 当成新协议。 */
async function ensureMock() {
  if (await checkMock()) {
    throw new Error(`mock 端口 ${String(MOCK_PORT)} 已被占用；先停掉占用者，冒烟只跑自己拉起的 mock`)
  }
  log(`启动本机 mock 云端（端口 ${String(MOCK_PORT)}）`)
  const out = openSync(join(LOGS, 'smoke-lcoder-mock.log'), 'w')
  mockChild = spawn(process.execPath, [join(REPO_ROOT, 'lcoder', 'scripts', 'mock-cloud.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, MOCK_CLOUD_PORT: String(MOCK_PORT) },
    stdio: ['ignore', out, out],
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await checkMock()) return
    await sleep(250)
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

async function mockState() {
  return await (await fetch(`${MOCK_ORIGIN}/_mock/state`)).json()
}

async function seedCredential() {
  let session = await post('/auth/login/password', { phone: PHONE, password: PASSWORD })
  if (session.status !== 200) {
    await post('/auth/sms/send', { phone: PHONE, purpose: 'register' })
    session = await post('/auth/register', { phone: PHONE, code: '123456', password: PASSWORD, displayName: 'T199 Smoke' })
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

/** 准备可写靶仓：复制本仓 `.spec`，再补一条带正文与表格的需求。 */
function prepareScratch() {
  rmSync(SCRATCH_REPO, { recursive: true, force: true })
  mkdirSync(SCRATCH_REPO, { recursive: true })
  cpSync(join(REPO_ROOT, '.spec'), join(SCRATCH_REPO, '.spec'), { recursive: true })
  for (const dir of ['requirements', 'tasks', 'contracts', 'evidence']) {
    mkdirSync(join(SCRATCH_REPO, '.spec', dir), { recursive: true })
  }
  writeFileSync(join(SCRATCH_REPO, '.spec', 'requirements', 'REQ-99.yaml'), [
    'id: REQ-99',
    'title: 探针需求：详情与讨论历史',
    'state: draft',
    'options: []',
    'opened_at: 2026-11-15T00:00:00.000Z',
    '',
  ].join('\n'))
  writeFileSync(join(SCRATCH_REPO, '.spec', 'requirements', 'REQ-99.md'), [
    '# 探针需求 REQ-99',
    '',
    `正文标记：${REQ_MARKER}。用于验证需求详情、Markdown 渲染与阅读器缩放。`,
    '',
    '| 项 | 值 |',
    '| --- | --- |',
    '| 状态 | draft |',
    '| 验收 | 阅读器正文与表格渲染 |',
    '',
  ].join('\n'))
  log(`靶仓已准备：${SCRATCH_REPO}`)
}

/** 本脚本占用的三个调试端口。 */
const DEBUG_PORTS = [RENDERER_PORT, MAIN_PORT, HOST_PORT]

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

function killTree(child) {
  if (child === undefined || child === null || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGKILL')
}

function resolveElectron() {
  const override = process.env.LCODER_PROBE_EXECUTABLE
  if (override !== undefined && override !== '') return override
  const requireFromApp = createRequire(join(APP_ROOT, 'package.json'))
  const resolved = requireFromApp('electron')
  assert(typeof resolved === 'string', '找不到 Electron 可执行文件')
  return resolved
}

const packagedProbe = process.env.LCODER_PROBE_PACKAGED === '1'

async function launch(label) {
  const logPath = join(LOGS, `smoke-lcoder-${label}.log`)
  const out = openSync(logPath, 'w')
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  Object.assign(environment, {
    DSH_HOME: HOME,
    LCODER_CLOUD_BASE_URL: MOCK_BASE,
    DSH_DESKTOP_RENDERER_DEBUG_PORT: String(RENDERER_PORT),
    DSH_DESKTOP_MAIN_INSPECT_PORT: String(MAIN_PORT),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(HOST_PORT),
    ELECTRON_ENABLE_LOGGING: '0',
  })
  const child = spawn(electron, [
    `--inspect=127.0.0.1:${String(MAIN_PORT)}`,
    `--remote-debugging-port=${String(RENDERER_PORT)}`,
    `--user-data-dir=${join(HOME, 'electron-user-data')}`,
    ...(packagedProbe ? [] : [APP_ROOT]),
  ], { cwd: packagedProbe ? dirname(electron) : APP_ROOT, env: environment, stdio: ['ignore', out, out] })
  log(`已启动 ${label}（pid ${String(child.pid)}），日志 ${logPath}`)
  return { child, logPath }
}

async function attach(url) {
  const socket = new WebSocket(url)
  await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++nextId
    pending.set(id, resolvePromise)
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (answer.result?.exceptionDetails !== undefined) {
      const details = answer.result.exceptionDetails
      const description = details.exception?.description ?? details.text
      throw new Error(`页面脚本失败：${String(description).slice(0, 300)}（${expression.slice(0, 120)}）`)
    }
    return answer.result?.result?.value
  }
  const waitFor = async (expression, milliseconds, label) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const value = await evaluate(expression)
      if (value !== undefined && value !== null && value !== false && value !== '') return value
      await sleep(120)
    }
    const body = await evaluate('document.body.innerText.slice(0, 500)').catch(() => '')
    throw new Error(`等待超时：${label}；页面：${String(body)}`)
  }
  const fire = (expression) => {
    socket.send(JSON.stringify({ id: ++nextId, method: 'Runtime.evaluate', params: { expression } }))
  }
  return { socket, evaluate, waitFor, fire }
}

async function connectCdp(logPath) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      if (existsSync(logPath) && readFileSync(logPath, 'utf8').includes('Cannot start http server for devtools')) {
        throw new Error('DevTools 端口绑定失败')
      }
      const list = await (await fetch(`http://127.0.0.1:${String(RENDERER_PORT)}/json/list`)).json()
      const page = list.find(target => target.type === 'page' && target.url.startsWith('file://'))
      if (page !== undefined && typeof page.webSocketDebuggerUrl === 'string') return await attach(page.webSocketDebuggerUrl)
    } catch (error) {
      if (error instanceof Error && error.message === 'DevTools 端口绑定失败') throw error
      // 端口未就绪时继续轮询。
    }
    await sleep(300)
  }
  throw new Error('90 秒内没有等到渲染端 CDP 目标')
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
      await sleep(3_000)
    }
  }
  throw lastError
}

/** 发关窗命令，等窗口目标消失再断 CDP：提前断链会把排队中的命令丢掉。 */
async function closeApp(page) {
  page.fire("window.lcoder.window('close')")
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    let targets
    try {
      targets = await (await fetch(`http://127.0.0.1:${String(RENDERER_PORT)}/json/list`)).json()
    } catch {
      page.socket.close()
      return
    }
    if (!targets.some(target => target.type === 'page' && target.url.startsWith('file://'))) {
      page.socket.close()
      return
    }
    await sleep(100)
  }
  page.socket.close()
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/**
 * 等实例真正退出。Windows 下自 SIGKILL 后父进程偶发收不到 exit 事件，
 * exitCode/signalCode 也保持 null；所以同时看 exit 事件、退出码与 PID 存活。
 */
async function waitExit(child, milliseconds) {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    if (child.exitCode !== null || child.signalCode !== null || !processAlive(child.pid)) return true
    await sleep(200)
  }
  return false
}

/**
 * 读一个会话的 durable 日志，把每条事件解出来。
 * @param sessionId - 渲染端使用的会话标识（与目录名相同）。
 * @returns 事件列表与文件路径；会话还没有落盘文件时返回 undefined。
 */
function readSessionEvents(sessionId) {
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
    const events = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const event = record.event ?? record
      if (typeof event?.type === 'string') events.push(event)
    }
    return { path: file, size: statSync(file).size, events }
  }
  return undefined
}

/** 等 durable 日志满足条件；事件可能在回合结束后才刷完。 */
async function waitDurable(sessionId, predicate, milliseconds, label) {
  const deadline = Date.now() + milliseconds
  let last
  while (Date.now() < deadline) {
    last = readSessionEvents(sessionId)
    if (last !== undefined && predicate(last)) return last
    await sleep(200)
  }
  const counts = last === undefined ? '（无日志）' : JSON.stringify(countOf(last.events))
  throw new Error(`等待超时：${label}；会话事件 ${counts}`)
}

function countOf(events) {
  const counts = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  return counts
}

function click(page, selector) {
  return page.evaluate(`(() => {
    const node = document.querySelector(${q(selector)});
    if (node === null || node.disabled === true) return false;
    node.click();
    return true;
  })()`)
}

function fill(page, selector, value) {
  return page.evaluate(`(() => {
    const node = document.querySelector(${q(selector)});
    if (node === null) return false;
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, ${q(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

const PAGE_MARKERS = {
  chat: 'session-list',
  requirements: 'page-requirements',
  tasks: 'page-tasks',
  projects: 'page-projects',
  'project-info': 'page-project-info',
  settings: 'page-settings',
}

async function goto(page, id) {
  const clicked = await click(page, `[data-testid="nav-${id}"]`)
  assert(clicked === true, `导航项 nav-${id} 不可点`)
  await page.waitFor(
    `document.querySelector(${q(`[data-testid="${PAGE_MARKERS[id]}"]`)}) !== null ? 'ok' : ''`,
    20_000, `页面 ${id}`)
}

/** 打开靶仓；chooseWorkspace 成功后自动切到任务页。 */
async function openProject(page, path) {
  await goto(page, 'projects')
  assert(await fill(page, '[data-testid="project-path"]', path), '项目路径输入框不存在')
  assert(await click(page, '[data-testid="project-open"]'), '打开按钮不可点')
  await page.waitFor("document.querySelector('[data-testid=\"page-tasks\"]') !== null ? 'ok' : ''", 90_000, '打开仓库后的任务页')
  const raw = await page.evaluate("localStorage.getItem('lcoder.m2.project') ?? ''")
  assert(typeof raw === 'string' && raw !== '', '打开仓库后没有保存项目作用域')
  context.scope = JSON.parse(raw)
  context.scratchOpen = true
}

/** 等一条已提交的 assistant 正文包含标记，并记录是否见过流式草稿。 */
async function watchAssistant(page, marker, milliseconds, label) {
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
    if (state.error !== '') throw new Error(`${label}流错误：${state.error}`)
    const hit = state.committed.find(text => text.includes(marker))
    if (hit !== undefined) return { text: hit, liveAt, committedAt: Date.now() - started }
    await sleep(40)
  }
  throw new Error(`等待超时：${label}（没有含 ${JSON.stringify(marker)} 的已提交答复）`)
}

async function sendPrompt(page, text) {
  await page.waitFor("document.querySelector('[data-testid=\"composer\"]') !== null ? 'ok' : ''", 10_000, '输入框')
  assert(await fill(page, '[data-testid="composer"]', text), '输入框不存在')
  assert(await click(page, '[data-testid="send"]'), '发送按钮不可点')
}

async function waitApprovalCard(page, label) {
  const payload = await page.waitFor(`(() => {
    const card = document.querySelector('[data-testid="approval-card"]');
    if (card === null) return '';
    return JSON.stringify({
      tool: card.querySelector('[data-testid="approval-tool"]')?.textContent ?? '',
      reason: card.querySelector('[data-testid="approval-reason"]')?.textContent ?? '',
      error: card.querySelector('[data-testid="approval-error"]')?.textContent ?? '',
    });
  })()`, 60_000, label)
  return JSON.parse(payload)
}

async function waitQuestionCard(page, label) {
  return JSON.parse(await page.waitFor(`(() => {
    const card = document.querySelector('[data-testid="question-card"]');
    if (card === null) return '';
    const submit = card.querySelector('[data-testid="question-submit"]');
    return JSON.stringify({
      text: card.innerText,
      options: [...card.querySelectorAll('[data-testid="question-option"]')].map(node => node.dataset.label ?? ''),
      disabled: submit === null ? null : submit.disabled,
    });
  })()`, 60_000, label))
}

async function pressCard(page, testId, label) {
  assert(await click(page, `[data-testid="${testId}"]`), `${label}不可点`)
  await page.waitFor(
    "document.querySelector('[data-testid=\"approval-card\"], [data-testid=\"question-card\"]') === null ? 'gone' : ''",
    20_000, `${label}后卡片收起`)
}

async function lastToolState(page, tool) {
  const states = JSON.parse(await page.evaluate(`JSON.stringify(
    [...document.querySelectorAll('[data-testid="process-tool"][data-tool=${q(tool)}]')]
      .map(node => node.querySelector('[data-testid="process-status"]')?.dataset.state ?? ''),
  )`))
  return states.at(-1)
}

/** 在输入区构造文件并塞进选择器。 */
function attachFiles(files) {
  const attachment = { selector: '[data-testid="attach-input"]', png: PIXEL_PNG, files }
  return `(() => {
    const attachment = ${JSON.stringify(attachment)};
    const input = document.querySelector(attachment.selector);
    if (input === null) return false;
    const transfer = new DataTransfer();
    for (const spec of attachment.files) {
      const bytes = spec.text === undefined
        ? Uint8Array.from(atob(attachment.png), char => char.charCodeAt(0))
        : new TextEncoder().encode(spec.text);
      transfer.items.add(new File([bytes], spec.name, { type: spec.type }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
}

/** 新建会话并返回它的标识。 */
async function createSession(page) {
  const before = JSON.parse(await page.evaluate(
    "JSON.stringify([...document.querySelectorAll('[data-testid=\"session-item\"]')].map(node => node.dataset.sessionId))",
  ))
  assert(await click(page, '[data-testid="new-session"]'), '新建会话按钮不可点')
  return await page.waitFor(`(() => {
    const before = new Set(${JSON.stringify(before)});
    const active = document.querySelector('[data-testid="session-item"].active')?.dataset.sessionId;
    if (typeof active === 'string' && !before.has(active)) return active;
    return [...document.querySelectorAll('[data-testid="session-item"]')]
      .map(node => node.dataset.sessionId)
      .find(id => !before.has(id)) ?? '';
  })()`, 30_000, '新建会话')
}

async function itemWindow(page) {
  const info = JSON.parse(await page.waitFor(`(() => {
    const host = document.querySelector('[data-testid="host-state"]');
    const bar = document.querySelector('[data-testid="titlebar"]');
    if (host === null || bar === null || host.dataset.hostState !== 'ready') return '';
    return JSON.stringify({
      host: host.dataset.hostState,
      maximized: bar.dataset.maximized,
      buttons: ['window-minimize', 'window-maximize', 'window-close']
        .filter(id => document.querySelector('[data-testid="' + id + '"]') !== null),
    });
  })()`, 90_000, '窗口与宿主 ready'))
  assert(info.buttons.length === 3, `标题栏窗口按钮不全：${info.buttons.join('/')}`)
  return `host-state=ready；自绘标题栏与 ${info.buttons.join('/')}；maximized=${String(info.maximized)}`
}

async function itemGate(page) {
  const gate = await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') ?? ''", 60_000, '登录门禁')
  assert(gate === 'ready', `登录门禁没有放行：${String(gate)}`)
  const login = await page.evaluate("document.querySelector('[data-testid=\"login-screen\"]') !== null")
  assert(login === false, '已登录时仍显示登录页')
  const account = await page.evaluate("document.querySelector('[data-testid=\"account-button\"]') !== null")
  assert(account === true, '已登录但标题栏没有账号入口')
  return 'data-lcoder-state=ready；登录页不显示；标题栏账号入口存在'
}

async function itemNav(page) {
  const ids = JSON.parse(await page.evaluate(
    "JSON.stringify([...document.querySelectorAll('[data-testid=\"nav\"] button')].map(node => node.dataset.testid))",
  ))
  assert(ids.length === 7, `导航项应为 7（六页 + 角色），实际 ${String(ids.length)}：${ids.join(',')}`)
  const pages = ['chat', 'requirements', 'tasks', 'projects', 'project-info', 'settings']
  for (const id of pages) {
    assert(ids.includes(`nav-${id}`), `导航缺少 nav-${id}`)
    await goto(page, id)
  }
  return `${String(pages.length)} 页逐页可达（${pages.join('/')}），导航共 ${String(ids.length)} 项含角色页`
}

async function itemBoard(page) {
  await openProject(page, SCRATCH_REPO)
  const columns = JSON.parse(await page.waitFor(`(() => {
    const nodes = [...document.querySelectorAll('[data-testid="task-column"]')];
    return nodes.length === 6 ? JSON.stringify(nodes.map(node => node.dataset.column)) : '';
  })()`, 90_000, '六列看板'))
  const expected = ['drafting', 'discussion', 'contracted', 'implementing', 'verifying', 'closed']
  assert(expected.every(id => columns.includes(id)), `看板列不符：${columns.join(',')}`)
  await page.waitFor(
    "[...document.querySelectorAll('[data-testid=\"task-card\"]')].some(card => (card.innerText ?? '').includes('DEMO-01')) ? 'ok' : ''",
    30_000, 'DEMO-01 任务卡')
  assert(await click(page, '[data-testid="task-view-list"]'), '列表视图按钮不可点')
  const rows = await page.waitFor(`(() => {
    if (document.querySelector('[data-testid="task-list"]') === null) return '';
    const nodes = [...document.querySelectorAll('[data-testid="task-row"]')];
    return nodes.length > 0 ? String(nodes.length) : '';
  })()`, 20_000, '列表视图')
  const listText = await page.evaluate("document.querySelector('[data-testid=\"task-list\"]')?.innerText ?? ''")
  assert(listText.includes('DEMO-01'), '列表视图没有 DEMO-01')
  assert(await click(page, '[data-testid="task-view-board"]'), '看板视图按钮不可点')
  await page.waitFor("document.querySelectorAll('[data-testid=\"task-column\"]').length === 6 ? 'ok' : ''", 20_000, '切回看板')
  return `六列 ${columns.join('/')}；列表 ${String(rows)} 行含 DEMO-01；可切回看板`
}

async function itemTaskDetail(page) {
  assert(context.scratchOpen, '前置不满足：靶仓未打开')
  assert(await click(page, '[data-testid="task-card"][data-task-id="DEMO-01"]'), 'DEMO-01 任务卡不可点')
  await page.waitFor("document.querySelector('[data-testid=\"task-detail\"]')?.dataset.taskId === 'DEMO-01' ? 'ok' : ''", 20_000, '任务详情')
  const info = JSON.parse(await page.evaluate(`JSON.stringify({
    signed: document.querySelector('[data-testid="task-contract-signed"]')?.textContent ?? '',
    acceptance: document.querySelectorAll('[data-testid="task-acceptance"] li').length,
    paths: document.querySelector('[data-testid="task-paths"]')?.textContent ?? '',
    description: document.querySelector('[data-testid="task-description"]')?.textContent ?? '',
    evidence: document.querySelector('[data-testid="task-evidence"]')?.textContent ?? '',
  })`))
  assert(info.signed.includes('未签署'), `契约签署态异常：${info.signed}`)
  assert(info.acceptance > 0, '契约验收条目为空')
  assert(info.paths.includes('fixtures/demo'), `允许路径缺少 fixtures/demo：${info.paths}`)
  assert(info.description.includes('佣金'), `任务描述没有渲染：${info.description.slice(0, 60)}`)
  assert(info.evidence !== '', '证据段为空')
  return `详情打开 DEMO-01；契约${info.signed.trim()}；验收 ${String(info.acceptance)} 条；允许路径含 fixtures/demo；证据段存在`
}

async function itemReader(page) {
  await goto(page, 'requirements')
  await page.waitFor("document.querySelector('[data-testid=\"requirement-row\"][data-requirement-id=\"REQ-99\"]') !== null ? 'ok' : ''", 30_000, 'REQ-99 行')
  assert(await click(page, '[data-testid="requirement-row"][data-requirement-id="REQ-99"]'), 'REQ-99 行不可点')
  await page.waitFor("document.querySelector('[data-testid=\"requirement-detail\"]')?.dataset.requirementId === 'REQ-99' ? 'ok' : ''", 20_000, '需求详情')
  assert(await click(page, '[data-testid="requirement-open-reader"]'), '打开阅读器按钮不可点')
  await page.waitFor("document.querySelector('[data-testid=\"markdown-reader\"]')?.dataset.readerStatus === 'ready' ? 'ok' : ''", 30_000, '阅读器就绪')
  const doc = await page.evaluate("document.querySelector('[data-testid=\"reader-doc\"]')?.innerText ?? ''")
  assert(doc.includes(REQ_MARKER), `阅读器正文没有靶仓标记：${doc.slice(0, 80)}`)
  const zoom0 = await page.evaluate("document.querySelector('[data-testid=\"reader-zoom\"]')?.textContent ?? ''")
  assert(zoom0 === '100%', `阅读器初始缩放应为 100%，实际 ${zoom0}`)
  await page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))")
  await page.waitFor("document.querySelector('[data-testid=\"reader-zoom\"]')?.textContent === '110%' ? 'ok' : ''", 10_000, '放大到 110%')
  await page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }))")
  await page.waitFor("document.querySelector('[data-testid=\"reader-zoom\"]')?.textContent === '100%' ? 'ok' : ''", 10_000, '缩小回 100%')
  await page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
  await page.waitFor("document.querySelector('[data-testid=\"markdown-reader\"]') === null ? 'closed' : ''", 10_000, 'Esc 关闭阅读器')
  return `阅读器正文 ${String(doc.length)} 字含标记；缩放 100%→110%→100%；Esc 关闭`
}

async function callHost(page, service, method, args) {
  const raw = await page.evaluate(`window.lcoder.call(${q(service)}, ${q(method)}, ${JSON.stringify(args)}).then(answer => JSON.stringify(answer))`)
  return JSON.parse(raw)
}

/** 等讨论会话的 assistant 事件落盘。 */
async function waitSessionAssistant(page, sessionId, milliseconds) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    const answer = await callHost(page, 'session', 'events', {
      request: { address: { kind: 'session', sessionId }, maxMessages: 120 },
    })
    const records = answer.ok && Array.isArray(answer.value?.records) ? answer.value.records : []
    if (records.some(record => record.type === 'event' && record.event?.type === 'assistant/message')) return
    await sleep(300)
  }
  throw new Error('讨论会话没有在时限内落盘 assistant 事件')
}

const PRESET_ROLES = {
  'lcoder-pm': 'pm',
  'lcoder-intake': 'analyst',
  'lcoder-manager': 'manager',
  'lcoder-architect': 'architect',
  'lcoder': 'track',
}

async function itemRequirement(page) {
  assert(context.scratchOpen && context.scope !== null, '前置不满足：靶仓未打开')
  const body = JSON.parse(await page.evaluate(`JSON.stringify({
    text: document.querySelector('[data-testid="requirement-document-body"]')?.innerText ?? '',
    tables: document.querySelectorAll('[data-testid="requirement-document-body"] table').length,
    title: document.querySelector('[data-testid="requirement-detail-title"]')?.textContent ?? '',
    timeline: document.querySelector('[data-testid="requirement-timeline"]') !== null,
  })`))
  assert(body.text.includes(REQ_MARKER), `需求正文没有靶仓标记：${body.text.slice(0, 80)}`)
  assert(body.tables > 0, '需求正文的表格没有渲染')
  assert(body.title !== '', '需求详情标题为空')
  assert(body.timeline === true, '需求详情缺少时间线')
  const presets = await callHost(page, 'agentPresets', 'list', {})
  const ids = presets.ok && Array.isArray(presets.value?.presets) ? presets.value.presets.map(item => item.id) : []
  const preset = Object.keys(PRESET_ROLES).find(id => ids.includes(id))
  assert(preset !== undefined, `没有可用的讨论 preset：${ids.join(',')}`)
  const created = await callHost(page, 'session', 'create', {
    request: { workspaceId: context.scope.workspaceId, agentPreset: preset },
  })
  assert(created.ok === true && typeof created.value?.sessionId === 'string',
    `讨论会话创建失败：${JSON.stringify(created.error ?? created.value)}`)
  const sessionId = created.value.sessionId
  const sent = await callHost(page, 'session', 'prompt', {
    request: {
      requestId: `smoke-${String(Date.now())}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'REQ-99 讨论：这条需求我建议先做最小可验收切片。' }],
    },
  })
  assert(sent.ok === true, `讨论提示词发送失败：${JSON.stringify(sent.error)}`)
  await waitSessionAssistant(page, sessionId, 60_000)
  // 会话列表由 api-session/added 事件补齐后再读历史。
  await sleep(600)
  const listed = await callHost(page, 'session', 'list', { _request: {} })
  const row = listed.ok && Array.isArray(listed.value?.items)
    ? listed.value.items.find(item => item.sessionId === sessionId)
    : undefined
  const wire = JSON.stringify({
    cwd: row?.cwd ?? null,
    projections: row?.projections ?? null,
  })
  assert(await click(page, '[data-testid="requirement-history-load"]'), '读取讨论历史按钮不可点')
  const history = JSON.parse(await page.waitFor(`(() => {
    const empty = document.querySelector('[data-testid="requirement-history-empty"]');
    const rounds = [...document.querySelectorAll('[data-testid="requirement-history-round"]')];
    if (empty === null && rounds.length === 0) return '';
    return JSON.stringify({
      message: empty?.textContent ?? '',
      rounds: rounds.map(node => ({ role: node.dataset.role, text: node.innerText })),
    });
  })()`, 30_000, '讨论历史结果'))
  assert(history.rounds.length > 0,
    `讨论历史没有聚合出轮次：${history.message}（讨论会话 ${sessionId}，preset ${preset}，cwd=${context.scope.path}，`
    + `session/list 行=${wire}）。客户端 summaryOf 只读 projections.agentPreset，宿主线形是 projections.values.agentPreset。`)
  const expected = PRESET_ROLES[preset]
  assert(history.rounds.some(round => round.role === expected),
    `讨论历史角色不含 ${expected}：${JSON.stringify(history.rounds.map(round => round.role))}`)
  const round = history.rounds.find(item => item.role === expected)
  assert(round.text.includes('仓库结构'), `讨论发言没有渲染 assistant 正文：${round.text.slice(0, 60)}`)
  return `需求正文 ${String(body.text.length)} 字含表格与时间线；讨论历史聚合出 ${String(history.rounds.length)} 轮（${expected}），会话 ${sessionId.slice(0, 8)}`
}

async function itemIntake(page) {
  assert(context.scratchOpen, '前置不满足：靶仓未打开')
  await goto(page, 'requirements')
  assert(await click(page, '[data-testid="intake-open"]'), '立项向导入口不可点')
  await page.waitFor("document.querySelector('[data-testid=\"intake-wizard\"]') !== null ? 'ok' : ''", 10_000, '立项向导')
  const fresh = await page.evaluate("document.querySelector('[data-testid=\"intake-prompt\"]')?.innerText ?? ''")
  assert(fresh.includes('全新项目立项') && fresh.includes('最多 7 问'), `立项指令预览不符：${fresh.slice(0, 80)}`)
  assert(await click(page, '[data-testid="intake-mode-onboarding"]'), '已有资料档位不可点')
  await page.waitFor("document.querySelector('[data-testid=\"intake-prompt\"]')?.innerText.includes('已有资料立项') ? 'ok' : ''", 10_000, '已有资料档位')
  assert(await click(page, '[data-testid="intake-mode-fresh"]'), '全新项目档位不可点')
  await page.waitFor("document.querySelector('[data-testid=\"intake-prompt\"]')?.innerText.includes('全新项目立项') ? 'ok' : ''", 10_000, '全新项目档位')
  assert(await click(page, '[data-testid="intake-start"]'), '开始立项不可点')
  await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null ? 'ok' : ''", 30_000, '立项后切到对话页')
  await page.waitFor(
    "[...document.querySelectorAll('[data-testid=\"message-user\"]')].some(node => (node.textContent ?? '').includes('全新项目立项')) ? 'ok' : ''",
    30_000, '立项指令进入对话')
  // 结果页：开始时切到对话页会让向导卸载；重新打开后应能回看结果，实际回到初始向导。
  await goto(page, 'requirements')
  assert(await click(page, '[data-testid="intake-open"]'), '再次打开立项向导失败')
  await page.waitFor("document.querySelector('[data-testid=\"intake-wizard\"]') !== null ? 'ok' : ''", 10_000, '重开立项向导')
  const after = JSON.parse(await page.evaluate(`JSON.stringify({
    result: document.querySelector('[data-testid="intake-result"]') !== null,
    start: document.querySelector('[data-testid="intake-start"]') !== null,
  })`))
  assert(after.result === true && after.start === false,
    '结果页不可达：开始立项后切到对话页，RequirementsPage 卸载，向导的 started 状态丢失；'
    + `重新打开只看到初始向导（result=${String(after.result)}、start=${String(after.start)}）。`
    + '最小修法：把 intake 的 started/结果提升到 RequirementsPage 或 App，或发送后不立即切页，让结果页可回看。')
  return '立项向导两档、7 问指令与发送均通过；结果页可回看'
}

async function itemChat(page) {
  await goto(page, 'chat')
  const sessionId = await createSession(page)
  context.sessionId = sessionId
  log(`聊天主会话 ${sessionId}`)
  await sendPrompt(page, '你好，请用一句话说明你读到了什么。')
  const plain = await watchAssistant(page, '仓库结构', 60_000, '纯文本答复')
  assert(plain.liveAt !== undefined, '没有观察到流式草稿（data-live）')
  await sendPrompt(page, 'T195:approve 请按流程处理这一轮。')
  const card = await waitApprovalCard(page, '审批卡')
  assert(card.error === '', `审批卡上有就地错误：${card.error}`)
  assert(card.tool === 'pwsh', `审批卡工具名应为 pwsh，实际 ${JSON.stringify(card.tool)}`)
  assert(card.reason.includes('danger-full-access'), `审批卡理由不符：${JSON.stringify(card.reason)}`)
  const pendingTool = await page.evaluate("document.querySelector('[data-testid=\"process-tool\"][data-tool=\"pwsh\"]') !== null")
  assert(pendingTool === true, '审批前工具卡没有出现')
  await pressCard(page, 'approval-allow', '允许一次')
  const approved = await watchAssistant(page, 'T195-APPROVED-DONE', 60_000, '批准后的最终正文')
  await page.waitFor(
    "document.querySelector('[data-testid=\"process-tool\"][data-tool=\"pwsh\"] [data-testid=\"process-status\"]')?.dataset.state === 'done' ? 'ok' : ''",
    20_000, '工具卡完成')
  const groups = await page.evaluate("document.querySelectorAll('[data-testid=\"process-group\"]').length")
  assert(groups > 0, '没有过程组')
  return `会话 ${sessionId.slice('session-'.length, 'session-'.length + 8)}；流式 ${String(plain.liveAt)} 毫秒、落定 ${String(plain.committedAt)} 毫秒；`
    + `审批卡 pwsh；工具卡 done；过程组 ${String(groups)}；正文含 T195-APPROVED-DONE`
}

async function itemApproval(page) {
  assert(context.sessionId !== null, '前置不满足：聊天会话未建立')
  await sendPrompt(page, 'T195:deny 请按流程处理这一轮。')
  const card = await waitApprovalCard(page, '拒绝轮审批卡')
  assert(card.error === '', `拒绝轮审批卡有就地错误：${card.error}`)
  assert(card.tool === 'pwsh', `拒绝轮工具名应为 pwsh：${JSON.stringify(card.tool)}`)
  await pressCard(page, 'approval-deny', '拒绝')
  const denied = await watchAssistant(page, 'T195-DENIED-DONE', 60_000, '拒绝后的最终正文')
  const state = await lastToolState(page, 'pwsh')
  assert(state === 'failed', `拒绝轮工具结果状态应为 failed，实际 ${String(state)}`)
  const durable = await waitDurable(context.sessionId, (log) => {
    const counts = countOf(log.events)
    return (counts['approval/asked'] ?? 0) === 2 && (counts['approval/decided'] ?? 0) === 2
  }, 30_000, '审批回执落盘')
  const counts = countOf(durable.events)
  const outcomes = durable.events.filter(event => event.type === 'approval/decided').map(event => event.data?.outcome)
  assert(outcomes.includes('allowed-once'), `审批回执缺少 allowed-once：${JSON.stringify(outcomes)}`)
  assert(outcomes.includes('rejected'), `审批回执缺少 rejected：${JSON.stringify(outcomes)}`)
  const results = durable.events.filter(event => event.type === 'tool/result')
  const allowed = results.find(event => JSON.stringify(event.data?.message?.content ?? '').includes('T195-PROBE-ALLOWED'))
  assert(allowed !== undefined && allowed.data?.message?.isError !== true, '批准后没有拿到成功命令输出')
  const rejected = results.find(event => event.data?.message?.isError === true
    && JSON.stringify(event.data?.message?.content ?? '').includes('rejected'))
  assert(rejected !== undefined, '拒绝路径没有留下 isError 且带 rejected 的工具结果')
  assert((counts['job/registered'] ?? 0) === 1, `job/registered 应为 1：${String(counts['job/registered'] ?? 0)}`)
  const calls = durable.events.filter(event => event.type === 'tool/call').map(event => event.data?.name ?? event.data?.toolName)
  assert(calls.filter(name => name === 'pwsh').length === 2, `tool/call 里 pwsh 应为 2 次：${JSON.stringify(calls)}`)
  return `UI：允许一次→done、拒绝→failed 与两段正文；日志 approval/asked×2、decided=${outcomes.join('+')}、job/registered=1`
}

async function itemQuestion(page) {
  assert(context.sessionId !== null, '前置不满足：聊天会话未建立')
  await sendPrompt(page, 'T195:ask 请先向我确认再继续。')
  const card = await waitQuestionCard(page, '提问卡')
  assert(card.text.includes('T195：请选择这次探针的继续方式'), `提问卡没有渲染问题：${card.text.slice(0, 100)}`)
  assert(card.options.includes(QUESTION_LABEL), `提问卡缺少选项 ${QUESTION_LABEL}：${JSON.stringify(card.options)}`)
  const picked = await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[data-testid="question-option"]')]
      .find(node => node.dataset.label === ${q(QUESTION_LABEL)});
    if (option === undefined) return false;
    option.click();
    return true;
  })()`)
  assert(picked === true, '提问选项不可点')
  await page.waitFor(
    "document.querySelector('[data-testid=\"question-submit\"]')?.disabled === false ? 'ok' : ''",
    5_000, '提交按钮可用')
  await pressCard(page, 'question-submit', '提交回答')
  const asked = await watchAssistant(page, 'T195-ASK-DONE', 60_000, '提问后的最终正文')
  assert(asked.text.includes(QUESTION_LABEL), `最终正文没有回显所选答案：${asked.text.slice(0, 100)}`)
  const durable = await waitDurable(context.sessionId,
    log => log.events.some(event => event.type === 'tool/result'
      && JSON.stringify(event.data?.message?.content ?? '').includes(QUESTION_LABEL)),
    30_000, '提问回执落盘')
  const askResult = durable.events.find(event => event.type === 'tool/result'
    && JSON.stringify(event.data?.message?.content ?? '').includes(QUESTION_LABEL))

  // 附件：先验图片预览，再验文件上传回执与消息回显。
  assert(await page.evaluate(attachFiles([{ name: 'pixel.png', type: 'image/png' }])), '附件选择器不存在')
  await page.waitFor("document.querySelector('[data-testid=\"composer-image\"]') !== null ? 'ok' : ''", 20_000, '图片预览')
  await page.evaluate("(() => { for (const node of [...document.querySelectorAll('[data-testid=\"attach-remove\"]')]) node.click(); return true })()")
  await page.waitFor("document.querySelector('[data-testid=\"composer-image\"]') === null ? 'ok' : ''", 10_000, '移除图片预览')
  assert(await page.evaluate(attachFiles([{ name: 'notes.md', type: 'text/markdown', text: 'hello from t199' }])), '附件选择器不存在')
  const upload = await page.waitFor(`(() => {
    const node = document.querySelector('[data-testid="composer-attachment"][data-kind="file"]');
    const status = node?.dataset.status ?? '';
    const problem = document.querySelector('[data-testid="composer-problem"]')?.textContent ?? '';
    return status === 'ready' ? 'ready' : status === 'failed' ? 'failed:' + problem : '';
  })()`, 30_000, '文件上传回执')
  assert(upload === 'ready', `文件上传没有拿到回执：${upload}`)
  assert(await click(page, '[data-testid="send"]'), '发送不可点')
  await page.waitFor("document.querySelector('[data-testid=\"message-attachments\"]') !== null ? 'ok' : ''", 30_000, '用户消息附件行')
  const fileEcho = await page.waitFor(
    "[...document.querySelectorAll('[data-testid=\"message-file\"]')].some(node => (node.textContent ?? '').includes('notes.md')) ? 'yes' : ''",
    10_000, '文件附件回显')
  assert(fileEcho === 'yes', '用户消息没有回显 notes.md')
  await watchAssistant(page, '仓库结构', 60_000, '附件回合答复')
  const usage = await page.waitFor(
    "document.querySelector('[data-testid=\"context-usage\"]')?.dataset.known === 'true' ? document.querySelector('[data-testid=\"context-usage\"]').textContent : ''",
    30_000, '上下文用量')
  assert(usage.includes('上下文') || usage.includes('Context'), `上下文用量文案不符：${usage}`)
  assert(askResult !== undefined, '没有找到提问回执')
  return `提问：选「${QUESTION_LABEL}」后回合继续并回显，日志有 ask 回执；`
    + `附件：图片预览可选、notes.md 上传回执 ready 并在消息里回显；用量「${usage.trim()}」`
}

async function itemRestart(page) {
  assert(context.sessionId !== null, '前置不满足：聊天会话未建立')
  assert(await click(page, '[data-testid="session-rename"]'), '改名入口不可点')
  await page.waitFor("document.querySelector('[data-testid=\"session-rename-input\"]') !== null ? 'ok' : ''", 5_000, '改名输入框')
  assert(await fill(page, '[data-testid="session-rename-input"]', RENAMED), '改名输入框不存在')
  assert(await click(page, '[data-testid="session-rename-save"]'), '保存改名不可点')
  await page.waitFor(`document.querySelector('[data-testid="active-session"]')?.textContent === ${q(RENAMED)} ? 'ok' : ''`,
    10_000, '改名生效')

  // 停止：在审批待回执的回合上点停止，回合必须结束且 mock 不再产出最终正文。
  const finalsBefore = (await mockState()).probe.approve.finals
  const approvedBefore = await page.evaluate(
    "[...document.querySelectorAll('[data-testid=\"message-assistant\"]:not([data-live])')].filter(node => (node.textContent ?? '').includes('T195-APPROVED-DONE')).length")
  await sendPrompt(page, 'T195:approve 停止场景：先不要回执。')
  await waitApprovalCard(page, '停止场景审批卡')
  const stopVisible = await page.waitFor("document.querySelector('[data-testid=\"stop\"]') !== null ? 'yes' : ''", 10_000, '停止入口')
  assert(stopVisible === 'yes', '运行期间没有停止入口')
  assert(await click(page, '[data-testid="stop"]'), '停止按钮不可点')
  await page.waitFor("document.querySelector('[data-testid=\"approval-card\"]') === null ? 'gone' : ''", 20_000, '停止后审批卡收起')
  await page.waitFor("document.querySelector('[data-testid=\"session-item\"][data-running=\"true\"]') === null ? 'idle' : ''",
    30_000, '停止后回合结束')
  await sleep(800)
  const finalsAfter = (await mockState()).probe.approve.finals
  assert(finalsAfter === finalsBefore, `停止后 mock 仍产出最终正文：${String(finalsBefore)}→${String(finalsAfter)}`)
  const approvedAfter = await page.evaluate(
    "[...document.querySelectorAll('[data-testid=\"message-assistant\"]:not([data-live])')].filter(node => (node.textContent ?? '').includes('T195-APPROVED-DONE')).length")
  assert(approvedAfter === approvedBefore, '停止后仍出现新的已提交批准正文')

  // 关窗确认：留一个待审批回合，先取消留在窗口内，再确认退出。
  await sendPrompt(page, 'T195:approve 关窗确认场景：先不要回执。')
  await waitApprovalCard(page, '关窗确认前的审批卡')
  page.fire("window.lcoder.window('close')")
  await page.waitFor("document.querySelector('[data-testid=\"quit-confirm-dialog\"]') !== null ? 'ok' : ''", 15_000, '运行中关窗确认')
  const dialog = await page.evaluate("document.querySelector('[data-testid=\"quit-confirm-dialog\"]')?.innerText ?? ''")
  assert(dialog.includes('正在运行'), `关窗确认没有说明回合在跑：${dialog.replace(/\n/gu, ' | ').slice(0, 80)}`)
  assert(await click(page, '[data-testid="quit-confirm-cancel"]'), '取消关窗不可点')
  await page.waitFor("document.querySelector('[data-testid=\"quit-confirm-dialog\"]') === null ? 'ok' : ''", 10_000, '取消关窗')
  assert(processAlive(context.child.pid), '取消关窗后实例仍在运行')
  page.fire("window.lcoder.window('close')")
  await page.waitFor("document.querySelector('[data-testid=\"quit-confirm-dialog\"]') !== null ? 'ok' : ''", 15_000, '再次关窗确认')
  page.fire("document.querySelector('[data-testid=\"quit-confirm-exit\"]').click()")
  const exited = await waitExit(context.child, 25_000)
  page.socket.close()
  assert(exited, '确认关窗后实例退出')

  const second = await launchResilient('restart')
  context.child = second.child
  context.page = second.page
  const restarted = second.page
  await restarted.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready' ? 'ok' : ''",
    90_000, '重启宿主 ready')
  await restarted.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready' ? 'ok' : ''",
    60_000, '重启门禁放行')
  const selector = `[data-testid="session-item"][data-session-id=${q(context.sessionId)}]`
  await restarted.waitFor(`document.querySelector(${q(selector)}) !== null ? 'ok' : ''`, 30_000, '重启后的会话列表')
  assert(await click(restarted, selector), '重启后的会话项不可点')
  await restarted.waitFor(`document.querySelector('[data-testid="active-session"]')?.textContent === ${q(RENAMED)} ? 'ok' : ''`,
    20_000, '重启后的改名标题')
  await watchAssistant(restarted, 'T195-APPROVED-DONE', 30_000, '重启后的历史正文')
  const fileBack = await restarted.evaluate(
    "[...document.querySelectorAll('[data-testid=\"message-file\"]')].some(node => (node.textContent ?? '').includes('notes.md'))")
  await closeApp(restarted)
  const exited2 = await waitExit(second.child, 25_000)
  assert(exited2, '重启实例关窗后退出')
  return `改名「${RENAMED}」；停止后 mock finals 停留在 ${String(finalsAfter)}；关窗确认先取消后退出；`
    + `重启后标题与历史正文（含 notes.md=${String(fileBack)}）均在`
}

async function main() {
  for (const path of [
    join(APP_ROOT, 'lib', 'types', 'main.js'),
    join(APP_ROOT, 'lib', 'preload.cjs'),
    join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html'),
  ]) {
    assert(existsSync(path), `缺少构建产物 ${path}；先跑 pnpm --filter @lcoder/desktop --filter @lcoder/client run build`)
  }
  const busy = await busyPorts()
  assert(busy.length === 0, `调试端口应空闲（占用：${busy.join(', ') || '无'}）`)
  electron = resolveElectron()
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
  prepareScratch()
  await ensureMock()
  await seedCredential()
  const first = await launchResilient('first')
  context.child = first.child
  context.page = first.page
  const page = first.page
  log(`全新 home：${HOME}；账号 ${PHONE}`)

  await step(1, () => itemWindow(page))
  await step(2, () => itemGate(page))
  await step(3, () => itemNav(page))
  await step(4, () => itemBoard(page))
  await step(5, () => itemTaskDetail(page))
  await step(6, () => itemReader(page))
  await step(7, () => itemRequirement(page))
  await step(8, () => itemIntake(page))
  await step(9, () => itemChat(page))
  await step(10, () => itemApproval(page))
  await step(11, () => itemQuestion(page))
  await step(12, () => itemRestart(page))
}

/** mock 端口是否已释放。 */
async function mockPortFree(milliseconds) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (!(await checkMock())) return true
    await sleep(300)
  }
  return false
}

/** 收尾：杀掉残留实例与 mock，补齐未跑项，检查端口，打印 12 项汇总。 */
async function finish() {
  if (context.child !== null && context.child.exitCode === null) {
    killTree(context.child)
    await sleep(1_500)
  }
  if (mockChild !== null) {
    mockChild.kill()
    mockChild = null
  }
  const mockFree = await mockPortFree(6_000)
  let busy = await busyPorts()
  for (let attempt = 0; attempt < 10 && busy.length > 0; attempt += 1) {
    await sleep(500)
    busy = await busyPorts()
  }
  for (let id = 1; id <= ITEM_NAMES.length; id += 1) {
    if (!results.has(id)) record(id, false, '未运行：前置失败')
  }
  const passed = [...results.values()].filter(result => result.ok).length
  console.log(`[smoke] 汇总：${String(passed)}/${String(ITEM_NAMES.length)}`)
  console.log(`[smoke] 断言 ${String(checks)} 条；日志与 home 在 ${LOGS}`)
  if (busy.length > 0) console.log(`[smoke] FAIL 调试端口残留：${busy.join(', ')}`)
  if (!mockFree) console.log(`[smoke] FAIL mock 端口 ${String(MOCK_PORT)} 仍被占用`)
  process.exitCode = passed === ITEM_NAMES.length && busy.length === 0 && mockFree ? 0 : 1
  console.log(`[smoke] 退出码 ${String(process.exitCode)}`)
}

main().catch((error) => {
  console.error('[smoke] 致命失败:', error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}).finally(finish)
