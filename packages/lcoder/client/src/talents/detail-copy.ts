/** 内置角色详情的人设摘要与工具白话说明：按预设 id 与工具名对齐中英词典。 */

import type { MessageKey } from '../locale.ts'

/** 内置角色的人设摘要；正文仍是模型唯一源，这份只用于详情展示。 */
const PERSONA_SUMMARIES: Readonly<Record<string, MessageKey>> = {
  maniu: 'talents.personaSummary.maniu',
  'maniu-intake': 'talents.personaSummary.maniu-intake',
  'maniu-architect': 'talents.personaSummary.maniu-architect',
  'maniu-review': 'talents.personaSummary.maniu-review',
  'maniu-pm': 'talents.personaSummary.maniu-pm',
  'maniu-git': 'talents.personaSummary.maniu-git',
  'maniu-ops': 'talents.personaSummary.maniu-ops',
  'maniu-scheduler': 'talents.personaSummary.maniu-scheduler',
  'maniu-flow': 'talents.personaSummary.maniu-flow',
  'maniu-manager': 'talents.personaSummary.maniu-manager',
  'maniu-prototype': 'talents.personaSummary.maniu-prototype',
}

/** 工具面的白话说明；只影响显示，工具名与 schema 不变。 */
const TOOL_COPIES: Readonly<Record<string, MessageKey>> = {
  file_read: 'talents.tool.file_read',
  file_list: 'talents.tool.file_list',
  file_edit: 'talents.tool.file_edit',
  cmd_run: 'talents.tool.cmd_run',
  evidence_attach: 'talents.tool.evidence_attach',
  git_status: 'talents.tool.git_status',
  git_diff: 'talents.tool.git_diff',
  git_commit: 'talents.tool.git_commit',
  project_draft: 'talents.tool.project_draft',
  proposal_draft: 'talents.tool.proposal_draft',
  requirement_draft: 'talents.tool.requirement_draft',
  role_draft: 'talents.tool.role_draft',
  spec_query: 'talents.tool.spec_query',
  spec_draft: 'talents.tool.spec_draft',
  spec_bind: 'talents.tool.spec_bind',
  contract_draft: 'talents.tool.contract_draft',
  task_read: 'talents.tool.task_read',
  task_draft: 'talents.tool.task_draft',
  task_close: 'talents.tool.task_close',
  deliverable_draft: 'talents.tool.deliverable_draft',
  ask_user_question: 'talents.tool.ask_user_question',
  prototype_draft: 'talents.tool.prototype_draft',
  subagent: 'talents.tool.subagent',
}

/**
 * 内置角色人设摘要对应的词典键。
 * @param presetId - 预设 id。
 * @returns 摘要键；未收录时为 undefined，由调用方回退到预设描述。
 */
export function personaSummaryKeyOf(presetId: string): MessageKey | undefined {
  return PERSONA_SUMMARIES[presetId]
}

/**
 * 工具名的白话说明键。
 * @param toolName - 工具面里的工具名。
 * @returns 说明键；未收录时为 undefined，由调用方回退到宿主返回的描述。
 */
export function toolCopyKeyOf(toolName: string): MessageKey | undefined {
  return TOOL_COPIES[toolName]
}
