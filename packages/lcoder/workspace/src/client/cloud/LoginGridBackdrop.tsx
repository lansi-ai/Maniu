/**
 * 登录页的背景网格：静止时与外壳原网格同款，指针附近按高斯影响隆起并提亮。
 *
 * 颜色每帧从皮肤 CSS 变量读取，切换皮肤由 MutationObserver 触发重绘，无需重建页面。
 * 画布固定覆盖整窗、不接指针事件；窗口隐藏或「减少动态效果」时只画静态网格。
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  clamp01, gridOffsets, lineAlpha, parseCssColor, rgba, warpVertex,
} from './login-grid.ts'
import type { GridColor, GridWarpSpec } from './login-grid.ts'
import css from './LoginGridBackdrop.module.css'

/** 缓冲区像素比的封顶，避免高分屏上每帧涂太多像素。 */
const MAX_DPR = 2
/** 读不到皮肤变量时的兜底网格间距。 */
const FALLBACK_SPACING = 32
/** 读不到皮肤变量时的兜底底色。 */
const FALLBACK_BASE: GridColor = { r: 34, g: 211, b: 238, alpha: 0.07 }
/** 读不到皮肤变量时的兜底高亮色。 */
const FALLBACK_PEAK: GridColor = { r: 34, g: 211, b: 238, alpha: 1 }
/** 隆起形状：标准差约 96px，三倍标准差外不再采样。 */
const WARP: GridWarpSpec = { sigma: 96, perspective: 0.09, lift: 22 }
/** 受影响区间的采样步长。 */
const SAMPLE_STEP = 8
/** 指针处的线条峰值透明度。 */
const PEAK_ALPHA = 0.56
/** 指针停止后多久开始回弹。 */
const IDLE_MS = 420
/** 顶部隆起与回弹的过渡时长。 */
const PUSH_MS = 140
const RELEASE_MS = 320
/** 亮度分桶数，控制每帧的 stroke 次数。 */
const GLOW_BUCKETS = 8
/** 隆起的光晕半径，相对标准差。 */
const HALO_SCALE = 2.2

/** 一帧要用的皮肤取色。 */
interface Palette {
  readonly base: GridColor
  readonly peak: GridColor
  readonly spacing: number
}

/** 已就绪的绘制表面，尺寸按 CSS 像素计。 */
interface Surface {
  readonly ctx: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
}

/** 从当前皮肤读网格间距与底色/高亮色；变量缺失时用兜底值。 */
function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const spacing = Number.parseFloat(style.getPropertyValue('--lc-grid-size'))
  return {
    base: parseCssColor(style.getPropertyValue('--lc-grid-line')) ?? FALLBACK_BASE,
    peak: parseCssColor(style.getPropertyValue('--lc-brand')) ?? FALLBACK_PEAK,
    spacing: Number.isFinite(spacing) ? Math.min(96, Math.max(16, spacing)) : FALLBACK_SPACING,
  }
}

/** 按 DPR 上限同步缓冲区并清屏；画布没有布局尺寸时返回 null。 */
function prepare(canvas: HTMLCanvasElement): Surface | null {
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

/** 画一段直线。 */
function strokeStraight(
  ctx: CanvasRenderingContext2D,
  color: string,
  vertical: boolean,
  fixed: number,
  from: number,
  to: number,
): void {
  if (to - from < 0.5) return
  ctx.strokeStyle = color
  ctx.beginPath()
  if (vertical) {
    ctx.moveTo(fixed, from)
    ctx.lineTo(fixed, to)
  } else {
    ctx.moveTo(from, fixed)
    ctx.lineTo(to, fixed)
  }
  ctx.stroke()
}

/** 一段已位移的线，按 [x1, y1, x2, y2] 记。 */
type Segment = readonly [number, number, number, number]

/**
 * 画一条线在影响区间内的位移与提亮；亮度按桶合并，减少 stroke 次数。
 * @param vertical - 竖线取固定 x、沿 y 采样；横线反之。
 * @param fixed - 线在另一轴上的位置。
 */
function strokeWarped(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  vertical: boolean,
  fixed: number,
  from: number,
  to: number,
  pointerX: number,
  pointerY: number,
  strength: number,
): void {
  const buckets = new Map<number, Segment[]>()
  for (let point = from; point < to; point += SAMPLE_STEP) {
    const next = Math.min(point + SAMPLE_STEP, to)
    const head = vertical
      ? warpVertex(fixed, point, pointerX, pointerY, WARP, strength)
      : warpVertex(point, fixed, pointerX, pointerY, WARP, strength)
    const tail = vertical
      ? warpVertex(fixed, next, pointerX, pointerY, WARP, strength)
      : warpVertex(next, fixed, pointerX, pointerY, WARP, strength)
    const glow = (head.glow + tail.glow) / 2
    if (glow < 0.005) continue
    const bucket = Math.min(GLOW_BUCKETS - 1, Math.round(glow * (GLOW_BUCKETS - 1)))
    const segment: Segment = [head.x, head.y, tail.x, tail.y]
    const list = buckets.get(bucket)
    if (list === undefined) buckets.set(bucket, [segment])
    else list.push(segment)
  }
  for (let bucket = 0; bucket < GLOW_BUCKETS; bucket++) {
    const segments = buckets.get(bucket)
    if (segments === undefined) continue
    ctx.strokeStyle = rgba(
      palette.peak,
      lineAlpha(palette.base.alpha, PEAK_ALPHA, bucket / (GLOW_BUCKETS - 1)),
    )
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of segments) {
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  }
}

/** 画一格网格线：静止段用底色，影响区间交给位移采样。 */
function strokeLine(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  surface: Surface,
  vertical: boolean,
  fixed: number,
  pointerX: number | null,
  pointerY: number | null,
  strength: number,
): void {
  const base = rgba(palette.base, palette.base.alpha)
  const length = vertical ? surface.height : surface.width
  const distance = vertical ? fixed - (pointerX ?? 0) : fixed - (pointerY ?? 0)
  if (pointerX === null || pointerY === null || strength <= 0 || Math.abs(distance) > WARP.sigma * 3) {
    strokeStraight(ctx, base, vertical, fixed, 0, length)
    return
  }
  const centre = vertical ? pointerY : pointerX
  const lo = Math.max(0, centre - WARP.sigma * 3)
  const hi = Math.min(length, centre + WARP.sigma * 3)
  strokeStraight(ctx, base, vertical, fixed, 0, lo)
  strokeStraight(ctx, base, vertical, fixed, hi, length)
  strokeWarped(ctx, palette, vertical, fixed, lo, hi, pointerX, pointerY, strength)
}

/** 画一帧：可选光晕、全部网格线；指针不在或强度为 0 时就是静态网格。 */
function paint(
  canvas: HTMLCanvasElement,
  palette: Palette,
  pointerX: number | null,
  pointerY: number | null,
  strength: number,
): boolean {
  const surface = prepare(canvas)
  if (surface === null) return false
  const { ctx, width, height } = surface
  if (pointerX !== null && pointerY !== null && strength > 0) {
    const halo = ctx.createRadialGradient(
      pointerX, pointerY, 0,
      pointerX, pointerY, WARP.sigma * HALO_SCALE,
    )
    halo.addColorStop(0, rgba(palette.peak, 0.1 * clamp01(strength)))
    halo.addColorStop(1, rgba(palette.peak, 0))
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, width, height)
  }
  ctx.lineWidth = 1
  ctx.lineCap = 'butt'
  for (const x of gridOffsets(width, palette.spacing)) {
    strokeLine(ctx, palette, surface, true, x, pointerX, pointerY, strength)
  }
  for (const y of gridOffsets(height, palette.spacing)) {
    strokeLine(ctx, palette, surface, false, y, pointerX, pointerY, strength)
  }
  return true
}

/**
 * 登录页背景网格画布。
 * @returns 覆盖整窗、不接指针事件的 canvas。
 */
export function LoginGridBackdrop(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    let palette = readPalette(canvas)
    let frame = 0
    let strength = 0
    let target = 0
    let pointerX: number | null = null
    let pointerY: number | null = null
    let lastMove = 0
    let lastFrame = 0
    let painted = false
    const reducedQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    let reduced = reducedQuery?.matches ?? false

    const render = (x: number | null, y: number | null, level: number): void => {
      painted = paint(canvas, palette, x, y, level) || painted
    }
    const paintStatic = (): void => { render(null, null, 0) }
    const stopFrame = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      lastFrame = 0
    }

    const tick = (now: number): void => {
      frame = 0
      const delta = lastFrame === 0 ? 16 : Math.min(64, now - lastFrame)
      lastFrame = now
      if (target === 1 && now - lastMove > IDLE_MS) target = 0
      const rate = target === 1 ? 1 / PUSH_MS : 1 / RELEASE_MS
      strength = strength < target
        ? Math.min(target, strength + delta * rate)
        : Math.max(target, strength - delta * rate)
      render(pointerX, pointerY, strength)
      if (target === 0 && strength === 0) {
        lastFrame = 0
        return
      }
      frame = requestAnimationFrame(tick)
    }
    const ensureFrame = (): void => {
      if (reduced || typeof requestAnimationFrame !== 'function') return
      if (frame === 0) frame = requestAnimationFrame(tick)
    }

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      pointerX = event.clientX - rect.left
      pointerY = event.clientY - rect.top
      lastMove = performance.now()
      target = 1
      ensureFrame()
    }
    const release = (): void => {
      target = 0
      ensureFrame()
    }
    const attachPointer = (): void => {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('blur', release)
      document.addEventListener('pointerleave', release)
    }
    const detachPointer = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', release)
      document.removeEventListener('pointerleave', release)
    }

    const onReducedChange = (): void => {
      reduced = reducedQuery?.matches ?? false
      if (!reduced) {
        attachPointer()
        return
      }
      detachPointer()
      stopFrame()
      strength = 0
      target = 0
      paintStatic()
    }
    const onVisibility = (): void => {
      if (!document.hidden) {
        paintStatic()
        return
      }
      stopFrame()
      strength = 0
      target = 0
    }
    const onResize = (): void => {
      if (frame === 0) paintStatic()
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    resizeObserver?.observe(canvas)

    const skinObserver = new MutationObserver(() => {
      palette = readPalette(canvas)
      if (frame === 0) paintStatic()
    })
    const skinRoot = canvas.closest('[data-skin]') ?? document.documentElement
    skinObserver.observe(skinRoot, { attributes: true, attributeFilter: ['data-skin', 'data-lcoder-skin'] })
    if (skinRoot !== document.documentElement) {
      skinObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lcoder-skin'] })
    }

    paintStatic()
    if (!reduced) attachPointer()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    reducedQuery?.addEventListener('change', onReducedChange)

    return () => {
      detachPointer()
      stopFrame()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      reducedQuery?.removeEventListener('change', onReducedChange)
      resizeObserver?.disconnect()
      skinObserver.disconnect()
      if (painted) {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [])

  return <canvas ref={canvasRef} className={css.backdrop} aria-hidden="true" />
}
