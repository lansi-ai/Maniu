/** 操作进度浮卡：后台操作的标题、岗位、步骤与状态色；可最小化成胶囊，查看对话自愿跳转。 */

import type { JSX } from 'react'
import type { Translate } from '../locale.ts'

/** 浮卡三态：进行中蓝、完成绿、失败警示色。 */
export type OperationStatus = 'running' | 'done' | 'failed'

/** 步骤四态：已完成、进行中、未开始、失败。 */
export type OperationStepState = 'done' | 'active' | 'pending' | 'failed'

/** 浮卡里的一条步骤。 */
export interface OperationStep {
  readonly label: string
  readonly state: OperationStepState
}

/** 一张浮卡的呈现事实；状态与步骤由持有轮询判定的一方算好下传。 */
export interface OperationCardView {
  readonly key: string
  readonly title: string
  readonly roleLabel: string
  readonly sourceLabel: string
  readonly status: OperationStatus
  readonly statusText: string
  readonly steps: readonly OperationStep[]
  readonly sessionId: string | null
  readonly minimized: boolean
}

/** 浮卡列表属性。 */
export interface OperationCardsProps {
  readonly cards: readonly OperationCardView[]
  readonly onToggleMinimize: (key: string) => void
  readonly onOpenSession: (sessionId: string) => void
  readonly onClose: (key: string) => void
  readonly t: Translate
}

/**
 * 画右下角浮卡堆叠；最小化态只留标题与状态色胶囊。
 * @param props - 卡片事实与三个回调。
 * @returns 浮卡层；没有卡片时不渲染。
 */
export function OperationCards(props: OperationCardsProps): JSX.Element | null {
  if (props.cards.length === 0) return null
  return (
    <div className="op-layer" data-testid="operation-cards">
      {props.cards.map((card) => {
        if (card.minimized) {
          return (
            <button
              key={card.key}
              type="button"
              className={`op-capsule op-${card.status}`}
              data-testid="op-capsule"
              data-op-key={card.key}
              title={props.t('op.expand')}
              onClick={() => { props.onToggleMinimize(card.key) }}
            >
              <span className="op-dot" aria-hidden="true" />
              <span>{card.title}</span>
            </button>
          )
        }
        const sessionId = card.sessionId
        const testId = card.status === 'running'
          ? 'requirement-op-running'
          : card.status === 'done'
            ? 'requirement-op-success'
            : 'requirement-op-timeout'
        return (
          <article key={card.key} className={`op-card op-${card.status}`} data-testid={testId} data-op-key={card.key}>
            <header className="op-head">
              <h3>{card.title}</h3>
              <p className="op-sub">{card.roleLabel} · {card.sourceLabel}</p>
            </header>
            <ol className="op-steps">
              {card.steps.map((step, index) => (
                <li key={`${card.key}-${String(index)}`} className={`op-step-${step.state}`}>{step.label}</li>
              ))}
            </ol>
            <p className="op-status">{card.statusText}</p>
            <div className="op-actions">
              {sessionId !== null && (
                <button
                  type="button"
                  className="link-button"
                  data-testid={card.status === 'failed' ? 'requirement-op-timeout-session' : 'op-view-session'}
                  onClick={() => { props.onOpenSession(sessionId) }}
                >
                  {props.t('op.viewSession')}
                </button>
              )}
              <button
                type="button"
                className="link-button"
                data-testid="op-minimize"
                onClick={() => { props.onToggleMinimize(card.key) }}
              >
                {props.t('op.minimize')}
              </button>
              {card.status !== 'running' && (
                <button
                  type="button"
                  className="link-button"
                  data-testid={card.status === 'failed' ? 'requirement-op-timeout-reload' : 'op-close'}
                  onClick={() => { props.onClose(card.key) }}
                >
                  {card.status === 'failed' ? props.t('requirement.opTimeoutReload') : props.t('op.close')}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
