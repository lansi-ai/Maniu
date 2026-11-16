/** 人才库数据面：云端条目解析、摘要去重计划与中英词典对齐。 */
import { describe, expect, it } from 'vitest'
import { EN } from '../src/locale-en.ts'
import { ZH } from '../src/locale-zh.ts'
import { attemptOf, needsProjectIdFix, planSync, talentDigest, talentOf, type TalentRow } from '../src/talents/model.ts'

const CLOUD_ROW = {
  id: '0f4c2f3e-1f4a-4d5e-8a1b-2c3d4e5f6a7b',
  scope: 'global',
  projectId: null,
  ownerUserId: 'u1',
  createdBy: 'user',
  name: '评审人才',
  description: '只看不改',
  config: {
    version: 1,
    basePreset: 'lcoder-review',
    persona: '你是评审',
    plugins: [{ name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } }],
    tools: ['file_read'],
    model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
    budget: { maxCostMicroUsd: 250_000, maxRequestsPerSession: 4 },
  },
  revision: 2,
  canManage: true,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:05:00.000Z',
}

function row(overrides: Partial<TalentRow> = {}): TalentRow {
  const parsed = talentOf({ ...CLOUD_ROW, ...overrides })
  if (parsed === undefined) throw new Error('fixture did not parse')
  return parsed
}

describe('人才条目解析', () => {
  it('保留配置字段与权限标记', () => {
    const parsed = row()
    expect(parsed).toMatchObject({ id: CLOUD_ROW.id, canManage: true, revision: 2 })
    expect(parsed.config.plugins).toEqual([{ name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } }])
    expect(parsed.config.budget).toEqual({ maxCostMicroUsd: 250_000, maxRequestsPerSession: 4 })
  })

  it('缺必填字段或 scope 不认识时整条无效', () => {
    expect(talentOf({ ...CLOUD_ROW, canManage: undefined })).toBeUndefined()
    expect(talentOf({ ...CLOUD_ROW, scope: 'team' })).toBeUndefined()
    expect(talentOf({ ...CLOUD_ROW, config: { version: 1, plugins: [{ config: {} }] } })).toBeUndefined()
  })

  it('摘要只看名称、描述与配置，换 revision 不触发重下发', () => {
    const before = talentDigest(row())
    expect(talentDigest(row({ revision: 9 }))).toBe(before)
    expect(talentDigest(row({ name: '评审人才 v2' }))).not.toBe(before)
    expect(talentDigest(row({ config: { version: 1, tools: ['file_read', 'file_edit'] } }))).not.toBe(before)
  })
})

describe('下发去重计划', () => {
  it('新增、改名与新增工具都要重新下发', () => {
    const first = row()
    const renamed = row({ id: 'b', name: '另一个名字' })
    const plan = planSync(new Map(), [first, renamed])
    expect(plan.apply.map(item => item.id)).toEqual([first.id, 'b'])
    expect(plan.remove).toEqual([])
  })

  it('摘要相同的条目跳过，云端删掉的条目撤回', () => {
    const first = row()
    const previous = new Map([[first.id, talentDigest(first)], ['gone', 'stale']])
    const plan = planSync(previous, [first])
    expect(plan.apply).toEqual([])
    expect(plan.unchanged).toEqual([first.id])
    expect(plan.remove).toEqual(['gone'])
  })

  it('同一配置重复读取得到同一摘要', () => {
    expect(talentDigest(row())).toBe(talentDigest(row()))
  })

  it('失败过的同一份配置不重试，改动后才重新下发', () => {
    const first = row()
    const failed = new Map([[first.id, { digest: talentDigest(first), message: 'agent-talent/invalid: boom' }]])
    expect(attemptOf(first, failed)).toEqual({ kind: 'skip', message: 'agent-talent/invalid: boom' })
    const edited = row({ name: '评审人才 v2' })
    expect(attemptOf(edited, failed)).toEqual({ kind: 'apply', digest: talentDigest(edited) })
    expect(attemptOf(first, new Map()).kind).toBe('apply')
  })
})

describe('老项目自动补 projectId', () => {
  it('只在文件存在且缺字段、且本进程没补过时触发', () => {
    const unbound = { path: 'E:/repo', projectId: null, state: 'unbound' as const }
    expect(needsProjectIdFix(unbound, new Set())).toBe(true)
    expect(needsProjectIdFix(unbound, new Set(['E:/repo']))).toBe(false)
    expect(needsProjectIdFix({ path: 'E:/repo', projectId: null, state: 'missing-project' }, new Set())).toBe(false)
    expect(needsProjectIdFix({ path: 'E:/repo', projectId: 'p', state: 'ready' }, new Set())).toBe(false)
    expect(needsProjectIdFix(null, new Set())).toBe(false)
  })
})

describe('人才库词典', () => {
  it('中英两份词典的键集合一致', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort())
  })

  it('每条文案都不为空，占位符两侧成对', () => {
    for (const key of Object.keys(ZH) as (keyof typeof ZH)[]) {
      expect(ZH[key].length).toBeGreaterThan(0)
      expect(EN[key].length).toBeGreaterThan(0)
      const placeholders = (text: string): string[] =>
        [...text.matchAll(/\{([A-Za-z]+)\}/gu)].map(match => match[1] ?? '').sort()
      expect(placeholders(EN[key])).toEqual(placeholders(ZH[key]))
    }
  })
})
