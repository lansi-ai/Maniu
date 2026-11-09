/**
 * 岗位弹窗里的本地推荐：只取 `suggestRole` 推荐的岗位 id，理由与置信度不进入界面。
 *
 * 这里只是展示：不写 `.spec`、不调 `/task_assign`，也不把建议塞进调度判定。
 * 能力天花板直接取 kernel 的 `ROLE_TOOLS`，不在这里抄第二份。
 */
import { ROLE_TOOLS } from '@lcoder/kernel/src/kernel/surface.ts'
import { suggestRole } from '../role-suggest.ts'
import type { SuggestRosterJob } from '../role-suggest.ts'
import type { JobRoleRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'

/**
 * 算出弹窗里该标建议徽标的岗位。
 * @param task - 详情里的任务事实；类型与描述在产品任务里不存在，按空串传入。
 * @param roster - `.spec/roles.yaml` 的岗位行。
 * @param acceptance - 该任务的契约验收条；没有契约时传空数组。
 * @returns 推荐岗位 id；没过阈值、无命中或推荐岗位不在名册时返回 null。
 */
export function recommendedRoleId(
  task: ShellTask,
  roster: readonly JobRoleRow[],
  acceptance: readonly string[],
): string | null {
  const jobs: SuggestRosterJob[] = roster.map(row => ({
    id: row.id,
    name: row.name,
    inherits: row.inherits,
    ...(row.persona === undefined ? {} : { persona: row.persona }),
    ...(row.signals === undefined ? {} : { signals: row.signals }),
  }))
  const suggestion = suggestRole({
    task: {
      id: task.id,
      title: task.title,
      description: '',
      type: '',
      state: task.state,
      dependsOn: task.dependsOn ?? [],
      allowedPaths: task.paths,
    },
    // 契约摘要当前没有可读字段，传空串，不编造。
    contract: { summary: '', irreversible: task.irreversible, acceptance },
    roster: { jobs },
    ceiling: ROLE_TOOLS,
    // 产品任务没有类型字段，无法证明是只读任务，保守按需要写盘处理。
    writeRequired: true,
  })

  const recommended = suggestion.recommended
  if (suggestion.decision !== 'suggest' || recommended === undefined) return null
  return roster.some(job => job.id === recommended.roleId) ? recommended.roleId : null
}
