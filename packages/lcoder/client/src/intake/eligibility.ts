/** 立项准入：只有空项目能开新立项分析。 */

import type { SpecProjection } from '../spec/load.ts'

/**
 * 判断项目里是否已有立项产物。
 * @param projection - 规格投影。
 * @returns 需求或任务至少一条时为 true；只有 `project.yaml` 不算。
 */
export function hasIntakeWork(projection: Pick<SpecProjection, 'requirements' | 'tasks'>): boolean {
  return projection.requirements.length > 0 || projection.tasks.length > 0
}
