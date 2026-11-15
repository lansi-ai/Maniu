/** 新客户端首屏：Maniu 品牌、去登录或跳过介绍。 */

import type { JSX } from 'react'
import type { Translate } from '../locale.ts'

/** 欢迎屏属性。 */
export interface WelcomeScreenProps {
  readonly t: Translate
  readonly onSignIn: () => void
  readonly onSkip: () => void
}

/**
 * 欢迎屏。
 * @param props - 词典与两个入口。
 * @returns 全屏品牌首屏。
 */
export function WelcomeScreen({ t, onSignIn, onSkip }: WelcomeScreenProps): JSX.Element {
  return (
    <main className="center" data-testid="welcome-screen">
      <section className="welcome-card lg-glass">
        <span className="welcome-mark" aria-hidden="true">M</span>
        <h1>{t('app.name')}</h1>
        <p className="welcome-slogan">{t('welcome.slogan')}</p>
        <p className="welcome-body">{t('welcome.body')}</p>
        <div className="welcome-actions">
          <button type="button" className="pill pill-accent lg-sheen lg-lift" data-testid="welcome-sign-in" onClick={onSignIn}>
            {t('welcome.signIn')}
          </button>
          <button type="button" className="pill lg-sheen" data-testid="welcome-skip" onClick={onSkip}>
            {t('welcome.skip')}
          </button>
        </div>
        <p className="welcome-hint">{t('welcome.hint')}</p>
      </section>
    </main>
  )
}
