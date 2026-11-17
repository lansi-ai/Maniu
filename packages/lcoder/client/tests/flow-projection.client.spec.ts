/** 流程配置投影与渲染端模型：解析、预制回落、岗位折算与命令序列化。 */
import { describe, expect, it } from 'vitest'

import { flowTextToRow, requirementTextToRow } from '../src/spec/rows.ts'
import { flowNodeOf, flowNodesOf, flowSaveLine, presetOfRole, PRESET_FLOW_NODES } from '../src/flow/config.ts'

const VALID = [
  'nodes:',
  '  - node: review',
  '    roles: [maniu-pm, maniu-review]',
  '    auto: true',
  '  - node: split',
  '    roles: [maniu-manager]',
  '    auto: false',
].join('\n')

describe('flow.yaml 解析', () => {
  it('合法配置按文件顺序读回', () => {
    expect(flowTextToRow(VALID)).toEqual({
      nodes: [
        { node: 'review', roles: ['maniu-pm', 'maniu-review'], auto: true },
        { node: 'split', roles: ['maniu-manager'], auto: false },
      ],
    })
  })

  it('未知节点、空岗位、重复节点、auto 非布尔与坏 YAML 都拒读', () => {
    expect(flowTextToRow('nodes: [{node: deploy, roles: [maniu-pm], auto: true}]')).toBeUndefined()
    expect(flowTextToRow('nodes: [{node: review, roles: [], auto: true}]')).toBeUndefined()
    expect(flowTextToRow('nodes: [{node: review, roles: [maniu-pm], auto: true}, {node: review, roles: [maniu-intake], auto: false}]')).toBeUndefined()
    expect(flowTextToRow('nodes: [{node: review, roles: [maniu-pm], auto: yes}]')).toBeUndefined()
    expect(flowTextToRow('nodes: [{node: review, roles: [maniu-pm, 3], auto: true}]')).toBeUndefined()
    expect(flowTextToRow('nodes: [')).toBeUndefined()
    expect(flowTextToRow('other: 1')).toBeUndefined()
  })

  it('评审署名透传；旧数据无 role 不报故障', () => {
    const row = requirementTextToRow('REQ-01.yaml', [
      'id: REQ-01',
      'title: 佣金改造',
      'reviews:',
      '  - round: 1',
      '    at: 2026-11-17T10:00:00+08:00',
      '    report: requirements/REQ-01/reviews/R1.md',
      '    role: maniu-pm',
      '  - round: 2',
      '    at: 2026-11-17T11:00:00+08:00',
      '    report: requirements/REQ-01/reviews/R2.md',
    ].join('\n'))
    expect(row?.reviews[0]?.role).toBe('maniu-pm')
    expect(row?.reviews[1]?.role).toBeUndefined()
  })
})

describe('预制回落与节点查找', () => {
  it('无配置走预制：四节点各一岗，评审自动衔接', () => {
    expect(flowNodesOf(null)).toEqual(PRESET_FLOW_NODES)
    expect(flowNodesOf(undefined)).toEqual(PRESET_FLOW_NODES)
    expect(flowNodeOf(null, 'review')).toEqual({ node: 'review', roles: ['maniu-pm'], auto: true })
    expect(flowNodeOf(null, 'intake').auto).toBe(false)
  })

  it('部分配置只覆盖对应节点，其余仍走预制', () => {
    const flow = flowTextToRow('nodes: [{node: review, roles: [maniu-review], auto: false}]')
    expect(flowNodeOf(flow, 'review')).toEqual({ node: 'review', roles: ['maniu-review'], auto: false })
    expect(flowNodeOf(flow, 'split')).toEqual({ node: 'split', roles: ['maniu-manager'], auto: false })
    expect(flowNodesOf(flow).map(node => node.node)).toEqual(['intake', 'review', 'revise', 'split'])
  })
})

describe('岗位折算与序列化', () => {
  const roster = [{ id: 'dotnet-eng', name: '.NET 工程师', inherits: 'dev' }]

  it('内置 preset 原样发起；名册岗位用继承角色的 preset；解析不了给 undefined', () => {
    expect(presetOfRole('maniu-review', roster)).toBe('maniu-review')
    expect(presetOfRole('dotnet-eng', roster)).toBe('maniu-dev')
    expect(presetOfRole('nobody', roster)).toBeUndefined()
  })

  it('flowSaveLine 生成整份 JSON 命令行', () => {
    const line = flowSaveLine([{ node: 'review', roles: ['maniu-pm'], auto: true }])
    expect(line).toBe('/flow_save {"nodes":[{"node":"review","roles":["maniu-pm"],"auto":true}]}')
  })
})
