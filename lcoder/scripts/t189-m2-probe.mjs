/**
 * T-189 M2 阶段 A 探针：窗口 → 门禁 → 导航 → 打开仓库 → 六列看板 → 任务速览
 * → 需求列表 → 项目信息 → 设置占位 → 回到聊天。
 *
 * 用法：node lcoder/scripts/t189-m2-probe.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`
 * 端口：渲染 9822、主进程 9829、宿主 9830、mock 云端 5091。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, openSync } from 'node:fs'
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
const DEMO_REPO = REPO_ROOT
const REQUIREMENTS_REPO = 'E:/Projects/LCoder-e2e-20261113'
mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null

function log(message) {
  console.log(`[t189] ${message}`)
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
  const out = openSync(join(LOGS, 't189-probe-mock.log'), 'w')
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
    session = await post('/auth/register', { phone: PHONE, code: '123456', password: PASSWORD, displayName: 'M2 Probe' })
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

async function launch() {
  const logPath = join(LOGS, 't189-probe-desktop.log')
  const out = openSync(logPath, 'w')
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
  log(`已启动桌面实例（pid ${String(child.pid)}），日志 ${logPath}`)
  return child
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
      throw new Error(`页面脚本失败：${answer.result.exceptionDetails.text}`)
    }
    return answer.result?.result?.value
  }
  const waitFor = async (expression, milliseconds, label) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      const value = await evaluate(expression)
      if (value !== undefined && value !== null && value !== false && value !== '') return value
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
    }
    const body = await evaluate('document.body.innerText.slice(0, 600)').catch(() => '')
    throw new Error(`等待超时：${label}；页面：${String(body)}`)
  }
  return { socket, evaluate, waitFor }
}

async function closeApp(page) {
  page.socket.send(JSON.stringify({ id: 999_999, method: 'Runtime.evaluate', params: { expression: "window.lcoder.window('close')" } }))
  await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  page.socket.close()
}

async function waitExit(child, milliseconds) {
  const exited = new Promise((resolvePromise) => {
    if (child.exitCode !== null) { resolvePromise(true); return }
    child.once('exit', () => { resolvePromise(true) })
  })
  let timer
  const timed = new Promise((resolvePromise) => { timer = setTimeout(() => { resolvePromise(false) }, milliseconds) })
  const ok = await Promise.race([exited, timed])
  clearTimeout(timer)
  if (!ok) child.kill('SIGTERM')
  return ok
}

async function openRepo(page, path) {
  await page.evaluate("document.querySelector('[data-testid=\"nav-projects\"]').click()")
  await page.waitFor("document.querySelector('[data-testid=\"page-projects\"]') !== null", 10_000, '项目页')
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="project-path"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(path)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await page.evaluate("document.querySelector('[data-testid=\"project-open\"]').click()")
  await page.waitFor("document.querySelector('[data-testid=\"page-tasks\"]') !== null", 60_000, '打开仓库后的任务页')
}

async function run() {
  const child = launch()
  let page
  try {
    page = await connectCdp()
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready')
    await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 30_000, '登录门禁')

    const navCount = await page.evaluate("document.querySelectorAll('[data-testid=\"nav\"] .nav-item').length")
    assert(navCount === 6, `导航项应为 6，实际 ${String(navCount)}`)

    await openRepo(page, DEMO_REPO)
    const columns = await page.waitFor("document.querySelectorAll('[data-testid=\"task-column\"]').length", 30_000, '六列看板')
    assert(columns === 6, `看板应有 6 列，实际 ${String(columns)}`)
    await page.waitFor(
      "[...document.querySelectorAll('[data-testid=\"task-card\"]')].some(card => (card.innerText ?? '').includes('DEMO-01'))",
      30_000, 'DEMO-01 任务卡')
    const scopeSessionId = await page.evaluate("JSON.parse(localStorage.getItem('lcoder.m2.project')).scopeSessionId")
    const commands = await page.evaluate(`window.lcoder.call('commands','list',{ agentId: ${JSON.stringify(scopeSessionId)} }).then(answer => answer.ok ? answer.value.map(item => item.name) : null)`)
    assert(Array.isArray(commands), '工作台作用域会话读不到命令面')
    assert(commands.includes('task_bind') && commands.includes('requirement_approve'),
      `命令面缺少工作台命令：${JSON.stringify(commands)}`)
    const presets = await page.evaluate("window.lcoder.call('agentPresets','list',{}).then(answer => answer.ok ? answer.value.presets.map(item => item.id) : null)")
    log(`命令 ${String(commands.length)} 条；preset ${JSON.stringify(presets)}`)
    assert(Array.isArray(presets) && presets.includes('lcoder-workbench'), '工作台 preset 未注册')
    const columnOfDemo = await page.evaluate(
      "document.querySelector('[data-testid=\"task-card\"][data-task-id=\"DEMO-01\"]')?.closest('[data-testid=\"task-column\"]')?.dataset.column")
    log(`DEMO-01 位于列 ${String(columnOfDemo)}`)
    await page.evaluate("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"DEMO-01\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"task-detail\"]')?.dataset.taskId === 'DEMO-01'", 10_000, '任务详情')
    const contract = await page.waitFor("document.querySelector('[data-testid=\"task-contract-signed\"]')?.textContent", 10_000, '契约签署态')
    const acceptance = await page.evaluate("document.querySelectorAll('[data-testid=\"task-acceptance\"] li').length")
    const paths = await page.evaluate("document.querySelector('[data-testid=\"task-paths\"]')?.textContent ?? ''")
    assert(String(contract).includes('未签署'), `DEMO-01 契约签署态异常：${String(contract)}`)
    assert(acceptance > 0, 'DEMO-01 契约验收为空')
    assert(paths.includes('fixtures/demo'), `DEMO-01 允许路径为空：${paths}`)
    log('任务详情、契约验收与允许路径通过')

    await page.evaluate("document.querySelector('[data-testid=\"nav-requirements\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-requirements\"]') !== null", 10_000, '需求页')
    const requirementRows = await page.evaluate("document.querySelectorAll('[data-testid=\"requirement-row\"]').length")
    log(`当前仓库需求行数：${String(requirementRows)}`)

    await openRepo(page, REQUIREMENTS_REPO)
    await page.waitFor("document.querySelector('[data-testid=\"task-card\"]') !== null", 30_000, '目标仓任务卡')
    await page.evaluate("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"T-01\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"task-detail\"]')?.dataset.taskId === 'T-01'", 10_000, 'T-01 详情')
    const deliverable = await page.waitFor("document.querySelector('[data-testid=\"task-doc\"]')?.textContent", 10_000, '交付文档入口')
    await page.evaluate("document.querySelector('[data-testid=\"task-doc\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"markdown-reader\"]')?.dataset.readerStatus === 'ready'", 20_000, '阅读器')
    const readerDoc = await page.waitFor("document.querySelector('[data-testid=\"reader-doc\"]')?.textContent", 10_000, '阅读器正文')
    assert(String(readerDoc).length > 20, `阅读器正文为空；文档 ${String(deliverable)}`)
    await page.evaluate("document.querySelector('[data-testid=\"reader-close\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"markdown-reader\"]') === null", 10_000, '关闭阅读器')
    log(`任务交付文档在阅读器中打开：${String(deliverable)}`)

    await page.evaluate("document.querySelector('[data-testid=\"nav-requirements\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"requirement-row\"][data-requirement-id=\"REQ-01\"]') !== null", 20_000, 'REQ-01')
    await page.evaluate("document.querySelector('[data-testid=\"requirement-row\"][data-requirement-id=\"REQ-01\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"requirement-detail\"]')?.dataset.requirementId === 'REQ-01'", 10_000, '需求详情')
    const bodyText = await page.evaluate("document.querySelector('[data-testid=\"requirement-document-body\"]')?.innerText ?? ''")
    const tableCount = await page.evaluate("document.querySelectorAll('[data-testid=\"requirement-document-body\"] table').length")
    assert(bodyText.includes('项目需求概要'), '需求正文没有渲染')
    assert(tableCount > 0, '需求正文里的表格没有渲染')
    await page.evaluate("document.querySelector('[data-testid=\"requirement-open-reader\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"markdown-reader\"]')?.dataset.readerStatus === 'ready'", 20_000, '需求阅读器')
    await page.evaluate("document.querySelector('[data-testid=\"reader-close\"]').click()")
    await page.evaluate("document.querySelector('[data-testid=\"requirement-history-load\"]').click()")
    await page.waitFor(
      "document.querySelector('[data-testid=\"requirement-history-empty\"]') !== null"
      + " || document.querySelectorAll('[data-testid=\"requirement-history-round\"]').length > 0",
      30_000, '讨论历史结果')
    log('需求正文、表格、阅读器与讨论历史入口通过')

    await page.evaluate("document.querySelector('[data-testid=\"nav-project-info\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-project-info\"]')?.innerText.includes('REQ-01') === false", 10_000, '项目信息页')
    const infoText = await page.evaluate("document.querySelector('[data-testid=\"page-project-info\"]')?.innerText ?? ''")
    assert(infoText.includes('作用域会话'), '项目信息页缺少作用域会话段')

    await page.evaluate("document.querySelector('[data-testid=\"nav-settings\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-settings\"]')?.innerText.includes('M3')", 10_000, '设置占位')

    await page.evaluate("document.querySelector('[data-testid=\"nav-chat\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null", 10_000, '聊天页会话列表')

    await closeApp(page)
    page = undefined
    const exited = await waitExit(child, 20_000)
    log(exited ? '实例已退出' : '实例未在 20 秒内退出，已发 SIGTERM')
    log('PASS：导航、六列看板、任务速览、需求列表与概要、项目信息、设置占位、聊天入口')
  } catch (error) {
    if (page !== undefined) await closeApp(page)
    if (child.exitCode === null) child.kill('SIGTERM')
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
  await run()
}

main().catch((error) => {
  console.error('[t189] FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
