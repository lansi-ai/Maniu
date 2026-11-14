/** 账号面的展示格式：金额、预估区间、时间与状态键。 */

import type { MessageKey, Translate } from '../locale.ts'
import type { CloudEstimateReason, CloudTokenEstimate } from './cloud.ts'

/** 微美元折成两位美元。 */
export function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`
}

/**
 * 单次花费：不足一分钱时保留四位，免得非零流水被压成 `$0.00`。
 * @param microUsd - 花费，微美元。
 * @returns 美元字符串。
 */
export function usdPrecise(microUsd: number): string {
  if (microUsd !== 0 && Math.abs(microUsd) < 10_000) return `$${(microUsd / 1_000_000).toFixed(4)}`
  return usd(microUsd)
}

/**
 * 一行 token 区间；不可用时给统一提示，绝不显示 0。
 * @param estimate - 云端预估。
 * @param t - 词典。
 * @returns 可直接渲染的一句话。
 */
export function estimateRange(estimate: CloudTokenEstimate | null, t: Translate): string {
  if (estimate === null || !estimate.available) return t('account.estimateUnavailable')
  return t('account.estimateLine', { lower: estimate.lowerBoundTokens, upper: estimate.upperBoundTokens })
}

/**
 * 预估不可用原因的词典键。
 * @param reason - 云端给出的原因。
 * @returns 词典键。
 */
export function estimateReasonKey(reason: CloudEstimateReason | null): MessageKey {
  switch (reason) {
    case 'no_effective_price': return 'account.estimateNoPrice'
    case 'zero_unit_price': return 'account.estimateZeroPrice'
    case 'zero_balance': return 'account.estimateZeroBalance'
    case 'estimate_overflow': return 'account.estimateOverflow'
    case null: return 'account.estimateReasonUnknown'
  }
}

/**
 * ISO 时间折成本地展示；解析失败时原样给出。
 * @param value - 服务端时间。
 * @returns 展示字符串。
 */
export function stamp(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/**
 * 账号状态的词典键。
 * @param status - 服务端状态。
 * @returns 词典键。
 */
export function statusKey(status: string): MessageKey {
  switch (status) {
    case 'active': return 'account.statusActive'
    case 'banned': return 'account.statusBanned'
    case 'deleted': return 'account.statusDeleted'
    default: return 'account.statusUnknown'
  }
}

/**
 * 流水状态的词典键。
 * @param status - 流水状态。
 * @returns 词典键。
 */
export function usageStatusKey(status: 'reserved' | 'settled' | 'released' | 'failed'): MessageKey {
  switch (status) {
    case 'reserved': return 'account.usageReserved'
    case 'settled': return 'account.usageSettled'
    case 'released': return 'account.usageReleased'
    case 'failed': return 'account.usageFailed'
  }
}
