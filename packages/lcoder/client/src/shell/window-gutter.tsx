/** 窗口透明边上的拖拽条：把标题栏上缘与左右留白的命中死角补成可拖，不画外观、不含控件。 */

import type { JSX } from 'react'

/** 拖拽条覆盖的窗口边。 */
type GutterEdge = 'top' | 'left' | 'right'

/** 窗口状态。 */
export interface WindowGutterProps {
  /** 最大化时不再保留顶部缩放边，拖拽条铺到窗口最外缘。 */
  readonly maximized: boolean
}

const EDGES: readonly GutterEdge[] = ['top', 'left', 'right']

/**
 * 固定定位的三条空拖拽条。
 *
 * 顶部从缩放边内侧铺到标题栏上缘，左右只在标题栏高度带内贴边各占一段；
 * 最大化态把顶部与左右都扩到窗口最外缘，登录门禁与已登录主界面共用同一份。
 * @param props - 最大化窗口状态。
 * @returns 只有 `-webkit-app-region` 命中区域、无文案无控件的三条轨道。
 */
export function WindowGutter({ maximized }: WindowGutterProps): JSX.Element {
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
    </>
  )
}
