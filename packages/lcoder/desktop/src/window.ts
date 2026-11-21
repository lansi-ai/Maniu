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

/** 独立预览窗口标题；带上沙箱字样，避免被当成主窗内容。 */
export const PROTOTYPE_PREVIEW_TITLE = '原型预览（沙箱）'

/** 预览 HTML 的字节上限，与原型落盘上限一致。 */
export const MAX_PROTOTYPE_PREVIEW_BYTES = 512 * 1024

/**
 * 预览窗口允许加载的 URL：只放行内联 data、本地 file 与 about 地址。
 * 任何 http(s)、ws(s) 等外部网络地址都被拦截，原型无法访问网络。
 * @param url - `webRequest.onBeforeRequest` 捕获到的请求地址。
 * @returns 允许加载时为 true。
 */
export function isAllowedPrototypePreviewUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('file:') || url.startsWith('about:')
}

/**
 * 把原型 HTML 折成预览窗口的内联 data URL；不套主窗 CSP，内联脚本与 CSS 可运行。
 * @param html - 单文件原型 HTML。
 * @returns 可直接交给 BrowserWindow.loadURL 的地址。
 */
export function prototypePreviewDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * 创建独立、离线、无业务 IPC 的原型交互预览窗口。
 *
 * 它使用专用 preload（只暴露元素上报）、独立内存 session（离线拦截不污染主窗
 * 默认 session），不加载主窗 index.html，也不带主窗 CSP，因此原型自己的内联
 * 脚本与 CSS 可以运行。窗口本身不接主窗的关窗确认/退出逻辑。
 * @param html - 已读出的单文件原型 HTML。
 * @returns 预览窗口。
 */
export function createPrototypePreviewWindow(html: string): BrowserWindow {
  const preload = join(import.meta.dirname, '..', 'prototype-preview-preload.cjs')
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: PROTOTYPE_PREVIEW_TITLE,
    webPreferences: {
      preload,
      // 独立 partition：离线拦截只作用在本窗口，不影响主窗默认 session。
      partition: 'lcoder-prototype-preview',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => { callback({ cancel: !isAllowedPrototypePreviewUrl(details.url) }) },
  )
  void window.loadURL(prototypePreviewDataUrl(html))
  return window
}
