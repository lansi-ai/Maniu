/** 原型重新生成的悬浮任务卡：把生成会话映射成统一浮卡事实，供原型页与需求详情共用。 */

import type { OpLiveFeed } from '../shell/op-live-feed.ts'
import type { OperationCardView, OperationStatus, OperationStep, OperationStepState } from '../shell/operation-cards.tsx'
import type { Translate } from '../locale.ts'

/** 构造一张原型生成浮卡所需的事实。 */
export interface PrototypeRegenCardInput {
  readonly sessionId: string
  readonly status: OperationStatus
  readonly minimized: boolean
  readonly t: Translate
  readonly liveFeed?: OpLiveFeed | undefined
}

/**
 * 同一生成会话的固定卡片键；重复发起会换新会话，因此不会复用旧卡。
 * @param sessionId - 生成会话标识。
 * @returns 浮卡键。
 */
export function prototypeRegenCardKey(sessionId: string): string {
  return `prototype-regen:${sessionId}`
}

/** 步骤状态：发起后写原型，产出落盘后整卡完成；失败停在写原型。 */
function stepStates(status: OperationStatus): readonly OperationStepState[] {
  if (status === 'running') return ['done', 'active', 'pending']
  if (status === 'done') return ['done', 'done', 'done']
  return ['done', 'failed', 'pending']
}

/**
 * 把生成会话的进度映射成统一浮卡：标题、岗位、三步清单、实时过程与对话入口。
 * @param input - 会话标识、运行状态、最小化态、取词函数与实时过程快照。
 * @returns 可直接交给 OperationCards 的卡片事实。
 */
export function prototypeRegenCardView(input: PrototypeRegenCardInput): OperationCardView {
  const { sessionId, status, minimized, t, liveFeed } = input
  const labels = [
    t('prototype.opStepStarted'),
    t('prototype.opStepWriting'),
    t('prototype.opStepStaged'),
  ]
  const states = stepStates(status)
  const steps: readonly OperationStep[] = labels.map((label, index) => ({
    label,
    state: states[index] ?? 'pending',
  }))
  return {
    key: prototypeRegenCardKey(sessionId),
    title: t('prototype.opCardTitle'),
    roleLabel: t('op.roleName.prototype'),
    sourceLabel: t('prototype.opCardSource'),
    status,
    statusText: status === 'running'
      ? t('prototype.opCardRunning')
      : status === 'done'
        ? t('prototype.opCardDone')
        : t('prototype.opCardFailed'),
    steps,
    sessionId,
    minimized,
    ...(liveFeed === undefined ? {} : { liveFeed }),
  }
}
