/**
 * 任务详情「分配岗位」芯片上的内联建议：推荐直接标在现有岗位上，
 * 芯片下方只留一行依据，不再单独列候选清单。
 *
 * 这里只是展示：不写 `.spec`、不调 `/task_assign`，也不把建议塞进调度判定。
 * 能力天花板直接取 kernel 的 `ROLE_TOOLS`，不在这里抄第二份。
 */
import { ROLE_TOOLS } from '@lcoder/kernel/src/kernel/surface.ts'
import { suggestRole } from '../role-suggest.ts'
import type { RoleReason, SuggestRosterJob } from '../role-suggest.ts'
import type { JobRoleRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'

/** 内联建议的三种状态：过阈值推荐一个岗位、有候选但要人挑、没有任何名册岗位命中。 */
export type RoleHintStatus = 'suggest' | 'needs_human' | 'fallback'

/** 需要人工挑选的原因；界面按 code 查 locales 拼进那一行说明。 */
export type RoleHintBlocker = 'irreversible' | 'low_confidence'

/** 推荐岗位与依据行要用的理由；`reasons` 已截到两条。 */
export interface RoleHintRecommendation {
  readonly roleId: string
  /** 候选分占比，界面换算成百分比。 */
  readonly confidence: number
  readonly reasons: readonly RoleReason[]
}

/**
 * 内联建议要画的一切。
 *
 * 只有 `suggest` 带推荐岗位与采用动作；另外两态不标任何芯片，只给一句人工提示。
 */
export type RoleHintView =
  | { readonly status: 'suggest'; readonly recommended: RoleHintRecommendation; readonly canAdopt: true }
  | { readonly status: 'needs_human'; readonly blocker: RoleHintBlocker }
  | { readonly status: 'fallback' }

const MAX_REASONS = 2

/**
 * 生成芯片内联建议的视图数据。
 * @param task - 详情里的任务事实；类型与描述在产品任务里不存在，按空串传入。
 * @param roster - `.spec/roles.yaml` 的岗位行。
 * @param acceptance - 该任务的契约验收条；没有契约时传空数组。
 * @returns 三态之一；推荐态附岗位、置信度与最多两条理由。
 */
export function buildRoleHint(
  task: ShellTask,
  roster: readonly JobRoleRow[],
  acceptance: readonly string[],
): RoleHintView {
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

  const positive = suggestion.candidates.filter(candidate =>
    candidate.disqualified === undefined && candidate.score > 0)
  const recommended = suggestion.recommended
  if (suggestion.decision === 'suggest' && recommended !== undefined && roster.some(job => job.id === recommended.roleId)) {
    const candidate = suggestion.candidates.find(entry => entry.roleId === recommended.roleId)
    return {
      status: 'suggest',
      recommended: {
        roleId: recommended.roleId,
        confidence: recommended.confidence,
        reasons: candidate?.reasons.slice(0, MAX_REASONS) ?? [],
      },
      canAdopt: true,
    }
  }

  if (positive.length === 0) return { status: 'fallback' }
  if (task.irreversible.length > 0) return { status: 'needs_human', blocker: 'irreversible' }
  return { status: 'needs_human', blocker: 'low_confidence' }
}
