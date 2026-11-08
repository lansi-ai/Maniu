/**
 * 岗位名册工具：`role_draft` 是模型唯一的岗位写入口。
 *
 * 它只能追加或更新一个岗位，不能删除；继承必须指向一个内置角色，所以新岗位
 * 不可能越过既有工具天花板。**分配仍然只能走人机命令 `/task_assign`**：
 * 模型能起草岗位，不能把任务塞给某个岗位。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { ROLES } from '../kernel/surface.js'
import { SIGNAL_LIMITS } from '../schema/spec.js'
import type { RoleSignals } from '../schema/spec.js'
import { isBuiltinRole } from '../schema/roles.js'
import { upsertRole } from '../kernel/role-store.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/** `signals` 的三组名称；顺序即校验与回显顺序。 */
const SIGNAL_GROUPS = ['strong', 'medium', 'preferredPaths'] as const

/**
 * 把工具入参里的 signals 规整成 schema 接受的值：去首尾空白、忽略大小写去重、查上限。
 * @param input - 工具调用的可选 signals 参数。
 * @returns 规整后的信号；未传时为 undefined。
 * @throws 组名非法、条目为空、条目过长或组内条数超限。
 */
function normalizeSignals(
  input: Partial<Record<(typeof SIGNAL_GROUPS)[number], readonly string[]>> | undefined,
): RoleSignals | undefined {
  if (input === undefined) return undefined
  const result = {} as RoleSignals
  for (const group of SIGNAL_GROUPS) {
    const seen = new Set<string>()
    const terms: string[] = []
    for (const raw of input[group] ?? []) {
      const term = raw.trim()
      if (term === '') throw new Error(`signals.${group} 里有空字符串：每一条都要是具体的词或路径`)
      if (term.length > SIGNAL_LIMITS.perTerm) {
        throw new Error(`signals.${group} 的单条最多 ${String(SIGNAL_LIMITS.perTerm)} 个字符，收到 ${String(term.length)} 个：${term}`)
      }
      const key = term.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      terms.push(term)
    }
    if (terms.length > SIGNAL_LIMITS.perGroup) {
      throw new Error(`signals.${group} 最多 ${String(SIGNAL_LIMITS.perGroup)} 条，去重后收到 ${String(terms.length)} 条`)
    }
    result[group] = terms
  }
  return result
}

export function createRoleTools(specRootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'role_draft',
      description:
        '向 .spec/roles.yaml 追加或更新一个岗位：写清 id、显示名与继承的内置角色，可选一段提示词前缀与可机读信号。signals 是三组字符串数组：strong 技术栈强特征词、medium 弱语义词、preferredPaths 文件落点前缀；每组最多 32 条、每条最多 64 个字符，自动去重，省略表示不写 signals。继承不在内置角色里会被拒绝；已有岗位不会被删除，同一 id 只更新字段。本工具不分配任务——分配仍需人执行 /task_assign。',
      parameters: {
        id: { type: 'string', required: true, description: '岗位 id，小写字母开头，只含小写字母、数字、下划线或连字符，如 vue-engineer' },
        name: { type: 'string', required: true, description: '显示名，如「Vue 工程师」' },
        inherits: { type: 'string', required: true, description: `继承哪个内置角色：${ROLES.join(' / ')}` },
        persona: { type: 'string', description: '可选的提示词前缀，说明这个岗位怎么干活；不改变工具面' },
        signals: {
          type: 'object',
          additionalProperties: false,
          description: '可选的可机读信号，供建议层排序，不参与调度硬闸。格式为 { strong: 技术栈强特征词数组, medium: 弱语义词数组, preferredPaths: 文件落点前缀数组 }；三组都可为空，每组最多 32 条、每条最多 64 个字符',
          properties: {
            strong: { type: 'array', items: { type: 'string' }, description: '技术栈强特征词，如 c#、vue、kotlin；命中权重高于 medium' },
            medium: { type: 'array', items: { type: 'string' }, description: '弱语义词，如 页面、脚本，用于辅助排序' },
            preferredPaths: { type: 'array', items: { type: 'string' }, description: '文件落点前缀，如 src/Client/、app/src/main/；与任务允许路径做前缀比较' },
          },
        },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const specRoot = resolveRoot(specRootInput, exec)
        if (!hasSpecRoot(specRoot)) {
          throw new Error('这个仓库还没有 .spec 规格库；先用 task_draft 立项，岗位名册才有落点')
        }

        const id = args.id.trim()
        const name = args.name.trim()
        if (name === '') throw new Error('role_draft 需要非空的 name：写一个给人看的岗位名')
        if (isBuiltinRole(id)) {
          throw new Error(`岗位 id ${id} 与内置角色同名；换一个名字，或直接给任务分配内置角色 ${id}`)
        }
        const inherits = args.inherits.trim()
        if (!isBuiltinRole(inherits)) {
          throw new Error(`inherits 只接受内置角色：${ROLES.join(' / ')}；收到 ${inherits}`)
        }
        const persona = args.persona?.trim()
        const signals = normalizeSignals(args.signals)

        const written = upsertRole(specRoot, {
          id,
          name,
          inherits,
          ...(persona === undefined || persona === '' ? {} : { persona }),
          ...(signals === undefined ? {} : { signals }),
        })

        return {
          role: {
            id,
            name,
            inherits,
            ...(persona === undefined || persona === '' ? {} : { persona }),
            ...(signals === undefined ? {} : { signals }),
          },
          roles: written.roles.length,
          path: written.path,
          note: '岗位已写入名册；分配任务仍需人执行 /task_assign，模型没有分配入口。',
        }
      },
    }),
  ]
}
