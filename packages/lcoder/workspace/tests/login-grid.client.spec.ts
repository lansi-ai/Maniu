/**
 * 登录页背景底纹的纯几何：高斯权重、透视外扩与抬升、亮度混合、网格相位、梅花姿态与颜色解析。
 *
 * 只测不碰 DOM 的函数；画布绘制与帧调度由真窗口冒烟覆盖。
 */
import { describe, expect, it } from 'vitest'

import {
  blossomPose, clamp01, gridInfluence, gridOffsets, lineAlpha, parseCssColor, PLUM_PETALS, plumPetals,
  readMotif, rgba, warpVertex,
} from '../src/client/cloud/login-grid.ts'
import type { GridWarpSpec } from '../src/client/cloud/login-grid.ts'

const SPEC: GridWarpSpec = { sigma: 100, perspective: 0.1, lift: 20 }

describe('高斯影响', () => {
  it('指针处权重为 1，随距离单调下降，三倍标准差外近似为零', () => {
    expect(gridInfluence(0, 0, 100)).toBe(1)
    const near = gridInfluence(50, 0, 100)
    const far = gridInfluence(150, 0, 100)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeLessThan(0.35)
    expect(gridInfluence(300, 0, 100)).toBeLessThan(0.02)
  })

  it('标准差非正数时没有影响', () => {
    expect(gridInfluence(10, 10, 0)).toBe(0)
    expect(gridInfluence(10, 10, -5)).toBe(0)
  })
})

describe('顶点位移', () => {
  it('指针处只抬升，不横向移动', () => {
    const vertex = warpVertex(120, 80, 120, 80, SPEC, 1)
    expect(vertex.x).toBeCloseTo(120)
    expect(vertex.y).toBeCloseTo(60)
    expect(vertex.glow).toBeCloseTo(1)
  })

  it('周边顶点向指针外侧放大，并随影响抬升', () => {
    const right = warpVertex(220, 80, 120, 80, SPEC, 1)
    const reference = gridInfluence(100, 0, 100)
    expect(right.x).toBeGreaterThan(220)
    expect(right.x).toBeCloseTo(120 + 100 * (1 + reference * SPEC.perspective))
    expect(right.y).toBeLessThan(80)
    expect(right.glow).toBeCloseTo(reference)
  })

  it('强度为零、指针缺省或距离极远时原样返回', () => {
    expect(warpVertex(5, 6, 0, 0, SPEC, 0)).toEqual({ x: 5, y: 6, glow: 0 })
    expect(warpVertex(5, 6, null, 6, SPEC, 1)).toEqual({ x: 5, y: 6, glow: 0 })
    expect(warpVertex(5, 6, 5000, 5000, SPEC, 1)).toEqual({ x: 5, y: 6, glow: 0 })
  })

  it('强度单调缩放位移与亮度，回弹路径可复现', () => {
    const full = warpVertex(200, 80, 120, 80, SPEC, 1)
    const half = warpVertex(200, 80, 120, 80, SPEC, 0.5)
    expect(half.glow).toBeCloseTo(full.glow / 2)
    expect(half.x).toBeLessThan(full.x)
    expect(half.y).toBeGreaterThan(full.y)
  })
})

describe('亮度与网格相位', () => {
  it('底色到峰值线性混合并夹紧', () => {
    expect(lineAlpha(0.1, 0.5, 0)).toBeCloseTo(0.1)
    expect(lineAlpha(0.1, 0.5, 1)).toBeCloseTo(0.5)
    expect(lineAlpha(0.1, 0.5, 0.5)).toBeCloseTo(0.3)
    expect(lineAlpha(0.1, 0.5, 2)).toBeCloseTo(0.5)
    expect(lineAlpha(0.1, 0.5, -1)).toBeCloseTo(0.1)
  })

  it('间距从 0 起、覆盖整段并各留一条在外侧', () => {
    const offsets = gridOffsets(100, 32)
    expect(offsets[0]).toBe(-32)
    expect(offsets[1]).toBe(0)
    expect(offsets).toContain(96)
    expect(offsets.at(-1)).toBe(128)
  })

  it('相位偏移落在 0–间距之内，非法参数返回空', () => {
    expect(gridOffsets(64, 32, 40)).toEqual([-24, 8, 40, 72])
    expect(gridOffsets(0, 32)).toEqual([])
    expect(gridOffsets(100, 0)).toEqual([])
    expect(gridOffsets(Number.NaN, 32)).toEqual([])
  })

  it('clamp01 夹紧并吞掉非有限值', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(9)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('底纹类型与梅花', () => {
  it('只认 plum，其余值一律回网格', () => {
    expect(readMotif('plum')).toBe('plum')
    expect(readMotif(' plum ')).toBe('plum')
    expect(readMotif('grid')).toBe('grid')
    expect(readMotif('')).toBe('grid')
    expect(readMotif('PLUM')).toBe('grid')
  })

  it('同一节点姿态稳定，相邻节点错开', () => {
    const first = blossomPose(3, 4)
    expect(blossomPose(3, 4)).toEqual(first)
    expect(blossomPose(4, 4)).not.toEqual(first)
    expect(blossomPose(3, 5)).not.toEqual(first)
  })

  it('偏移不超过半格、缩放落在 0.7–1、旋转覆盖整周', () => {
    const angles: number[] = []
    for (let column = 0; column < 40; column++) {
      for (let row = 0; row < 40; row++) {
        const pose = blossomPose(column, row)
        expect(Math.abs(pose.dx)).toBeLessThanOrEqual(0.25)
        expect(Math.abs(pose.dy)).toBeLessThanOrEqual(0.25)
        expect(pose.scale).toBeGreaterThanOrEqual(0.7)
        expect(pose.scale).toBeLessThanOrEqual(1)
        expect(pose.angle).toBeGreaterThanOrEqual(0)
        expect(pose.angle).toBeLessThan(Math.PI * 2)
        angles.push(pose.angle)
      }
    }
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI)
  })

  it('五瓣等角分布、长轴沿径向、整体绕中心对称', () => {
    const petals = plumPetals(10, 0)
    expect(petals).toHaveLength(PLUM_PETALS)
    const sumX = petals.reduce((total, petal) => total + petal.x, 0)
    const sumY = petals.reduce((total, petal) => total + petal.y, 0)
    expect(sumX).toBeCloseTo(0)
    expect(sumY).toBeCloseTo(0)
    const first = petals[0]
    expect(first?.x).toBeCloseTo(10)
    expect(first?.y).toBeCloseTo(0)
    expect(first?.rx).toBeCloseTo(4.4)
    expect(first?.ry).toBeCloseTo(9.2)
    expect(first?.rotation).toBeCloseTo(-Math.PI / 2)
    for (const petal of petals) {
      expect(Math.hypot(petal.x, petal.y)).toBeCloseTo(10)
    }
  })

  it('整朵旋转同样旋转全部花瓣', () => {
    const upright = plumPetals(8, 0)
    const turned = plumPetals(8, Math.PI / 2)
    expect(turned[0]?.x).toBeCloseTo(0)
    expect(turned[0]?.y).toBeCloseTo(8)
    expect(turned[0]?.rotation).toBeCloseTo(0)
    expect(Math.hypot(turned[2]?.x ?? 0, turned[2]?.y ?? 0)).toBeCloseTo(8)
    expect(upright[0]?.rx).toBeCloseTo(turned[0]?.rx ?? Number.NaN)
  })
})

describe('CSS 颜色解析', () => {
  it('十六进制三种长度都认', () => {
    expect(parseCssColor('#22d3ee')).toEqual({ r: 34, g: 211, b: 238, alpha: 1 })
    expect(parseCssColor('#0af')).toEqual({ r: 0, g: 170, b: 255, alpha: 1 })
    expect(parseCssColor('#7dd3fc80')).toEqual({ r: 125, g: 211, b: 252, alpha: 128 / 255 })
  })

  it('rgba 与空格写法、百分比都认', () => {
    expect(parseCssColor('rgba(34, 211, 238, 0.07)')).toEqual({ r: 34, g: 211, b: 238, alpha: 0.07 })
    expect(parseCssColor('rgb(125 211 252 / 30%)')).toEqual({ r: 125, g: 211, b: 252, alpha: 0.3 })
    expect(parseCssColor('rgb(100% 50% 0%)')).toEqual({ r: 255, g: 127.5, b: 0, alpha: 1 })
  })

  it('透明与无法识别的值分别返回零透明和 null', () => {
    expect(parseCssColor(' transparent ')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 })
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor('var(--lc-line)')).toBeNull()
    expect(parseCssColor('#12345')).toBeNull()
    expect(parseCssColor('rgb(1, 2)')).toBeNull()
  })

  it('rgba 输出取整并夹紧透明度', () => {
    expect(rgba({ r: 34.4, g: 300, b: -1, alpha: 0.1 }, 2)).toBe('rgba(34, 255, 0, 1)')
    expect(rgba({ r: 0, g: 0, b: 0, alpha: 1 }, Number.NaN)).toBe('rgba(0, 0, 0, 0)')
  })
})
