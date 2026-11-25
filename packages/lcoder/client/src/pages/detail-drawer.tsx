/** 详情抽屉外壳：统一右上角控制条、放大覆盖工作区与还原。 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Button } from '@heroui/react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { translate, type Translate } from '../locale.ts'

/** 工作台页面尚未接入词典，抽屉按钮沿用中文键；新客户端页面可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 一个详情抽屉的可变量：身份、顶栏内容、关闭回调与主体。 */
export interface DetailDrawerProps {
  readonly t?: Translate
  /** aside 的 `data-testid`；放大按钮为 `${testId}-expand`。 */
  readonly testId: string
  readonly closeTestId: string
  readonly onClose: () => void
  /** 顶栏左侧：标题或状态标签。 */
  readonly head: ReactNode
  /** 关闭按钮左侧的额外控制，例如刷新。 */
  readonly actions?: ReactNode
  /** 透传给 aside 的 `data-*` 属性。 */
  readonly attributes?: Readonly<Record<string, string>>
  /** 打开即铺满工作区可见区；默认 false 不影响任务详情等其它抽屉。 */
  readonly defaultExpanded?: boolean
  /** 是否渲染右上角放大/还原图标；默认 true，任务详情传 false 隐藏放大入口。 */
  readonly expandable?: boolean
  readonly children: ReactNode
}

/** 放大后的视口矩形；宿主未布局时为空。 */
interface ViewportRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/**
 * 详情抽屉外壳。
 *
 * 顶栏固定，主体是唯一滚动容器，所以放大与还原只切定位与样式，不重建子树：
 * 表单输入与滚动位置都留在原地。放大态覆盖宿主页面的可见区域（标题栏与左侧
 * 导航在页面之外，因此不被遮住），宿主未布局时退回普通右栏。
 * @param props - 文案、身份、关闭回调与内容。
 * @returns 带关闭与可选放大/还原的抽屉。
 */
export function DetailDrawer(props: DetailDrawerProps): JSX.Element {
  const t = props.t ?? zhText
  const ref = useRef<HTMLElement>(null)
  const [expandedState, setExpandedState] = useState(props.defaultExpanded === true)
  const expanded = props.expandable === false ? false : expandedState
  const [rect, setRect] = useState<ViewportRect | null>(null)

  useLayoutEffect(() => {
    if (!expanded) {
      setRect(null)
      return undefined
    }
    const node = ref.current
    const host = node?.offsetParent instanceof HTMLElement
      ? node.offsetParent
      : node?.closest<HTMLElement>('.page') ?? node?.parentElement ?? null
    if (host === null) return undefined
    const measure = (): void => {
      const box = host.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return
      setRect(previous => previous !== null
        && previous.top === box.top
        && previous.left === box.left
        && previous.width === box.width
        && previous.height === box.height
        ? previous
        : { top: box.top, left: box.left, width: box.width, height: box.height })
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [expanded])

  const label = expanded ? t('drawer.restore') : t('drawer.maximize')

  return (
    <aside
      ref={ref}
      className={expanded ? 'detail-drawer is-expanded' : 'detail-drawer'}
      data-testid={props.testId}
      data-expanded={expanded ? 'true' : 'false'}
      {...props.attributes}
      {...rect === null
        ? {}
        : { style: { position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height } }}
    >
      <div className="detail-drawer-head detail-drawer-bar">
        <div className="detail-drawer-leading">{props.head}</div>
        <div className="detail-drawer-controls">
          {props.actions}
          {props.expandable !== false && (
            <Button
              isIconOnly
              className="detail-drawer-icon"
              variant="ghost"
              size="sm"
              data-testid={`${props.testId}-expand`}
              aria-label={label}
              aria-pressed={expanded}
              ref={(node) => { if (node !== null) node.title = label }}
              onPress={() => { setExpandedState(current => !current) }}
            >
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
          )}
          <Button
            isIconOnly
            className="detail-drawer-icon"
            variant="ghost"
            size="sm"
            data-testid={props.closeTestId}
            aria-label={t('drawer.close')}
            onPress={props.onClose}
          >
            <X aria-hidden="true" />
            <span className="sr-only">{t('drawer.close')}</span>
          </Button>
        </div>
      </div>
      <div className="detail-drawer-body">{props.children}</div>
    </aside>
  )
}
