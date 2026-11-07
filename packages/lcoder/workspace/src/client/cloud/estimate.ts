/**
 * token 预估与金额的展示格式。
 *
 * 区间数值由云端算好；桌面只做插值与格式化，不含任何单价常量。
 */
import type { CloudEstimateReason, CloudState, CloudTokenEstimate } from '@lcoder/kernel/src/cloud/types.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'

/** 弹窗与个人中心共用的翻译函数。 */
export type CloudTranslate = (key: LcoderWorkspaceKey) => string

/** 补词典占位符。 */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text)
}

/** 微美元折成两位美元。 */
export function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`
}

/**
 * 单次请求的花费：不足一分钱时保留四位，免得非零流水被压成 `$0.00`。
 * @param microUsd - 花费，微美元。
 * @returns 美元字符串。
 */
export function usdPrecise(microUsd: number): string {
  if (microUsd !== 0 && Math.abs(microUsd) < 10_000) return `$${(microUsd / 1_000_000).toFixed(4)}`
  return usd(microUsd)
}

/**
 * 当前该展示哪份预估：登录后看账号，匿名看当日授权。
 * @param state - 登录状态。
 * @returns 预估；两者都没有时返回 null。
 */
export function activeEstimate(state: CloudState | null): CloudTokenEstimate | null {
  if (state === null) return null
  return state.estimate ?? state.guest?.estimate ?? null
}

/**
 * 一行 token 区间摘要；不可用时给出统一提示，绝不显示 0。
 * @param estimate - 云端预估。
 * @param t - 词典。
 * @returns 可直接渲染的一句话。
 */
export function estimateRange(estimate: CloudTokenEstimate | null, t: CloudTranslate): string {
  if (estimate === null || !estimate.available) return t('shell.cloudEstimateUnavailable')
  return fill(t('shell.cloudEstimateLine'), {
    lower: estimate.lowerBoundTokens,
    upper: estimate.upperBoundTokens,
  })
}

/**
 * 不可用原因对应的词典键。
 * @param reason - 云端给出的原因；缺省走通用文案。
 * @returns 词典键。
 */
export function estimateReasonKey(reason: CloudEstimateReason | null): LcoderWorkspaceKey {
  switch (reason) {
    case 'no_effective_price': return 'shell.cloudEstimateNoPrice'
    case 'zero_unit_price': return 'shell.cloudEstimateZeroPrice'
    case 'zero_balance': return 'shell.cloudEstimateZeroBalance'
    case 'estimate_overflow': return 'shell.cloudEstimateOverflow'
    case null: return 'shell.cloudEstimateUnknown'
  }
}
