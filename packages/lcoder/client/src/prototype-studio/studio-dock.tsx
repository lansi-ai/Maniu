/**
 * 主窗右下角的 Prototype Studio 停靠胶囊：工作台最小化后由它恢复或关闭。
 * 只渲染状态，动作经 preload 回到主进程，渲染端不自己开窗口。
 */

import type { JSX } from 'react'
import type { Translate } from '../locale.ts'

/** 停靠胶囊属性。 */
export interface StudioDockProps {
  readonly t: Translate
  /** 工作台当前需求编号；缺省时只显示工作室名称。 */
  readonly requirementId?: string | undefined
  readonly onRestore: () => void
  readonly onClose: () => void
}

/**
 * 画停靠胶囊。
 * @param props - 词典、需求编号与两个动作回调。
 * @returns 可恢复或关闭最小化工作台的胶囊。
 */
export function StudioDock(props: StudioDockProps): JSX.Element {
  const { t } = props
  const requirementId = props.requirementId
  return (
    <div className="studio-dock" data-testid="studio-minimized-dock" data-requirement-id={requirementId ?? ''}>
      <span className="studio-dock-dot" aria-hidden="true" />
      <span className="studio-dock-title" data-testid="studio-dock-title">
        {requirementId === undefined || requirementId === ''
          ? t('studio.dockTitlePlain')
          : t('studio.dockTitle', { id: requirementId })}
      </span>
      <button
        type="button"
        className="studio-dock-action"
        data-testid="studio-dock-restore"
        onClick={props.onRestore}
      >
        {t('studio.dockRestore')}
      </button>
      <button
        type="button"
        className="studio-dock-close"
        data-testid="studio-dock-close"
        aria-label={t('studio.dockClose')}
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  )
}
