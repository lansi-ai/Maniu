/**
 * 人机命令 `flow_save` 的行为测：写入、恢复预制、非法输入拒绝，以及模型工具面的缺席。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createFlowSaveCommand } from '../src/commands/flow-save.js'
import { flowConfigPath, loadFlowConfig } from '../src/kernel/flow-config.js'
import { saveRoles } from '../src/kernel/role-store.js'
import { ROLE_TOOLS, SURFACE, UNSCOPEED_SURFACE, allowedTools } from '../src/kernel/surface.js'
import { BUILTIN_ROLES } from '../src/schema/roles.js'
import type { TaskState } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-save-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(root, { recursive: true })
  saveRoles(root, [
    { id: 'deputy-pm', name: '副项目经理', inherits: 'pm' },
    { id: 'dotnet-eng', name: '.NET 工程师', inherits: 'dev' },
  ])
  return root
}

const save = (root: string, raw: string) => createFlowSaveCommand(root).handler({ rawInput: raw })

const CONFIG = '{"nodes":[{"node":"review","roles":["maniu-pm","deputy-pm"],"auto":true}]}'

describe('flow_save 命令', () => {
  it('合法 JSON 写入 flow.yaml，回执列出节点与衔接方式', () => {
    const root = makeSpec()
    const result = save(root, CONFIG)
    expect(result.kind).toBe('success')
    expect(result.kind === 'success' ? result.text : '').toContain('review[maniu-pm、deputy-pm]自动')
    expect(loadFlowConfig(root).config.nodes).toEqual([
      { node: 'review', roles: ['maniu-pm', 'deputy-pm'], auto: true },
    ])
  })

  it('preset 删除已有配置回到预制；没有文件时也给人话', () => {
    const root = makeSpec()
    expect(save(root, 'preset').kind).toBe('success')
    save(root, CONFIG)
    const result = save(root, 'preset')
    expect(result.kind).toBe('success')
    expect(existsSync(flowConfigPath(root))).toBe(false)
    expect(loadFlowConfig(root).source).toBe('preset')
  })

  it('空输入、坏 JSON、非法形状与解析不了的岗位都拒绝，不落盘', () => {
    const root = makeSpec()
    expect(save(root, '').kind).toBe('error')
    expect(save(root, '{nodes').kind).toBe('error')
    const bad = save(root, '{"nodes":[{"node":"deploy","roles":["maniu-pm"],"auto":true}]}')
    expect(bad.kind).toBe('error')
    const ghost = save(root, '{"nodes":[{"node":"review","roles":["nobody"],"auto":true}]}')
    expect(ghost.kind).toBe('error')
    expect(ghost.kind === 'error' ? ghost.text : '').toContain('nobody')
    expect(existsSync(flowConfigPath(root))).toBe(false)
  })

  it('节点能力不足拒绝保存：继承 dev 的岗位进不了评审节点', () => {
    const root = makeSpec()
    const result = save(root, '{"nodes":[{"node":"review","roles":["dotnet-eng"],"auto":true}]}')
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('流程节点能力不足')
    expect(result.kind === 'error' ? result.text : '').toContain('requirement_review_draft')
    expect(existsSync(flowConfigPath(root))).toBe(false)
  })

  it('没有 .spec 的仓库拒绝配置', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-flow-save-nospec-'))
    dirs.push(repo)
    const result = save(join(repo, '.spec'), CONFIG)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('还没有 .spec')
  })
})

describe('flow_save 是人机命令', () => {
  it('任何状态与任何角色的工具面都不含 flow_save', () => {
    for (const tools of Object.values(SURFACE)) expect(tools).not.toContain('flow_save')
    for (const tools of Object.values(ROLE_TOOLS)) expect(tools).not.toContain('flow_save')
    expect(UNSCOPEED_SURFACE).not.toContain('flow_save')
    for (const state of Object.keys(SURFACE) as TaskState[]) {
      for (const role of BUILTIN_ROLES) {
        expect(allowedTools(state, role)).not.toContain('flow_save')
      }
      expect(allowedTools(state, null)).not.toContain('flow_save')
    }
    expect(allowedTools(null, null)).not.toContain('flow_save')
  })
})
