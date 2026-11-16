/** 主窗口：frameless、默认 1280×800、只加载本地渲染产物。 */

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './profile.ts'

/**
 * 应用图标：发布态取 extraResources 里的 app.ico，开发态取本包 resources。
 * @returns 多尺寸 ICO 的绝对路径。
 */
export function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(import.meta.dirname, '..', '..', 'resources', 'maniu-windows.ico')
}

/** 渲染产物入口：开发态取本仓 client 包的 dist，发布态取安装包内的 client-dist。 */
export function clientIndex(): string {
  const override = process.env.LCODER_CLIENT_DIST
  if (override !== undefined && override !== '') return override
  return app.isPackaged
    ? join(process.resourcesPath, 'client-dist', 'index.html')
    : join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html')
}

/** 创建唯一的 S1 主窗口。 */
export function createMainWindow(): BrowserWindow {
  const preload = join(import.meta.dirname, '..', 'preload.cjs')
  const index = clientIndex()
  if (!existsSync(index)) throw new Error(`lcoder desktop: 找不到渲染产物 ${index}`)
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // 无边框窗口在 Windows 上仍带不可见缩放边，按内容区算才能让渲染端正好 1280×800。
    useContentSize: true,
    minWidth: 900,
    minHeight: 640,
    resizable: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fc',
    title: 'Maniu',
    icon: appIconPath(),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 窗口被遮挡或失焦时继续按真实帧率渲染，流式观察与 CDP 采样才不会被节流降频。
      backgroundThrottling: false,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  void window.loadFile(index)
  return window
}
