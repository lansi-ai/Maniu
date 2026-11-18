/** 自绘标题栏：品牌、项目、宿主状态、账号入口与窗口按钮。 */

import type { JSX } from 'react'
import { AppWindow, Minus, Square, X } from 'lucide-react'
import type { HostState, WindowStateInfo } from '@maniu/desktop/contract'
import type { Translate } from '../locale.ts'
import type { CloudState } from '../account/cloud.ts'
import { AccountMenu } from '../account/account-menu.tsx'
import type { ProjectScope } from '../workspace/use-workspaces.ts'

/** 标题栏属性。 */
export interface TitlebarProps {
  readonly t: Translate
  readonly host: HostState
  readonly project: ProjectScope | null
  readonly windowState: WindowStateInfo
  readonly cloud: CloudState | null
  readonly onPersonalCenter: () => void
  readonly onCloudChanged: () => void | Promise<void>
}

/**
 * 标题栏。
 * @param props - 词典、宿主态、项目、窗口状态与账号回调。
 * @returns 深色静态命中条；控件区显式 no-drag，窗口按钮带图标与配色。
 */
export function Titlebar({
  t, host, project, windowState, cloud, onPersonalCenter, onCloudChanged,
}: TitlebarProps): JSX.Element {
  const toggleMaximize = (): void => { void window.lcoder.window('toggle-maximize') }
  return (
    <header className="titlebar" data-testid="titlebar" data-maximized={windowState.maximized ? 'true' : 'false'}>
      <div
        className="titlebar-drag"
        onDoubleClick={toggleMaximize}
      >
        <AppWindow className="titlebar-brand-icon" aria-hidden="true" />
        <span className="brand">{t('app.name')}</span>
        <span className="tag" data-testid="titlebar-project">
          {project === null ? t('titlebar.noProject') : project.title}
        </span>
        <span className="host" data-testid="host-state" data-host-state={host.kind}>
          {host.kind === 'ready'
            ? t('titlebar.hostReady')
            : host.kind === 'fatal' ? t('titlebar.hostFailed', { detail: host.detail }) : t('titlebar.hostStarting')}
        </span>
      </div>
      <div className="titlebar-tools window-no-drag">
        {cloud?.signedIn === true
          ? <AccountMenu state={cloud} t={t} onPersonalCenter={onPersonalCenter} onChanged={onCloudChanged} />
          : null}
        <div className="window-buttons">
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
      </div>
    </header>
  )
}
