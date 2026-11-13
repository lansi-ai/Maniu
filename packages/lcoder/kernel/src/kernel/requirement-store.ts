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

import { Requirement } from '../schema/spec.js'
import type { RequirementOption } from '../schema/spec.js'
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
 * 建一条新需求：分配编号，先写正文再写元数据，任一步失败回滚已写的那份。
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
  if (existsSync(yamlPath) || existsSync(documentPath)) {
    throw new Error(`需求编号 ${id} 已被占用；先清理占用它的文件再起草`)
  }

  mkdirSync(dirname(yamlPath), { recursive: true })
  writeFileSync(documentPath, input.content, 'utf8')
  const requirement: Requirement = {
    id,
    title: input.title,
    state: 'draft',
    options: [...(input.options ?? [])],
    ...(input.recommendation === undefined ? {} : { recommendation: input.recommendation }),
    opened_at: input.opened_at,
  }
  try {
    saveRequirement(root, requirement)
  } catch (error) {
    // 元数据写失败时删掉刚写的正文：留下半截需求比什么都不留更难收拾。
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
