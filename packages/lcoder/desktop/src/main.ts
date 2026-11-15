/** LCoder 自研壳主进程：起宿主、接链路、开窗口、装系统面与窄 IPC。 */

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from './contract.ts'
import type { DesktopLocaleId } from './contract.ts'
import { readDesktopPreferences } from './desktop-locale.ts'
import { resolveDesktopHome } from './home.ts'
import { HostSupervisor, type HostLaunch } from './host-supervisor.ts'
import { createStatePublisher, createWindowStatePublisher, registerIpc } from './ipc.ts'
import { HostLink } from './link.ts'
import { installMenu } from './menu.ts'
import { REPO_ROOT, releaseProfileSourceDir } from './profile.ts'
import { RunningTurns } from './running-turns.ts'
import { DesktopTray } from './tray.ts'
import { checkUpdate } from './update.ts'
import { createMainWindow } from './window.ts'

const home = resolveDesktopHome({
  isPackaged: app.isPackaged,
  userHome: app.getPath('home'),
  repoRoot: REPO_ROOT,
  override: process.env.DSH_HOME,
})
process.env.DSH_HOME = home

/** 关停从关窗开始算起的总上限；到点强制退出，绝不允许关窗后静默驻留。 */
const QUIT_GUARD_MS = 12_000

let mainWindow: BrowserWindow | undefined
let supervisor: HostSupervisor | undefined
let link: HostLink | undefined
let tray: DesktopTray | undefined
let locale: DesktopLocaleId = 'zh'
let shutdownStarted = false
/** 渲染端已确认放弃运行中的回合；主进程窗口 `close` 只放行这一次。 */
let closeConfirmed = false

const runningTurns = new RunningTurns()

const publisher = createStatePublisher(() => mainWindow)
const windowState = createWindowStatePublisher(() => mainWindow)

function send(channel: string, ...args: readonly unknown[]): void {
  const target = mainWindow
  if (target === undefined || target.isDestroyed()) return
  target.webContents.send(channel, ...args)
}

function wireStateReplay(window: BrowserWindow): void {
  window.webContents.on('did-finish-load', () => { publisher.replay(); windowState.replay() })
  window.webContents.on('did-stop-loading', () => { publisher.replay(); windowState.replay() })
}

function publishWindowState(): void {
  const target = mainWindow
  if (target === undefined || target.isDestroyed()) return
  windowState.publish({ maximized: target.isMaximized(), fullscreen: target.isFullScreen() })
}

function wireWindowState(window: BrowserWindow): void {
  window.on('maximize', publishWindowState)
  window.on('unmaximize', publishWindowState)
  window.on('enter-full-screen', publishWindowState)
  window.on('leave-full-screen', publishWindowState)
  window.once('ready-to-show', publishWindowState)
}

function focusWindow(): void {
  const target = mainWindow
  if (target === undefined || target.isDestroyed()) {
    mainWindow = createMainWindow()
    wireMainWindow(mainWindow)
    return
  }
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

function wireMainWindow(window: BrowserWindow): void {
  wireStateReplay(window)
  wireWindowState(window)
  closeConfirmed = false
  window.on('close', (event) => {
    // 空闲直接走正常关停；有回合在跑时先让渲染端确认，确认后同一条 close 再放行。
    if (closeConfirmed || runningTurns.count === 0) return
    event.preventDefault()
    send(IPC_CHANNELS.closeRequest, { running: runningTurns.count })
  })
  window.on('closed', () => { mainWindow = undefined })
}

function applyLocale(localeId: DesktopLocaleId): void {
  if (locale === localeId) return
  locale = localeId
  installMenu({ locale: () => locale, window: () => mainWindow, quit: () => { app.quit() } })
  tray?.relabel()
}

function hostInspectPort(): number | undefined {
  const raw = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (raw === undefined || raw === '') return undefined
  const port = Number(raw)
  return Number.isSafeInteger(port) && port > 0 && port < 65_536 ? port : undefined
}

/** 发布态宿主与载荷都在 `resources/` 下；开发态走本包编译产物。 */
function hostLaunch(): HostLaunch {
  if (!app.isPackaged) return {}
  return {
    entry: join(process.resourcesPath, 'dsh', 'lib', 'types', 'host-entry.js'),
    nodeModules: join(process.resourcesPath, 'dsh', 'node_modules'),
    packageManager: {
      pnpm: join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
      nodeBin: join(process.resourcesPath, 'runtime', 'bin'),
    },
  }
}

/** 窗口与托盘图标：发布态随 extraResources 落盘。 */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.ico')
    : join(import.meta.dirname, '..', '..', 'resources', 'tray-windows.ico')
}

async function boot(): Promise<void> {
  supervisor = new HostSupervisor()
  const link_ = new HostLink()
  try {
    const sourceDir = releaseProfileSourceDir(app.isPackaged, process.resourcesPath)
    const url = await supervisor.start(home, sourceDir, hostInspectPort(), hostLaunch())
    console.log('lcoder desktop: 宿主已就绪', url.replace(/token=[^&]+/u, 'token=<redacted>'))
    await link_.connect(url, {
      onEvent: (event) => {
        if (event.name === 'api-session/status') {
          const [sessionId, running] = event.args
          if (typeof sessionId === 'string' && typeof running === 'boolean') runningTurns.update(sessionId, running)
        }
        send(IPC_CHANNELS.events, event)
      },
      onWaterfall: (event) => { send(IPC_CHANNELS.waterfall, event) },
      onWaterfallCancel: (event) => { send(IPC_CHANNELS.waterfallCancel, event) },
      onStreamFrame: (streamId, frame) => { send(IPC_CHANNELS.streamFrame, streamId, frame) },
    })
    console.log('lcoder desktop: 宿主链路已连接')
    link = link_
    publisher.publish({ kind: 'ready', url })
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    publisher.publish({ kind: 'fatal', detail })
    console.error('lcoder desktop: 宿主启动失败', error)
    await supervisor.stop()
    supervisor = undefined
  }
}

async function shutdown(): Promise<void> {
  if (shutdownStarted) return
  shutdownStarted = true
  console.log(`lcoder desktop: 关停步骤 托盘=${tray === undefined ? '无' : '有'} 窗口=${String(BrowserWindow.getAllWindows().length)}`)
  tray?.dispose()
  tray = undefined
  link?.close()
  link = undefined
  const started = Date.now()
  await supervisor?.stop()
  supervisor = undefined
  console.log(`lcoder desktop: 关停步骤 宿主已停（${String(Date.now() - started)} 毫秒）`)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { focusWindow() })
  app.whenReady().then(async () => {
    locale = readDesktopPreferences().locale
    registerIpc({
      link: () => link,
      appInfo: () => ({ version: app.getVersion(), ...(link === undefined ? {} : { hostUrl: supervisor?.readyUrl ?? '' }) }),
      window: () => mainWindow,
      hostState: () => publisher.current(),
      windowState: () => windowState.current(),
      update: checkUpdate,
      confirmClose: () => {
        closeConfirmed = true
        mainWindow?.close()
      },
      applyLocale,
    })
    mainWindow = createMainWindow()
    wireMainWindow(mainWindow)
    installMenu({ locale: () => locale, window: () => mainWindow, quit: () => { app.quit() } })
    const trayIcon = trayIconPath()
    if (existsSync(trayIcon)) {
      tray = new DesktopTray({
        iconPath: trayIcon,
        locale: () => locale,
        open: focusWindow,
        quit: () => { app.quit() },
      })
    }
    await boot()
    app.on('activate', () => { focusWindow() })
  }).catch((error: unknown) => {
    console.error('lcoder desktop: 启动失败', error)
    publisher.publish({ kind: 'fatal', detail: error instanceof Error ? error.message : String(error) })
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (shutdownStarted) return
    event.preventDefault()
    console.log('lcoder desktop: 开始关停')
    const guard = setTimeout(() => {
      console.error(`lcoder desktop: 关停超过 ${String(QUIT_GUARD_MS)} 毫秒，强制退出`)
      supervisor?.terminate()
      process.kill(process.pid, 'SIGKILL')
    }, QUIT_GUARD_MS)
    void shutdown().finally(() => {
      clearTimeout(guard)
      console.log('lcoder desktop: 关停完成')
      // 链路、托盘与宿主都已关停，窗口也已销毁；Electron 的 app.quit/app.exit 在
      // renderer 进程滞留时会卡在原生退出等待（T-192 现场），这里直接终止进程。
      console.log(`lcoder desktop: 强制终止（pid ${String(process.pid)}）`)
      process.kill(process.pid, 'SIGKILL')
    })
  })
}
