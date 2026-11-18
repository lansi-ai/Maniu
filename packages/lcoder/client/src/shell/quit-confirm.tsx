/** 关窗确认：主进程判定有回合在跑时才出现，取消或确认放弃后关窗。 */

import type { JSX } from 'react'
import { Button, Card } from '@heroui/react'
import type { Translate } from '../locale.ts'

/** 关窗确认属性。 */
export interface QuitConfirmProps {
  readonly t: Translate
  /** 在跑的会话数。 */
  readonly running: number
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/**
 * 运行中关窗的确认卡片。
 * @param props - 词典、在跑会话数与取消/退出动作。
 * @returns 压暗底层的确认层。
 */
export function QuitConfirm({ t, running, onCancel, onConfirm }: QuitConfirmProps): JSX.Element {
  return (
    <div className="quit-backdrop" data-testid="quit-confirm-dialog">
      <Card className="quit-card" role="dialog" aria-modal="true" aria-labelledby="quit-confirm-title">
        <h3 id="quit-confirm-title">{t('quit.title')}</h3>
        <p>{t('quit.body', { count: running })}</p>
        <div className="quit-actions">
          <Button variant="secondary" data-testid="quit-confirm-cancel" onPress={onCancel}>
            {t('quit.cancel')}
          </Button>
          <Button variant="primary" data-testid="quit-confirm-exit" onPress={onConfirm}>
            {t('quit.exit')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
