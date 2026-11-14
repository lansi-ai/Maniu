/** 更新检查：新壳尚未接入更新源，先给出可解释的空态。 */

import { app } from 'electron'
import type { UpdateCheck } from './contract.ts'

/**
 * 检查一次更新。
 *
 * 没有更新源时返回 `unavailable`：这是构建形态事实，不是网络失败。接入
 * `electron-updater` 后在这里换成真实检查，IPC 与界面无需改动。
 * @returns 当前版本与检查结果。
 */
export function checkUpdate(): UpdateCheck {
  return { kind: 'unavailable', version: app.getVersion(), reason: 'no-feed' }
}
