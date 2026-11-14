/** 皮肤、字体与语言的本地偏好：读取、应用与持久化。 */

import { useCallback, useEffect, useState } from 'react'
import { isLocaleId, localeTag, type LocaleId } from './locale.ts'

/** 四套皮肤；第一套是新客户端默认的流体玻璃。 */
export const SKINS = ['liquid-glass', 'neon', 'silver', 'rose'] as const

/** 皮肤标识。 */
export type SkinId = (typeof SKINS)[number]

/** 两套字体。 */
export const FONTS = ['system', 'modern'] as const

/** 字体标识。 */
export type FontId = (typeof FONTS)[number]

/** 默认皮肤。 */
export const DEFAULT_SKIN: SkinId = 'liquid-glass'

/** 默认字体。 */
export const DEFAULT_FONT: FontId = 'system'

/** 本地存储键；只存标识，不存宿主侧设置。 */
export const PREFERENCE_KEYS = {
  skin: 'lcoder.skin',
  font: 'lcoder.font',
  locale: 'lcoder.locale',
  welcomeSeen: 'lcoder.welcome-seen',
} as const

/** 当前偏好。 */
export interface Preferences {
  readonly skin: SkinId
  readonly font: FontId
  readonly locale: LocaleId
}

/** 偏好需要的最小存储接口。 */
export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 判定任意值是已知皮肤。
 * @param value - 来自存储或调用的值。
 * @returns value 是 `SkinId` 时为 true。
 */
export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && SKINS.some(skin => skin === value)
}

/**
 * 判定任意值是已知字体。
 * @param value - 来自存储或调用的值。
 * @returns value 是 `FontId` 时为 true。
 */
export function isFontId(value: unknown): value is FontId {
  return typeof value === 'string' && FONTS.some(font => font === value)
}

/**
 * 取浏览器本地存储；禁用存储时返回 undefined。
 * @returns 可用存储或 undefined。
 */
export function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage
  } catch (error: unknown) {
    // 禁用本地存储的 WebView 在属性访问时抛 SecurityError；本次用默认偏好。
    void error
    return undefined
  }
}

/**
 * 读一次偏好；缺失、未知或读取失败时回默认值。
 * @param storage - 本地存储；不可用时传 undefined。
 * @returns 完整偏好。
 */
export function readPreferences(storage: PreferenceStorage | undefined): Preferences {
  const read = (key: string): string | null => {
    if (storage === undefined) return null
    try {
      return storage.getItem(key)
    } catch (error: unknown) {
      // 同 browserStorage：读取失败按缺失处理。
      void error
      return null
    }
  }
  const skin = read(PREFERENCE_KEYS.skin)
  const font = read(PREFERENCE_KEYS.font)
  const locale = read(PREFERENCE_KEYS.locale)
  return {
    skin: isSkinId(skin) ? skin : DEFAULT_SKIN,
    font: isFontId(font) ? font : DEFAULT_FONT,
    locale: isLocaleId(locale) ? locale : 'zh',
  }
}

/**
 * 保存一个偏好；存储不可用时本次切换仍然生效。
 * @param storage - 本地存储；不可用时传 undefined。
 * @param key - 偏好键。
 * @param value - 本次选择。
 */
export function writePreference(storage: PreferenceStorage | undefined, key: string, value: string): void {
  if (storage === undefined) return
  try {
    storage.setItem(key, value)
  } catch (error: unknown) {
    // 配额满或被禁用时放弃持久化；界面已经切到新值。
    void error
  }
}

/** 记录欢迎屏已看过；下次冷启动直接进登录页。 */
export function markWelcomeSeen(storage: PreferenceStorage | undefined): void {
  writePreference(storage, PREFERENCE_KEYS.welcomeSeen, '1')
}

/**
 * 读欢迎屏是否已看过。
 * @param storage - 本地存储；不可用时视为没看过。
 * @returns 看过为 true。
 */
export function welcomeSeen(storage: PreferenceStorage | undefined): boolean {
  if (storage === undefined) return false
  try {
    return storage.getItem(PREFERENCE_KEYS.welcomeSeen) === '1'
  } catch (error: unknown) {
    void error
    return false
  }
}

/**
 * 把偏好写到根元素；渲染与桌面菜单都从这里取值。
 * @param preferences - 当前偏好。
 */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement
  root.dataset.skin = preferences.skin
  root.dataset.font = preferences.font
  root.lang = localeTag(preferences.locale)
  void window.lcoder.setLocale(preferences.locale).catch(() => undefined)
}

/** 偏好读取与写入面。 */
export interface PreferencesHandle extends Preferences {
  readonly setSkin: (skin: SkinId) => void
  readonly setFont: (font: FontId) => void
  readonly setLocale: (locale: LocaleId) => void
}

/**
 * 订阅并持久化偏好；改完立即应用到根元素。
 * @returns 当前偏好与三个写入口。
 */
export function usePreferences(): PreferencesHandle {
  const [preferences, setPreferences] = useState<Preferences>(() => readPreferences(browserStorage()))

  useEffect(() => {
    applyPreferences(preferences)
  }, [preferences])

  const write = useCallback((key: string, value: string, patch: Partial<Preferences>) => {
    writePreference(browserStorage(), key, value)
    setPreferences(current => ({ ...current, ...patch }))
  }, [])

  return {
    ...preferences,
    setSkin: useCallback((skin: SkinId) => { write(PREFERENCE_KEYS.skin, skin, { skin }) }, [write]),
    setFont: useCallback((font: FontId) => { write(PREFERENCE_KEYS.font, font, { font }) }, [write]),
    setLocale: useCallback((locale: LocaleId) => { write(PREFERENCE_KEYS.locale, locale, { locale }) }, [write]),
  }
}
