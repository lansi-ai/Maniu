/** 主进程菜单与托盘的词典，以及界面语言的本地持久化。 */

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DesktopLocaleId } from './contract.ts'

/** 主进程需要本地化的一处文案。 */
export interface DesktopMessages {
  readonly appName: string
  readonly openApplication: string
  readonly quitApplication: string
  readonly edit: string
  readonly undo: string
  readonly redo: string
  readonly cut: string
  readonly copy: string
  readonly paste: string
  readonly selectAll: string
  readonly view: string
  readonly reload: string
  readonly toggleDevTools: string
  readonly resetZoom: string
  readonly zoomIn: string
  readonly zoomOut: string
  readonly toggleFullScreen: string
  readonly window: string
  readonly minimize: string
  readonly close: string
  readonly help: string
  readonly checkForUpdates: string
  readonly about: string
  readonly aboutDetail: string
  readonly updateUnavailable: string
}

/** 两种界面语言的主进程词典。 */
export const DESKTOP_MESSAGES: Readonly<Record<DesktopLocaleId, DesktopMessages>> = {
  zh: {
    appName: 'LCoder',
    openApplication: '打开 LCoder',
    quitApplication: '退出 LCoder',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    reload: '重新加载',
    toggleDevTools: '开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    toggleFullScreen: '全屏',
    window: '窗口',
    minimize: '最小化',
    close: '关闭窗口',
    help: '帮助',
    checkForUpdates: '检查更新',
    about: '关于 LCoder',
    aboutDetail: '版本 {version}',
    updateUnavailable: '当前构建没有配置更新源，无法检查更新。',
  },
  en: {
    appName: 'LCoder',
    openApplication: 'Open LCoder',
    quitApplication: 'Quit LCoder',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    view: 'View',
    reload: 'Reload',
    toggleDevTools: 'Developer tools',
    resetZoom: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    toggleFullScreen: 'Toggle full screen',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close window',
    help: 'Help',
    checkForUpdates: 'Check for updates',
    about: 'About LCoder',
    aboutDetail: 'Version {version}',
    updateUnavailable: 'This build has no update feed configured, so updates cannot be checked.',
  },
}

/**
 * 判定任意值是界面语言标识。
 * @param value - 来自 IPC 或磁盘的值。
 * @returns value 是 `DesktopLocaleId` 时为 true。
 */
export function isDesktopLocale(value: unknown): value is DesktopLocaleId {
  return value === 'zh' || value === 'en'
}

/** 偏好文件路径；放在 userData 下，跨安装更新保留。 */
function preferenceFile(): string {
  return join(app.getPath('userData'), 'lcoder-preferences.json')
}

/**
 * 读最近一次保存的界面语言。
 * @returns 保存值；缺失、损坏或未知时为中文。
 */
export function readDesktopLocale(): DesktopLocaleId {
  try {
    const parsed: unknown = JSON.parse(readFileSync(preferenceFile(), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'locale' in parsed && isDesktopLocale(parsed.locale)) {
      return parsed.locale
    }
  } catch (error: unknown) {
    // 首次启动没有偏好文件，或文件被外部改坏；用默认语言继续启动。
    void error
  }
  return 'zh'
}

/**
 * 保存界面语言；写盘失败不回滚已生效的菜单。
 * @param locale - 本次选择的界面语言。
 */
export function writeDesktopLocale(locale: DesktopLocaleId): void {
  try {
    const file = preferenceFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ locale }, null, 2)}\n`)
  } catch (error: unknown) {
    // 磁盘或权限异常；本次菜单仍按新语言渲染，下次启动回到上次成功写入的值。
    void error
  }
}

/**
 * 补一条模板占位符。
 * @param text - 词典文案。
 * @param values - 占位符值。
 * @returns 替换后的一句话。
 */
export function fillDesktop(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text)
}
