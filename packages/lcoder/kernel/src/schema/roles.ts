/**
 * 内置角色 id：`Config.role` 的取值域，也是岗位 `inherits` 唯一合法的目标。
 *
 * 工具面本身在 `kernel/surface.ts` 的角色表里；这里只固定名字集合，供 schema
 * 与外壳共用——岗位名册与界面判断「未知岗位」都读这一份，不各抄一遍。
 * 没有运行时代码依赖，浏览器侧可以直接 import。
 */

/** 内置角色；顺序即报错与展示顺序。`manager` 是研发经理。 */
export const BUILTIN_ROLES = [
  'intake',
  'architect',
  'pm',
  'dev',
  'git',
  'ops',
  'review',
  'scheduler',
  'flow',
  'manager',
  'requirement-editor',
] as const

/** 一个内置角色。 */
export type BuiltinRoleId = (typeof BUILTIN_ROLES)[number]

/**
 * 这个值是不是内置角色。
 * @param value - 待判断的原始值。
 * @returns 是内置角色为 true。
 */
export function isBuiltinRole(value: unknown): value is BuiltinRoleId {
  return typeof value === 'string' && (BUILTIN_ROLES as readonly string[]).includes(value)
}

/** 岗位 id 的形态：小写字母开头，只含小写字母、数字、下划线与连字符。 */
export const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
