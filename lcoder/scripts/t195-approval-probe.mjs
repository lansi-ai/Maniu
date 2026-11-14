/**
 * T-195 探针：真实回合里的审批通过、审批拒绝与 ask_user 提问回环。
 *
 * 只跑本工作树的实例（渲染 9822、主进程 9829、宿主 9830）。mock 云端独占
 * 5092：5091 上可能还留着旧代码的 mock，探针不复用，免得「新协议没生效」
 * 变成一轮说不清的假红。
 *
 * 三轮都在同一会话里推进，mock 靠用户口令区分轮次：
 *   1. T195:approve → pwsh 申请 danger-full-access → 点「允许一次」→ 命令执行；
 *   2. T195:deny    → 同一条调用 → 点「拒绝」→ 工具不执行；
 *   3. T195:ask     → ask_user_question → 选一项并提交 → 回合带着选择继续。
 *
 * 收尾核对会话日志（durable `session.v4.jsonl.zstd`）：approval/asked 两次、
 * approval/decided 的 allowed-once 与 rejected、提问的 tool/result 回执，以及
 * 三轮最终正文。
 *
 * 用法：node lcoder/scripts/t195-approval-probe.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const APP_ROOT = join(REPO_ROOT, 'packages', 'lcoder', 'desktop')
const HOME = process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const MOCK_PORT = Number(process.env.T195_MOCK_PORT ?? 5092)
const MOCK_ORIGIN = `http://127.0.0.1:${String(MOCK_PORT)}`
const MOCK_BASE = `${MOCK_ORIGIN}/v1`
const RENDERER_PORT = 9822
const MAIN_PORT = 9829
const HOST_PORT = 9830
const PHONE = '+8613900000055'
const PASSWORD = 'lcoder-t195-pass'
const QUESTION_LABEL = '继续（推荐）'
const JUSTIFICATION = 'T195 approval probe needs one escalated command'
mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null
let checks = 0
let steps = 0

function log(message) {
  console.log(`[t195] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  checks += 1
}

/** 记一条可读的阶段通过项（断言本身在失败时才说话）。 */
function step(label) {
  steps += 1
  log(`PASS ${steps}: ${label}`)
}

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

async function checkMock() {
  try {
    const response = await fetch(`${MOCK_BASE}/models`, { signal: AbortSignal.timeout(1500) })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

/** 只认本探针拉起的 mock：端口被占时直接失败，不去猜那是不是旧代码。 */
async function ensureMock() {
  if (await checkMock()) {
    throw new Error(`mock 端口 ${String(MOCK_PORT)} 已被占用；先停掉占用者，探针只跑自己拉起的 mock`)
  }
  log(`启动本机 mock 云端（端口 ${String(MOCK_PORT)}）`)
  const out = openSync(join(LOGS, 't195-probe-mock.log'), 'w')
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
  const response = await fetch(`${MOCK_ORIGIN}/_mock/state`)
  return await response.json()
}

async function seedCredential() {
  let session = await post('/auth/login/password', { phone: PHONE, password: PASSWORD })
  if (session.status !== 200) {
    await post('/auth/sms/send', { phone: PHONE, purpose: 'register' })
    session = await post('/auth/register', { phone: PHONE, code: '123456', password: PASSWORD, displayName: 'T195 Probe' })
  }
  assert(session.status === 200, `云端测试号不可用（HTTP ${String(session.status)}）`)
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
const DEBUG_PORTS = [RENDERER_PORT, MAIN_PORT, HOST_PORT]

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

/** 异常收尾时杀掉整个 Electron 进程树，避免宿主子进程占住会话库与端口。 */
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
  const logPath = join(LOGS, `t195-probe-${label}.log`)
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
    APP_ROOT,
  ], { cwd: APP_ROOT, env: environment, stdio: ['ignore', out, out] })
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
      throw new Error(`页面脚本失败：${answer.result.exceptionDetails.text} ${answer.result.exceptionDetails.exception?.description ?? ''}`)
    }
    return answer.result?.result?.value
  }
  const waitFor = async (expression, milliseconds, label) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const value = await evaluate(expression)
      if (value !== undefined && value !== null && value !== false && value !== '') return value
      await sleep(200)
    }
    throw new Error(`等待超时：${label}`)
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

/** 进程是否仍存在；ESRCH 表示已不存在。 */
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
 * 所以同时看 exit 事件、退出码与 PID 存活。
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

/** 失败现场：卡片、消息、提示与流错误。 */
async function dumpPage(page) {
  try {
    log(`页面现场：${await page.evaluate(`JSON.stringify({
      notice: document.querySelector('[data-testid="notice"]')?.textContent ?? '',
      streamError: document.querySelector('[data-testid="stream-error"]')?.textContent ?? '',
      approval: document.querySelector('[data-testid="approval-card"]')?.innerText ?? null,
      approvalError: document.querySelector('[data-testid="approval-error"]')?.textContent ?? null,
      question: document.querySelector('[data-testid="question-card"]')?.innerText ?? null,
      questionError: document.querySelector('[data-testid="question-error"]')?.textContent ?? null,
      users: [...document.querySelectorAll('[data-testid="message-user"]')].map(node => (node.textContent ?? '').slice(0, 40)),
      assistants: [...document.querySelectorAll('[data-testid="message-assistant"]')].map(node => (node.textContent ?? '').slice(0, 60)),
      tools: [...document.querySelectorAll('[data-testid="process-tool"]')].map(node => ({
        name: node.dataset.tool,
        state: node.querySelector('[data-testid="process-status"]')?.dataset.state ?? '',
      })),
    })`)}`)
  } catch (error) {
    log(`页面现场读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 用非受控 textarea 的直写方式填提示词，再点发送。 */
async function sendPrompt(page, text) {
  await page.waitFor("document.querySelector('[data-testid=\"composer\"]') !== null", 10_000, '输入框')
  const filled = await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="composer"]');
    if (input === null) return false;
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  assert(filled === true, '输入框不存在')
  await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
}

/**
 * 等审批卡出现并读出工具名与理由。
 * @param page - CDP 页面。
 * @param label - 失败时的阶段名。
 * @returns 卡片上的工具名、理由与就地错误。
 */
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

/**
 * 等提问卡出现并读出问题、选项与提交态。
 * @param page - CDP 页面。
 * @param label - 失败时的阶段名。
 * @returns 卡片文本、选项标签与提交按钮状态。
 */
async function waitQuestionCard(page, label) {
  const payload = await page.waitFor(`(() => {
    const card = document.querySelector('[data-testid="question-card"]');
    if (card === null) return '';
    const submit = card.querySelector('[data-testid="question-submit"]');
    return JSON.stringify({
      text: card.innerText,
      options: [...card.querySelectorAll('[data-testid="question-option"]')].map(node => node.dataset.label ?? ''),
      disabled: submit === null ? null : submit.disabled,
    });
  })()`, 60_000, label)
  return JSON.parse(payload)
}

/** 点一个卡片按钮，并等两类卡片都收起（回执被宿主接受后客户端才移除卡片）。 */
async function pressCard(page, testId, label) {
  const clicked = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="${testId}"]');
    if (button === null || button.disabled) return false;
    button.click();
    return true;
  })()`)
  assert(clicked === true, `${label}不可点`)
  await page.waitFor(
    "document.querySelector('[data-testid=\"approval-card\"], [data-testid=\"question-card\"]') === null ? 'gone' : ''",
    20_000,
    `${label}后卡片收起`,
  )
}

/** 等一条已提交的 assistant 正文包含标记（流式草稿不算）。 */
async function watchFinal(page, marker, label) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const state = JSON.parse(await page.evaluate(`JSON.stringify({
      committed: [...document.querySelectorAll('[data-testid="message-assistant"]:not([data-live])')]
        .map(node => node.textContent ?? ''),
      error: document.querySelector('[data-testid="stream-error"]')?.textContent ?? '',
      notice: document.querySelector('[data-testid="notice"]')?.textContent ?? '',
    })`))
    if (state.error !== '') throw new Error(`${label}流错误：${state.error}`)
    const committed = state.committed.find(text => text.includes(marker))
    if (committed !== undefined) return committed
    await sleep(80)
  }
  throw new Error(`等待超时：${label}（没有含 ${JSON.stringify(marker)} 的已提交答复）`)
}

/** 读当前页面上最后一条 pwsh 工具行的结果状态。 */
async function lastToolState(page, tool) {
  const states = JSON.parse(await page.evaluate(`JSON.stringify(
    [...document.querySelectorAll('[data-testid="process-tool"][data-tool="${tool}"]')]
      .map(node => node.querySelector('[data-testid="process-status"]')?.dataset.state ?? ''),
  )`))
  return states.at(-1)
}

/**
 * 一轮审批：发口令 → 等卡 → 点通过/拒绝 → 等最终正文与工具结果状态。
 * @param page - CDP 页面。
 * @param marker - 用户消息里的 T-195 口令。
 * @param decision - `allow` 或 `deny`。
 * @returns 已提交的最终正文。
 */
async function approvalRound(page, marker, decision) {
  await sendPrompt(page, `${marker} 请按流程处理这一轮。`)
  const card = await waitApprovalCard(page, `${marker} 审批卡`)
  assert(card.error === '', `${marker} 审批卡上有就地错误：${card.error}`)
  assert(card.tool === 'pwsh', `${marker} 审批卡工具名应为 pwsh，实际 ${JSON.stringify(card.tool)}`)
  assert(card.reason.includes('danger-full-access') && card.reason.includes(JUSTIFICATION),
    `${marker} 审批卡理由不符合扩权请求：${JSON.stringify(card.reason)}`)
  log(`${marker} 审批卡：${card.tool} / ${card.reason.slice(0, 60)}`)
  await pressCard(page, decision === 'allow' ? 'approval-allow' : 'approval-deny', `${marker} ${decision}`)
  const expected = decision === 'allow' ? 'T195-APPROVED-DONE' : 'T195-DENIED-DONE'
  const text = await watchFinal(page, expected, `${marker} 最终正文`)
  const state = await lastToolState(page, 'pwsh')
  assert(state === (decision === 'allow' ? 'done' : 'failed'),
    `${marker} 工具结果状态应为 ${decision === 'allow' ? 'done' : 'failed'}，实际 ${String(state)}`)
  log(`${marker} 最终正文：${text.slice(0, 60)}（pwsh=${String(state)}）`)
  return text
}

/** 一轮提问：发口令 → 等卡 → 选一项 → 提交 → 等最终正文回显所选项。 */
async function questionRound(page) {
  await sendPrompt(page, 'T195:ask 请先向我确认再继续。')
  const card = await waitQuestionCard(page, 'T195:ask 提问卡')
  assert(card.text.includes('T195：请选择这次探针的继续方式'), `提问卡没有渲染问题：${card.text.slice(0, 100)}`)
  assert(card.options.includes(QUESTION_LABEL), `提问卡缺少选项 ${QUESTION_LABEL}：${JSON.stringify(card.options)}`)
  const picked = await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[data-testid="question-option"]')]
      .find(node => node.dataset.label === ${JSON.stringify(QUESTION_LABEL)});
    if (option === undefined) return false;
    option.click();
    return true;
  })()`)
  assert(picked === true, '提问选项不可点')
  await page.waitFor(
    "document.querySelector('[data-testid=\"question-submit\"]')?.disabled === false ? 'ready' : ''",
    5_000,
    '提交按钮可用',
  )
  await pressCard(page, 'question-submit', '提交回答')
  const text = await watchFinal(page, 'T195-ASK-DONE', '提问后的最终正文')
  assert(text.includes(QUESTION_LABEL), `最终正文没有回显所选答案：${text.slice(0, 100)}`)
  log(`T195:ask 最终正文：${text.slice(0, 60)}`)
  return text
}

/**
 * 核对 durable 会话日志里的回执证据。
 * @param sessionId - 目标会话。
 */
function assertDurable(sessionId) {
  const durable = readSessionEvents(sessionId)
  assert(durable !== undefined, `找不到会话日志 ${sessionId}`)
  const counts = {}
  for (const event of durable.events) counts[event.type] = (counts[event.type] ?? 0) + 1
  log(`会话日志 ${durable.path}（${String(durable.size)} 字节）：${JSON.stringify(counts)}`)

  assert((counts['approval/asked'] ?? 0) === 2, `approval/asked 应为 2 条，实际 ${String(counts['approval/asked'] ?? 0)}`)
  assert((counts['approval/decided'] ?? 0) === 2, `approval/decided 应为 2 条，实际 ${String(counts['approval/decided'] ?? 0)}`)
  const asked = durable.events.filter(event => event.type === 'approval/asked')
  assert(asked.every(event => event.data?.toolName === 'pwsh'),
    `审批审计的工具名不符：${JSON.stringify(asked.map(event => event.data?.toolName))}`)
  assert(asked.every(event => String(event.data?.reason ?? '').includes('danger-full-access')),
    `审批审计的理由不含扩权目标：${JSON.stringify(asked.map(event => event.data?.reason))}`)
  const outcomes = durable.events.filter(event => event.type === 'approval/decided').map(event => event.data?.outcome)
  assert(outcomes.includes('allowed-once'), `审批回执里没有 allowed-once：${JSON.stringify(outcomes)}`)
  assert(outcomes.includes('rejected'), `审批回执里没有 rejected：${JSON.stringify(outcomes)}`)

  const results = durable.events.filter(event => event.type === 'tool/result')
  const contents = results.map(event => JSON.stringify(event.data?.message?.content ?? ''))
  const allowedResult = results.find(event => JSON.stringify(event.data?.message?.content ?? '').includes('T195-PROBE-ALLOWED'))
  assert(allowedResult !== undefined, '批准后没有拿到命令输出 T195-PROBE-ALLOWED')
  assert(allowedResult.data?.message?.isError !== true, '批准后的工具结果被标成了失败')
  const rejectedResult = results.find(event => event.data?.message?.isError === true
    && JSON.stringify(event.data?.message?.content ?? '').includes('rejected'))
  assert(rejectedResult !== undefined, '拒绝路径没有留下 isError 且带 rejected 的工具结果')
  const askResult = contents.find(content => content.includes('t195_choice'))
  assert(askResult !== undefined, '会话日志里没有 ask_user_question 的工具结果')
  assert(askResult.includes(QUESTION_LABEL), '提问回执里没有所选项')
  // 拒绝的那一轮不能在宿主侧起进程：只有批准的一轮有 job 记录。
  assert((counts['job/registered'] ?? 0) === 1, `job/registered 应为 1（只有批准那轮执行）：${String(counts['job/registered'] ?? 0)}`)

  const calls = durable.events.filter(event => event.type === 'tool/call').map(event => event.data?.name ?? event.data?.toolName)
  assert(calls.filter(name => name === 'pwsh').length === 2, `tool/call 里 pwsh 应为 2 次：${JSON.stringify(calls)}`)
  assert(calls.includes('ask_user_question'), `tool/call 里没有 ask_user_question：${JSON.stringify(calls)}`)

  const assistantText = durable.events
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => Array.isArray(event.data?.message?.content) ? event.data.message.content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  for (const marker of ['T195-APPROVED-DONE', 'T195-DENIED-DONE', 'T195-ASK-DONE']) {
    assert(assistantText.includes(marker), `会话日志的 assistant 正文缺少 ${marker}`)
  }
  log('回执证据齐全：approval/asked×2、allowed-once + rejected、提问 tool/result 与三轮最终正文')
}

async function run() {
  const launched = await launchResilient('run')
  let page = launched.page
  let sessionId
  try {
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready')
    await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 30_000, '门禁放行')
    await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null", 10_000, '会话列表')
    const before = JSON.parse(await page.evaluate(
      "JSON.stringify([...document.querySelectorAll('[data-testid=\"session-item\"]')].map(node => node.dataset.sessionId))",
    ))
    await page.evaluate("document.querySelector('[data-testid=\"new-session\"]').click()")
    sessionId = await page.waitFor(`(() => {
      const before = new Set(${JSON.stringify(before)});
      const active = document.querySelector('[data-testid="session-item"].active')?.dataset.sessionId;
      return typeof active === 'string' && !before.has(active) ? active : '';
    })()`, 30_000, '新建会话')
    log(`新建会话 ${sessionId}（点击前已有 ${String(before.length)} 条）`)
    step(`新会话已就绪（${sessionId.slice(0, 12)}）`)

    const approved = await approvalRound(page, 'T195:approve', 'allow')
    step('审批通过：卡片出现、允许一次后 pwsh 执行、最终正文已提交')
    const denied = await approvalRound(page, 'T195:deny', 'deny')
    step('审批拒绝：卡片出现、拒绝后 pwsh 未执行、最终正文已提交')
    const asked = await questionRound(page)
    step('提问回答：卡片出现、选项提交后回合继续并回显所选答案')

    const state = await mockState()
    const probe = state.probe
    for (const scenario of ['approve', 'deny', 'ask']) {
      assert(probe[scenario].toolCalls === 1, `mock 的 ${scenario} 工具调用次数应为 1：${probe[scenario].toolCalls}`)
      assert(probe[scenario].finals === 1, `mock 的 ${scenario} 最终正文次数应为 1：${probe[scenario].finals}`)
    }
    step('mock 侧三轮各一次工具调用与一次最终正文，轮次未串台')
    log(`mock 轮次轨迹：${JSON.stringify(probe.log.map(entry => `${entry.scenario}/${entry.stage}`))}`)

    // 运行中关窗：新会话留一个待审批回合，关窗必须先确认；取消留在窗口内，确认后才退出。
    const known = await page.evaluate(
      "[...document.querySelectorAll('[data-testid=\"session-item\"]')].map(node => node.dataset.sessionId)",
    )
    await page.evaluate("document.querySelector('[data-testid=\"new-session\"]').click()")
    await page.waitFor(`(() => {
      const active = document.querySelector('[data-testid="session-item"].active')?.dataset.sessionId;
      return typeof active === 'string' && !${JSON.stringify(known)}.includes(active) ? active : '';
    })()`, 30_000, '关窗确认用会话')
    await sendPrompt(page, 'T195:approve 关窗确认场景：先不要回执。')
    const pendingCard = await waitApprovalCard(page, '关窗确认前的审批卡')
    assert(pendingCard.error === '', `关窗确认场景的审批卡有就地错误：${pendingCard.error}`)
    page.fire("window.lcoder.window('close')")
    await page.waitFor(
      "document.querySelector('[data-testid=\"quit-confirm-dialog\"]') !== null",
      15_000, '运行中关窗确认')
    const dialogText = await page.evaluate(
      "document.querySelector('[data-testid=\"quit-confirm-dialog\"]')?.innerText ?? ''")
    assert(dialogText.includes('正在运行'), `关窗确认说明有回合在跑（${dialogText.replace(/\n/gu, ' | ').slice(0, 80)}）`)
    await page.evaluate("document.querySelector('[data-testid=\"quit-confirm-cancel\"]').click()")
    await page.waitFor(
      "document.querySelector('[data-testid=\"quit-confirm-dialog\"]') === null",
      10_000, '取消关窗')
    assert(processAlive(launched.child.pid), '取消关窗后实例仍在运行')
    page.fire("window.lcoder.window('close')")
    await page.waitFor(
      "document.querySelector('[data-testid=\"quit-confirm-dialog\"]') !== null",
      15_000, '再次关窗确认')
    page.fire("document.querySelector('[data-testid=\"quit-confirm-exit\"]').click()")
    const exited = await waitExit(launched.child, 20_000)
    page.socket.close()
    page = undefined
    assert(exited, '确认关窗后实例退出')
    step('运行中关窗：先确认、取消留在窗口内、确认后退出')
    assert(approved.includes('T195-APPROVED-DONE') && denied.includes('T195-DENIED-DONE'), '审批两轮的最终正文标记不完整')
    assert(asked.includes('T195-ASK-DONE'), '提问轮的最终正文标记不完整')
    assertDurable(sessionId)
    step('会话日志回执证据齐全（approval/asked×2、allowed-once+rejected、提问 tool/result）')
    log('PASS：审批通过、审批拒绝、提问回答三轮全部通过，回执在会话日志里可查')
  } catch (error) {
    if (page !== undefined) {
      await dumpPage(page)
      await closeApp(page)
    }
    killTree(launched.child)
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
  assert(busy.length === 0, `调试端口应空闲（占用：${busy.join(', ') || '无'}）；先关掉本工作树正在运行的实例`)
  electron = resolveElectron()
  step('构建产物齐全、调试端口空闲、Electron 可执行文件可用')
  await ensureMock()
  step(`mock 云端就绪（端口 ${String(MOCK_PORT)}）`)
  await seedCredential()
  step('云端测试号令牌已就绪')
  await run()
  log(`本轮 ${String(steps)} 个阶段、${String(checks)} 项断言全部通过`)
}

main().catch((error) => {
  console.error('[t195] FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
