/**
 * 佣金计算。R-02 的落点。
 *
 * fixture 用途：这是被 LCoder 检查的最小真实代码，
 * 名字改动会让 P1 的落点校验失败——那正是它该做的事。
 */
export function calculateCommission(paid: number, rate: number): number {
  const raw = Math.round(paid * rate * 100) / 100
  return Math.max(raw, 1)
}
