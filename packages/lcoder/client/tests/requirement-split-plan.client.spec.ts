/** 拆分计划投影：计划文件存在时读入建议，缺失不报错，坏文件只记问题。 */
import { describe, expect, it } from 'vitest'

import { loadSpecProjection } from '../src/spec/load.ts'
import type { SpecEntry, SpecFiles } from '../src/spec/files.ts'
import { splitPlanTextToRow } from '../src/spec/rows.ts'

function filesOf(map: Readonly<Record<string, string>>): SpecFiles {
  return {
    async list(path) {
      const prefix = `${path}/`
      const entries: SpecEntry[] = []
      const seen = new Set<string>()
      for (const key of Object.keys(map)) {
        if (!key.startsWith(prefix)) continue
        const [name, ...rest] = key.slice(prefix.length).split('/')
        if (name === undefined || name === '' || seen.has(name)) continue
        seen.add(name)
        entries.push({ name, type: rest.length === 0 ? 'file' : 'directory' })
      }
      return { ok: true, entries }
    },
    async readPage(path) {
      const text = map[path]
      if (text === undefined) {
        return { ok: false, error: { code: 'not-found', message: `ENOENT: ${path} 不存在` } }
      }
      return { ok: true, text }
    },
  }
}

const REQUIREMENT = 'id: REQ-01\ntitle: 佣金改造\nstate: confirmed\nopened_at: 2026-11-17T09:00:00+08:00\n'

const PLAN = [
  'requirement: REQ-01',
  'at: 2026-11-17T15:00:00+08:00',
  'tasks:',
  '  - task: T-01',
  '    role: vue',
  '    reason: 页面交互',
  '  - task: T-02',
  '    role: dev',
].join('\n')

describe('拆分计划行', () => {
  it('读出生成时刻与逐条建议，理由可省', () => {
    expect(splitPlanTextToRow(PLAN)).toEqual({
      at: '2026-11-17T15:00:00+08:00',
      entries: [
        { task: 'T-01', role: 'vue', reason: '页面交互' },
        { task: 'T-02', role: 'dev' },
      ],
    })
  })

  it('缺时刻、没有有效条目或读不懂时为 undefined', () => {
    expect(splitPlanTextToRow('tasks: [{task: T-01, role: dev}]')).toBeUndefined()
    expect(splitPlanTextToRow('at: 2026-11-17T15:00:00+08:00\ntasks: []')).toBeUndefined()
    expect(splitPlanTextToRow('at: [\n')).toBeUndefined()
  })
})

describe('需求投影读取拆分计划', () => {
  it('计划存在时挂到需求行，缺失时不报错也不带字段', async () => {
    const files = filesOf({
      '.spec/requirements/REQ-01.yaml': REQUIREMENT,
      '.spec/requirements/REQ-01.md': '需求正文',
      '.spec/requirements/REQ-01/split-plan.yaml': PLAN,
      '.spec/requirements/REQ-02.yaml': 'id: REQ-02\ntitle: 另一条需求\nstate: confirmed\nopened_at: 2026-11-17T09:00:00+08:00\n',
    })

    const projection = await loadSpecProjection(files, new AbortController().signal)
    const first = projection.requirements.find(row => row.id === 'REQ-01')
    const second = projection.requirements.find(row => row.id === 'REQ-02')

    expect(first?.splitPlan).toEqual({
      at: '2026-11-17T15:00:00+08:00',
      entries: [
        { task: 'T-01', role: 'vue', reason: '页面交互' },
        { task: 'T-02', role: 'dev' },
      ],
    })
    expect(second?.splitPlan).toBeUndefined()
    expect(projection.problems).toEqual([])
  })

  it('计划文件读不懂时记为问题，需求行仍保留且不带计划', async () => {
    const files = filesOf({
      '.spec/requirements/REQ-01.yaml': REQUIREMENT,
      '.spec/requirements/REQ-01/split-plan.yaml': 'at: [\n',
    })

    const projection = await loadSpecProjection(files, new AbortController().signal)
    expect(projection.requirements[0]?.splitPlan).toBeUndefined()
    expect(projection.problems.some(problem => problem.includes('split-plan.yaml'))).toBe(true)
  })
})
