/**
 * AI 自签的三道补偿闸：策略允许、任务无可逆项、契约有评审复核证据。
 *
 * 三条必须**同时**成立。这不是「AI 也可以签」的授权，而是把「签署只能是人」这条前提
 * 打开后用来兜住 P3 的替代约束——少任何一条，模型给自己签字就会重新变成默认能力。
 * 判定是纯函数：流程引擎、人机命令与 P3 检查器共用同一份口径，不各写一套。
 */

/** 未通过的那一道闸；顺序固定，便于回执稳定。 */
export type SelfSignGateId = 'policy' | 'irreversible' | 'review'

/** 三道闸的输入事实。 */
export interface SelfSignCheck {
  /** `automation.yaml` 里 `sign` 是否为 `auto`。 */
  readonly signAuto: boolean
  /** 任务的 `scope.irreversible`。 */
  readonly irreversible: readonly string[]
  /** 是否有非空的评审复核证据（`review*` 前缀，见 `hasReviewEvidence`）。 */
  readonly reviewEvidence: boolean
}

/** 判定结果；`failed` 为空即三闸全部成立。 */
export interface SelfSignGateResult {
  readonly allowed: boolean
  readonly failed: readonly SelfSignGateId[]
}

/**
 * 求一次自签判定。
 * @param check - 三道闸的输入事实。
 * @returns 是否允许，以及未通过的那几道。
 */
export function evaluateSelfSignGate(check: SelfSignCheck): SelfSignGateResult {
  const failed: SelfSignGateId[] = []
  if (!check.signAuto) failed.push('policy')
  if (check.irreversible.length > 0) failed.push('irreversible')
  if (!check.reviewEvidence) failed.push('review')
  return { allowed: failed.length === 0, failed }
}

/**
 * 未通过时给人看的一句话。顺序与 `evaluateSelfSignGate` 一致。
 * @param result - 未通过的判定结果。
 * @returns 说明；全部通过时给空串。
 */
export function describeSelfSignFailure(result: SelfSignGateResult): string {
  const reasons = result.failed.map((gate): string => {
    switch (gate) {
      case 'policy':
        return '策略里签署不是 auto'
      case 'irreversible':
        return '任务触及不可逆项，只能由人签'
      case 'review':
        return '缺少评审复核证据（review*.log）'
      default:
        return gate
    }
  })
  return reasons.join('；')
}
