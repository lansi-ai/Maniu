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
 * 把偏好写到根元素；只改 DOM，不触发持久化。
 * @param preferences - 当前偏好。
 */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement
  root.dataset.skin = preferences.skin
  root.dataset.font = preferences.font
  root.lang = localeTag(preferences.locale)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把主进程下发的值折成偏好；坏字段逐项回落到本地缓存或默认值。
 * @param value - `readPreferences` 的返回值。
 * @param fallback - 读不到或字段非法时的回落值。
 * @returns 完整偏好。
 */
export function preferencesOf(value: unknown, fallback: Preferences): Preferences {
  if (!isRecord(value)) return fallback
  return {
    skin: isSkinId(value.skin) ? value.skin : fallback.skin,
    font: isFontId(value.font) ? value.font : fallback.font,
    locale: isLocaleId(value.locale) ? value.locale : fallback.locale,
  }
}

/** 写进 localStorage 的缓存；主进程仍是权威值。 */
function cachePreferences(preferences: Preferences): void {
  const storage = browserStorage()
  writePreference(storage, PREFERENCE_KEYS.skin, preferences.skin)
  writePreference(storage, PREFERENCE_KEYS.font, preferences.font)
  writePreference(storage, PREFERENCE_KEYS.locale, preferences.locale)
}

let primed: Preferences | undefined

/** 已就绪的偏好：启动时先取主进程，取不到再退回 localStorage 缓存。 */
function initialPreferences(): Preferences {
  return primed ?? readPreferences(browserStorage())
}

/**
 * 启动时从主进程取一次偏好，并把结果写进本地缓存。
 *
 * 读取有 2 秒上限：IPC 不可用时不能让首屏一直空着，直接用缓存渲染。
 * @returns 主进程的偏好；失败时是本地缓存。
 */
export async function hydratePreferences(): Promise<Preferences> {
  const fallback = readPreferences(browserStorage())
  const fetched = await Promise.race([
    window.lcoder.readPreferences().catch(() => undefined),
    new Promise<undefined>(resolve => setTimeout(() => { resolve(undefined) }, 2_000)),
  ])
  const preferences = fetched === undefined ? fallback : preferencesOf(fetched, fallback)
  cachePreferences(preferences)
  primed = preferences
  return preferences
}

/** 一项偏好：本地缓存 + 主进程落盘。 */
function persistPreference(patch: Partial<Preferences>, key: string, value: string): void {
  writePreference(browserStorage(), key, value)
  void window.lcoder.writePreferences(patch).catch(() => undefined)
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
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences)

  useEffect(() => {
    applyPreferences(preferences)
  }, [preferences])

  const write = useCallback((key: string, value: string, patch: Partial<Preferences>) => {
    persistPreference(patch, key, value)
    setPreferences(current => ({ ...current, ...patch }))
  }, [])

  return {
    ...preferences,
    setSkin: useCallback((skin: SkinId) => { write(PREFERENCE_KEYS.skin, skin, { skin }) }, [write]),
    setFont: useCallback((font: FontId) => { write(PREFERENCE_KEYS.font, font, { font }) }, [write]),
    setLocale: useCallback((locale: LocaleId) => { write(PREFERENCE_KEYS.locale, locale, { locale }) }, [write]),
  }
}
