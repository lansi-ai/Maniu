/**
 * T-190 M3 探针：欢迎屏 → 登录 → 会话 → 设置（模型/四皮肤/字体/中英/更新）
 * → 窗口最大化 → 个人中心 → 重启保持 → 退出登录。
 *
 * 用法：node lcoder/scripts/t190-m3-probe.mjs
 * 前置：`pnpm --filter @lcoder/desktop --filter @lcoder/client run build`
 * 端口：渲染 9822、主进程 9829、宿主 9830、mock 云端 5091。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const APP_ROOT = join(REPO_ROOT, 'packages', 'lcoder', 'desktop')
const LOGS = join(REPO_ROOT, 'lcoder', 'logs')
const HOME = join(LOGS, 't190-home')
const MOCK_PORT = 5091
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}/v1`
const RENDERER_PORT = 9822
const PASSWORD = 'lcoder-m3-pass'
/** 每次运行用新手机号，避免 mock 内存里重名账号。 */
const PHONE = `+86139${String(Date.now() % 100_000_000).padStart(8, '0')}`
mkdirSync(LOGS, { recursive: true })

let electron = null
let mockChild = null
let passed = 0

function log(message) {
  console.log(`[t190] ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
  log(`PASS ${passed}: ${message}`)
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
  const out = openSync(join(LOGS, 't190-probe-mock.log'), 'w')
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
  const override = process.env.LCODER_PROBE_EXECUTABLE
  if (override !== undefined && override !== '') return override
  const requireFromApp = createRequire(join(APP_ROOT, 'package.json'))
  const resolved = requireFromApp('electron')
  assert(typeof resolved === 'string', '找到 Electron 可执行文件')
  return resolved
}

/** 打包态由安装产物自己的可执行文件启动，不再传应用目录。 */
const packagedProbe = process.env.LCODER_PROBE_PACKAGED === '1'

function launch(suffix) {
  const logPath = join(LOGS, `t190-probe-desktop-${suffix}.log`)
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
    ...(packagedProbe ? [] : [APP_ROOT]),
  ], { cwd: packagedProbe ? dirname(electron) : APP_ROOT, env: environment, stdio: ['ignore', out, out] })
  log(`启动桌面实例（pid ${String(child.pid)}），日志 ${logPath}`)
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
    await new Promise(resolvePromise => setTimeout(resolvePromise, 300))
  }
  throw new Error('90 秒内没有等到渲染端 CDP 目标')
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
  const click = (selector) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) throw new Error('找不到 ${selector}');
    node.click();
    return true;
  })()`)
  const fill = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) throw new Error('找不到 ${selector}');
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  return { socket, evaluate, waitFor, click, fill,
    emulateReducedMotion: () => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }),
  }
}

async function closeApp(page) {
  // 只发关窗命令，不主动断开 CDP：渲染端忙时提前断链会把排队中的命令丢掉，
  // 窗口不关、进程不退出，探针只能等到超时。
  page.socket.send(JSON.stringify({ id: 999_999, method: 'Runtime.evaluate', params: { expression: "window.lcoder.window('close')" } }))
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
 * 等实例真正退出，并报告命中的判定路径。
 * Windows 下自 SIGKILL 后父进程偶发收不到 exit 事件，exitCode/signalCode 也保持 null；
 * 所以同时看 exit 事件、退出码与 PID 存活，任一成立即为已退出。
 * @param child - 探针启动的 Electron 主进程。
 * @param milliseconds - 等待上限。
 * @returns 是否已退出。
 */
async function waitExit(child, milliseconds) {
  let timer
  let poll
  const event = new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolvePromise('exit-code'); return }
    child.once('exit', () => { resolvePromise('exit-event') })
  })
  const gone = new Promise((resolvePromise) => {
    if (!processAlive(child.pid)) { resolvePromise('pid-gone'); return }
    poll = setInterval(() => {
      if (!processAlive(child.pid)) resolvePromise('pid-gone')
    }, 250)
  })
  const timed = new Promise((resolvePromise) => { timer = setTimeout(() => { resolvePromise('timeout') }, milliseconds) })
  const outcome = await Promise.race([event, gone, timed])
  clearTimeout(timer)
  if (poll !== undefined) clearInterval(poll)
  if (outcome === 'timeout') {
    child.kill('SIGTERM')
    return false
  }
  log(outcome === 'pid-gone'
    ? `退出检测：PID ${String(child.pid)} 已不存在（未收到 exit 事件）`
    : `退出检测：${outcome === 'exit-event' ? 'exit 事件' : 'exitCode'}`)
  return true
}

async function launchResilient(suffix) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { child, logPath } = launch(suffix)
    try {
      return { child, page: await connectCdp(logPath) }
    } catch (error) {
      lastError = error
      log(`${suffix} 第 ${attempt} 次启动未拿到 CDP：${error instanceof Error ? error.message : String(error)}`)
      killTree(child)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3_000))
    }
  }
  throw lastError
}

async function waitReady(page) {
  await page.waitFor("document.querySelector('.app')?.hasAttribute('data-lcoder-state')", 90_000, '宿主 ready')
  await page.waitFor("document.querySelector('.app')?.getAttribute('data-lcoder-state') === 'ready'", 60_000, '登录门禁放行')
}

/** 从主进程 inspector 读应用菜单标签，验证菜单已安装并随语言切换。 */
async function mainMenuLabels() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch('http://127.0.0.1:9829/json/list')).json()
      const target = list[0]
      if (target === undefined) throw new Error('主进程 inspector 没有目标')
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject })
      const answer = await new Promise((resolvePromise) => {
        socket.onmessage = (event) => { resolvePromise(JSON.parse(String(event.data))) }
        socket.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: "(() => { const Module = process.getBuiltinModule('module'); const electron = Module._load('electron', null, false); return electron.Menu.getApplicationMenu()?.items.map(item => item.label); })()",
            returnByValue: true,
            awaitPromise: true,
          },
        }))
      })
      socket.close()
      const labels = answer.result?.result?.value
      if (Array.isArray(labels)) return labels
    } catch {
      // inspector 尚未就绪时继续轮询。
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error('读不到主进程应用菜单')
}

async function signUp(page) {
  await page.click('[data-testid="login-tab-register"]')
  await page.fill('[data-testid="login-phone"]', PHONE.replace('+86', ''))
  await page.click('[data-testid="login-send-code"]')
  await page.waitFor("document.querySelector('[data-testid=\"login-hint\"]')?.textContent.includes('秒')", 15_000, '验证码已发送')
  await page.fill('[data-testid="login-code"]', '123456')
  await page.fill('[data-testid="login-new-password"]', PASSWORD)
  await page.click('[data-testid="login-submit"]')
}

async function run() {
  let child
  let page
  try {
    const first = await launchResilient('1')
    child = first.child
    page = first.page
    await page.waitFor("document.querySelector('.app')?.hasAttribute('data-lcoder-state')", 90_000, '宿主 ready')
    await page.waitFor("document.querySelector('[data-testid=\"welcome-screen\"]') !== null", 60_000, '欢迎屏')
    assert(true, '新客户端首屏是 LCoder 欢迎屏')

    await page.click('[data-testid="welcome-sign-in"]')
    await page.waitFor("document.querySelector('[data-testid=\"login-screen\"]') !== null", 15_000, '登录页')
    assert(true, '欢迎屏可进入登录页')

    await signUp(page)
    await waitReady(page)
    assert(true, `注册并登录成功（${PHONE}）`)

    await page.click('[data-testid="new-session"]')
    await page.waitFor("document.querySelectorAll('[data-testid=\"session-item\"]').length > 0", 30_000, '新建会话')
    assert(true, '登录后可新建会话')

    await page.fill('[data-testid="composer"]', 'M3 探针：确认云端用量写入。')
    await page.click('[data-testid="send"]')
    const assistant = await page.waitFor(
      "document.querySelector('[data-testid=\"message-assistant\"]')?.textContent || ''", 90_000, 'assistant 文本')
    assert(String(assistant).length > 0, `一轮真实回合产出 assistant 文本（${String(assistant).slice(0, 24)}…）`)

    const zhMenu = await mainMenuLabels()
    assert(zhMenu.includes('编辑') && zhMenu.includes('视图'), `主进程菜单已安装并按中文渲染（${zhMenu.join(' / ')}）`)

    await page.click('[data-testid="nav-settings"]')
    await page.waitFor("document.querySelector('[data-testid=\"page-settings\"]') !== null", 15_000, '设置页')
    await page.waitFor(
      "document.querySelector('[data-testid=\"settings-models-error\"]') === null"
      + " && (document.querySelectorAll('[data-testid=\"settings-provider-row\"]').length > 0"
      + " || document.querySelector('[data-testid=\"settings-no-providers\"]') !== null)",
      30_000, '模型快照')
    const providers = await page.evaluate(
      "[...document.querySelectorAll('[data-testid=\"settings-provider-row\"]')].map(row => row.dataset.provider)")
    assert(providers.includes('lcoder-cloud'), `模型行包含云端托管路由（共 ${String(providers.length)} 个）`)
    await page.click('[data-testid="settings-provider-row"][data-provider="lcoder-cloud"] .model-row-main')
    const cloudKeyInput = await page.evaluate(
      "document.querySelector('[data-testid=\"settings-provider-row\"][data-provider=\"lcoder-cloud\"] [data-testid=\"settings-key-input\"]') !== null")
    assert(cloudKeyInput === false, '云端托管路由不提供密钥输入')
    const cloudAccountNote = await page.evaluate(
      "(document.querySelector('[data-testid=\"settings-provider-row\"][data-provider=\"lcoder-cloud\"]')?.innerText ?? '').includes('登录令牌')")
    assert(cloudAccountNote === true, '云端托管路由保留账号托管说明')
    const readOnlyNote = await page.evaluate("document.querySelector('[data-testid=\"settings-models-readonly\"]') !== null")
    assert(readOnlyNote === true, '模型面板标出首版只读')
    const defaultText = await page.evaluate("document.querySelector('[data-testid=\"settings-default-model\"]')?.innerText ?? ''")
    assert(defaultText.includes('默认模型'), `默认模型区可见（${defaultText.split('\n')[0]}）`)
    const editable = await page.evaluate(`JSON.stringify({
      setDefault: document.querySelector('[data-testid="settings-set-default"]') !== null,
      options: document.querySelectorAll('[data-testid="settings-default-model"] option').length,
    })`)
    assert(editable === '{"setDefault":false,"options":0}', `默认模型没有可编辑控件（${editable}）`)
    assert(true, '默认模型只读展示')

    await page.click('[data-testid="settings-provider-row"][data-provider="deepseek"] .model-row-main')
    const keyInputState = await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="settings-provider-row"][data-provider="deepseek"] [data-testid="settings-key-input"]');
      return input === null ? 'missing' : input.disabled ? 'disabled' : 'enabled';
    })()`)
    assert(keyInputState === 'missing', `首版设置不提供密钥编辑入口（${keyInputState}）`)
    // 界面只读，但底层凭据能力仍在：直接走 IPC 验证写入/描述/删除往返。
    const round = await page.evaluate(`(async () => {
      const describe = () => window.lcoder.call('credentials', 'describe', { refs: ['DEEPSEEK_API_KEY'] })
      const configured = (answer) => answer.ok && answer.value !== null
        && typeof answer.value === 'object' && answer.value.DEEPSEEK_API_KEY?.configured === true
      const before = await describe()
      const set = await window.lcoder.call('credentials', 'set', { ref: 'DEEPSEEK_API_KEY', value: 'sk-t190-probe-only' })
      const after = await describe()
      const unset = await window.lcoder.call('credentials', 'unset', { ref: 'DEEPSEEK_API_KEY' })
      const final = await describe()
      return { before: configured(before), set: set.ok, after: configured(after), unset: unset.ok, final: configured(final) };
    })()`)
    assert(round.before === false && round.set === true && round.after === true
      && round.unset === true && round.final === false,
    `credentials 写入/描述/删除往返（${JSON.stringify(round)}）`)

    const baseOf = (skin) => page.evaluate(`(() => {
      document.querySelector('[data-testid="settings-skin-${skin}"]').click();
      return getComputedStyle(document.documentElement).getPropertyValue('--lg-base-a').trim();
    })()`)
    const skinValues = {}
    for (const skin of ['neon', 'silver', 'rose', 'liquid-glass']) {
      skinValues[skin] = await baseOf(skin)
      const applied = await page.evaluate('document.documentElement.dataset.skin')
      assert(applied === skin, `皮肤切换为 ${skin}`)
    }
    assert(new Set(Object.values(skinValues)).size === 4, `四套皮肤底色不同（${Object.values(skinValues).join(' / ')}）`)

    await page.click('[data-testid="settings-font-modern"]')
    const font = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--lg-font')")
    assert((await page.evaluate('document.documentElement.dataset.font')) === 'modern' && font.includes('Inter Variable'),
      '字体切换到现代（Inter）')
    await page.click('[data-testid="settings-font-system"]')

    await page.click('[data-testid="settings-locale-en"]')
    await page.waitFor("document.querySelector('[data-testid=\"nav-chat\"]')?.textContent === 'Chat'", 10_000, '英文导航')
    const settingsTitle = await page.evaluate("document.querySelector('[data-testid=\"page-settings\"] h2')?.textContent")
    assert(settingsTitle === 'Settings', '语言切换为英文')
    await page.click('[data-testid="settings-locale-zh"]')
    await page.waitFor("document.querySelector('[data-testid=\"nav-chat\"]')?.textContent === '对话'", 10_000, '中文导航')

    const checkButton = await page.evaluate("document.querySelector('[data-testid=\"settings-update-check\"]') !== null")
    assert(checkButton === false, '更新入口不提供检查按钮')
    const updateState = await page.evaluate("document.querySelector('[data-testid=\"settings-update-state\"]')?.textContent ?? ''")
    assert(updateState.includes('官方下载页') && updateState.includes('覆盖安装'),
      `更新入口给出手动下载说明（${updateState.slice(0, 60)}）`)

    await page.click('[data-testid="window-maximize"]')
    await page.waitFor("document.querySelector('[data-testid=\"titlebar\"]')?.dataset.maximized === 'true'", 10_000, '最大化状态')
    await page.click('[data-testid="window-maximize"]')
    await page.waitFor("document.querySelector('[data-testid=\"titlebar\"]')?.dataset.maximized === 'false'", 10_000, '还原状态')
    assert(true, '窗口最大化状态与按钮同步')

    await page.click('[data-testid="account-button"]')
    await page.waitFor("document.querySelector('[data-testid=\"account-menu\"]') !== null", 10_000, '账号菜单')
    await page.click('[data-testid="account-refresh"]')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_500))
    const refreshClean = await page.evaluate(
      "document.querySelector('[data-testid=\"account-menu\"]') !== null"
      + " && document.querySelector('[data-testid=\"account-menu\"] .notice') === null")
    assert(refreshClean === true, '账号菜单刷新额度无错误回执')
    await page.click('[data-testid="account-personal-center"]')
    await page.waitFor("document.querySelector('[data-testid=\"page-account\"]') !== null", 10_000, '个人中心')
    await page.waitFor("document.querySelector('[data-testid=\"account-usage\"]') !== null", 10_000, '用量区')
    await page.waitFor("document.querySelectorAll('[data-testid=\"account-usage-row\"]').length > 0", 30_000, '用量流水行')
    const usageRow = await page.evaluate("document.querySelector('[data-testid=\"account-usage-row\"]')?.innerText ?? ''")
    assert(usageRow.length > 0, `个人中心用量来自真实流水（${usageRow.replace(/\s+/gu, ' ').slice(0, 80)}）`)
    assert(true, '账号菜单与个人中心可用')
    await page.click('[data-testid="account-back"]')
    await page.waitFor("document.querySelector('[data-testid=\"page-settings\"]') !== null", 10_000, '返回设置页')

    // 落一套非默认偏好，重启后核对。
    await page.click('[data-testid="settings-skin-rose"]')
    await page.click('[data-testid="settings-font-modern"]')
    await page.click('[data-testid="settings-locale-en"]')
    await page.waitFor("document.documentElement.lang === 'en'", 10_000, '英文语言标记')
    const enMenu = await mainMenuLabels()
    assert(enMenu.includes('Edit') && enMenu.includes('View'), `菜单跟随语言切到英文（${enMenu.join(' / ')}）`)

    await page.emulateReducedMotion()
    const motion = await page.evaluate(`(() => ({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation: getComputedStyle(document.querySelector('.ambient-blob')).animationName,
    }))()`)
    assert(motion.matches === true && motion.animation === 'none',
      `reduced-motion 下环境层动效关闭（animation=${String(motion.animation)}）`)

    await closeApp(page)
    const firstExited = await waitExit(child, 25_000)
    page.socket.close()
    page = undefined
    assert(firstExited, '首次实例退出')
    const second = await launchResilient('2')
    child = second.child
    page = second.page
    await waitReady(page)
    assert(true, '重启后仍保持登录')
    const restored = await page.evaluate(`JSON.stringify({
      skin: document.documentElement.dataset.skin,
      font: document.documentElement.dataset.font,
      lang: document.documentElement.lang,
      chat: document.querySelector('[data-testid="nav-chat"]')?.textContent,
      sessions: document.querySelectorAll('[data-testid="session-item"]').length,
    })`)
    const state = JSON.parse(restored)
    assert(state.skin === 'rose' && state.font === 'modern' && state.lang === 'en' && state.chat === 'Chat',
      `重启后皮肤/字体/语言仍生效（${restored}）`)
    assert(state.sessions > 0, '重启后会话列表仍在')
    await page.click('[data-testid="nav-settings"]')
    await page.waitFor(
      "(() => { const text = document.querySelector('[data-testid=\"settings-default-model\"]')?.innerText ?? '';"
      + " return text.includes('Default model') && /Current:|No default model set/.test(text) ? 'ok' : ''; })()",
      30_000, '重启后的默认模型')
    assert(true, '重启后默认模型区仍可见（只读）')

    await page.click('[data-testid="account-button"]')
    await page.click('[data-testid="account-logout"]')
    await page.click('[data-testid="account-logout-confirm"]')
    await page.waitFor("document.querySelector('[data-testid=\"login-screen\"]') !== null", 20_000, '退出登录')
    assert(true, '退出登录回到登录页')

    await page.click('[data-testid="login-tab-password"]')
    await page.fill('[data-testid="login-phone"]', PHONE.replace('+86', ''))
    await page.fill('[data-testid="login-password"]', PASSWORD)
    await page.click('[data-testid="login-submit"]')
    await waitReady(page)
    assert(true, '密码登录可用')

    await closeApp(page)
    const secondExited = await waitExit(child, 25_000)
    page.socket.close()
    page = undefined
    assert(secondExited, '第二次实例退出')
    log(`PASS：${passed} 项断言全部通过`)
  } catch (error) {
    if (page !== undefined) { await closeApp(page); page.socket.close() }
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
    assert(existsSync(path), `产物存在：${path.replace(REPO_ROOT, '')}`)
  }
  const busy = await busyPorts()
  assert(busy.length === 0, `调试端口空闲（占用：${busy.join(', ') || '无'}）；先关掉本工作树正在运行的实例`)
  electron = resolveElectron()
  await ensureMock()
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
  log(`全新 home：${HOME}；测试号 ${PHONE}`)
  await run()
}

main().catch((error) => {
  console.error('[t190] FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(() => {
  if (mockChild !== null) mockChild.kill()
})
