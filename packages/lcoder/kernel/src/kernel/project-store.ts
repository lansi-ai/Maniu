/**
 * `project.yaml`：项目交付、文档与部署环境的读写。
 *
 * 为什么单独一个模块而不并进 `spec-store`：那边读的是「规格条目与状态机」，
 * 会被差异计算（`diffSpec`）消费；项目信息没有比对语义，只有「有没有、是不是
 * 这份」。合在一起会让 `loadSpec` 的快照里多出一个不参与差异的字段。
 *
 * 一条分工与 `spec-store` 一致：本模块只做读写，语义是否合规由 schema
 * （`ProjectInfo`）在写前认，坏文件当场抛，不留半截。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { ProjectInfo } from '../schema/spec.js'

/** `project.yaml` 在规格库里的路径。 */
export function projectPath(root: string): string {
  return join(root, 'project.yaml')
}

/**
 * 项目信息是否已落盘。
 * @param root - 规格库根。
 * @returns false 表示这个仓库连项目身份都还没登记，引导要从第一问开始。
 */
export function hasProject(root: string): boolean {
  return existsSync(projectPath(root))
}

/**
 * 读 `.spec/project.yaml`。
 * @param root - 规格库根。
 * @returns 项目信息；文件不存在返回 null（没登记不是故障）。
 * @throws 文件存在但形状不合 `ProjectInfo` 时抛 zod 报错原文。
 */
export function loadProject(root: string): ProjectInfo | null {
  const path = projectPath(root)
  if (!existsSync(path)) return null
  return ProjectInfo.parse(parseYaml(readFileSync(path, 'utf8')))
}

/**
 * 写 `.spec/project.yaml`。写前过一遍 schema，避免写出坏文件。
 * @param root - 规格库根。
 * @param info - 待落盘的项目信息。
 * @returns 落盘路径。
 */
export function saveProject(root: string, info: ProjectInfo): string {
  const path = projectPath(root)
  const data = ProjectInfo.parse(info)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(data), 'utf8')
  return path
}

/**
 * 生成一个随仓提交的新 `projectId`。
 * @returns 新的项目 UUID。
 */
export function newProjectId(): string {
  return randomUUID()
}

/**
 * 读或补出项目的稳定 `projectId`。
 *
 * 已登记就只读回；旧文件缺 `projectId` 时就地生成 UUID 并写回，其余字段原样保留。
 * 没有 `project.yaml` 直接抛：项目身份还没登记，不能凭空造一个不随仓的 id。
 * @param root - 规格库根。
 * @returns 随仓提交的项目 UUID。
 * @throws 项目信息尚未登记，或文件本身不合 `ProjectInfo` 时抛出。
 */
export function ensureProjectId(root: string): string {
  const info = loadProject(root)
  if (info === null) {
    throw new Error(`读不到 ${projectPath(root)}：项目身份还没登记，无法生成 projectId`)
  }
  if (info.projectId !== undefined) return info.projectId

  const projectId = newProjectId()
  saveProject(root, { ...info, projectId })
  return projectId
}
