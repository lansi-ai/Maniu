/** 主窗口：frameless、最小 520×600、只加载本地渲染产物。 */

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './profile.ts'

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
    width: 1080,
    height: 760,
    minWidth: 520,
    minHeight: 600,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fc',
    title: 'LCoder',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  void window.loadFile(index)
  return window
}
