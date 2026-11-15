/**
 * 折射玻璃：按元素尺寸生成边缘位移贴图，挂到 `backdrop-filter: url(#id)` 上，
 * 让卡面背后的水流在边缘被拉伸成透镜。
 *
 * 位移贴图算法参考 shuding/liquid-glass 与 archisvaze/liquid-glass（均 MIT License，
 * Copyright (c) Shu Ding；Copyright (c) Archisvaze），按元素尺寸与 DPR 重写。
 *
 * 只有 Chromium/Electron 的 `backdrop-filter: url()` 会作用到背景；其它内核保持调用方
 * 自己的 `backdrop-filter`（普通模糊）。每个实例一个 id，卸载时移除定义并停掉观察。
 */

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, RefObject } from 'react'

/** 位移贴图边长上限；再大的元素也不提高贴图细节。 */
const MAP_MAX_SIDE = 512
/** 贴图重建的尺寸阈值：小于该值只更新滤镜区域，不重新生成位图。 */
const MAP_SIZE_STEP = 24
/** 边缘带占短边的比例。 */
const EDGE_BAND = 0.17
/** 边缘最大位移（CSS 像素）。 */
const EDGE_PUSH = 26

/** 折射参数。 */
export interface RefractionOptions {
  /** 折射层之外的模糊半径。 */
  readonly blur: number
  /** 折射强度，1 是原型默认。 */
  readonly strength?: number
  /** 背后颜色的饱和度倍数。 */
  readonly saturate?: number
  /** 背后颜色的亮度倍数。 */
  readonly brightness?: number
}

/** 折射玻璃的挂载结果。 */
export interface RefractionLayer {
  /** 挂到承载 `backdrop-filter` 的元素上，用于测量尺寸。 */
  readonly ref: RefObject<HTMLElement>
  /** 交给该元素的内联样式；不支持折射时为空对象。 */
  readonly style: CSSProperties
  /** 放进该元素内的滤镜定义；尺寸未就绪时为 null。 */
  readonly defs: JSX.Element | null
}

/** `backdrop-filter` 是否接受 SVG 滤镜引用；结果在模块内缓存。 */
let filterUrlSupported: boolean | null = null
function supportsFilterUrl(): boolean {
  if (filterUrlSupported !== null) return filterUrlSupported
  filterUrlSupported = typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('backdrop-filter', 'url(#refraction-probe)')
  return filterUrlSupported
}

/**
 * 画一张边缘位移贴图：中心透明（128,128 不变形），靠近边框处沿径向向外推。
 * @param width - 目标宽度（CSS 像素）。
 * @param height - 目标高度（CSS 像素）。
 * @param dpr - 设备像素比，决定贴图分辨率。
 * @returns PNG data URL；没有 2D 画布时返回 null。
 */
function buildDisplacementMap(width: number, height: number, dpr: number): string | null {
  const resolution = Math.min(MAP_MAX_SIDE, Math.max(2, Math.round(Math.max(width, height) * dpr)))
  const aspect = width / Math.max(1, height)
  const mapWidth = Math.max(2, Math.round(aspect >= 1 ? resolution : resolution * aspect))
  const mapHeight = Math.max(2, Math.round(aspect >= 1 ? resolution / aspect : resolution))
  const canvas = document.createElement('canvas')
  canvas.width = mapWidth
  canvas.height = mapHeight
  const context = canvas.getContext('2d')
  if (context === null) return null
  const image = context.createImageData(mapWidth, mapHeight)
  for (let y = 0; y < mapHeight; y++) {
    const v = y / (mapHeight - 1)
    for (let x = 0; x < mapWidth; x++) {
      const u = x / (mapWidth - 1)
      const edge = Math.min(u, 1 - u, v, 1 - v)
      const falloff = Math.pow(1 - Math.min(1, edge / EDGE_BAND), 1.7)
      const directionX = 0.5 - u
      const directionY = 0.5 - v
      const length = Math.hypot(directionX, directionY) || 1
      const push = falloff / length
      const index = (y * mapWidth + x) * 4
      image.data[index] = Math.round(128 + directionX * push * 63.5)
      image.data[index + 1] = Math.round(128 + directionY * push * 63.5)
      image.data[index + 2] = 128
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 给一个元素挂上折射玻璃。
 * @param options - 模糊半径、强度与背后颜色的饱和/亮度。
 * @returns 元素引用、内联样式与滤镜定义。
 */
export function useRefractionFilter({
  blur,
  strength = 1,
  saturate = 1.45,
  brightness = 1.02,
}: RefractionOptions): RefractionLayer {
  const ref = useRef<HTMLElement | null>(null)
  const reactId = useId()
  const id = useMemo(() => `refraction-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId])
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [mapKey, setMapKey] = useState({ width: 0, height: 0, dpr: 1 })

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      setBox(current => current.width === width && current.height === height
        ? current
        : { width, height })
      setMapKey((current) => {
        const steady = current.dpr === dpr
          && Math.abs(current.width - width) < MAP_SIZE_STEP
          && Math.abs(current.height - height) < MAP_SIZE_STEP
        // 首次测量必须生成位图，之后按阈值重建，拖动窗口时不做无谓的位图重绘。
        return steady && current.width > 0 ? current : { width, height, dpr }
      })
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(element)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  const map = useMemo(
    () => mapKey.width === 0 || mapKey.height === 0 || !supportsFilterUrl()
      ? null
      : buildDisplacementMap(mapKey.width, mapKey.height, mapKey.dpr),
    [mapKey],
  )

  const plain = `blur(${blur}px) saturate(${saturate}) brightness(${brightness})`
  // 贴图就绪前先用普通模糊顶上：既不退回主题的 30px 重模糊，也不会有一帧没有玻璃。
  const style: CSSProperties = !supportsFilterUrl()
    ? {}
    : { backdropFilter: map === null ? plain : `url(#${id}) ${plain}` }

  const defs = map === null || box.width === 0 || box.height === 0
    ? null
    : (
      <svg className="refraction-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <filter
            id={id}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={box.width}
            height={box.height}
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={map}
              x="0"
              y="0"
              width={box.width}
              height={box.height}
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={EDGE_PUSH * strength * 2}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    )

  return { ref, style, defs }
}
