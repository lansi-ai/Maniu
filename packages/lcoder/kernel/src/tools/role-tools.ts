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
import { isBuiltinRole } from '../schema/roles.js'
import { upsertRole } from '../kernel/role-store.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

export function createRoleTools(specRootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'role_draft',
      description:
        '向 .spec/roles.yaml 追加或更新一个岗位：写清 id、显示名与继承的内置角色，可选一段提示词前缀。继承不在内置角色里会被拒绝；已有岗位不会被删除，同一 id 只更新字段。本工具不分配任务——分配仍需人执行 /task_assign。',
      parameters: {
        id: { type: 'string', required: true, description: '岗位 id，小写字母开头，只含小写字母、数字、下划线或连字符，如 vue-engineer' },
        name: { type: 'string', required: true, description: '显示名，如「Vue 工程师」' },
        inherits: { type: 'string', required: true, description: `继承哪个内置角色：${ROLES.join(' / ')}` },
        persona: { type: 'string', description: '可选的提示词前缀，说明这个岗位怎么干活；不改变工具面' },
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

        const written = upsertRole(specRoot, {
          id,
          name,
          inherits,
          ...(persona === undefined || persona === '' ? {} : { persona }),
        })

        return {
          role: {
            id,
            name,
            inherits,
            ...(persona === undefined || persona === '' ? {} : { persona }),
          },
          roles: written.roles.length,
          path: written.path,
          note: '岗位已写入名册；分配任务仍需人执行 /task_assign，模型没有分配入口。',
        }
      },
    }),
  ]
}
