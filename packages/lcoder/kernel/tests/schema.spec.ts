import { describe, expect, it } from 'vitest'

import { Contract, Env, RolesFile, RuleEntry as Rule, Task } from '../src/schema/index.js'

/**
 * 这些用例不只是"能不能跑"，它们固定了几条设计边界。
 * 改动 schema 时如果某条用例红了，先想清楚是边界变了还是实现错了。
 */
describe('.spec schema', () => {
  const validRule = {
    id: 'R-02',
    module: 'settlement',
    kind: 'formula' as const,
    text: '佣金 = max(round(实付 × 费率, 2), 1.00)',
    source: { doc: 'prd.md#6.3', quote: '平台佣金 = 订单实付 × 佣金率，最低一元' },
    status: 'confirmed' as const,
  }

  it('合法条目通过，且数组字段被补默认值', () => {
    const r = Rule.parse(validRule)
    expect(r.found_at).toEqual([])
    expect(r.acceptance).toEqual([])
    expect(r.blocks).toEqual([])
  })

  it('confirmed 但无落点 —— schema 放行（这是 P1 的职责，不是 schema 的）', () => {
    const r = Rule.safeParse(validRule)
    expect(r.success).toBe(true)
  })

  it('编号形态不符被拒（R2 / rule-2 都不行）', () => {
    expect(Rule.safeParse({ ...validRule, id: 'R2' }).success).toBe(false)
    expect(Rule.safeParse({ ...validRule, id: 'rule-2' }).success).toBe(false)
  })

  it('没有出处的条目被拒 —— 人不敢确认它', () => {
    const { source: _drop, ...noSource } = validRule
    expect(Rule.safeParse(noSource).success).toBe(false)
  })

  it('契约缺验收条款被拒，签署默认 null', () => {
    const base = {
      id: 'T-014',
      change: ['R-02 下限改为可配置'],
      acceptance: ['费率为 0 且下限为 0 时不生成结算记录'],
    }
    const c = Contract.parse(base)
    expect(c.sig).toBeNull()
    expect(Contract.safeParse({ ...base, acceptance: [] }).success).toBe(false)
    expect(Contract.safeParse({ ...base, change: [] }).success).toBe(false)
  })

  it('任务状态只接受五个枚举值', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    expect(Task.safeParse({ ...base, state: 'contracted' }).success).toBe(true)
    expect(Task.safeParse({ ...base, state: 'done' }).success).toBe(false)
    expect(Task.safeParse({ ...base, grade: 'D' }).success).toBe(false)
  })

  it('认领会话号可选，空串被拒：认领关系只有人机命令写得出形状', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    expect(Task.parse(base).session).toBeUndefined()
    expect(Task.parse({ ...base, session: 'session-8676' }).session).toBe('session-8676')
    expect(Task.safeParse({ ...base, session: '' }).success).toBe(false)
  })

  it('旧任务不填描述、分类、变更类型与附件时，按空串、省略与空数组解析', () => {
    const task = Task.parse({
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    })
    expect(task.description).toBe('')
    expect(task.category).toBeUndefined()
    expect(task.change_type).toBeUndefined()
    expect(task.attachments).toEqual([])
  })

  it('描述允许换行，超过上限给出可读错误', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    expect(Task.parse({ ...base, description: '第一行\n第二行' }).description).toBe('第一行\n第二行')
    const tooLong = Task.safeParse({ ...base, description: 'x'.repeat(4001) })
    expect(tooLong.success).toBe(false)
    expect(tooLong.success ? '' : tooLong.error.issues[0]?.message).toContain('最多 4000 个字符')
  })

  it('领域与变更类型只接受约定枚举', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    for (const category of ['page', 'api', 'data', 'other']) {
      expect(Task.safeParse({ ...base, category }).success).toBe(true)
    }
    for (const changeType of ['bug', 'feature', 'improvement', 'style']) {
      expect(Task.safeParse({ ...base, change_type: changeType }).success).toBe(true)
    }
    expect(Task.parse({ ...base, change_type: 'bug' }).change_type).toBe('bug')
    expect(Task.safeParse({ ...base, category: 'ui' }).success).toBe(false)
    expect(Task.safeParse({ ...base, change_type: 'fix' }).success).toBe(false)
    // 字段名是 YAML 契约的一部分：驼峰写法按未知键拒绝，而不是静默丢掉。
    expect(Task.safeParse({ ...base, changeType: 'bug' }).success).toBe(false)
  })

  it('附件只收 .spec 相对路径的图片：绝对路径、上跳、空串与非图片都被拒', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    expect(Task.parse({
      ...base,
      attachments: ['attachments/T-014/shot.png', 'attachments/T-014/photo.JPEG'],
    }).attachments).toEqual(['attachments/T-014/shot.png', 'attachments/T-014/photo.JPEG'])
    expect(Task.safeParse({ ...base, attachments: ['C:/shot.png'] }).success).toBe(false)
    expect(Task.safeParse({ ...base, attachments: ['/abs/shot.png'] }).success).toBe(false)
    expect(Task.safeParse({ ...base, attachments: ['attachments/../shot.png'] }).success).toBe(false)
    expect(Task.safeParse({ ...base, attachments: [''] }).success).toBe(false)
    expect(Task.safeParse({ ...base, attachments: ['attachments/T-014/notes.txt'] }).success).toBe(false)
  })

  it('附件最多 8 张', () => {
    const base = {
      id: 'T-014',
      title: '佣金支持 0',
      grade: 'B' as const,
      state: 'drafting' as const,
      opened_at: '2026-11-02T09:10:00+08:00',
    }
    const images = Array.from({ length: 8 }, (_, index) => `attachments/T-014/${String(index)}.png`)
    expect(Task.safeParse({ ...base, attachments: images }).success).toBe(true)
    expect(Task.safeParse({ ...base, attachments: [...images, 'attachments/T-014/8.png'] }).success).toBe(false)
  })

  it('任务的时间必须是可解析的 ISO 时间', () => {
    const base = { id: 'T-014', title: 'x', grade: 'C' as const, state: 'drafting' as const }
    expect(Task.safeParse({ ...base, opened_at: '2026-11-02' }).success).toBe(true)
    expect(Task.safeParse({ ...base, opened_at: '昨天' }).success).toBe(false)
  })

  it('岗位信号三组可省可空，缺组补空数组且按组忽略大小写去重', () => {
    const file = RolesFile.parse({
      roles: [{
        id: 'vue-engineer',
        name: 'Vue 工程师',
        inherits: 'dev',
        signals: { strong: ['vue', 'Vue', ' vue '] },
      }],
    })

    expect(file.roles[0]?.signals).toEqual({ strong: ['vue'], medium: [], preferredPaths: [] })
  })

  it('岗位信号的空词、超长、超限与未知组在 schema 层被拒', () => {
    const base = { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' }

    expect(RolesFile.safeParse({ roles: [{ ...base, signals: { strong: [''] } }] }).success).toBe(false)
    expect(RolesFile.safeParse({ roles: [{ ...base, signals: { strong: ['x'.repeat(65)] } }] }).success).toBe(false)
    expect(RolesFile.safeParse({
      roles: [{
        ...base,
        signals: { strong: Array.from({ length: 33 }, (_, index) => `t${String(index)}`) },
      }],
    }).success).toBe(false)
    expect(RolesFile.safeParse({ roles: [{ ...base, signals: { strong: ['vue'], unknown: [] } }] }).success).toBe(false)
  })

  it('环境命令的默认执行权是 ai-confirm，不是 ai-auto', () => {
    const env = Env.parse({
      repo: { url: 'https://example.com/r.git', branch: 'main', push_mode: 'branch' },
      commands: [{ id: 'build', cmd: 'pnpm build' }],
    })
    expect(env.commands[0]?.exec).toBe('ai-confirm')
    expect(env.commands[0]?.timeout).toBe(300)
    expect(env.commands[0]?.dry_run).toBe('none')
    expect(env.commands[0]?.sensitive).toBe(false)
    expect(env.credentials).toEqual([])
  })
})
