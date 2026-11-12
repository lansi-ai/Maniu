/**
 * 皮肤偏好的读取、校验与持久化。
 *
 * 存储用内存替身；这里只断言默认值、未知值回退、写后可读回，以及存储抛错时
 * 不把异常带到整壳渲染。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SKIN, isSkin, readSkin, SKIN_STORAGE_KEY, writeSkin,
} from '../src/client/shell/skin.ts'
import type { SkinStorage } from '../src/client/shell/skin.ts'

/** 内存存储替身；可指定读取时抛错。 */
function memoryStorage(initial?: string, throws = false): SkinStorage {
  let value = initial ?? null
  return {
    getItem(key: string): string | null {
      if (throws) throw new Error(`storage unavailable: ${key}`)
      return key === SKIN_STORAGE_KEY ? value : null
    },
    setItem(key: string, next: string): void {
      if (throws) throw new Error(`storage unavailable: ${key}`)
      if (key === SKIN_STORAGE_KEY) value = next
    },
  }
}

describe('皮肤偏好', () => {
  it('没有保存值时默认霓虹夜航', () => {
    expect(DEFAULT_SKIN).toBe('neon')
    expect(readSkin(undefined)).toBe('neon')
    expect(readSkin(memoryStorage())).toBe('neon')
  })

  it('只认三套已知皮肤，未知值回默认', () => {
    expect(isSkin('neon')).toBe(true)
    expect(isSkin('silver')).toBe(true)
    expect(isSkin('rose')).toBe(true)
    expect(isSkin('light')).toBe(false)
    expect(readSkin(memoryStorage('light'))).toBe('neon')
  })

  it('写入后重新读取能拿回同一套皮肤，等同刷新恢复', () => {
    const storage = memoryStorage()
    for (const skin of ['silver', 'rose', 'neon'] as const) {
      writeSkin(storage, skin)
      expect(readSkin(storage)).toBe(skin)
    }
  })

  it('存储不可用时读取回默认、写入不抛错', () => {
    const storage = memoryStorage('silver', true)
    expect(readSkin(storage)).toBe('neon')
    expect(() => { writeSkin(storage, 'silver') }).not.toThrow()
  })
})
