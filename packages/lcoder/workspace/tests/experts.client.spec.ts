/**
 * 专家名册读法的纯函数测：排序、缺省回落，以及从声明清单里取 persona 提示词的三种失败形状。
 */
import { describe, expect, it } from 'vitest'

import { expertsFromRoster, personaPromptOf } from '../src/client/experts.ts'

const DECLARATION = `- id: persona
  name: "@deepseek-ai/dsh-persona"
  config:
    prefix: >-
      You are LCoder 产品. 你的天花板是 file_read / file_list / spec_query / spec_draft /
      task_read / task_draft / proposal_draft。
      批准是人的动作（/proposal_approve），你没有这个能力。
- id: lcoder
  name: '@maniu/kernel'
  config:
    selfCheck: true
    role: pm
`

describe('专家名册', () => {
  it('按装配声明的 order 排，没有 order 的按 id 排在后面，名称缺省回落 id', () => {
    const rows = expertsFromRoster([
      { id: 'standard' },
      { id: 'maniu-pm', name: 'LCoder 产品', order: 19 },
      { id: 'maniu', name: 'LCoder 实施', order: 20, broken: 'boom' },
      { id: 'aardvark', order: 20 },
    ])
    expect(rows.map(row => row.id)).toEqual(['maniu-pm', 'aardvark', 'maniu', 'standard'])
    expect(rows.find(row => row.id === 'maniu-pm')?.name).toBe('LCoder 产品')
    expect(rows.find(row => row.id === 'maniu')?.broken).toBe('boom')
    const standard = rows.find(row => row.id === 'standard')
    expect(standard?.name).toBe('standard')
    expect(standard?.description).toBeUndefined()
  })
})

describe('提示词取法', () => {
  it('从 persona 行的 config.prefix 取出整段提示词，折叠标量的换行拼成一段', () => {
    const prompt = personaPromptOf(DECLARATION)
    expect(prompt).not.toBeNull()
    expect(prompt).toContain('You are LCoder 产品')
    expect(prompt).toContain('批准是人的动作')
    expect(prompt).not.toContain('selfCheck')
  })

  it('按模块名认行也成立（装配源里两种写法都出现过）', () => {
    const byModule = `- id: persona-copy
  name: "@deepseek-ai/dsh-persona"
  config:
    prefix: 只按模块名认我
`
    expect(personaPromptOf(byModule)).toBe('只按模块名认我')
  })

  it('没有 persona 行、YAML 读不懂、prefix 为空或非字符串，都返回 null 而不抛', () => {
    expect(personaPromptOf('- id: lcoder\n  name: "@maniu/kernel"\n')).toBeNull()
    expect(personaPromptOf('  - id: [\n   broken')).toBeNull()
    expect(personaPromptOf('- id: persona\n  config:\n    prefix: ""\n')).toBeNull()
    expect(personaPromptOf('- id: persona\n  config:\n    prefix: 123\n')).toBeNull()
    expect(personaPromptOf('- id: persona\n')).toBeNull()
    expect(personaPromptOf('not a list at all')).toBeNull()
  })
})
