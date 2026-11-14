/** 托盘：常驻的「回到窗口」与显式退出入口。 */

import { Menu, nativeImage, Tray } from 'electron'
import type { DesktopLocaleId } from './contract.ts'
import { DESKTOP_MESSAGES } from './desktop-locale.ts'

/** 托盘选项。 */
export interface TrayOptions {
  /** 随包发布的 ICO；Windows 按显示缩放挑位图。 */
  readonly iconPath: string
  readonly locale: () => DesktopLocaleId
  readonly open: () => void
  readonly quit: () => void
}

/** 托盘图标在进程存活期间一直存在，不只在线隐藏时。 */
export class DesktopTray {
  private tray: Tray | undefined

  /** @param options - 图标、语言读取器与打开/退出动作。 */
  constructor(private readonly options: TrayOptions) {
    this.tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray.on('click', () => { options.open() })
    this.relabel()
  }

  /** 按当前语言重建提示与菜单。 */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const messages = DESKTOP_MESSAGES[this.options.locale()]
    tray.setToolTip(messages.appName)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: messages.openApplication, click: () => { this.options.open() } },
      { type: 'separator' },
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]))
  }

  /** 退出确认后移除图标，避免残留死图标。 */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
