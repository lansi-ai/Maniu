/** 窗口透明边与标题栏中段的拖拽区：只提供原生命中，不画外观、不含控件。 */

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'

/** 拖拽条覆盖的窗口边。 */
type GutterEdge = 'top' | 'left' | 'right'

/** 窗口状态。 */
export interface WindowGutterProps {
  /** 最大化时不再保留顶部缩放边，拖拽条铺到窗口最外缘。 */
  readonly maximized: boolean
  /** 已登录主界面才有标题栏；门禁态没有拖拽垫。 */
  readonly titlebar: boolean
}

/** 标题栏拖拽垫的视口几何。 */
interface TitlebarPad {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

const EDGES: readonly GutterEdge[] = ['top', 'left', 'right']

/** 拖拽垫右边界与工具区左缘的间隙，账号与窗口按钮不落入拖拽区。 */
const TOOLS_GAP = 2

function padOf(bar: DOMRect, tools: DOMRect): TitlebarPad | null {
  const width = tools.left - TOOLS_GAP - bar.left
  if (width <= 0 || bar.height <= 0) return null
  return { top: bar.top, left: bar.left, width, height: bar.height }
}

function samePad(left: TitlebarPad | null, right: TitlebarPad | null): boolean {
  if (left === null || right === null) return left === right
  return left.top === right.top && left.left === right.left
    && left.width === right.width && left.height === right.height
}

/** 原生拖拽区在标题栏中段被裁断，按标题栏与工具区的实际矩形补一条固定层。 */
function measurePad(): TitlebarPad | null {
  const bar = document.querySelector<HTMLElement>('.titlebar')
  const tools = document.querySelector<HTMLElement>('.titlebar-tools')
  if (bar === null || tools === null) return null
  return padOf(bar.getBoundingClientRect(), tools.getBoundingClientRect())
}

/**
 * 固定定位的三条空拖拽条与标题栏拖拽垫。
 *
 * 顶部从缩放边内侧铺到标题栏上缘，左右只在标题栏高度带内贴边各占一段；
 * 最大化态把顶部与左右都扩到窗口最外缘。标题栏垫在门禁态不渲染，右边界
 * 停在工具区左缘前 2px；标题栏、工具区尺寸变化与最大化切换时重算。
 * 垫子挂在 body 上：与应用根内的标题栏重叠时，原生拖拽区会被裁断。
 * @param props - 最大化与标题栏存在性。
 * @returns 只有 `-webkit-app-region` 命中区域、无文案无控件的拖拽层。
 */
export function WindowGutter({ maximized, titlebar }: WindowGutterProps): JSX.Element {
  const [pad, setPad] = useState<TitlebarPad | null>(null)

  useLayoutEffect(() => {
    if (!titlebar) {
      setPad(null)
      return
    }
    const remeasure = (): void => {
      const next = measurePad()
      setPad(current => samePad(current, next) ? current : next)
    }
    remeasure()
    const bar = document.querySelector<HTMLElement>('.titlebar')
    const tools = document.querySelector<HTMLElement>('.titlebar-tools')
    const observer = new ResizeObserver(remeasure)
    if (bar !== null) observer.observe(bar)
    if (tools !== null) observer.observe(tools)
    return () => { observer.disconnect() }
  }, [maximized, titlebar])

  return (
    <>
      {EDGES.map(edge => (
        <div
          key={edge}
          className={maximized ? 'window-gutter is-maximized' : 'window-gutter'}
          data-edge={edge}
          data-testid={`window-gutter-${edge}`}
          aria-hidden="true"
        />
      ))}
      {pad === null ? null : createPortal(
        <div
          className="titlebar-pad"
          data-testid="titlebar-pad"
          aria-hidden="true"
          style={{ top: pad.top, left: pad.left, width: pad.width, height: pad.height }}
        />,
        document.body,
      )}
    </>
  )
}
