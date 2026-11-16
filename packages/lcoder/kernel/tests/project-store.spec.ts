import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { ensureProjectId, loadProject, projectPath, saveProject } from '../src/kernel/project-store.js'
import { ProjectInfo } from '../src/schema/spec.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const root = mkdtempSync(join(tmpdir(), 'lcoder-project-store-'))
  dirs.push(root)
  const spec = join(root, '.spec')
  mkdirSync(spec, { recursive: true })
  return spec
}

const LEGACY = {
  kind: 'desktop',
  repo: { url: 'E:/Projects/talent-demo', branch: 'main' },
  docs: { product: 'prd.md' },
  tracks: [{ id: 'payment', name: '支付端' }],
}

describe('projectId', () => {
  it('没有 project.yaml 时不凭空生成 id', () => {
    const spec = makeSpec()

    expect(() => ensureProjectId(spec)).toThrow(/项目身份还没登记/)
  })

  it('旧文件缺 projectId → 生成 UUID 写回并保留其余字段', () => {
    const spec = makeSpec()
    writeFileSync(projectPath(spec), stringifyYaml(LEGACY), 'utf8')

    const projectId = ensureProjectId(spec)

    expect(projectId).toMatch(UUID)
    const info = ProjectInfo.parse(parseYaml(readFileSync(projectPath(spec), 'utf8')))
    expect(info.projectId).toBe(projectId)
    expect(info).toMatchObject({
      kind: 'desktop',
      repo: { url: 'E:/Projects/talent-demo', branch: 'main' },
      docs: { product: 'prd.md' },
      tracks: [{ id: 'payment', name: '支付端' }],
    })
  })

  it('已有 projectId → 只读回，不改文件', () => {
    const spec = makeSpec()
    const projectId = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'
    writeFileSync(projectPath(spec), stringifyYaml({ ...LEGACY, projectId }), 'utf8')
    const before = readFileSync(projectPath(spec), 'utf8')

    expect(ensureProjectId(spec)).toBe(projectId)
    expect(readFileSync(projectPath(spec), 'utf8')).toBe(before)
  })

  it('连续调用返回同一个 id', () => {
    const spec = makeSpec()
    writeFileSync(projectPath(spec), stringifyYaml(LEGACY), 'utf8')

    const first = ensureProjectId(spec)
    expect(ensureProjectId(spec)).toBe(first)
    expect(loadProject(spec)?.projectId).toBe(first)
  })

  it('非法 projectId 在读取时当场拒绝', () => {
    const spec = makeSpec()
    writeFileSync(projectPath(spec), stringifyYaml({ ...LEGACY, projectId: 'not-a-uuid' }), 'utf8')

    expect(() => loadProject(spec)).toThrow(/projectId 必须是 UUID/)
    expect(() => ensureProjectId(spec)).toThrow(/projectId 必须是 UUID/)
  })

  it('重新保存仍带 projectId', () => {
    const spec = makeSpec()
    const info = ProjectInfo.parse({ ...LEGACY, projectId: '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b' })

    saveProject(spec, info)

    expect(loadProject(spec)?.projectId).toBe(info.projectId)
  })
})
