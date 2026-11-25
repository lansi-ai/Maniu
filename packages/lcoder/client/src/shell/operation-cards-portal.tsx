/** 悬浮任务卡的跨页挂载层：portal 到 body 的共享容器，页面被 display:none 隐藏时卡片仍在视口内。 */

import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { OperationCards, type OperationCardsProps } from './operation-cards.tsx'

const HOST_ID = 'lcoder-op-cards-host'

/** 取或建共享挂载点：需求页与原型页的卡片都挂进同一列，避免两层浮卡在右下角互相覆盖。 */
function cardHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID)
  if (existing !== null) return existing
  const host = document.createElement('div')
  host.id = HOST_ID
  host.className = 'op-portal-host'
  document.body.appendChild(host)
  return host
}

/**
 * 把悬浮任务卡挂到 body 的共享固定列，切页与页面隐藏都不丢卡片状态。
 * @param props - 卡片事实与操作回调。
 * @returns 跨页可见的卡片层。
 */
export function OperationCardsPortal(props: OperationCardsProps): JSX.Element {
  return createPortal(
    <div className="op-portal-layer">
      <OperationCards {...props} />
    </div>,
    cardHost(),
  )
}
