/** LCoder 自研壳的 S1 主进程：起宿主、接链路、开窗口、注册窄 IPC。 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from './contract.ts'
import { HostSupervisor } from './host-supervisor.ts'
import { createStatePublisher, registerIpc } from './ipc.ts'
import { HostLink } from './link.ts'
import { REPO_ROOT } from './profile.ts'
import { createMainWindow } from './window.ts'

const home = process.env.DSH_HOME ?? join(REPO_ROOT, '.dsh-home')
process.env.DSH_HOME = home

let mainWindow: BrowserWindow | undefined
let supervisor: HostSupervisor | undefined
let link: HostLink | undefined
let shutdownStarted = false

const publisher = createStatePublisher(() => mainWindow)

function send(channel: string, ...args: readonly unknown[]): void {
  const target = mainWindow
  if (target === undefined || target.isDestroyed()) return
  target.webContents.send(channel, ...args)
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
  link?.close()
  link = undefined
  await supervisor?.stop()
  supervisor = undefined
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    registerIpc({
      link: () => link,
      appInfo: () => ({ version: app.getVersion(), ...(link === undefined ? {} : { hostUrl: supervisor?.readyUrl ?? '' }) }),
      window: () => mainWindow,
      hostState: () => publisher.current(),
    })
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => { mainWindow = undefined })
    mainWindow.webContents.on('did-finish-load', () => { publisher.replay() })
    await boot()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        mainWindow.webContents.on('did-finish-load', () => { publisher.replay() })
      }
    })
  }).catch((error: unknown) => {
    console.error('lcoder desktop: 启动失败', error)
    publisher.publish({ kind: 'fatal', detail: error instanceof Error ? error.message : String(error) })
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (shutdownStarted) return
    event.preventDefault()
    void shutdown().finally(() => { app.quit() })
  })
}
