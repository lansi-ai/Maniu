/** LCoder 自研壳主进程：起宿主、接链路、开窗口、装系统面与窄 IPC。 */

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from './contract.ts'
import type { DesktopLocaleId } from './contract.ts'
import { readDesktopLocale, writeDesktopLocale } from './desktop-locale.ts'
import { HostSupervisor } from './host-supervisor.ts'
import { createStatePublisher, createWindowStatePublisher, registerIpc } from './ipc.ts'
import { HostLink } from './link.ts'
import { installMenu } from './menu.ts'
import { REPO_ROOT } from './profile.ts'
import { DesktopTray } from './tray.ts'
import { checkUpdate } from './update.ts'
import { createMainWindow } from './window.ts'

const home = process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home')
process.env.DSH_HOME = home

/** 关停从关窗开始算起的总上限；到点强制退出，绝不允许关窗后静默驻留。 */
const QUIT_GUARD_MS = 12_000

let mainWindow: BrowserWindow | undefined
let supervisor: HostSupervisor | undefined
let link: HostLink | undefined
let tray: DesktopTray | undefined
let locale: DesktopLocaleId = 'zh'
let shutdownStarted = false

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
  window.on('closed', () => { mainWindow = undefined })
}

function installLocale(localeId: DesktopLocaleId): void {
  locale = localeId
  writeDesktopLocale(localeId)
  installMenu({ locale: () => locale, window: () => mainWindow, quit: () => { app.quit() } })
  tray?.relabel()
}

function hostInspectPort(): number | undefined {
  const raw = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (raw === undefined || raw === '') return undefined
  const port = Number(raw)
  return Number.isSafeInteger(port) && port > 0 && port < 65_536 ? port : undefined
}

async function boot(): Promise<void> {
  supervisor = new HostSupervisor()
  const link_ = new HostLink()
  try {
    const url = await supervisor.start(home, hostInspectPort())
    console.log('lcoder desktop: 宿主已就绪', url.replace(/token=[^&]+/u, 'token=<redacted>'))
    await link_.connect(url, {
      onEvent: (event) => { send(IPC_CHANNELS.events, event) },
      onWaterfall: (event) => { send(IPC_CHANNELS.waterfall, event) },
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
    locale = readDesktopLocale()
    registerIpc({
      link: () => link,
      appInfo: () => ({ version: app.getVersion(), ...(link === undefined ? {} : { hostUrl: supervisor?.readyUrl ?? '' }) }),
      window: () => mainWindow,
      hostState: () => publisher.current(),
      windowState: () => windowState.current(),
      update: checkUpdate,
      setLocale: installLocale,
    })
    mainWindow = createMainWindow()
    wireMainWindow(mainWindow)
    installMenu({ locale: () => locale, window: () => mainWindow, quit: () => { app.quit() } })
    const trayIcon = join(import.meta.dirname, '..', '..', 'resources', 'tray-windows.ico')
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
