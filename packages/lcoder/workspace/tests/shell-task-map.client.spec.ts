// @vitest-environment jsdom
/**
 * 文件投影的一行任务映射到外壳任务：描述、两维分类与附件原样透传。
 */
import { expect, it } from 'vitest'

import { toShellTask } from '../src/client/shell/Shell.tsx'
import type { TaskRow } from '../src/client/projection.ts'

const ROW: TaskRow = {
  id: 'T-014',
  title: '登录接口限流',
  description: '连续失败 5 次锁定 10 分钟。',
  category: 'api',
  changeType: 'bug',
  attachments: ['attachments/T-014/shot.png'],
  state: 'contracted',
  grade: 'B',
  rules: ['R-LOGIN-01'],
  evidence: ['test'],
  dependsOn: [],
  paths: [],
  irreversible: [],
}

it('描述、分类、变更类型与附件透给外壳任务', () => {
  const mapped = toShellTask(ROW)
  expect(mapped).toMatchObject({
    id: 'T-014',
    description: '连续失败 5 次锁定 10 分钟。',
    category: 'api',
    changeType: 'bug',
    attachments: ['attachments/T-014/shot.png'],
  })
  expect(typeof mapped.surface).toBe('string')
})

it('旧任务缺省时外壳拿到空描述、空附件与未分类', () => {
  const { category: _category, changeType: _changeType, ...legacy } = ROW
  const mapped = toShellTask({ ...legacy, description: '', attachments: [] })
  expect(mapped.description).toBe('')
  expect(mapped.attachments).toEqual([])
  expect(mapped.category).toBeUndefined()
  expect(mapped.changeType).toBeUndefined()
})
