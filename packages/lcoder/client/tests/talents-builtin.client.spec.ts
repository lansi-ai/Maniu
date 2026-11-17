// @vitest-environment jsdom
/** 内置角色名册与组合解析，以及 `agentPresets/*` 调用的成功/失败面。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBuiltinPresets, loadPresetDocument } from '../src/talents/api.ts'
import {
  currentPresetId, isBuiltinTalentPreset, pluginPackageOf, presetDocumentOf, presetRosterOf,
} from '../src/talents/model.ts'

const ROSTER = {
  presets: [
    { id: 'standard', isDefault: false },
    { id: 'maniu', name: '实施', description: '开发角色', isDefault: true },
    { id: 'maniu-pm', name: '项目经理', description: '谈需求', isDefault: false },
    { id: 'maniu-workbench', name: '慢牛工作台', description: '内部会话', isDefault: false },
    { id: 'maniu-broken', name: '坏角色', broken: 'unknown plugin @x/y', isDefault: false },
    { id: 'talent-cloud-1', name: '云端人才', isDefault: false },
  ],
}

const DOCUMENT = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
      你是项目经理。
      一次只问一个问题。
- id: ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
`

describe('内置角色名册', () => {
  it('解析 name、description、默认与失败原因', () => {
    const rows = presetRosterOf(ROSTER)
    expect(rows).toHaveLength(6)
    expect(rows?.[1]).toEqual({ id: 'maniu', name: '实施', description: '开发角色', isDefault: true })
    expect(rows?.[4]).toMatchObject({ id: 'maniu-broken', broken: 'unknown plugin @x/y' })
  })

  it('把改名前的 preset id 换到当前命名，其余原样返回', () => {
    expect(currentPresetId('lcoder')).toBe('maniu')
    expect(currentPresetId('lcoder-pm')).toBe('maniu-pm')
    expect(currentPresetId('lcoder-workbench')).toBe('maniu-workbench')
    expect(currentPresetId('maniu-pm')).toBe('maniu-pm')
    expect(currentPresetId('talent-cloud-1')).toBe('talent-cloud-1')
  })

  it('结构不符时整份名册无效', () => {
    expect(presetRosterOf({ presets: [{ name: '缺 id' }] })).toBeUndefined()
    expect(presetRosterOf({})).toBeUndefined()
  })

  it('只认产品内置角色，排除工作台、改名前旧 id 与上游系统 preset', () => {
    expect(isBuiltinTalentPreset('maniu')).toBe(true)
    expect(isBuiltinTalentPreset('maniu-pm')).toBe(true)
    expect(isBuiltinTalentPreset('maniu-workbench')).toBe(false)
    expect(isBuiltinTalentPreset('lcoder')).toBe(false)
    expect(isBuiltinTalentPreset('lcoder-pm')).toBe(false)
    expect(isBuiltinTalentPreset('standard')).toBe(false)
    expect(isBuiltinTalentPreset('talent-cloud-1')).toBe(false)
  })
})

describe('preset 组合解析', () => {
  it('读人设行、展开分组、标出禁用与条件禁用', () => {
    const parsed = presetDocumentOf({ agentPreset: 'maniu-pm', content: DOCUMENT })
    expect(parsed?.persona).toContain('你是项目经理')
    expect(parsed?.plugins).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona', group: false, disabled: 'no' },
      { id: 'ask-user', name: '@deepseek-ai/dsh-tool-ask-user', group: false, disabled: 'no' },
      { id: 'compaction', name: 'cordis:group', group: true, disabled: 'no' },
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', group: false, disabled: 'no' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', group: false, disabled: 'conditional' },
    ])
  })

  it('没有人设行时留空，不臆造', () => {
    const parsed = presetDocumentOf({
      agentPreset: 'maniu-workbench',
      content: "- id: ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'\n",
    })
    expect(parsed?.persona).toBeUndefined()
    expect(parsed?.plugins).toHaveLength(1)
  })

  it('YAML 读不了或字段不全时返回 undefined', () => {
    expect(presetDocumentOf({ agentPreset: 'maniu', content: '- id: [unclosed' })).toBeUndefined()
    expect(presetDocumentOf({ agentPreset: 'maniu', content: 42 })).toBeUndefined()
    expect(presetDocumentOf({ content: '- id: x\n  name: y\n' })).toBeUndefined()
  })
})

describe('组合行的包名', () => {
  it('取包名根，伪插件与相对路径不算包', () => {
    expect(pluginPackageOf('@deepseek-ai/dsh-tool-bash')).toBe('@deepseek-ai/dsh-tool-bash')
    expect(pluginPackageOf('@deepseek-ai/dsh-tool-bash/sub')).toBe('@deepseek-ai/dsh-tool-bash')
    expect(pluginPackageOf('some-package')).toBe('some-package')
    expect(pluginPackageOf('cordis:group')).toBeUndefined()
    expect(pluginPackageOf('./local.ts')).toBeUndefined()
    expect(pluginPackageOf('#internal')).toBeUndefined()
  })
})

describe('agentPresets 调用面', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'lcoder')
  })

  function stub(answer: unknown): ReturnType<typeof vi.fn> {
    const call = vi.fn(async () => answer)
    Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
    return call
  }

  it('内置名册只保留产品角色，云端动态人才不混入', async () => {
    const call = stub({ ok: true, value: ROSTER })
    const answer = await loadBuiltinPresets()
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.value.map(row => row.id)).toEqual(['maniu', 'maniu-pm', 'maniu-broken'])
    expect(call).toHaveBeenCalledWith('agentPresets', 'list', {})
  })

  it('宿主拒绝时原样带回码与消息', async () => {
    stub({ ok: false, error: { code: 'agent-preset/not-found', message: 'Unknown agent preset' } })
    const answer = await loadBuiltinPresets()
    expect(answer).toEqual({
      ok: false, code: 'agent-preset/not-found', message: 'Unknown agent preset',
    })
  })

  it('名册结构不符时给可读失败', async () => {
    stub({ ok: true, value: { presets: 'nope' } })
    const answer = await loadBuiltinPresets()
    expect(answer).toMatchObject({ ok: false, code: 'invalid_response' })
  })

  it('组合读成功时带回人设与插件行', async () => {
    const call = stub({ ok: true, value: { agentPreset: 'maniu-pm', content: DOCUMENT } })
    const answer = await loadPresetDocument('maniu-pm')
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.value.persona).toContain('你是项目经理')
    expect(call).toHaveBeenCalledWith('agentPresets', 'read', { agentPreset: 'maniu-pm' })
  })

  it('组合读成坏结构时给可读失败', async () => {
    stub({ ok: true, value: { agentPreset: 'maniu-pm', content: '- id: [unclosed' } })
    const answer = await loadPresetDocument('maniu-pm')
    expect(answer).toMatchObject({ ok: false, code: 'invalid_response' })
  })
})
