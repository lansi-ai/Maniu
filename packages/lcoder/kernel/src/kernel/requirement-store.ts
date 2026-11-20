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
import type { RequirementOption, RequirementReview, RequirementVersion } from '../schema/spec.js'
import { listFiles, matchPattern } from '../schema/validate.js'
import { loadFlowConfig, missingReviewRootSet, presetBuiltinRoot } from './flow-config.js'

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
  /** v1 快照的说明；缺省表示没有特别说明。提案落盘用它记录来源（基于哪条需求哪一版，或对话新建）。 */
  readonly note?: string
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
  const version: RequirementVersion = {
    n: 1,
    at: input.opened_at,
    ...(input.note === undefined ? {} : { note: input.note }),
  }
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
    // 改稿就是「采纳并修改需求」：把所有还没处置的轮次一并标已采纳，关联这次写下的版本；
    // 已终态的轮次不动。reviews 与 versions 在同一次 saveRequirement 里落盘。
    const reviews = requirement.reviews.map(review =>
      review.decision === undefined || review.decision === 'pending'
        ? { ...review, decision: 'accepted' as const, decided_at: input.at, applied_version: next }
        : review,
    )
    const revised: Requirement = { ...requirement, versions, reviews }
    saveRequirement(root, revised)
    return { requirement: revised, version: next, documentPath, snapshotPath, backfilled }
  } catch (error) {
    writeFileSync(documentPath, previous, 'utf8')
    for (const path of created) rmSync(path, { force: true })
    throw error
  }
}

/**
 * 原地修改起草态需求的正文：只重写 `.md`，不增版本、不写快照、不改元数据与评审记录。
 *
 * 应用前重新核对目标仍是草稿、正文存在且与提案基线逐字一致；被其他操作改动则拒绝，
 * 让调用方保留提案并提示重新生成。返回改写前的正文，供提案批准态写失败时回滚。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param baseContent - 提案生成时宿主读到的草稿正文。
 * @param content - 新的完整正文。
 * @returns 改写前的正文原文。
 */
export function patchRequirementDraft(root: string, id: string, baseContent: string, content: string): string {
  const requirement = loadRequirement(root, id)
  if (requirement.state !== 'draft') {
    throw new Error(`${id} 现在在「${requirement.state}」，只有起草态需求能原地修改正文`)
  }
  const current = readRequirementDocument(root, id)
  if (current === undefined) {
    throw new Error(`${id} 还没有正文（${requirementDocPath(root, id)} 不存在或为空）；先补正文再修改`)
  }
  if (current !== baseContent) {
    throw new Error(`${id} 的正文已与提案基线不一致（可能已被其他操作改动）；请重新生成修改提案后再应用`)
  }
  writeFileSync(requirementDocPath(root, id), content, 'utf8')
  return current
}

/** 一次评审落盘所需的输入。 */
export interface RequirementReviewInput {
  /** 评审报告的 Markdown 正文。 */
  readonly report: string
  readonly at: string
  /** 落盘这轮报告时读到的正文全文；报告依据的正文基线，旧数据可省。 */
  readonly baseContent?: string
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
 * 一轮评审是否带有正文基线，以及它是否仍对应给定的当前正文。
 *
 * 新评审落盘时写入 `base_content`；草稿修改（patch）原地改正文不写版本，靠正文全文比对
 * 判断报告依据是否已变。旧评审没有基线字段时返回 undefined，由调用方回退版本时间戳判定。
 * @param review - 一轮评审记录。
 * @param document - 当前正文全文；读不到时同样回退。
 * @returns 基线与当前正文相同为 true，不同为 false，无法按基线判定时为 undefined。
 */
function reviewBodyMatches(
  review: Pick<RequirementReview, 'base_content'>,
  document: string | undefined,
): boolean | undefined {
  if (review.base_content === undefined || document === undefined) return undefined
  return review.base_content === document
}

/**
 * 追加评审前的重复门禁：上一轮意见还没处置、且正文没改过时给出拒绝原因。
 *
 * 有正文基线时按「报告依据的正文是否仍等于当前正文」判定；草稿修改（patch）原地改正文
 * 不写版本也能被识别。没有基线的旧记录回退到版本时间戳：版本不晚于评审就说明报告针对的
 * 正文没变过。未决轮次送审即锁定：无论正文是否改过，只要最新一轮未决就拦下一轮评审，须先
 * 放弃本轮意见（`rejected`，可直接复评）或采纳并修改需求产出晚于该轮的版本。已采纳但正文没变
 * 仍要拦；没有评审时首轮允许。正文基线只用于已采纳分支判定。
 *
 * 传 `options` 时，有文件流程配置且 review 节点配了多岗时开一个例外：当前正文周期内
 * 配置岗位还缺这个调用方的署名时，允许它接着落本轮报告，各岗位评齐后才回到严格判定。
 * `root` 或 `role` 缺失、没有文件配置、流程配置读不懂或没有 review 节点时一律走严格判定，
 * 不会因读配置失败而放行重复评审。
 * @param requirement - 已读回的需求，只消费 `versions` 与 `reviews`。
 * @param options - 规格根、调用方 preset 署名与当前正文；不传时行为与单参数调用一致。
 * @returns 可追加时返回 undefined；否则返回可读的中文拒绝原因。
 */
export function reviewStaleReason(
  requirement: Pick<Requirement, 'versions' | 'reviews'>,
  options?: { readonly root?: string; readonly role?: string | undefined; readonly document?: string },
): string | undefined {
  const { versions, reviews } = requirement
  if (reviews.length === 0) return undefined
  const document = options?.document
  const latestReview = reviews.reduce((best, review) => review.round > best.round ? review : best)
  const latestVersion = versions.length === 0
    ? undefined
    : versions.reduce((best, version) => version.n > best.n ? version : best)
  const bodyMatches = reviewBodyMatches(latestReview, document)
  const changedAfterReview = bodyMatches === undefined
    ? latestVersion !== undefined && Date.parse(latestVersion.at) > Date.parse(latestReview.at)
    : !bodyMatches

  if (options?.root !== undefined && options.role !== undefined) {
    try {
      const flow = loadFlowConfig(options.root)
      if (flow.source === 'file' && flow.config.nodes.some(node => node.node === 'review')) {
        const currentVersionReviews = reviews.filter((review) => {
          const matches = reviewBodyMatches(review, document)
          return matches === undefined
            ? (latestVersion === undefined || Date.parse(review.at) >= Date.parse(latestVersion.at))
            : matches
        })
        const callerRoot = presetBuiltinRoot(options.role)
        if (callerRoot !== undefined
          && missingReviewRootSet(options.root, flow.config, currentVersionReviews).has(callerRoot)) {
          return undefined
        }
      }
    } catch (_error: unknown) {
      // 流程配置读不懂或岗位解析失败：降级为严格判定，不因配置错误放行重复评审。
    }
  }

  if (latestReview.decision === 'rejected') return undefined
  if (latestReview.decision === 'accepted') {
    return changedAfterReview
      ? undefined
      : `上一轮评审（R${String(latestReview.round)}）已采纳但正文未改稿，请用修改需求产出新版本后再发起下一轮评审`
  }
  // 缺省与 pending 都是未决：送审即锁定，无条件要求先处置，不再按正文是否改过放行。
  return `上一轮评审（R${String(latestReview.round)}）尚未处理：请先「采纳并修改需求」产出新版本，或「放弃本轮意见」后再发起下一轮评审（上一轮评审后正文未改稿）`
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
        ...(input.baseContent === undefined ? {} : { base_content: input.baseContent }),
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

/** 一次评审处置所需的输入。 */
export interface RequirementReviewDecisionInput {
  /** 要处置的轮次。 */
  readonly round: number
  /** 采纳或放弃本轮意见；未决不该由这条命令制造。 */
  readonly decision: 'accepted' | 'rejected'
  /** 处置时刻。 */
  readonly at: string
  /** 处置理由；缺省表示没写。 */
  readonly note?: string
}

/** 一次评审处置的落盘结果。 */
export interface RequirementReviewDecisionResult {
  readonly requirement: Requirement
  readonly round: number
  readonly decision: 'accepted' | 'rejected'
  /** 采纳时关联的正文版本号；没有可关联的晚于该轮的版本时缺省。 */
  readonly appliedVersion?: number
  /** 本轮报告依据的正文已被原地修改，当前正文没有对应版本；供命令给出明确回执。 */
  readonly baselineChanged?: boolean
}

/**
 * 人处置一轮评审：把决定写进该轮记录，不碰正文与其他轮次。
 *
 * 采纳时关联晚于该轮的最新版本；新评审带正文基线时还要求该版本快照就是当前正文，
 * 草稿修改（patch）原地改正文不写版本，因此不会被指向错位的旧版本。旧评审无基线时
 * 保持原来的纯时间戳判定。放弃时清掉残留的 `applied_version`。
 * @param root - 规格根。
 * @param id - 需求编号。
 * @param input - 轮次、决定、时刻与可选理由。
 * @returns 落盘后的需求、轮次、决定、关联版本与基线是否已被原地改动。
 */
export function decideRequirementReview(
  root: string,
  id: string,
  input: RequirementReviewDecisionInput,
): RequirementReviewDecisionResult {
  const requirement = loadRequirement(root, id)
  const target = requirement.reviews.find(review => review.round === input.round)
  if (target === undefined) {
    throw new Error(`${id} 没有第 ${String(input.round)} 轮评审，无法处置`)
  }
  const document = readRequirementDocument(root, id)
  const baselineChanged = target.base_content !== undefined
    && document !== undefined
    && target.base_content !== document

  let appliedVersion: number | undefined
  if (input.decision === 'accepted') {
    const versions = [...requirement.versions].sort((left, right) => right.n - left.n)
    for (const version of versions) {
      if (Date.parse(version.at) <= Date.parse(target.at)) continue
      // 新评审按正文基线核准：只有快照就是当前正文的版本才是「据以改稿的版本」。
      if (target.base_content !== undefined && document !== undefined) {
        const snapshotPath = requirementVersionPath(root, id, version.n)
        const snapshot = existsSync(snapshotPath) && statSync(snapshotPath).isFile()
          ? readFileSync(snapshotPath, 'utf8')
          : undefined
        if (snapshot !== document) continue
      }
      appliedVersion = version.n
      break
    }
  }

  const reviews = requirement.reviews.map((review) => {
    if (review.round !== input.round) return review
    const decided: RequirementReview = {
      round: review.round,
      at: review.at,
      report: review.report,
      ...(review.base_content === undefined ? {} : { base_content: review.base_content }),
      ...(review.sessionId === undefined ? {} : { sessionId: review.sessionId }),
      ...(review.role === undefined ? {} : { role: review.role }),
      decision: input.decision,
      decided_at: input.at,
      ...(input.note === undefined ? {} : { decision_note: input.note }),
      ...(appliedVersion === undefined ? {} : { applied_version: appliedVersion }),
    }
    return decided
  })
  const decidedRequirement: Requirement = { ...requirement, reviews }
  saveRequirement(root, decidedRequirement)
  return {
    requirement: decidedRequirement,
    round: input.round,
    decision: input.decision,
    ...(appliedVersion === undefined ? {} : { appliedVersion }),
    ...(baselineChanged ? { baselineChanged: true } : {}),
  }
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
