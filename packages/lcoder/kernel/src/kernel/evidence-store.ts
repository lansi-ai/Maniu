/**
 * 任务证据目录的读侧：文件名（去掉 `.log`）→ 字节数。
 *
 * 带大小的原因与 P4 一致：**存在但空白的证据等于没证据**，只给名字清单判不出来。
 * 三个消费方共用这一份读取：收口判定、契约推进、流程引擎；路径规则只写一次。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 证据文件的存放目录。
 * @param root - 规格根。
 * @param taskId - 任务编号。
 * @returns 该任务的证据目录。
 */
export function evidenceDir(root: string, taskId: string): string {
  return join(root, 'evidence', taskId)
}

/**
 * 读一条任务的全部证据。
 * @param root - 规格根。
 * @param taskId - 任务编号。
 * @returns 证据名（去 `.log`）到字节数；目录不存在返回空表。
 */
export function loadEvidence(root: string, taskId: string): Record<string, number> {
  const dir = evidenceDir(root, taskId)
  if (!existsSync(dir)) return {}

  const out: Record<string, number> = {}
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isFile()) continue
    out[name.replace(/\.log$/, '')] = statSync(full).size
  }
  return out
}

/**
 * 评审复核证据的可辨识约定：证据名以 `review` 开头（`review.log`、`review-round-2.log`）。
 *
 * 这是 AI 自签第三道闸的机械判据。空文件不算复核，和 P4 同一口径。
 * @param evidence - `loadEvidence` 的结果。
 * @returns 至少一条非空评审证据时为 true。
 */
export function hasReviewEvidence(evidence: Readonly<Record<string, number>>): boolean {
  return Object.entries(evidence).some(([name, bytes]) => /^review(?:[-_].*)?$/u.test(name) && bytes > 0)
}
