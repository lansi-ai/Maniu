/** 偏好的回落与合并：坏字段只坏自己，未知补丁不覆盖当前选择。 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_PREFERENCES, isDesktopFont, isDesktopLocale, isDesktopSkin, preferencePatchOf,
  sanitizeDesktopPreferences,
} from '../src/preferences.ts'

describe('sanitizeDesktopPreferences', () => {
  it('完整合法值原样保留', () => {
    expect(sanitizeDesktopPreferences({ skin: 'rose', font: 'modern', locale: 'en' }))
      .toEqual({ skin: 'rose', font: 'modern', locale: 'en' })
  })

  it('旧文件只有 locale 时，其余字段回默认', () => {
    expect(sanitizeDesktopPreferences({ locale: 'en' }))
      .toEqual({ skin: DEFAULT_DESKTOP_PREFERENCES.skin, font: DEFAULT_DESKTOP_PREFERENCES.font, locale: 'en' })
  })

  it('坏字段只回落自己，不污染其他字段', () => {
    expect(sanitizeDesktopPreferences({ skin: 'bogus', font: 'modern', locale: 'en' }))
      .toEqual({ skin: 'liquid-glass', font: 'modern', locale: 'en' })
    expect(sanitizeDesktopPreferences(null)).toEqual(DEFAULT_DESKTOP_PREFERENCES)
    expect(sanitizeDesktopPreferences('nope')).toEqual(DEFAULT_DESKTOP_PREFERENCES)
  })
})

describe('preferencePatchOf', () => {
  it('只接受已知字段', () => {
    expect(preferencePatchOf({ skin: 'neon', font: 'modern', locale: 'en' }))
      .toEqual({ skin: 'neon', font: 'modern', locale: 'en' })
    expect(preferencePatchOf({ skin: 'bogus', font: 'modern' })).toEqual({ font: 'modern' })
    expect(preferencePatchOf({ extra: 'x' })).toEqual({})
    expect(preferencePatchOf(undefined)).toEqual({})
  })
})

describe('validators', () => {
  it('只认已知字面量', () => {
    expect(isDesktopSkin('silver')).toBe(true)
    expect(isDesktopSkin('frost')).toBe(false)
    expect(isDesktopFont('system')).toBe(true)
    expect(isDesktopFont('mono')).toBe(false)
    expect(isDesktopLocale('en')).toBe(true)
    expect(isDesktopLocale('ja')).toBe(false)
  })
})
