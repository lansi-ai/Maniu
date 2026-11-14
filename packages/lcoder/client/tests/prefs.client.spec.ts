/** 偏好回落：主进程下发值坏一项时，只回落那一项。 */
import { describe, expect, it } from 'vitest'
import { preferencesOf, readPreferences, type PreferenceStorage } from '../src/prefs.ts'

const fallback = { skin: 'rose', font: 'modern', locale: 'en' } as const

describe('preferencesOf', () => {
  it('主进程值合法时原样采用', () => {
    expect(preferencesOf({ skin: 'neon', font: 'system', locale: 'zh' }, fallback))
      .toEqual({ skin: 'neon', font: 'system', locale: 'zh' })
  })

  it('坏字段回落到缓存值', () => {
    expect(preferencesOf({ skin: 'bogus', font: 'system', locale: 'zh' }, fallback))
      .toEqual({ skin: 'rose', font: 'system', locale: 'zh' })
    expect(preferencesOf(undefined, fallback)).toEqual(fallback)
    expect(preferencesOf([], fallback)).toEqual(fallback)
  })
})

describe('readPreferences', () => {
  function storageOf(entries: Readonly<Record<string, string>>): PreferenceStorage {
    return {
      getItem: key => entries[key] ?? null,
      setItem: () => undefined,
    }
  }

  it('缺省与未知值回默认', () => {
    expect(readPreferences(undefined)).toEqual({ skin: 'liquid-glass', font: 'system', locale: 'zh' })
    expect(readPreferences(storageOf({ 'lcoder.skin': 'bogus', 'lcoder.font': 'modern', 'lcoder.locale': 'en' })))
      .toEqual({ skin: 'liquid-glass', font: 'modern', locale: 'en' })
  })
})
