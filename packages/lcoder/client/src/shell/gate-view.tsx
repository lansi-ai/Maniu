/** 登录门禁的四种视图：启动中、云端不可用、欢迎屏与登录页。 */

import type { JSX } from 'react'
import type { HostState, RemoteFailure } from '@maniu/desktop/contract'
import type { Translate } from '../locale.ts'
import { LoginScreen } from '../account/login-screen.tsx'
import { WelcomeScreen } from '../welcome/welcome-screen.tsx'

/** 门禁视图属性。 */
export interface GateViewProps {
  readonly kind: 'booting' | 'cloud-error' | 'signed-out'
  readonly t: Translate
  readonly host: HostState
  readonly failure: RemoteFailure | null
  readonly showWelcome: boolean
  readonly onRetry: () => void
  readonly onSignIn: () => void
  readonly onSkipWelcome: () => void
  readonly onAuthenticated: () => void | Promise<void>
}

/**
 * 未放行时的整屏视图。
 * @param props - 门禁种类、宿主态、失败与动作。
 * @returns 居中玻璃卡、欢迎屏或登录页。
 */
export function GateView({
  kind, t, host, failure, showWelcome, onRetry, onSignIn, onSkipWelcome, onAuthenticated,
}: GateViewProps): JSX.Element {
  if (kind === 'signed-out' && showWelcome) {
    return <WelcomeScreen t={t} onSignIn={onSignIn} onSkip={onSkipWelcome} />
  }
  if (kind === 'signed-out') {
    return <LoginScreen t={t} onAuthenticated={onAuthenticated} />
  }
  if (kind === 'cloud-error') {
    return (
      <main className="center" data-testid="cloud-unavailable">
        <section className="gate-card lg-glass">
          <h1>{t('gate.cloudTitle')}</h1>
          <p>{t('gate.cloudBody')}</p>
          <code>{failure === null ? '' : `${failure.code}: ${failure.message}`}</code>
          <button type="button" className="pill pill-accent lg-sheen lg-lift" onClick={onRetry}>{t('gate.retry')}</button>
        </section>
      </main>
    )
  }
  return (
    <main className="center" data-testid="gate-loading">
      <section className="gate-card lg-glass">
        <h1>{t('gate.bootingTitle')}</h1>
        <p>{t('gate.bootingBody')}</p>
        {host.kind === 'fatal' && <pre className="fatal">{host.detail}</pre>}
      </section>
    </main>
  )
}
