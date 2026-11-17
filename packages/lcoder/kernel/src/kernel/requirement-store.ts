/**
 * 需求对象的读写、编号分配与正文落盘。
 *
 * 与 `task-store`、`proposal-store` 同一条口径：编号形态稳定（`REQ-01`）、写盘前过 schema、
 * 按 id 排序读回。正文另写同名 `.md`——YAML 只记事实，Markdown 记人读的内容。
 *
 * 起草是一次两文件写入：先写正文再写 YAML，任一步失败都要把先写的那份删掉，
 * 不让磁盘上留下「有正文没有元数据」或反过来的半截需求。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { Requirement, RequirementSplitPlan } from '../schema/spec.js'
import type { RequirementOption, RequirementVersion } from '../schema/spec.js'
import { listFiles, matchPattern } from '../schema/validate.js'

/** 需求编号的唯一形态：`REQ-` 加两位以上数字。 */
const REQUIREMENT_ID = /^REQ-\d{2,}$/

const REQUIREMENTS_DIR = 'requirements'

/**
 * 校验需求编号形态，不合法就抛。
 * @param id - 调用方（模型、命令或 UI）给出的编号。
 * @returns 原样返回校验过的编号。
 */
export function assertRequirementId(id: string): string {
  if (!REQUIREMENT_ID.test(id)) {
    throw new Error(`非法的需求编号：${id}（应形如 REQ-01）`)
  }
  return id
}

/**
 * 列出已占用的需求编号，只读文件名，不解析内容——坏文件不该挡住下一条需求的编号分配。
 * @param root - 规格根。
 * @returns 按字典序排序的 `REQ-` 编号；目录不存在时为空数组。
 */
export function listRequirementIds(root: string): string[] {
  if (!existsSync(root)) return []
  return listFiles(root)
    .filter(file => matchPattern(`${REQUIREMENTS_DIR}/*.yaml`, file))
    .map(file => file.slice(REQUIREMENTS_DIR.length + 1).replace(/\.yaml$/, ''))
    .filter(id => /^REQ-\d+$/.test(id))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 下一个可用的 `REQ-<序号>` 编号：取现有编号的最大序号加一，两位起排。
 * 其它前缀的文件不参与计数，示例数据不会挤占正式编号。
 * @param ids - 已占用的需求编号。
 * @returns 未被占用的编号。
 */
export function nextRequirementId(ids: readonly string[]): string {
  let max = 0
  for (const id of ids) {
    const digits = /^REQ-(\d+)$/.exec(id)?.[1]
    if (digits !== undefined) max = Math.max(max, Number.parseInt(digits, 10))
  }
  return `REQ-${String(max + 1).padStart(2, '0')}`
}

/**
 * 需求元数据文件的落点。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns `requirements/<id>.yaml` 的绝对路径。
 */
export function requirementPath(root: string, id: string): string {
  return join(root, REQUIREMENTS_DIR, `${id}.yaml`)
}

/**
 * 需求正文文件的落点。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns `requirements/<id>.md` 的绝对路径。
 */
export function requirementDocPath(root: string, id: string): string {
  return join(root, REQUIREMENTS_DIR, `${id}.md`)
}

/**
 * 需求版本快照文件的落点。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param version - 版本号。
 * @returns `requirements/<id>/versions/v<n>.md` 的绝对路径。
 */
export function requirementVersionPath(root: string, id: string, version: number): string {
  return join(root, REQUIREMENTS_DIR, id, 'versions', `v${String(version)}.md`)
}

/**
 * 需求评审报告文件的落点。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param round - 评审轮次。
 * @returns `requirements/<id>/reviews/R<n>.md` 的绝对路径。
 */
export function requirementReviewPath(root: string, id: string, round: number): string {
  return join(root, REQUIREMENTS_DIR, id, 'reviews', `R${String(round)}.md`)
}

/**
 * 拆分岗位建议文件的落点。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns `requirements/<id>/split-plan.yaml` 的绝对路径。
 */
export function requirementSplitPlanPath(root: string, id: string): string {
  return join(root, REQUIREMENTS_DIR, id, 'split-plan.yaml')
}

/**
 * 评审记录里的报告路径：相对 `.spec` 根目录，统一用 `/` 分隔。
 * @param id - 需求编号。
 * @param round - 评审轮次。
 * @returns 如 `requirements/REQ-01/reviews/R1.md` 的相对路径。
 */
export function requirementReviewRelativePath(id: string, round: number): string {
  return `${REQUIREMENTS_DIR}/${id}/reviews/R${String(round)}.md`
}

/** 建目录并写文本；版本快照与评审报告共用这一个落盘口。 */
function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/**
 * 写一条需求：先过 schema，再落盘。
 * @param root - 规格根。
 * @param requirement - 待写的需求。
 * @returns 落盘路径。
 */
export function saveRequirement(root: string, requirement: Requirement): string {
  const path = requirementPath(root, requirement.id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(Requirement.parse(requirement)), 'utf8')
  return path
}

/**
 * 读一条需求。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns 解析后的需求；文件不存在或形状不合都会抛。
 */
export function loadRequirement(root: string, id: string): Requirement {
  return Requirement.parse(parseYaml(readFileSync(requirementPath(root, id), 'utf8')))
}

/**
 * 列出全部需求元数据。
 * @param root - 规格根。
 * @returns 按编号排序的需求；`requirements/` 不存在时为空数组。
 */
export function listRequirements(root: string): Requirement[] {
  if (!existsSync(root)) return []
  return listFiles(root)
    .filter(file => matchPattern(`${REQUIREMENTS_DIR}/*.yaml`, file))
    .map(file => Requirement.parse(parseYaml(readFileSync(join(root, file), 'utf8'))))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * 读需求正文；只把普通文件当正文，空白的正文按缺失处理。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns 正文原文；文件不存在、不是普通文件或去空白后为空时返回 undefined。
 */
export function readRequirementDocument(root: string, id: string): string | undefined {
  const path = requirementDocPath(root, id)
  if (!existsSync(path) || !statSync(path).isFile()) return undefined
  const text = readFileSync(path, 'utf8')
  return text.trim() === '' ? undefined : text
}

/** 起草一条需求所需的输入。 */
export interface RequirementDraftInput {
  readonly title: string
  /** 完整 Markdown 正文；调用方已确认去空白后非空。 */
  readonly content: string
  readonly options?: readonly RequirementOption[]
  readonly recommendation?: string
  readonly opened_at: string
}

/** 一次起草的落盘结果。 */
export interface RequirementDraft {
  readonly requirement: Requirement
  readonly yamlPath: string
  readonly documentPath: string
  /** 正文字符数（去首尾空白后）。 */
  readonly characters: number
}

/**
 * 建一条新需求：分配编号，先写正文与 v1 快照，再写元数据，任一步失败回滚已写的文件。
 *
 * 编号只增不覆盖：目标文件已存在就拒绝，避免把别人的需求悄悄替换掉。
 * @param root - 规格根。
 * @param input - 标题、正文、候选与推荐。
 * @returns 落盘的需求与两个路径。
 */
export function createRequirement(root: string, input: RequirementDraftInput): RequirementDraft {
  const id = nextRequirementId(listRequirementIds(root))
  const yamlPath = requirementPath(root, id)
  const documentPath = requirementDocPath(root, id)
  const versionPath = requirementVersionPath(root, id, 1)
  if (existsSync(yamlPath) || existsSync(documentPath)) {
    throw new Error(`需求编号 ${id} 已被占用；先清理占用它的文件再起草`)
  }

  mkdirSync(dirname(yamlPath), { recursive: true })
  writeFileSync(documentPath, input.content, 'utf8')
  const version: RequirementVersion = { n: 1, at: input.opened_at }
  try {
    writeText(versionPath, input.content)
  } catch (error) {
    rmSync(documentPath, { force: true })
    throw error
  }
  const requirement: Requirement = {
    id,
    title: input.title,
    state: 'draft',
    options: [...(input.options ?? [])],
    ...(input.recommendation === undefined ? {} : { recommendation: input.recommendation }),
    opened_at: input.opened_at,
    versions: [version],
    reviews: [],
  }
  try {
    saveRequirement(root, requirement)
  } catch (error) {
    // 元数据写失败时删掉刚写的正文与快照：留下半截需求比什么都不留更难收拾。
    rmSync(versionPath, { force: true })
    rmSync(documentPath, { force: true })
    throw error
  }
  return {
    requirement,
    yamlPath,
    documentPath,
    characters: input.content.trim().length,
  }
}

/** 一次改稿所需的输入。 */
export interface RequirementRevisionInput {
  /** 新的完整 Markdown 正文；调用方已确认去空白后非空。 */
  readonly content: string
  readonly at: string
  /** 这一版的说明；缺省表示没有特别说明。 */
  readonly note?: string
}

/** 一次改稿的落盘结果。 */
export interface RequirementRevision {
  readonly requirement: Requirement
  /** 这次写下的版本号。 */
  readonly version: number
  readonly documentPath: string
  /** 这一版快照的绝对路径。 */
  readonly snapshotPath: string
  /** 改稿前是否先补录了旧正文的 v1。 */
  readonly backfilled: boolean
}

/** 确保某个正文有一份对应快照后的版本表；`created` 是本次新建的文件，供失败回滚。 */
interface EnsuredVersions {
  readonly versions: RequirementVersion[]
  readonly version: number
  readonly created: string[]
}

/**
 * 确保当前正文有一份对应快照：没有版本时补 v1，快照文件缺失时补写，
 * 正文与最新快照不一致时追加一版。改稿与过审共用这一条保障。
 */
function ensureCurrentVersion(
  root: string,
  id: string,
  requirement: Requirement,
  document: string,
  at: string,
): EnsuredVersions {
  const versions = [...requirement.versions]
  const created: string[] = []
  const latest = versions[versions.length - 1]

  if (latest === undefined) {
    const path = requirementVersionPath(root, id, 1)
    writeText(path, document)
    created.push(path)
    versions.push({ n: 1, at })
    return { versions, version: 1, created }
  }

  const snapshotPath = requirementVersionPath(root, id, latest.n)
  const snapshot = existsSync(snapshotPath) && statSync(snapshotPath).isFile()
    ? readFileSync(snapshotPath, 'utf8')
    : undefined
  if (snapshot === undefined) {
    writeText(snapshotPath, document)
    created.push(snapshotPath)
    return { versions, version: latest.n, created }
  }
  if (snapshot !== document) {
    const n = latest.n + 1
    const path = requirementVersionPath(root, id, n)
    writeText(path, document)
    created.push(path)
    versions.push({ n, at })
    return { versions, version: n, created }
  }
  return { versions, version: latest.n, created }
}

/**
 * 改一条需求的正文：先确保当前正文有版本快照（旧需求补 v1），
 * 再把新正文写成下一个版本，最后写元数据。
 *
 * 文件全部写完才写 YAML；任一步失败都还原正文并删掉本次新建的快照，
 * 不让磁盘留下「正文换了但版本表没记」或反过来的半截。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param input - 新正文、时刻与可选说明。
 * @returns 落盘后的需求、版本号与快照路径。
 */
export function reviseRequirement(root: string, id: string, input: RequirementRevisionInput): RequirementRevision {
  const requirement = loadRequirement(root, id)
  const documentPath = requirementDocPath(root, id)
  const previous = readRequirementDocument(root, id)
  if (previous === undefined) {
    throw new Error(`${id} 还没有正文（${documentPath} 不存在或为空）；先补正文再改稿`)
  }

  const backfilled = requirement.versions.length === 0
  const created: string[] = []
  try {
    const ensured = ensureCurrentVersion(root, id, requirement, previous, input.at)
    created.push(...ensured.created)
    const next = ensured.versions.reduce((max, version) => Math.max(max, version.n), 0) + 1
    const snapshotPath = requirementVersionPath(root, id, next)
    const versions = [
      ...ensured.versions,
      { n: next, at: input.at, ...(input.note === undefined ? {} : { note: input.note }) },
    ]
    writeFileSync(documentPath, input.content, 'utf8')
    writeText(snapshotPath, input.content)
    created.push(snapshotPath)
    const revised: Requirement = { ...requirement, versions }
    saveRequirement(root, revised)
    return { requirement: revised, version: next, documentPath, snapshotPath, backfilled }
  } catch (error) {
    writeFileSync(documentPath, previous, 'utf8')
    for (const path of created) rmSync(path, { force: true })
    throw error
  }
}

/** 一次评审落盘所需的输入。 */
export interface RequirementReviewInput {
  /** 评审报告的 Markdown 正文。 */
  readonly report: string
  readonly at: string
  /** 产出这轮评审的会话号；缺省表示没有会话来源。 */
  readonly sessionId?: string
  /** 产出这轮评审的会话 preset id（署名）；缺省表示旧式无署名评审。 */
  readonly role?: string
}

/** 一次评审落盘的结果。 */
export interface RequirementReviewResult {
  readonly requirement: Requirement
  readonly round: number
  readonly reportPath: string
  /** 落进 YAML 的规格根相对路径。 */
  readonly relativeReport: string
}

/**
 * 追加一轮评审：先写报告文件，再把轮次记进 YAML；YAML 失败时删掉报告。
 *
 * 只追加 `reviews`，不改状态与正文——评审只出报告，改稿由需求分析师另一条工具做。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param input - 报告正文、时刻、可选会话号与产出会话的 preset 署名。
 * @returns 落盘后的需求、轮次与报告路径。
 */
export function recordRequirementReview(root: string, id: string, input: RequirementReviewInput): RequirementReviewResult {
  const requirement = loadRequirement(root, id)
  const round = requirement.reviews.reduce((max, review) => Math.max(max, review.round), 0) + 1
  const reportPath = requirementReviewPath(root, id, round)
  const relativeReport = requirementReviewRelativePath(id, round)
  writeText(reportPath, input.report)

  const reviewed: Requirement = {
    ...requirement,
    reviews: [
      ...requirement.reviews,
      {
        round,
        at: input.at,
        report: relativeReport,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.role === undefined ? {} : { role: input.role }),
      },
    ],
  }
  try {
    saveRequirement(root, reviewed)
  } catch (error) {
    rmSync(reportPath, { force: true })
    throw error
  }
  return { requirement: reviewed, round, reportPath, relativeReport }
}

/**
 * 写一份拆分岗位建议：先过 schema，再整文件覆盖上一份计划。
 *
 * 计划只是建议，不带任务状态；分配仍由人机命令写进任务。
 * @param root - 规格根。
 * @param plan - 需求编号、生成时刻与逐条建议。
 * @returns 写入的路径。
 */
export function saveSplitPlan(root: string, plan: RequirementSplitPlan): string {
  const path = requirementSplitPlanPath(root, plan.requirement)
  writeText(path, stringifyYaml(RequirementSplitPlan.parse(plan)))
  return path
}

/**
 * 读一份拆分岗位建议。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @returns 解析后的计划；文件不存在时为 undefined，形状不合会抛。
 */
export function loadSplitPlan(root: string, id: string): RequirementSplitPlan | undefined {
  const path = requirementSplitPlanPath(root, id)
  if (!existsSync(path)) return undefined
  return RequirementSplitPlan.parse(parseYaml(readFileSync(path, 'utf8')))
}

/** 一次过审落盘的结果。 */
export interface RequirementApproval {
  readonly requirement: Requirement
  /** `approved_version` 指向的版本号。 */
  readonly approvedVersion: number
}

/**
 * 人过审：确保当前正文有对应快照，再写状态、过审时刻与批准版本。
 *
 * 旧需求没有版本表时补录 v1；已有版本但快照文件缺失时补写同一版；
 * 正文与最新快照不一致时追加一版，保证 `approved_version` 指的是当前正文。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param at - 过审时刻。
 * @returns 落盘后的需求与批准版本号。
 */
export function approveRequirement(root: string, id: string, at: string): RequirementApproval {
  const requirement = loadRequirement(root, id)
  const document = readRequirementDocument(root, id)
  if (document === undefined) {
    throw new Error(`${id} 还没有正文（${requirementDocPath(root, id)} 不存在或为空）；先补正文再过审`)
  }

  const created: string[] = []
  try {
    const ensured = ensureCurrentVersion(root, id, requirement, document, at)
    created.push(...ensured.created)
    const approved: Requirement = {
      ...requirement,
      versions: ensured.versions,
      state: 'confirmed',
      confirmed_at: at,
      approved_at: at,
      approved_version: ensured.version,
    }
    saveRequirement(root, approved)
    return { requirement: approved, approvedVersion: ensured.version }
  } catch (error) {
    for (const path of created) rmSync(path, { force: true })
    throw error
  }
}
