/** 应用菜单：本地化标签与标准快捷键；不依赖上游窗口实现。 */

import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { DesktopLocaleId } from './contract.ts'
import { DESKTOP_MESSAGES, fillDesktop } from './desktop-locale.ts'

/** 菜单安装依赖。 */
export interface MenuOptions {
  readonly locale: () => DesktopLocaleId
  readonly window: () => BrowserWindow | undefined
  readonly quit: () => void
}

function focus(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * 装一份本地化应用菜单；语言切换时重建。
 * @param options - 当前语言、主窗口读取器与退出动作。
 */
export function installMenu(options: MenuOptions): void {
  const messages = DESKTOP_MESSAGES[options.locale()]
  const template: MenuItemConstructorOptions[] = [
    {
      label: messages.appName,
      submenu: [
        { label: messages.openApplication, click: () => { focus(options.window()) } },
        {
          label: messages.checkForUpdates,
          click: () => {
            const target = options.window()
            if (target === undefined || target.isDestroyed()) return
            void dialog.showMessageBox(target, {
              type: 'info',
              title: messages.checkForUpdates,
              message: messages.updateUnavailable,
            })
          },
        },
        { type: 'separator' },
        { label: messages.quitApplication, accelerator: 'CmdOrCtrl+Q', click: () => { options.quit() } },
      ],
    },
    {
      label: messages.edit,
      submenu: [
        { label: messages.undo, role: 'undo' },
        { label: messages.redo, role: 'redo' },
        { type: 'separator' },
        { label: messages.cut, role: 'cut' },
        { label: messages.copy, role: 'copy' },
        { label: messages.paste, role: 'paste' },
        { label: messages.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: messages.view,
      submenu: [
        { label: messages.reload, role: 'reload' },
        { label: messages.toggleDevTools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: messages.resetZoom, role: 'resetZoom' },
        { label: messages.zoomIn, role: 'zoomIn' },
        { label: messages.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: messages.toggleFullScreen, role: 'togglefullscreen', accelerator: 'F11' },
      ],
    },
    {
      label: messages.window,
      submenu: [
        { label: messages.minimize, role: 'minimize' },
        { label: messages.close, role: 'close' },
      ],
    },
    {
      label: messages.help,
      submenu: [
        {
          label: messages.about,
          click: () => {
            const target = options.window()
            if (target === undefined || target.isDestroyed()) return
            void dialog.showMessageBox(target, {
              type: 'info',
              title: messages.about,
              message: messages.about,
              detail: fillDesktop(messages.aboutDetail, { version: app.getVersion() }),
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
