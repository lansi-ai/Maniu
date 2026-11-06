/**
 * `.spec/automation.yaml` 的读取与默认值。
 *
 * 两条口径写死在代码里，不留给配置：
 *   1. **缺文件即全手动。** 没有策略与今天的行为完全一致；「没写」不能被读成「允许自动」。
 *   2. **外部不可逆动作永不进配置。** push、部署、改注册表与环境都由人做；配置文件里
 *      出现这些键由 schema 的 `strict` 直接判非法，而不是读进来再忽略。
 *
 * 每次求值都重读磁盘：策略改了，下一次判断就按新策略走，不需要重启。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { ZodError } from 'zod'

import { AutomationPolicy } from '../schema/spec.js'

/** 策略文件在规格根下的文件名。 */
export const AUTOMATION_FILE = 'automation.yaml'

/**
 * 策略文件在规格根下的完整路径。
 * @param root - 规格根。
 * @returns 策略文件路径；文件不存在时也返回这个位置。
 */
export function automationPath(root: string): string {
  return join(root, AUTOMATION_FILE)
}

/** 缺文件时的策略：全部动作手动、不设停止条件、管全部任务。 */
export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = AutomationPolicy.parse({})

/** 一次读取的结果，连同审计要用的来源事实。 */
export interface AutomationPolicyFact {
  readonly policy: AutomationPolicy
  /** `default` 表示没有文件；此时签署永远不是 auto。 */
  readonly source: 'default' | 'file'
  /** 策略文件路径；缺文件时也给出「本该在哪」。 */
  readonly path: string
  /** 文件内容的 `sha256:<hex>`；缺文件为 null。 */
  readonly hash: string | null
  /** 文件最后修改时刻；缺文件为 null。 */
  readonly at: string | null
}

/**
 * 读一份自动化策略。
 * @param root - 规格根。
 * @returns 策略与来源事实；文件不存在时返回全手动默认值。
 * @throws 文件读不懂或含非法键时抛出——策略配错要当场响，不能静默按全手动跑。
 */
export function loadAutomationPolicy(root: string): AutomationPolicyFact {
  const path = automationPath(root)
  if (!existsSync(path)) {
    return { policy: DEFAULT_AUTOMATION_POLICY, source: 'default', path, hash: null, at: null }
  }

  const bytes = readFileSync(path)
  let doc: unknown
  try {
    doc = parseYaml(bytes.toString('utf8'))
  } catch (error: unknown) {
    throw new Error(`自动化策略不是能读的 YAML（${path}）：${errorMessage(error)}`)
  }

  try {
    return {
      policy: AutomationPolicy.parse(doc),
      source: 'file',
      path,
      hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      at: statSync(path).mtime.toISOString(),
    }
  } catch (error: unknown) {
    throw new Error(`自动化策略非法（${path}）：${policyErrorMessage(error)}`)
  }
}

/**
 * 把 schema 的错误说成人话；未知键单独点出来，因为它们多半是外部不可逆动作。
 * @param error - `AutomationPolicy.parse` 抛出的错误。
 * @returns 一行说明。
 */
function policyErrorMessage(error: unknown): string {
  if (!(error instanceof ZodError)) return errorMessage(error)
  const unknown: string[] = []
  const rest: string[] = []
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      unknown.push(...issue.keys)
      continue
    }
    const where = issue.path.length === 0 ? '' : `${issue.path.join('.')}：`
    rest.push(`${where}${issue.message}`)
  }
  const lines: string[] = []
  if (unknown.length > 0) {
    lines.push(`不允许的键 ${unknown.join('、')}；push、部署与外部环境变更永远由人执行，不进自动化策略`)
  }
  lines.push(...rest)
  return lines.join('；')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
