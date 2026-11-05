/**
 * 起草态工具集：模型在「还没签契约」时能做的全部事情。
 *
 * 这一组里**没有**任何写代码、跑命令的能力——不是靠提示词约束，
 * 而是 SURFACE 掩码在 drafting 状态下根本不放它们出来（见 kernel/surface.ts）。
 *
 * **`contract_sign` 刻意不存在**：模型能调用的工具就等于模型能给自己签字，
 * S1 当场失效。签署是人机命令，不经过模型回合。
 *
 * 输出统一用 `{ type: 'json' }` + JSON 渲染。代价是没有输出校验，
 * 理由与后续收紧计划见 docs/cookbook/adding-a-tool.md。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { Contract, RuleKind } from '../schema/spec.js'
import type { RuleEntry, RuleKind as RuleKindName } from '../schema/spec.js'
import { contractHash, saveContract } from '../kernel/contract.js'
import { findByText, loadSpec, nextRuleId, saveRules } from '../kernel/spec-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'

/** `RuleKind` 的合法取值，取自 schema 本身，避免与枚举漂移。 */
const RuleKindValues: readonly RuleKindName[] = RuleKind.options

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

export function createSpecTools(rootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'spec_query',
      description:
        '查询规格库。可按条目编号、模块或关键词过滤，返回条目正文、出处、落点与状态。改动任何代码前先用它确认要遵守哪几条规格。',
      parameters: {
        id: { type: 'string', description: '规格条目编号，如 R-02' },
        module: { type: 'string', description: '模块名' },
        keyword: { type: 'string', description: '在条目正文里做包含匹配' },
        include_states: { type: 'boolean', description: '是否一并返回状态机，默认 false' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        // 没有 `.spec` 是起点而不是故障：读盘会抛 ENOENT，这里给出空规格库加下一步。
        if (!hasSpecRoot(root)) {
          return {
            count: 0,
            rules: [],
            ...(args.include_states ? { states: [] } : {}),
            note: '这个仓库还没有 .spec 规格库；先按产品文档用 project_draft 登记项目信息，规格条目用 spec_draft 逐条落，任务用 task_draft 立。',
          }
        }
        const snap = loadSpec(root)
        const kw = args.keyword?.toLowerCase()

        const rules = snap.rules.filter(
          r =>
            (!args.id || r.id === args.id) &&
            (!args.module || r.module === args.module) &&
            (!kw || r.text.toLowerCase().includes(kw)),
        )

        return {
          count: rules.length,
          rules: rules.map(r => ({
            id: r.id,
            module: r.module,
            kind: r.kind,
            text: r.text,
            status: r.status,
            source: r.source.doc,
            found_at: r.found_at.map(l => (l.symbol ? `${l.file}#${l.symbol}` : l.file)),
            blocks: r.blocks,
          })),
          // 不要给 undefined：JsonValue 里没有 undefined，省略键才是「没有这个字段」。
          ...(args.include_states
            ? { states: snap.states.map(m => ({ id: m.id, statuses: m.statuses })) }
            : {}),
        }
      },
    }),

    defineTool({
      name: 'spec_draft',
      description:
        '登记一条新的规格条目：状态固定 draft，落点与验收留空。正文要写成能判定的约束，出处必须是真实存在的文档。只新增，不修改——编号或正文撞上已登记的条目一律拒绝。',
      parameters: {
        module: { type: 'string', required: true, description: '所属模块名' },
        kind: { type: 'string', required: true, description: `条目类型：${RuleKindValues.join('、')}` },
        text: { type: 'string', required: true, description: '规格正文，一条写一个能判定的约束' },
        source_doc: { type: 'string', required: true, description: '出处文档的仓库内相对路径' },
        source_quote: { type: 'string', description: '出处原文引句，供人复核' },
        rule_id: { type: 'string', description: '指定编号，形如 R-03；省略则取现有 R- 编号之后的下一个空号' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const module = args.module.trim()
        if (module === '') throw new Error('spec_draft 需要非空的 module：条目要能归到某个模块')
        const kind = RuleKind.safeParse(args.kind.trim())
        if (!kind.success) {
          throw new Error(`spec_draft 的 kind 只能是 ${RuleKindValues.join('、')}，收到：${args.kind}`)
        }
        const text = args.text.trim()
        if (text === '') throw new Error('spec_draft 需要非空的 text：一条规格要能被判定')
        const sourceDoc = args.source_doc.trim()
        if (sourceDoc === '') throw new Error('spec_draft 需要非空的 source_doc：没有出处的条目不能登记')

        const rules = hasSpecRoot(root) ? loadSpec(root).rules : []

        const duplicate = findByText(rules, text)
        if (duplicate !== undefined) {
          return {
            rule_id: duplicate.id,
            status: duplicate.status,
            created: false,
            note: `已有一条同正文规格 ${duplicate.id}（${duplicate.status}），没有重复登记。要给它补落点就用 spec_bind。`,
          }
        }

        const id = args.rule_id === undefined ? nextRuleId(rules) : args.rule_id.trim()
        if (!/^[A-Z]+-\d{2,}$/.test(id)) {
          throw new Error(`rule_id 要形如 R-03（大写字母加两位以上数字），收到：${args.rule_id}`)
        }
        if (rules.some(rule => rule.id === id)) {
          throw new Error(`规格编号 ${id} 已被占用；spec_draft 不修改已登记的条目，省略 rule_id 可自动取下一个空号`)
        }

        const quote = args.source_quote?.trim()
        const entry: RuleEntry = {
          id,
          module,
          kind: kind.data,
          text,
          source: quote === undefined || quote === '' ? { doc: sourceDoc } : { doc: sourceDoc, quote },
          status: 'draft',
          found_at: [],
          acceptance: [],
          blocks: [],
        }
        const path = saveRules(root, [...rules, entry])

        return {
          rule_id: entry.id,
          path,
          status: entry.status,
          module: entry.module,
          kind: entry.kind,
          created: true,
          note: '规格条目已登记为 draft，等待人复核并确认。confirmed 要由人置，落点由 spec_bind 补。',
        }
      },
    }),

    defineTool({
      name: 'spec_bind',
      description:
        '把一条规格条目绑定到代码落点（文件 + 可选符号）。已存在的相同落点不会重复添加。绑定是「这条规格由这里实现」的声明，不是猜测。',
      parameters: {
        rule_id: { type: 'string', required: true, description: '规格条目编号' },
        file: { type: 'string', required: true, description: '仓库内相对路径' },
        symbol: { type: 'string', description: '文件内的符号名，如类名或方法名' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const snap = loadSpec(root)
        const rule = snap.rules.find(r => r.id === args.rule_id)
        if (!rule) throw new Error(`找不到规格条目 ${args.rule_id}，先用 spec_query 确认编号`)

        const exists = rule.found_at.some(
          l => l.file === args.file && l.symbol === args.symbol,
        )
        if (!exists) {
          rule.found_at.push({ file: args.file, ...(args.symbol ? { symbol: args.symbol } : {}) })
          saveRules(root, snap.rules)
        }

        return {
          rule_id: rule.id,
          added: !exists,
          found_at: rule.found_at.map(l => (l.symbol ? `${l.file}#${l.symbol}` : l.file)),
        }
      },
    }),

    defineTool({
      name: 'contract_draft',
      description:
        '为任务起草契约：改什么、不改什么、怎么算过、影响哪些测试、什么算失败。返回内容哈希。契约未经人签署前不生效——本工具不提供签署能力。',
      parameters: {
        task_id: { type: 'string', required: true, description: '任务编号，如 T-014' },
        change: { type: 'array', items: { type: 'string' }, required: true },
        acceptance: { type: 'array', items: { type: 'string' }, required: true },
        not_change: { type: 'array', items: { type: 'string' } },
        affected_tests: { type: 'array', items: { type: 'string' } },
        fail_if: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const draft: Contract = Contract.parse({
          id: args.task_id,
          change: args.change,
          acceptance: args.acceptance,
          not_change: args.not_change ?? [],
          affected_tests: args.affected_tests ?? [],
          fail_if: args.fail_if ?? [],
          sig: null,
        })

        const path = saveContract(root, draft)
        const hash = contractHash(draft)
        return {
          task_id: draft.id,
          path,
          hash,
          signed: false,
          note: '契约已起草但未签署。签署需由人在界面上完成，模型无法自行签署。',
        }
      },
    }),
  ]
}
