/**
 * 任务详情「建议岗位」卡片的视图数据：把本地建议层的结果收敛成界面要画的
 * 三个候选、一个状态标签与一句被排除说明。
 *
 * 卡片只是排序展示：这里不写 `.spec`、不调 `/task_assign`，也不把建议塞进调度判定。
 * 能力天花板直接取 kernel 的 `ROLE_TOOLS`，不在这里抄第二份。
 */
import { ROLE_TOOLS } from '@lcoder/kernel/src/kernel/surface.ts'
import { suggestRole } from '../role-suggest.ts'
import type { RoleDisqualification, RoleReason, SuggestRosterJob } from '../role-suggest.ts'
import type { JobRoleRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'

/** 卡片顶部的状态：过阈值给建议、有候选但要人挑、没有任何名册岗位命中。 */
export type RoleCardStatus = 'suggest' | 'needs_human' | 'fallback'

/** 一个展示候选；`reasons` 已截到两条，仍是 code 加参数，文案由界面按 locales 渲染。 */
export interface RoleCardCandidate {
  readonly roleId: string
  /** 名册里的显示名；兜底的内置角色直接显示 id。 */
  readonly label: string
  /** 候选分占比，界面换算成百分比。 */
  readonly confidence: number
  readonly reasons: readonly RoleReason[]
}

/** 卡片要画的一切；`canAdopt` 为 true 时才有采用按钮。 */
export interface RoleCardView {
  readonly status: RoleCardStatus
  /** 最多三个候选，不含被否决项。 */
  readonly candidates: readonly RoleCardCandidate[]
  /** 是否提供采用按钮；只有推荐候选确实是名册岗位时才为 true。 */
  readonly canAdopt: boolean
  /** 推荐候选的岗位 id；`canAdopt` 为 true 时必有值。 */
  readonly adoptRoleId?: string
  /** 被否决的候选条数；0 表示没有。 */
  readonly disqualified: number
  /** 被否决的第一条原因；没有否决项时不出现。 */
  readonly disqualifiedReason?: RoleDisqualification
  /** 建议层按「需要写盘」处理；界面把这条判定如实写给用户看。 */
  readonly writeRequired: boolean
}

const MAX_CANDIDATES = 3
const MAX_REASONS = 2

/**
 * 生成详情卡片的视图数据。
 * @param task - 详情里的任务事实；类型与描述在产品任务里不存在，按空串传入。
 * @param roster - `.spec/roles.yaml` 的岗位行。
 * @param acceptance - 该任务的契约验收条；没有契约时传空数组。
 * @returns 状态、候选、采用能力与排除说明。
 */
export function buildRoleCard(
  task: ShellTask,
  roster: readonly JobRoleRow[],
  acceptance: readonly string[],
): RoleCardView {
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

  const scored = suggestion.candidates.filter(candidate =>
    candidate.disqualified === undefined && candidate.score > 0)
  const fallback = scored.length === 0
  const recommendedId = suggestion.recommended?.roleId
  const adoptable = recommendedId !== undefined && roster.some(job => job.id === recommendedId)
  const status: RoleCardStatus = suggestion.decision === 'suggest' && adoptable
    ? 'suggest'
    : fallback ? 'fallback' : 'needs_human'

  const shown = fallback ? suggestion.candidates.slice(0, 1) : scored.slice(0, MAX_CANDIDATES)
  const candidates: RoleCardCandidate[] = shown.map(candidate => ({
    roleId: candidate.roleId,
    label: roster.find(job => job.id === candidate.roleId)?.name ?? candidate.roleId,
    confidence: candidate.confidence,
    reasons: candidate.reasons.slice(0, MAX_REASONS),
  }))

  const disqualified = suggestion.candidates.filter(candidate => candidate.disqualified !== undefined)
  const firstReason = disqualified[0]?.disqualified

  return {
    status,
    candidates,
    canAdopt: status === 'suggest' && adoptable,
    ...(status === 'suggest' && adoptable ? { adoptRoleId: recommendedId } : {}),
    disqualified: disqualified.length,
    ...(firstReason === undefined ? {} : { disqualifiedReason: firstReason }),
    writeRequired: true,
  }
}
