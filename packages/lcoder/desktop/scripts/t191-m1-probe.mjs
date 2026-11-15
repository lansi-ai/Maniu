/**
 * T-191 M1 端到端探针。
 *
 * 只跑本工作树的实例（渲染 9823、主进程 9831、宿主 9832），用本机 mock 云端
 * 走一轮真实回合，断言：模型 chip、上下文用量、改名、图片附件随消息发出并在
 * 聊天里回显；重启后同一会话仍能读到正文、改名后的标题与图片预览。
 *
 * 用法：node packages/lcoder/desktop/scripts/t191-m1-probe.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(APP_ROOT, '..', '..', '..')
const HOME = process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const MOCK_PORT = 5091
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}/v1`
const RENDERER_PORT = 9823
const MAIN_PORT = 9831
const HOST_PORT = 9832
const PHONE = '+8613900000001'
const PASSWORD = 'lcoder-s1-pass'
/** 1×1 PNG；探针只验证回显与回读，不关心画面内容。 */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const RENAMED = 'M1 probe session'
mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null

function log(message) {
  console.log(`[t191] ${message}`)
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
  const out = openSync(join(LOGS, 't191-probe-mock.log'), 'w')
  mockChild = spawn(process.execPath, [join(REPO_ROOT, 'lcoder', 'scripts', 'mock-cloud.mjs')], {
    cwd: REPO_ROOT, stdio: ['ignore', out, out],
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await checkMock()) return
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
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
    session = await post('/auth/register', { phone: PHONE, code: '123456', password: PASSWORD, displayName: 'M1 Probe' })
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
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
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

/** 打包态由安装产物自己的可执行文件启动，不再传应用目录。 */
const packagedProbe = process.env.LCODER_PROBE_PACKAGED === '1'

async function launch(label) {
  const logPath = join(LOGS, `t191-probe-${label}.log`)
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
      throw new Error(`页面脚本失败：${answer.result.exceptionDetails.text} ${answer.result.exceptionDetails.exception?.description ?? ''}`)
    }
    return answer.result?.result?.value
  }
  const waitFor = async (expression, milliseconds, label) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const value = await evaluate(expression)
      if (value !== undefined && value !== null && value !== false && value !== '') return value
      await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
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
    } catch {
      // 端口未就绪时继续轮询。
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 300))
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
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3_000))
    }
  }
  throw lastError
}

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
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
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

async function waitExit(child, milliseconds) {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    if (child.exitCode !== null || child.signalCode !== null || !processAlive(child.pid)) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  return false
}

/** 失败现场：通知、输入区问题、附件状态与消息行数。 */
async function dumpPage(page) {
  try {
    log(`页面现场：${await page.evaluate(`JSON.stringify({
      notice: document.querySelector('[data-testid="notice"]')?.textContent ?? '',
      problem: document.querySelector('[data-testid="composer-problem"]')?.textContent ?? '',
      sendDisabled: document.querySelector('[data-testid="send"]')?.disabled ?? null,
      attachments: [...document.querySelectorAll('[data-testid="composer-attachment"]')]
        .map(node => ({ kind: node.dataset.kind, status: node.dataset.status })),
      users: [...document.querySelectorAll('[data-testid="message-user"]')].map(node => node.textContent ?? ''),
      assistants: [...document.querySelectorAll('[data-testid="message-assistant"]')].map(node => (node.textContent ?? '').slice(0, 30)),
      streamError: document.querySelector('[data-testid="stream-error"]')?.textContent ?? '',
    })`)}`)
  } catch (error) {
    log(`页面现场读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 等到一条已提交的 assistant 记录（排除流式草稿）。 */
async function watchAssistant(page, milliseconds, marker, label) {
  const deadline = Date.now() + milliseconds
  let liveSeen = false
  while (Date.now() < deadline) {
    const state = JSON.parse(await page.evaluate(`JSON.stringify({
      live: document.querySelector('[data-testid="message-assistant"][data-live="true"]')?.textContent ?? '',
      committed: [...document.querySelectorAll('[data-testid="message-assistant"]:not([data-live])')]
        .map(node => node.textContent ?? ''),
      error: document.querySelector('[data-testid="stream-error"]')?.textContent ?? '',
    })`))
    if (state.live !== '') liveSeen = true
    if (state.committed.some(text => text.includes(marker))) return { liveSeen }
    if (state.error !== '') throw new Error(`${label}流错误：${state.error}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 80))
  }
  throw new Error(`等待超时：${label}（${liveSeen ? '有流式文本但' : ''}没有含 ${JSON.stringify(marker)} 的已提交答复）`)
}

/** 用原生 setter 改 React 受控输入，再派发 input 事件。 */
function setControlledValue(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (input === null) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`
}

/**
 * 在页面里构造文件并塞进文件选择器。
 * @param files - `{ name, type, text? }`；给了 `text` 就按文本写，否则写 1×1 PNG。
 * @returns 可直接 evaluate 的表达式。
 */
function attachFiles(files) {
  const attachment = {
    selector: '[data-testid="attach-input"]',
    png: PIXEL_PNG,
    files,
  }
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

/** 移除输入区里的全部附件。 */
const CLEAR_ATTACHMENTS = "(() => { for (const node of [...document.querySelectorAll('[data-testid=\"attach-remove\"]')]) node.click(); return true })()"

async function firstRun() {
  const launched = await launchResilient('first')
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
    log(`新建会话 ${sessionId}`)

    // 模型 chip：目录里应有 mock 的 deepseek-flash，且不是禁用态。
    const chip = JSON.parse(await page.waitFor(`(() => {
      const select = document.querySelector('[data-testid="model-chip-select"]');
      if (select === null) return '';
      return JSON.stringify({
        disabled: select.disabled,
        value: select.value,
        options: [...select.options].map(option => option.textContent ?? ''),
      });
    })()`, 20_000, '模型 chip'))
    assert(chip.options.length > 0, `模型 chip 没有选项：${JSON.stringify(chip)}`)
    assert(chip.disabled === false, '模型 chip 在没有门禁时被禁用')
    assert(chip.value.includes('deepseek-flash'), `模型 chip 没有当前选择：${JSON.stringify(chip)}`)
    log(`模型 chip 可用：${chip.options.length} 个选项`)

    await page.evaluate("(() => { const input = document.querySelector('[data-testid=\"composer\"]'); input.value = '你好，请用一句话说明你读到了什么。'; input.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
    // 回合运行期间给一个停止入口；mock 的回合很短，用 50ms 轮询抓运行位。
    const stopDeadline = Date.now() + 5_000
    let stopSeen = false
    while (Date.now() < stopDeadline && !stopSeen) {
      stopSeen = await page.evaluate("document.querySelector('[data-testid=\"stop\"]') !== null")
      if (!stopSeen) await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    }
    assert(stopSeen, '回合运行期间没有出现停止入口')
    await watchAssistant(page, 60_000, '仓库结构', 'assistant 文本')
    await page.waitFor("document.querySelector('[data-testid=\"stop\"]') === null ? 'gone' : ''", 10_000, '停止入口收起')
    log('第一条答复已提交，运行期停止入口出现并在结束后收起')

    // 上下文用量来自 contextPressure 投影；mock 会报告 usage。
    const usage = await page.waitFor(
      "document.querySelector('[data-testid=\"context-usage\"]')?.dataset.known === 'true' ? document.querySelector('[data-testid=\"context-usage\"]').textContent : ''",
      30_000,
      '上下文用量',
    )
    assert(usage.includes('上下文') || usage.includes('Context'), `上下文用量文案不符：${usage}`)
    log(`上下文用量：${usage}`)

    // 改名：受控输入，用原生 setter 改值。
    await page.evaluate("document.querySelector('[data-testid=\"session-rename\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"session-rename-input\"]') !== null", 5_000, '改名输入框')
    assert(await page.evaluate(setControlledValue('[data-testid="session-rename-input"]', RENAMED)), '改名输入框不存在')
    await page.evaluate("document.querySelector('[data-testid=\"session-rename-save\"]').click()")
    const renamed = await page.waitFor(
      `document.querySelector('[data-testid="active-session"]')?.textContent === ${JSON.stringify(RENAMED)} ? ${JSON.stringify(RENAMED)} : ''`,
      10_000,
      '改名生效',
    )
    log(`改名生效：${renamed}`)

    // 图片：先验证输入区缩略图；S1 profile 的模型不支持图片输入，发送时应当次就地报错。
    assert(await page.evaluate(attachFiles([{ name: 'pixel.png', type: 'image/png' }])), '附件选择器不存在')
    await page.waitFor("document.querySelector('[data-testid=\"composer-image\"]') !== null", 15_000, '输入区图片缩略图')
    await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
    const refused = await page.waitFor(
      "document.querySelector('[data-testid=\"notice\"]')?.textContent ?? ''",
      15_000,
      '图片被拒的就地提示',
    )
    assert(refused.includes('image input'), `图片被拒时没有显示宿主原话：${refused}`)
    log(`图片选择与拒绝提示成立：${refused}`)
    await page.evaluate(CLEAR_ATTACHMENTS)

    // S1 profile 的模型只有文本模态，图片无法落成 durable 引用；已提交图片的
    // 预览通道（session/attachment）由单测覆盖调用形状，这里只验到「可选中、可拒绝」。

    // 文件：走宿主上传面拿 receiptId，随消息发出后在聊天里回显。
    assert(await page.evaluate(attachFiles([{ name: 'notes.md', type: 'text/markdown', text: 'hello from m1' }])), '附件选择器不存在')
    const upload = await page.waitFor(`(() => {
      const node = document.querySelector('[data-testid="composer-attachment"][data-kind="file"]');
      const status = node?.dataset.status ?? '';
      const problem = document.querySelector('[data-testid="composer-problem"]')?.textContent ?? '';
      return status === 'ready' ? 'ready' : status === 'failed' ? 'failed:' + problem : '';
    })()`, 30_000, '文件上传回执')
    assert(upload === 'ready', `文件上传没有拿到回执：${upload}`)
    log('文件上传回执就绪')
    await page.evaluate("document.querySelector('[data-testid=\"send\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"message-attachments\"]') !== null", 30_000, '用户消息附件行')
    await page.waitFor("document.querySelector('[data-testid=\"message-file\"]')?.textContent?.includes('notes.md') === true", 10_000, '用户消息文件附件')
    await watchAssistant(page, 30_000, '仓库结构', '附件回合的答复')
    log('文件附件随消息发出并在聊天里回显')

    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000)
    page = undefined
    assert(exited, '首次实例关窗后退出')
    log('首次实例已退出')
    return sessionId
  } catch (error) {
    if (page !== undefined) { await dumpPage(page); await closeApp(page) }
    killTree(launched.child)
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
    await page.waitFor(`document.querySelector('${selector}') !== null`, 20_000, '重启后的会话列表')
    await page.evaluate(`document.querySelector('${selector}').click()`)
    await watchAssistant(page, 30_000, '仓库结构', '重启后的历史')
    await page.waitFor(
      `document.querySelector('[data-testid="active-session"]')?.textContent === ${JSON.stringify(RENAMED)} ? 'renamed' : ''`,
      20_000,
      '重启后的标题',
    )
    await page.waitFor(
      "[...document.querySelectorAll('[data-testid=\"message-file\"]')].some(node => (node.textContent ?? '').includes('notes.md')) ? 'file' : ''",
      30_000,
      '重启后的文件附件',
    )
    log('重启后正文、改名标题与文件附件都在')
    await closeApp(page)
    const exited = await waitExit(launched.child, 20_000)
    page = undefined
    assert(exited, '重启实例关窗后退出')
    log('重启实例已退出')
  } catch (error) {
    if (page !== undefined) { await closeApp(page) }
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
  await ensureMock()
  await seedCredential()
  const sessionId = await firstRun()
  await restartRun(sessionId)
  log('PASS：模型 chip、上下文用量、停止入口、改名、附件回显与重启历史全部通过')
}

main().catch((error) => {
  console.error('[t191] FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
