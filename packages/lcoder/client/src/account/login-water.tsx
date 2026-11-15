/** 登录页水流底：自绘光流与水波，不用位图；减少动态效果时只画一帧。 */

import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

/** 光流条数。 */
const STRANDS = 11
/** 采样步长（CSS 像素）。 */
const SEGMENT = 26
/** 基础相位周期，秒。 */
const CYCLE = 26
/** 缓冲区像素比封顶。 */
const MAX_DPR = 2

/** 一帧要用的皮肤取色。 */
interface Palette {
  readonly accent: string
  readonly brand2: string
  readonly teal: string
  readonly violet: string
}

/** 从画布计算样式读皮肤色；缺 token 时回落到强调色。 */
function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const accent = style.getPropertyValue('--lg-accent').trim() || '#0a5fe0'
  return {
    accent,
    brand2: style.getPropertyValue('--lg-brand-2').trim() || accent,
    teal: style.getPropertyValue('--lg-ambient-teal').trim() || accent,
    violet: style.getPropertyValue('--lg-ambient-violet').trim() || accent,
  }
}

/** 按 DPR 上限同步缓冲区并清屏。 */
function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  const width = Math.max(1, Math.round(rect.width * dpr))
  const height = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  return { ctx, width: rect.width, height: rect.height }
}

/**
 * 画一帧：三团缓慢游移的光池加十一条正弦光流，叠加混合出水波与折射感。
 * 指针位置让光池与光流轻微偏移，形成随鼠标的折射错觉。
 * @param time - 毫秒时间戳；减动效时固定为 0。
 * @param pointerX - 归一化指针横坐标（-0.5～0.5）。
 * @param pointerY - 归一化指针纵坐标（-0.5～0.5）。
 */
function paint(canvas: HTMLCanvasElement, time: number, pointerX = 0, pointerY = 0): void {
  const surface = prepare(canvas)
  if (surface === null) return
  const { ctx, width, height } = surface
  const palette = readPalette(canvas)
  const seconds = (time % (CYCLE * 1000)) / 1000
  const phase = (seconds / CYCLE) * Math.PI * 2

  ctx.globalCompositeOperation = 'lighter'
  const pools = [
    { color: palette.accent, x: 0.24 + Math.sin(phase) * 0.1, y: 0.3 + Math.cos(phase * 0.8) * 0.12, r: 0.62 },
    { color: palette.violet, x: 0.72 + Math.cos(phase * 0.7) * 0.1, y: 0.24 + Math.sin(phase * 0.9) * 0.1, r: 0.55 },
    { color: palette.teal, x: 0.52 + Math.sin(phase * 1.3 + 1.7) * 0.16, y: 0.78 + Math.cos(phase * 0.6) * 0.1, r: 0.6 },
  ]
  for (const pool of pools) {
    const radius = Math.max(width, height) * pool.r
    const centreX = (pool.x + pointerX * 0.1) * width
    const centreY = (pool.y + pointerY * 0.1) * height
    const gradient = ctx.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius)
    gradient.addColorStop(0, pool.color)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.globalAlpha = 0.16
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  ctx.lineCap = 'round'
  for (let index = 0; index < STRANDS; index++) {
    const lane = (index + 0.5) / STRANDS
    const amplitude = height * (0.03 + (index % 4) * 0.012)
    const drift = phase * (0.7 + (index % 3) * 0.35) + index * 1.7 + pointerX * 1.6
    const lift = pointerY * height * 0.035
    ctx.beginPath()
    for (let x = -SEGMENT; x <= width + SEGMENT; x += SEGMENT) {
      const u = x / Math.max(1, width)
      const y = height * (0.18 + lane * 0.64) + lift
        + Math.sin(u * 5.2 + drift) * amplitude
        + Math.sin(u * 2.1 - drift * 0.7 + index) * amplitude * 0.6
      if (x <= -SEGMENT + 1) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.globalAlpha = index % 2 === 0 ? 0.1 : 0.07
    ctx.strokeStyle = index % 3 === 0 ? palette.brand2 : palette.accent
    ctx.lineWidth = index % 4 === 0 ? 1.8 : 1.1
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * 登录页水流背景画布。
 * @returns 铺满主区、不接指针事件的 canvas。
 */
export function LoginWater(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const reducedQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    let reduced = reducedQuery?.matches ?? false
    let frame = 0

    const stop = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    }
    /** 读主区上的指针变量；登录页没挂指针跟随或减动效时就是 0。 */
    const pointer = (): [number, number] => {
      const root = canvas.closest('.login-screen')
      if (!(root instanceof HTMLElement)) return [0, 0]
      const x = Number.parseFloat(root.style.getPropertyValue('--login-px'))
      const y = Number.parseFloat(root.style.getPropertyValue('--login-py'))
      return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0]
    }
    const tick = (now: number): void => {
      const [x, y] = pointer()
      paint(canvas, now, x, y)
      frame = requestAnimationFrame(tick)
    }
    const start = (): void => {
      stop()
      if (reduced || document.hidden || typeof requestAnimationFrame !== 'function') {
        paint(canvas, 0)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    const onVisibility = (): void => { start() }
    const onReduced = (): void => {
      reduced = reducedQuery?.matches ?? false
      start()
    }
    const onResize = (): void => {
      if (frame === 0) paint(canvas, 0)
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    resizeObserver?.observe(canvas)

    start()
    document.addEventListener('visibilitychange', onVisibility)
    reducedQuery?.addEventListener('change', onReduced)
    window.addEventListener('resize', onResize)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      reducedQuery?.removeEventListener('change', onReduced)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
      canvas.width = 0
      canvas.height = 0
    }
  }, [])

  return <canvas ref={canvasRef} className="login-water" data-testid="login-water" aria-hidden="true" />
}
