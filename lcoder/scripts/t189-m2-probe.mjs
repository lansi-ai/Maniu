/**
 * T-189 M2 阶段 A 探针：窗口 → 门禁 → 导航 → 打开仓库 → 六列看板 → 任务速览
 * → 需求列表 → 项目信息 → 设置占位 → 回到聊天。
 *
 * 用法：node lcoder/scripts/t189-m2-probe.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`
 * 端口：渲染 9822、主进程 9829、宿主 9830、mock 云端 5091。
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync } from 'node:fs'
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
const SCRATCH_REPO = join(LOGS, 't189-scratch')
mkdirSync(LOGS, { recursive: true })

/** 准备一个可写靶仓：复制本仓 `.spec`，再补一条草稿需求与一条可推进任务。 */
function prepareScratch() {
  rmSync(SCRATCH_REPO, { recursive: true, force: true })
  mkdirSync(SCRATCH_REPO, { recursive: true })
  cpSync(join(REPO_ROOT, '.spec'), join(SCRATCH_REPO, '.spec'), { recursive: true })
  for (const dir of ['requirements', 'tasks', 'contracts', 'evidence']) {
    mkdirSync(join(SCRATCH_REPO, '.spec', dir), { recursive: true })
  }
  writeFileSync(join(SCRATCH_REPO, '.spec', 'requirements', 'REQ-99.yaml'), [
    'id: REQ-99',
    'title: 探针需求：确认与拆分',
    'state: draft',
    'options: []',
    'opened_at: 2026-11-14T00:00:00.000Z',
    '',
  ].join('\n'))
  writeFileSync(join(SCRATCH_REPO, '.spec', 'requirements', 'REQ-99.md'), '# 探针需求\n\n用于验证确认与拆分动作。\n')
  writeFileSync(join(SCRATCH_REPO, '.spec', 'tasks', 'T-99.yaml'), [
    'id: T-99',
    'title: 探针任务：分配岗位后推进到待开发',
    'description: 只用于验证人机命令。',
    'grade: C',
    'state: drafting',
    'proposal: REQ-99',
    'rules: []',
    'scope:',
    '  allowed_paths: [src/]',
    '  irreversible: []',
    'evidence_required: []',
    'opened_at: 2026-11-14T00:00:00.000Z',
    '',
  ].join('\n'))
  log(`靶仓已准备：${SCRATCH_REPO}`)
}

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
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
    }
    const body = await evaluate('document.body.innerText.slice(0, 600)').catch(() => '')
    throw new Error(`等待超时：${label}；页面：${String(body)}`)
  }
  return { socket, evaluate, waitFor }
}

function closeApp(page) {
  // 关窗命令由渲染端发出；窗口随即销毁，invoke 回执本来就不会返回，因此不等回执。
  // 也不主动断开 CDP：保留到进程退出之后再关 socket，避免排队中的命令随断链丢失。
  page.socket.send(JSON.stringify({
    id: 999_999,
    method: 'Runtime.evaluate',
    params: { expression: "window.lcoder.window('close')" },
  }))
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

async function launchResilient() {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { child, logPath } = await launch()
    try {
      return { child, page: await connectCdp(logPath) }
    } catch (error) {
      lastError = error
      log(`第 ${attempt} 次启动未拿到 CDP：${error instanceof Error ? error.message : String(error)}`)
      killTree(child)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3_000))
    }
  }
  throw lastError
}

async function run() {
  let child
  let page
  try {
    const started = await launchResilient()
    child = started.child
    page = started.page
    await page.waitFor("document.querySelector('[data-testid=\"host-state\"]')?.dataset.hostState === 'ready'", 60_000, '宿主 ready')
    await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 30_000, '登录门禁')

    const navCount = await page.evaluate("document.querySelectorAll('[data-testid=\"nav\"] .nav-item').length")
    assert(navCount === 7, `导航项应为 7，实际 ${String(navCount)}`)

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
    await page.waitFor("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"T-01\"]') !== null", 30_000, 'T-01 任务卡')
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

    await page.evaluate("document.querySelector('[data-testid=\"nav-roles\"]').click()")
    await page.waitFor("document.querySelectorAll('[data-testid=\"preset-card\"]').length > 0", 20_000, '角色看板')
    await page.waitFor("document.querySelector('[data-testid=\"preset-card\"][data-preset-id=\"lcoder-workbench\"]') !== null", 10_000, '工作台 preset')
    log('角色看板通过')

    // 靶仓：命令动作、附件只读、调度与流程日志。
    await openRepo(page, SCRATCH_REPO)
    await page.waitFor("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"DEMO-01\"]') !== null", 30_000, '靶仓 DEMO-01')
    await page.evaluate("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"DEMO-01\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"task-detail\"]')?.dataset.taskId === 'DEMO-01'", 10_000, '靶仓任务详情')
    await page.waitFor("document.querySelector('[data-testid=\"task-attachment\"] img') !== null", 20_000, '附件缩略图')
    log('附件只读缩略图通过')

    const runAction = async (testId, expectOk, expectText, label) => {
      await page.waitFor(`document.querySelector('[data-testid="${testId}"]:not([disabled])') !== null`, 10_000, `${label} 按钮可用`)
      await page.evaluate(`document.querySelector('[data-testid="${testId}"]').click()`)
      let result
      try {
        result = await page.waitFor(
          `(() => {
            const node = document.querySelector('[data-testid="task-action-result"]');
            if (node === null) return false;
            const text = node.textContent ?? '';
            return node.dataset.ok === '${expectOk ? 'true' : 'false'}' && text.includes(${JSON.stringify(expectText)}) ? text : false;
          })()`,
          20_000, label)
      } catch (error) {
        const current = await page.evaluate("document.querySelector('[data-testid=\"task-action-result\"]')?.textContent ?? '(无回执)'")
        throw new Error(`${label} 未通过：${String(current)}`)
      }
      log(`${label}：${String(result).slice(0, 60)}`)
      return String(result)
    }
    await runAction('task-sign', true, '已由人签署', '签署契约')
    await runAction('task-contract', true, '已签约', '确认契约签约')
    await runAction('task-bind', true, '认上', '认领任务')
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="task-role-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'dev');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await runAction('task-assign', true, '已分配', '分配岗位')
    await runAction('schedule-record', true, '调度记录', '记录调度判定')

    await page.evaluate("document.querySelector('[data-testid=\"task-detail-close\"]').click()")
    await page.evaluate("document.querySelector('[data-testid=\"flow-open\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"flow-decision\"]') !== null", 20_000, '流程判定')
    await page.waitFor("document.querySelector('[data-testid=\"flow-log-entry\"]') !== null", 20_000, '动作日志')
    log('流程状态与动作日志通过')
    await page.evaluate("document.querySelector('[data-testid=\"flow-close\"]').click()")

    await page.evaluate("document.querySelector('[data-testid=\"task-card\"][data-task-id=\"T-99\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"task-detail\"]')?.dataset.taskId === 'T-99'", 10_000, 'T-99 详情')
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="task-role-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'dev');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await runAction('task-assign', true, '已分配', 'T-99 分配岗位')
    await runAction('task-split-ready', true, '待开发', 'T-99 推进到待开发')
    await page.evaluate("document.querySelector('[data-testid=\"task-detail-close\"]').click()")

    await page.evaluate("document.querySelector('[data-testid=\"nav-requirements\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"requirement-row\"][data-requirement-id=\"REQ-99\"]') !== null", 20_000, 'REQ-99')
    await page.evaluate("document.querySelector('[data-testid=\"requirement-row\"][data-requirement-id=\"REQ-99\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"requirement-approve\"]:not([disabled])') !== null", 10_000, '确认需求按钮')
    await page.evaluate("document.querySelector('[data-testid=\"requirement-approve\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"requirement-action-result\"]')?.dataset.ok === 'true'", 20_000, '确认需求回执')
    await page.waitFor("document.querySelector('[data-testid=\"requirement-detail\"]')?.innerText.includes('已确认')", 20_000, '需求状态已确认')
    log('确认需求命令通过')

    await page.waitFor("document.querySelector('[data-testid=\"requirement-split\"]:not([disabled])') !== null", 10_000, '拆分按钮可用')
    await page.evaluate("document.querySelector('[data-testid=\"requirement-split\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-requirements\"]') === null", 30_000, '切到对话页')
    await page.waitFor("document.querySelector('[data-testid=\"message-user\"]')?.textContent.includes('需求拆分')", 30_000, '拆分提示词进入对话')
    log('拆分指令已进入工作台会话')

    await page.evaluate("document.querySelector('[data-testid=\"nav-requirements\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-requirements\"]') !== null", 10_000, '回到需求页')
    await page.evaluate("document.querySelector('[data-testid=\"intake-open\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"intake-prompt\"]')?.textContent.includes('项目需求概要')", 10_000, '立项指令预览')
    await page.evaluate("document.querySelector('[data-testid=\"intake-close\"]').click()")
    log('立项向导入口与指令预览通过')

    await page.evaluate("document.querySelector('[data-testid=\"nav-project-info\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-project-info\"]')?.innerText.includes('REQ-01') === false", 10_000, '项目信息页')
    const infoText = await page.evaluate("document.querySelector('[data-testid=\"page-project-info\"]')?.innerText ?? ''")
    assert(infoText.includes('作用域会话'), '项目信息页缺少作用域会话段')

    await page.evaluate("document.querySelector('[data-testid=\"nav-settings\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"page-settings\"]')?.innerText.includes('模型服务')", 30_000, '设置页模型区')

    await page.evaluate("document.querySelector('[data-testid=\"nav-chat\"]').click()")
    await page.waitFor("document.querySelector('[data-testid=\"session-list\"]') !== null", 10_000, '聊天页会话列表')

    await closeApp(page)
    const exited = await waitExit(child, 20_000)
    page.socket.close()
    page = undefined
    log(exited ? '实例已退出' : '实例未在 20 秒内退出，已发 SIGTERM')
    log('PASS：导航、六列看板、任务速览、需求列表与概要、项目信息、设置占位、聊天入口')
  } catch (error) {
    if (page !== undefined) { await closeApp(page); page.socket.close() }
    if (child !== undefined) killTree(child)
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
  prepareScratch()
  await run()
}

main().catch((error) => {
  console.error('[t189] FAIL:', error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
