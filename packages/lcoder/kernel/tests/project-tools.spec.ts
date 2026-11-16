import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createProjectTools } from '../src/tools/project-tools.js'
import { ProjectInfo } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** 完全空的文件夹：没有 `.spec`，也没有任何文档。 */
function makeEmptyRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-project-empty-'))
  dirs.push(repo)
  return { repo, spec: join(repo, '.spec') }
}

function call(specRoot: string, toolName: string, args: Record<string, unknown>) {
  const tool = createProjectTools(specRoot).find(t => t.name === toolName)
  if (tool === undefined) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

const ANSWERED = {
  kind: 'desktop',
  repo_url: 'E:/Projects/intake-demo',
  repo_branch: 'main',
  doc_product: 'prd.md#4.2',
}

describe('项目信息工具', () => {
  it('提供 project_draft', () => {
    expect(createProjectTools(makeEmptyRepo().spec).map(t => t.name)).toEqual(['project_draft'])
  })

  it('空文件夹里登记 → 建出 .spec/project.yaml 并落全部答案', async () => {
    const { spec } = makeEmptyRepo()

    const r = await call(spec, 'project_draft', ANSWERED)
    expect(r).toMatchObject({ created: true, kind: 'desktop', repo_url: 'E:/Projects/intake-demo', repo_branch: 'main' })

    const info = ProjectInfo.parse(parseYaml(readFileSync(join(spec, 'project.yaml'), 'utf8')))
    expect(info).toMatchObject({
      kind: 'desktop',
      repo: { url: 'E:/Projects/intake-demo', branch: 'main' },
      docs: { product: 'prd.md#4.2' },
    })
    expect(info.projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
    expect(r.project_id).toBe(info.projectId)
  })

  it('文件已存在 → 只回读现值，不覆盖人写过的内容，也不补 projectId', async () => {
    const { spec } = makeEmptyRepo()
    mkdirSync(spec, { recursive: true })
    const path = join(spec, 'project.yaml')
    const original = 'kind: library\nrepo:\n  url: https://example.invalid/kept\n  branch: trunk\n'
    writeFileSync(path, original, 'utf8')

    const r = await call(spec, 'project_draft', { ...ANSWERED, repo_url: 'E:/Projects/other' })

    expect(r).toMatchObject({ created: false, repo_url: 'https://example.invalid/kept', repo_branch: 'trunk' })
    expect(readFileSync(path, 'utf8')).toContain('https://example.invalid/kept')
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('登记项目追加轨；与内置轨重名或重复被拒', async () => {
    const { spec } = makeEmptyRepo()
    const r = await call(spec, 'project_draft', {
      ...ANSWERED,
      tracks: [{ id: 'payment', name: '支付端' }],
    })
    expect(r).toMatchObject({ created: true, tracks: [{ id: 'payment', name: '支付端' }] })
    expect(readFileSync(join(spec, 'project.yaml'), 'utf8')).toContain('payment')

    const other = makeEmptyRepo()
    await expect(call(other.spec, 'project_draft', {
      ...ANSWERED,
      tracks: [{ id: 'h5', name: '自定前端' }],
    })).rejects.toThrow(/内置轨重名/)
    expect(() => readFileSync(join(other.spec, 'project.yaml'), 'utf8')).toThrow()
  })

  it('类型不在三档内 → 当场抛并给出可选值', async () => {    const { spec } = makeEmptyRepo()

    await expect(call(spec, 'project_draft', { ...ANSWERED, kind: 'mobile' })).rejects.toThrow(/web、desktop、library/)
    expect(() => readFileSync(join(spec, 'project.yaml'), 'utf8')).toThrow()
  })

  it('仓库地址或分支为空 → 抛，不留半截文件', async () => {
    const { spec } = makeEmptyRepo()

    await expect(call(spec, 'project_draft', { ...ANSWERED, repo_url: '  ' })).rejects.toThrow(/repo_url 与 repo_branch/)
    expect(() => readFileSync(join(spec, 'project.yaml'), 'utf8')).toThrow()
  })

  it('文档路径给空串 → 不写空字段，交给 schema 默认值', async () => {
    const { spec } = makeEmptyRepo()

    await call(spec, 'project_draft', { ...ANSWERED, doc_product: '  ', doc_architecture: 'architecture.md' })

    const onDisk = ProjectInfo.parse(parseYaml(readFileSync(join(spec, 'project.yaml'), 'utf8')))
    expect(onDisk.docs).toEqual({ architecture: 'architecture.md' })
  })
})
