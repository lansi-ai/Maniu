/** 新客户端首屏：Maniu 品牌、去登录或跳过介绍。 */

import type { JSX } from 'react'
import { Button, Card } from '@heroui/react'
import type { Translate } from '../locale.ts'
import { PaperWater } from '../theme/paper-water.tsx'

/** 欢迎屏属性。 */
export interface WelcomeScreenProps {
  readonly t: Translate
  readonly onSignIn: () => void
  readonly onSkip: () => void
}

/**
 * 欢迎屏。
 * @param props - 词典与两个入口。
 * @returns 官方表面浮岛首屏，随明暗主题取色。
 */
export function WelcomeScreen({ t, onSignIn, onSkip }: WelcomeScreenProps): JSX.Element {
  return (
    <main className="center welcome-screen" data-testid="welcome-screen">
      <PaperWater testId="welcome-water" />
      <Card className="welcome-card" data-testid="welcome-card">
        <span className="welcome-mark" aria-hidden="true">M</span>
        <h1>{t('app.name')}</h1>
        <p className="welcome-slogan">{t('welcome.slogan')}</p>
        <p className="welcome-body">{t('welcome.body')}</p>
        <div className="welcome-actions">
          <Button
            className="gradient-primary welcome-sign-in"
            data-testid="welcome-sign-in"
            size="lg"
            onPress={onSignIn}
          >
            {t('welcome.signIn')}
          </Button>
          <Button
            className="welcome-skip"
            data-testid="welcome-skip"
            variant="outline"
            size="lg"
            onPress={onSkip}
          >
            {t('welcome.skip')}
          </Button>
        </div>
        <p className="welcome-hint">{t('welcome.hint')}</p>
      </Card>
    </main>
  )
}
