/**
 * 流程配置 store 的行为测：预制回落、校验拒绝、岗位可解析、恢复预制与署名配齐判定。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  FLOW_CONFIG_FILE,
  PRESET_FLOW,
  flowConfigPath,
  loadFlowConfig,
  missingReviewSignatures,
  resetFlowConfig,
  saveFlowConfig,
} from '../src/kernel/flow-config.js'
import { saveRoles } from '../src/kernel/role-store.js'
import { FlowConfig } from '../src/schema/spec.js'
import type { RequirementReview } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-config-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(root, { recursive: true })
  return root
}

const REVIEW_NODE = { node: 'review', roles: ['maniu-pm', 'maniu-review'], auto: true }

function review(round: number, role?: string): RequirementReview {
  return {
    round,
    at: '2026-11-17T10:00:00+08:00',
    report: `requirements/REQ-01/reviews/R${String(round)}.md`,
    ...(role === undefined ? {} : { role }),
  }
}

describe('预制回落', () => {
  it('无文件走内置预制：四节点各一岗，评审自动衔接，其余人工', () => {
    const root = makeSpec()
    const snapshot = loadFlowConfig(root)
    expect(snapshot.source).toBe('preset')
    expect(snapshot.path).toBe(flowConfigPath(root))
    expect(snapshot.config).toEqual(PRESET_FLOW)
    expect(PRESET_FLOW.nodes).toEqual([
      { node: 'intake', roles: ['maniu-intake'], auto: false },
      { node: 'review', roles: ['maniu-pm'], auto: true },
      { node: 'revise', roles: ['maniu-intake'], auto: false },
      { node: 'split', roles: ['maniu-manager'], auto: false },
    ])
  })

  it('旧项目只有 requirements 没有 flow.yaml：读取不抛，照常返回预制', () => {
    const root = makeSpec()
    mkdirSync(join(root, 'requirements'), { recursive: true })
    expect(loadFlowConfig(root).source).toBe('preset')
  })
})

describe('写入与读回', () => {
  it('合法配置整文件落盘，读回来源为 file', () => {
    const root = makeSpec()
    const saved = saveFlowConfig(root, { nodes: [REVIEW_NODE] })
    expect(saved.path).toBe(join(root, FLOW_CONFIG_FILE))
    expect(saved.config.nodes).toEqual([REVIEW_NODE])
    const snapshot = loadFlowConfig(root)
    expect(snapshot.source).toBe('file')
    expect(snapshot.config.nodes).toEqual([REVIEW_NODE])
    expect(parseYaml(readFileSync(saved.path, 'utf8'))).toEqual({ nodes: [REVIEW_NODE] })
  })

  it('名册岗位可解析：roles.yaml 里的岗位 id 能进配置', () => {
    const root = makeSpec()
    saveRoles(root, [{ id: 'dotnet-eng', name: '.NET 工程师', inherits: 'dev' }])
    saveFlowConfig(root, { nodes: [{ node: 'review', roles: ['maniu-pm', 'dotnet-eng'], auto: false }] })
    expect(loadFlowConfig(root).config.nodes[0]?.roles).toEqual(['maniu-pm', 'dotnet-eng'])
  })

  it('恢复预制删除文件；本来没有文件时返回 false', () => {
    const root = makeSpec()
    expect(resetFlowConfig(root)).toBe(false)
    saveFlowConfig(root, { nodes: [REVIEW_NODE] })
    expect(existsSync(flowConfigPath(root))).toBe(true)
    expect(resetFlowConfig(root)).toBe(true)
    expect(existsSync(flowConfigPath(root))).toBe(false)
    expect(loadFlowConfig(root).source).toBe('preset')
  })
})

describe('非法配置拒绝', () => {
  it('未知节点类型拒绝，不落盘', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [{ node: 'deploy', roles: ['maniu-pm'], auto: true }] }))
      .toThrow(/流程配置非法/)
    expect(existsSync(flowConfigPath(root))).toBe(false)
  })

  it('空 roles 拒绝', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [{ node: 'review', roles: [], auto: true }] }))
      .toThrow(/至少要配一个岗位/)
  })

  it('重复节点拒绝', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [REVIEW_NODE, { node: 'review', roles: ['maniu-intake'], auto: false }] }))
      .toThrow(/流程节点重复：review/)
  })

  it('解析不了的岗位拒绝：既不是内置 preset 也不在名册', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [{ node: 'review', roles: ['nobody'], auto: true }] }))
      .toThrow(/岗位解析不了.*nobody/)
    expect(existsSync(flowConfigPath(root))).toBe(false)
  })

  it('裸内置角色 id 不是 preset，拒绝', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [{ node: 'review', roles: ['pm'], auto: true }] }))
      .toThrow(/岗位解析不了/)
  })

  it('auto 不是布尔、多余键都拒绝', () => {
    const root = makeSpec()
    expect(() => saveFlowConfig(root, { nodes: [{ node: 'review', roles: ['maniu-pm'], auto: 'yes' }] }))
      .toThrow(/流程配置非法/)
    expect(() => saveFlowConfig(root, { nodes: [REVIEW_NODE], extra: 1 })).toThrow(/流程配置非法/)
  })

  it('磁盘上的坏文件读取时抛：形状非法与岗位失效都当场响', () => {
    const root = makeSpec()
    writeFileSync(flowConfigPath(root), 'nodes: [{node: review, roles: [], auto: true}]', 'utf8')
    expect(() => loadFlowConfig(root)).toThrow(/流程配置非法/)
    writeFileSync(flowConfigPath(root), 'nodes: [{node: review, roles: [ghost], auto: true}]', 'utf8')
    expect(() => loadFlowConfig(root)).toThrow(/岗位解析不了/)
    writeFileSync(flowConfigPath(root), 'nodes: [', 'utf8')
    expect(() => loadFlowConfig(root)).toThrow(/不是能读的 YAML/)
  })
})

describe('配齐判定', () => {
  it('review 节点每个配置岗位都要有署名等于该 id 的评审', () => {
    const config = FlowConfig.parse({ nodes: [REVIEW_NODE] })
    expect(missingReviewSignatures(config, [])).toEqual(['maniu-pm', 'maniu-review'])
    expect(missingReviewSignatures(config, [review(1, 'maniu-pm')])).toEqual(['maniu-review'])
    expect(missingReviewSignatures(config, [review(1, 'maniu-pm'), review(2, 'maniu-review')])).toEqual([])
  })

  it('无署名旧评审不算配齐；署名不精确匹配也不算', () => {
    const config = FlowConfig.parse({ nodes: [REVIEW_NODE] })
    expect(missingReviewSignatures(config, [review(1), review(2)])).toEqual(['maniu-pm', 'maniu-review'])
    expect(missingReviewSignatures(config, [review(1, 'maniu-reviewer')])).toEqual(['maniu-pm', 'maniu-review'])
  })

  it('没有 review 节点时不要求署名', () => {
    const config = FlowConfig.parse({ nodes: [{ node: 'split', roles: ['maniu-manager'], auto: false }] })
    expect(missingReviewSignatures(config, [])).toEqual([])
  })
})
