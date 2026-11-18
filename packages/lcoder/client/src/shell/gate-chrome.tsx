/** 门禁态的窗口控制：一条透明拖拽区与右上角三个幽灵按钮，不画玻璃条、不占布局高度。 */

import type { JSX } from 'react'
import { Minus, Square, X } from 'lucide-react'
import type { WindowStateInfo } from '@maniu/desktop/contract'
import type { Translate } from '../locale.ts'

/** 门禁态窗口控制属性。 */
export interface GateChromeProps {
  readonly t: Translate
  readonly windowState: WindowStateInfo
}

/**
 * 登录、欢迎、启动中与云端不可用时的窗口控制。
 * @param props - 词典与窗口状态。
 * @returns 顶部拖拽区与浮在右上的最小化/最大化/关闭按钮。
 */
export function GateChrome({ t, windowState }: GateChromeProps): JSX.Element {
  const toggleMaximize = (): void => { void window.lcoder.window('toggle-maximize') }
  return (
    <>
      <div className="gate-drag" data-testid="gate-drag" aria-hidden="true" onDoubleClick={toggleMaximize} />
      <div
        className="gate-window-buttons window-no-drag"
        data-testid="gate-window-buttons"
        data-maximized={windowState.maximized ? 'true' : 'false'}
      >
        <button
          type="button"
          data-action="minimize"
          aria-label={t('titlebar.minimize')}
          data-testid="window-minimize"
          onClick={() => { void window.lcoder.window('minimize') }}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          data-action="maximize"
          aria-label={windowState.maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          data-testid="window-maximize"
          data-maximized={windowState.maximized ? 'true' : 'false'}
          onClick={toggleMaximize}
        >
          <Square aria-hidden="true" />
        </button>
        <button
          type="button"
          data-action="close"
          data-role="close"
          aria-label={t('titlebar.close')}
          data-testid="window-close"
          onClick={() => { void window.lcoder.window('close') }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </>
  )
}
