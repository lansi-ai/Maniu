/**
 * 主窗口初始尺寸：首选 1440×900，小屏按工作区收敛，最小尺寸与 `createWindow` 一致。
 */
import { describe, expect, it } from 'vitest'
import { primaryWindowSize } from '../src/window-size.ts'

describe('primaryWindowSize', () => {
  it('大屏上使用首选尺寸', () => {
    expect(primaryWindowSize({ width: 1920, height: 1080 })).toEqual({ width: 1440, height: 900 })
    expect(primaryWindowSize({ width: 2560, height: 1440 })).toEqual({ width: 1440, height: 900 })
  })

  it('工作区放不下首选尺寸时收敛到工作区减去边距', () => {
    expect(primaryWindowSize({ width: 1280, height: 720 })).toEqual({ width: 1232, height: 672 })
    expect(primaryWindowSize({ width: 1366, height: 768 })).toEqual({ width: 1318, height: 720 })
  })

  it('工作区连最小尺寸都放不下时仍返回最小尺寸', () => {
    expect(primaryWindowSize({ width: 400, height: 500 })).toEqual({ width: 520, height: 600 })
  })
})
