/**
 * 规格根解析：会话工作区优先，显式部署配置兜底。
 *
 * 桌面端宿主子进程的 cwd 是 profile 目录，不是目标仓库；只认
 * `process.cwd()/.spec` 会让工具读写错误的规格库。会话创建时的
 * `header.cwd` 是不可变的工作区事实，UI 投影也按它解析相对路径，
 * 工具跟随同一来源才不会与 UI 各读一套 `.spec`。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 解析规格根与认领关系所需的会话事实：`agent.session.header` 的 `cwd` 与 `id`。 */
export interface SpecRootContext {
  readonly agent?: {
    readonly session: {
      readonly header: {
        readonly cwd?: string
        /** 会话号：任务认领（`Task.session`）按它反查。 */
        readonly id?: string
      }
    }
  }
}

/** 固定根，或按每次调用的会话上下文解析。 */
export type RootInput = string | ((context?: SpecRootContext) => string)

/**
 * 归一化根输入。字符串根在每次调用时原样返回。
 * @param input - 固定路径或解析函数。
 * @param context - 工具执行或工具面求值时的会话上下文。
 * @returns 规格库根目录。
 */
export function resolveRoot(input: RootInput, context?: SpecRootContext): string {
  return typeof input === 'string' ? input : input(context)
}

/**
 * 会话工作区下的 `.spec`；没有会话 cwd 时用备案根。
 * @param context - 工具执行或工具面求值时的会话上下文。
 * @param fallback - 没有会话 cwd 时使用的 `.spec` 目录。
 * @returns 规格库根目录。
 */
export function sessionSpecRoot(context: SpecRootContext | undefined, fallback: string): string {
  const cwd = context?.agent?.session.header.cwd
  return typeof cwd === 'string' && cwd !== '' ? join(cwd, '.spec') : fallback
}

/**
 * 规格根是否已经存在于磁盘上。
 * @param root - 解析出的规格库根目录。
 * @returns false 表示这个仓库还没立项——没有 `.spec` 是起点，不是故障。
 */
export function hasSpecRoot(root: string): boolean {
  return existsSync(root)
}
