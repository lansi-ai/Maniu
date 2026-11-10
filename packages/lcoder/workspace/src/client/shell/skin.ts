/**
 * 外壳皮肤选择与本地持久化。
 *
 * 两套皮肤只决定 `Shell.module.css` 里的颜色与表面 token；这里只负责选择值与
 * 刷新后的恢复。读不到或读到未知值时回默认皮肤，不阻塞整壳渲染。
 */

/** 可用皮肤。 */
export const SKINS = ['neon', 'silver'] as const

/** 皮肤标识；`neon` 是霓虹夜航，`silver` 是冷银冰蓝。 */
export type Skin = (typeof SKINS)[number]

/** 默认皮肤：霓虹夜航。 */
export const DEFAULT_SKIN: Skin = 'neon'

/** 本地存储键；只存皮肤标识。 */
export const SKIN_STORAGE_KEY = 'lcoder.skin'

/** 皮肤偏好需要的最小存储接口；测试注入内存实现。 */
export interface SkinStorage {
  /** 读取上次保存的皮肤标识。 */
  getItem(key: string): string | null
  /** 保存本次皮肤标识。 */
  setItem(key: string, value: string): void
}

/**
 * 判定任意值是否是已知皮肤。
 * @param value - 来自本地存储或调用方的值。
 * @returns value 是 `Skin` 时为 true。
 */
export function isSkin(value: unknown): value is Skin {
  return typeof value === 'string' && SKINS.some(skin => skin === value)
}

/**
 * 读取上次选择的皮肤。
 * @param storage - 浏览器本地存储；不可用时传 undefined。
 * @returns 保存的皮肤；缺失、未知或读取失败时返回默认皮肤。
 */
export function readSkin(storage: SkinStorage | undefined): Skin {
  if (storage === undefined) return DEFAULT_SKIN
  let saved: string | null
  try {
    saved = storage.getItem(SKIN_STORAGE_KEY)
  } catch (error) {
    // 隐私模式或磁盘异常会让读取抛错；回默认皮肤，不阻塞整壳渲染。
    void error
    return DEFAULT_SKIN
  }
  return isSkin(saved) ? saved : DEFAULT_SKIN
}

/**
 * 保存皮肤选择；存储不可用时本次切换仍然生效。
 * @param storage - 浏览器本地存储；不可用时传 undefined。
 * @param skin - 本次选择的皮肤。
 */
export function writeSkin(storage: SkinStorage | undefined, skin: Skin): void {
  if (storage === undefined) return
  try {
    storage.setItem(SKIN_STORAGE_KEY, skin)
  } catch (error) {
    // 配额满或被禁用时放弃持久化；界面已经切到新皮肤。
    void error
  }
}

/**
 * 取浏览器本地存储；禁用存储的 WebView 会在属性访问时抛错。
 * @returns 可用的存储，或 undefined。
 */
export function browserSkinStorage(): SkinStorage | undefined {
  try {
    return globalThis.localStorage
  } catch (error) {
    // 禁用 Cookie/本地存储的 WebView 访问 localStorage 会抛 SecurityError。
    void error
    return undefined
  }
}
