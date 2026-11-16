/** 自绘标题栏：品牌、项目、宿主状态、账号入口与窗口按钮。 */

import type { JSX } from 'react'
import type { HostState, WindowStateInfo } from '@lcoder/desktop/contract'
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
 * @returns 可拖拽的玻璃条。
 */
export function Titlebar({
  t, host, project, windowState, cloud, onPersonalCenter, onCloudChanged,
}: TitlebarProps): JSX.Element {
  const toggleMaximize = (): void => { void window.lcoder.window('toggle-maximize') }
  return (
    <header className="titlebar lg-frost" data-testid="titlebar" data-maximized={windowState.maximized ? 'true' : 'false'}>
      <div
        className="titlebar-drag"
        onDoubleClick={toggleMaximize}
      >
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
      <div className="titlebar-tools">
        {cloud?.signedIn === true
          ? <AccountMenu state={cloud} t={t} onPersonalCenter={onPersonalCenter} onChanged={onCloudChanged} />
          : null}
        <div className="window-buttons">
          <button type="button" className="lg-sheen" aria-label={t('titlebar.minimize')} data-testid="window-minimize" onClick={() => { void window.lcoder.window('minimize') }}>—</button>
          <button
            type="button"
            className="lg-sheen"
            aria-label={windowState.maximized ? t('titlebar.restore') : t('titlebar.maximize')}
            data-testid="window-maximize"
            data-maximized={windowState.maximized ? 'true' : 'false'}
            onClick={toggleMaximize}
          >
            {windowState.maximized ? '❐' : '□'}
          </button>
          <button type="button" className="lg-sheen" data-role="close" aria-label={t('titlebar.close')} data-testid="window-close" onClick={() => { void window.lcoder.window('close') }}>×</button>
        </div>
      </div>
    </header>
  )
}
