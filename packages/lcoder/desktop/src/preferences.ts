/** 界面偏好的纯校验与合并：不碰磁盘与 Electron，便于单测钉住回落规则。 */

import { DESKTOP_FONTS, DESKTOP_SKINS } from './contract.ts'
import type { DesktopLocaleId, DesktopPreferences } from './contract.ts'

/** 默认偏好；字段缺失、未知或文件损坏时逐项回落到这里。 */
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  skin: 'liquid-glass',
  font: 'system',
  locale: 'zh',
  lastPickedDirectory: null,
}

/**
 * 判定任意值是界面语言标识。
 * @param value - 来自 IPC 或磁盘的值。
 * @returns value 是 `DesktopLocaleId` 时为 true。
 */
export function isDesktopLocale(value: unknown): value is DesktopLocaleId {
  return value === 'zh' || value === 'en'
}

/**
 * 判定任意值是已知皮肤。
 * @param value - 来自磁盘或 IPC 的值。
 * @returns value 是 `DesktopPreferences['skin']` 时为 true。
 */
export function isDesktopSkin(value: unknown): value is DesktopPreferences['skin'] {
  return typeof value === 'string' && DESKTOP_SKINS.some(skin => skin === value)
}

/**
 * 判定任意值是已知字体。
 * @param value - 来自磁盘或 IPC 的值。
 * @returns value 是 `DesktopPreferences['font']` 时为 true。
 */
export function isDesktopFont(value: unknown): value is DesktopPreferences['font'] {
  return typeof value === 'string' && DESKTOP_FONTS.some(font => font === value)
}

/**
 * 把任意值折成完整偏好；逐字段独立回落，未知值不污染其他字段。
 * @param value - 磁盘上的 JSON 或 IPC 载荷。
 * @returns 完整偏好。
 */
export function sanitizeDesktopPreferences(value: unknown): DesktopPreferences {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    skin: isDesktopSkin(record.skin) ? record.skin : DEFAULT_DESKTOP_PREFERENCES.skin,
    font: isDesktopFont(record.font) ? record.font : DEFAULT_DESKTOP_PREFERENCES.font,
    locale: isDesktopLocale(record.locale) ? record.locale : DEFAULT_DESKTOP_PREFERENCES.locale,
    lastPickedDirectory: typeof record.lastPickedDirectory === 'string' && record.lastPickedDirectory !== ''
      ? record.lastPickedDirectory
      : null,
  }
}

/**
 * 只接受已知字段的偏好补丁；未知值被忽略，不把当前选择改回默认。
 * @param value - `preferencesWrite` 的载荷。
 * @returns 可安全合并的补丁。
 */
export function preferencePatchOf(value: unknown): Partial<DesktopPreferences> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const patch: { -readonly [K in keyof DesktopPreferences]?: DesktopPreferences[K] } = {}
  if (isDesktopSkin(record.skin)) patch.skin = record.skin
  if (isDesktopFont(record.font)) patch.font = record.font
  if (isDesktopLocale(record.locale)) patch.locale = record.locale
  return patch
}
