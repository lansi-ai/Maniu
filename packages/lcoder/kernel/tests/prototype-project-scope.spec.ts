/**
 * T-323 项目级统一活原型：作用域目录规则、旧 REQ-xx 数据回退、两种作用域的读写与提交。
 *
 * 既有数据全部在 `.spec/prototypes/<REQ-xx>/`；项目级主原型落在
 * `.spec/prototypes/__project__/`，主原型不存在时读取回退到最近一条需求。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterAll, describe, expect, it } from 'vitest'

import { createRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { PrototypeController } from '../src/prototype/controller.js'
import {
  isProjectScopeDir, PROJECT_SCOPE_DIR, prototypePath, prototypeScopeDir, prototypeStagedPath,
} from '../src/prototype/paths.js'
import {
  commitStagedPrototype, listSnapshots, prototypeReadScopes, readPrototypeHtml, readStagedPrototype,
  restoreSnapshot, saveSnapshot, writeStagedPrototype,
} from '../src/prototype/store.js'
import { StagedPrototypeSchema } from '../src/prototype/types.js'
import type { StagedPrototype } from '../src/prototype/types.js'
import { createPrototypeTools } from '../src/tools/prototype-tools.js'
import { rejectsWithCode } from './prototype-remote-assert.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))
const CONTENT = '# 原型测试需求\n\n一段正文。\n'

/** 通过质量门禁的完整 HTML；命中需求关键词「原型测试需求」「一段正文」。 */
const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>原型测试需求</title><style>body{color:#123456}</style></head><body><nav>导航</nav><h1>原型测试需求</h1><section class="features"><ul><li>一段正文</li></ul></section><footer>页脚</footer></body></html>'
const STAGED_HTML = HTML.replace('页脚', '暂存页脚')

function makeSpec(): { spec: string; id: string; repo: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-proto-project-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  const spec = join(repo, '.spec')
  const draft = createRequirement(spec, {
    title: '原型测试需求',
    content: CONTENT,
    opened_at: '2026-11-20T00:00:00.000Z',
  })
  return { spec, id: draft.requirement.id, repo }
}

function makeController(repo: string): PrototypeController {
  const ctx = new Context()
  ctx.provide('sessions', { get: () => ({ header: { cwd: repo } }) } as never)
  return new PrototypeController(ctx)
}

function staged(scopeId: string, html: string): StagedPrototype {
  return {
    requirementId: scopeId,
    html,
    changeKind: 'visual',
    summary: ['调整页脚'],
    changedDomPaths: ['body:nth-child(2) > footer:nth-child(4)'],
    createdAt: '2026-11-23T00:00:00.000Z',
  }
}

function writeCommitted(spec: string, scopeDir: string, html: string): void {
  const target = prototypePath(spec, scopeDir, 'index.html')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html, 'utf8')
}

async function callStage(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_stage')
  if (tool === undefined) throw new Error('没有 prototype_stage')
  return tool.execute(args, {} as Parameters<typeof tool.execute>[1]) as Promise<Record<string, unknown>>
}

describe('作用域目录规则', () => {
  it('缺省需求编号指向项目级目录，给出编号时用它自己', () => {
    expect(PROJECT_SCOPE_DIR).toBe('__project__')
    expect(prototypeScopeDir(undefined)).toBe(PROJECT_SCOPE_DIR)
    expect(prototypeScopeDir('  ')).toBe(PROJECT_SCOPE_DIR)
    expect(prototypeScopeDir('REQ-01')).toBe('REQ-01')
    expect(isProjectScopeDir(PROJECT_SCOPE_DIR)).toBe(true)
    expect(isProjectScopeDir('REQ-01')).toBe(false)
  })

  it('项目级路径同样拒绝越界', () => {
    const { spec } = makeSpec()
    expect(() => prototypePath(spec, PROJECT_SCOPE_DIR, '..', 'REQ-01', 'index.html')).toThrow(/越界/)
    expect(prototypeStagedPath(spec, PROJECT_SCOPE_DIR)).toBe(join(spec, 'prototypes', PROJECT_SCOPE_DIR, 'staged.json'))
  })
})

describe('项目级主原型读写', () => {
  it('项目级正式版、暂存与快照都落在 __project__ 目录', () => {
    const { spec } = makeSpec()
    writeCommitted(spec, PROJECT_SCOPE_DIR, HTML)
    writeStagedPrototype(spec, PROJECT_SCOPE_DIR, staged(PROJECT_SCOPE_DIR, STAGED_HTML))

    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toBe(HTML)
    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)?.html).toBe(STAGED_HTML)
    expect(existsSync(prototypePath(spec, PROJECT_SCOPE_DIR, 'staged.json'))).toBe(true)

    const snapshotId = saveSnapshot(spec, PROJECT_SCOPE_DIR, HTML)
    expect(snapshotId).toBeDefined()
    expect(listSnapshots(spec, PROJECT_SCOPE_DIR).map(item => item.snapshotId)).toEqual([snapshotId])
  })

  it('提交项目级暂存只改项目主原型，不碰需求 YAML 与需求原型', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, PROJECT_SCOPE_DIR, HTML)
    writeStagedPrototype(spec, PROJECT_SCOPE_DIR, staged(PROJECT_SCOPE_DIR, STAGED_HTML))

    const result = commitStagedPrototype(spec, PROJECT_SCOPE_DIR)

    expect(result.requirementSync).toBe('none')
    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toBe(STAGED_HTML)
    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)).toBeNull()
    expect(loadRequirement(spec, id).prototype).toBeUndefined()
    expect(existsSync(prototypePath(spec, id, 'index.html'))).toBe(false)
    expect(listSnapshots(spec, PROJECT_SCOPE_DIR)).toHaveLength(1)
  })
})

describe('项目级读取回退到旧 REQ-xx 数据', () => {
  it('主原型不存在时读回最近需求的正式版、暂存与快照', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, id, HTML)
    writeStagedPrototype(spec, id, staged(id, STAGED_HTML))
    const snapshotId = saveSnapshot(spec, id, HTML)

    expect(prototypeReadScopes(spec, PROJECT_SCOPE_DIR)).toEqual([PROJECT_SCOPE_DIR, id])
    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toBe(HTML)
    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)?.html).toBe(STAGED_HTML)
    expect(listSnapshots(spec, PROJECT_SCOPE_DIR).map(item => item.snapshotId)).toEqual([snapshotId])
  })

  it('项目主原型落盘后不再回退到需求目录', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, id, HTML)
    writeStagedPrototype(spec, id, staged(id, STAGED_HTML))
    writeCommitted(spec, PROJECT_SCOPE_DIR, HTML.replace('页脚', '项目页脚'))

    expect(prototypeReadScopes(spec, PROJECT_SCOPE_DIR)).toEqual([PROJECT_SCOPE_DIR])
    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toContain('项目页脚')
    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)).toBeNull()
  })

  it('需求级作用域只读它自己，不回退到项目级', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, PROJECT_SCOPE_DIR, HTML.replace('页脚', '项目页脚'))

    expect(prototypeReadScopes(spec, id)).toEqual([id])
    expect(readPrototypeHtml(spec, id)).toBeUndefined()
  })

  it('恢复需求目录里的快照时写进项目主原型，不改需求原型', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, id, HTML)
    const snapshotId = saveSnapshot(spec, id, HTML)
    if (snapshotId === undefined) throw new Error('没有归档快照')
    writeCommitted(spec, id, HTML.replace('页脚', '新页脚'))

    const restored = restoreSnapshot(spec, PROJECT_SCOPE_DIR, snapshotId)

    expect(restored.html).toBe(HTML)
    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toBe(HTML)
    expect(readFileSync(prototypePath(spec, id, 'index.html'), 'utf8')).toContain('新页脚')
  })
})

describe('prototype_stage 的两种作用域', () => {
  it('不传 requirementId 时暂存到项目级目录，回执标明 project', async () => {
    const { spec } = makeSpec()
    const result = await callStage(spec, {
      html: HTML,
      changeKind: 'visual',
      summary: ['首版项目原型'],
      changedDomPaths: [],
    })

    expect(result).toMatchObject({ ok: true, scope: 'project', staged_path: `.spec/prototypes/${PROJECT_SCOPE_DIR}/staged.json` })
    expect(result.requirement_id).toBeUndefined()
    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)?.requirementId).toBe(PROJECT_SCOPE_DIR)
    expect(existsSync(prototypeStagedPath(spec, PROJECT_SCOPE_DIR))).toBe(true)
  })

  it('传 requirementId 时仍暂存到该需求目录，回执标明 requirement', async () => {
    const { spec, id } = makeSpec()
    const result = await callStage(spec, {
      requirementId: id,
      html: HTML,
      changeKind: 'visual',
      summary: ['首版需求原型'],
      changedDomPaths: [],
    })

    expect(result).toMatchObject({ ok: true, scope: 'requirement', requirement_id: id })
    expect(readStagedPrototype(spec, id)?.requirementId).toBe(id)
    expect(existsSync(prototypeStagedPath(spec, PROJECT_SCOPE_DIR))).toBe(false)
  })

  it('项目级暂存丢弃模型给的正文提案，不落假提案', async () => {
    const { spec } = makeSpec()
    await callStage(spec, {
      html: HTML,
      changeKind: 'business',
      summary: ['项目级改版'],
      changedDomPaths: [],
      requirementProposedContent: '# 提案\n',
    })

    expect(readStagedPrototype(spec, PROJECT_SCOPE_DIR)?.requirementDiff).toBeUndefined()
  })
})

describe('Remote 作用域', () => {
  it('不传 requirementId 时读项目级视图（含旧数据回退）', async () => {
    const { spec, id, repo } = makeSpec()
    writeCommitted(spec, id, HTML)
    writeStagedPrototype(spec, id, staged(id, STAGED_HTML))
    const controller = makeController(repo)

    const view = await controller.getStaged({ sessionId: SessionId('s1') })
    expect(view.committedHtml).toBe(HTML)
    expect(view.staged?.html).toBe(STAGED_HTML)

    const scoped = await controller.getStaged({ sessionId: SessionId('s1'), requirementId: id })
    expect(scoped.committedHtml).toBe(HTML)
    expect(scoped.staged?.html).toBe(STAGED_HTML)
  })

  it('提交项目级暂存不写需求登记，需求级提交仍写', async () => {
    const { spec, id, repo } = makeSpec()
    const controller = makeController(repo)
    writeStagedPrototype(spec, PROJECT_SCOPE_DIR, staged(PROJECT_SCOPE_DIR, STAGED_HTML))

    await controller.commitStaged({ sessionId: SessionId('s1') })
    expect(readPrototypeHtml(spec, PROJECT_SCOPE_DIR)).toBe(STAGED_HTML)
    expect(loadRequirement(spec, id).prototype).toBeUndefined()

    writeStagedPrototype(spec, id, staged(id, HTML))
    await controller.commitStaged({ sessionId: SessionId('s1'), requirementId: id })
    expect(loadRequirement(spec, id).prototype?.path).toBe(`prototypes/${id}/index.html`)
    expect(readFileSync(prototypePath(spec, id, 'index.html'), 'utf8')).toBe(HTML)
  })

  it('非法需求编号仍显式失败', async () => {
    const { repo } = makeSpec()
    const controller = makeController(repo)
    await rejectsWithCode(
      controller.getStaged({ sessionId: SessionId('s1'), requirementId: '../escape' }),
      'PROTOTYPE/FAILED',
    )
  })
})

describe('暂存 wire 校验', () => {
  it('接受旧需求编号与项目级标记，拒绝其它作用域', () => {
    expect(StagedPrototypeSchema.parse(staged('REQ-01', HTML)).requirementId).toBe('REQ-01')
    expect(StagedPrototypeSchema.parse(staged(PROJECT_SCOPE_DIR, HTML)).requirementId).toBe(PROJECT_SCOPE_DIR)
    expect(() => StagedPrototypeSchema.parse(staged('project', HTML))).toThrow()
  })
})
