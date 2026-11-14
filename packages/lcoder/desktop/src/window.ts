/** 主窗口：frameless、最小 520×600、只加载本地渲染产物。 */

import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './profile.ts'

/** 渲染产物入口：默认取本仓 client 包的 dist。 */
export function clientIndex(): string {
  return process.env.LCODER_CLIENT_DIST ?? join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html')
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
    backgroundColor: '#0f1115',
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
