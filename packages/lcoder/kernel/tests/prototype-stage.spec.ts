/** 原型暂存/快照/受控回写：不碰正式版与需求正文、快照 10 份淘汰、回写三态、路径穿越拒绝。 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterAll, describe, expect, it } from 'vitest'

import { createRequirement, loadRequirement, recordRequirementReview, saveRequirement } from '../src/kernel/requirement-store.js'
import { prototypeSnapshotPath } from '../src/prototype/paths.js'
import { PrototypeController } from '../src/prototype/controller.js'
import {
  commitStagedPrototype, discardStagedPrototype, listSnapshots, readPrototypeHtml,
  readStagedPrototype, restoreSnapshot, saveSnapshot, writeStagedPrototype,
} from '../src/prototype/store.js'
import type { StagedPrototype } from '../src/prototype/types.js'
import { createPrototypeTools } from '../src/tools/prototype-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))
const CONTENT = '# 原型测试需求\n\n一段正文。\n'

/** 通过质量门禁的完整 HTML；命中需求关键词「原型测试需求」「一段正文」。 */
const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>原型测试需求</title><style>body{color:#123456}</style></head><body><nav>导航</nav><h1>原型测试需求</h1><section class="features"><ul><li>一段正文</li></ul></section><footer>页脚</footer></body></html>'
const BAD_HTML = '<!doctype html><html><head></head><body><script src="https://evil.example/a.js"></script><h1>原型测试需求</h1><p>一段正文</p></body></html>'

function makeSpec(): { spec: string; id: string; repo: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-proto-stage-'))
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

function stage(id: string, html: string, overrides: Partial<StagedPrototype> = {}): StagedPrototype {
  return {
    requirementId: id,
    html,
    changeKind: 'visual',
    summary: ['调整导航布局', '补充列表项'],
    changedDomPaths: ['body:nth-child(2) > nav:nth-child(1)'],
    createdAt: '2026-11-23T00:00:00.000Z',
    ...overrides,
  }
}

function stageTool(spec: string) {
  const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_stage')
  if (tool === undefined) throw new Error('没有 prototype_stage')
  return tool
}

async function callStage(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = stageTool(spec)
  return tool.execute(args, {} as Parameters<typeof tool.execute>[1]) as Promise<Record<string, unknown>>
}

function writeCommitted(spec: string, id: string, html: string): void {
  const target = join(spec, 'prototypes', id, 'index.html')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html, 'utf8')
}

function seedCommitted(spec: string, id: string): void {
  writeCommitted(spec, id, HTML)
  saveSnapshot(spec, id, readPrototypeHtml(spec, id))
}

describe('prototype_stage 暂存不碰正式版与需求正文', () => {
  it('校验通过后只写 staged.json，index.html 与 REQ md 字节不变', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const indexPath = join(spec, 'prototypes', id, 'index.html')
    const docPath = join(spec, 'requirements', `${id}.md`)
    const htmlBefore = readFileSync(indexPath)
    const docBefore = readFileSync(docPath)

    const result = await callStage(spec, {
      requirementId: id,
      html: HTML,
      changeKind: 'business',
      summary: ['把列表改成可筛选', '新增空状态提示'],
      changedDomPaths: ['body:nth-child(2) > section.features:nth-child(3)'],
    })

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ requirement_id: id, change_kind: 'business' })
    const stored = readStagedPrototype(spec, id)
    expect(stored).toMatchObject({
      requirementId: id,
      html: HTML,
      changeKind: 'business',
      summary: ['把列表改成可筛选', '新增空状态提示'],
    })
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(true)
    expect(readFileSync(indexPath).equals(htmlBefore)).toBe(true)
    expect(readFileSync(docPath).equals(docBefore)).toBe(true)
  })

  it('非法 HTML 被质量门禁拦截，staged.json 与两个正式文件都不动', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const indexPath = join(spec, 'prototypes', id, 'index.html')
    const docPath = join(spec, 'requirements', `${id}.md`)
    const htmlBefore = readFileSync(indexPath)
    const docBefore = readFileSync(docPath)

    const bad = await callStage(spec, {
      requirementId: id,
      html: BAD_HTML,
      changeKind: 'visual',
      summary: ['改一处颜色', '改一处间距'],
    })
    expect(bad.ok).toBe(false)
    expect((bad.failed as readonly { code: string }[]).map(item => item.code)).toContain('UNSAFE_MARKUP')
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(false)
    expect(readFileSync(indexPath).equals(htmlBefore)).toBe(true)
    expect(readFileSync(docPath).equals(docBefore)).toBe(true)

    // 摘要条数也不能绕过门禁写暂存。
    await expect(callStage(spec, {
      requirementId: id,
      html: HTML,
      changeKind: 'visual',
      summary: ['只有一条'],
    })).rejects.toThrow(/2 到 4 条/)
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(false)
  })

  it('正文基线取磁盘当前值，模型传入旧正文无效', async () => {
    const { spec, id } = makeSpec()
    const result = await callStage(spec, {
      requirementId: id,
      html: HTML,
      changeKind: 'business',
      summary: ['调整列表', '补充提示'],
      requirementProposedContent: `${CONTENT}\n## 新增口径\n`,
    })
    expect(result.ok).toBe(true)
    const stored = readStagedPrototype(spec, id)
    expect(stored?.requirementDiff?.baseContent).toBe(CONTENT)
    expect(stored?.requirementDiff?.proposedContent).toContain('新增口径')
  })
})

describe('commitStaged 归档、原子写与快照淘汰', () => {
  it('每次提交先归档旧版，超 10 份淘汰最旧，最后清掉 staged.json', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, id, HTML)
    const versions: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const html = HTML.replace('页脚', `页脚 v${String(i)}`)
      versions.push(html)
      writeStagedPrototype(spec, id, stage(id, html))
      const result = commitStagedPrototype(spec, id)
      expect(result.requirementSync).toBe('none')
      expect(typeof result.snapshotId).toBe('string')
    }

    expect(readPrototypeHtml(spec, id)).toBe(versions[11])
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(false)
    const history = join(spec, 'prototypes', id, 'history')
    expect(readdirSync(history).filter(name => name.endsWith('.html'))).toHaveLength(10)

    const snapshots = listSnapshots(spec, id)
    expect(snapshots).toHaveLength(10)
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i - 1]!.snapshotId > snapshots[i]!.snapshotId).toBe(true)
    }
    // 最早两版已被淘汰，淘汰后读回的快照内容都是还留在列表里的版本。
    const survivors = new Set(snapshots.map(item => item.snapshotId))
    expect(survivors.has(snapshots[0]!.snapshotId)).toBe(true)
    expect(survivors.size).toBe(10)
  })

  it('没有暂存时提交返回结构化 NO_STAGED，不创建正式版', () => {
    const { spec, id } = makeSpec()
    try {
      commitStagedPrototype(spec, id)
      expect.unreachable('没有暂存时提交应当失败')
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'PROTOTYPE/NO_STAGED' })
    }
    expect(readPrototypeHtml(spec, id)).toBeUndefined()
  })
})

describe('需求正文受控回写三态', () => {
  it('draft 未锁定且基线一致时 patch 成功', () => {
    const { spec, id } = makeSpec()
    const proposed = `${CONTENT}\n## 补充说明\n\n新增一段口径。\n`
    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: CONTENT, proposedContent: proposed, summary: '补充一段业务口径' },
    }))
    const result = commitStagedPrototype(spec, id, { applyRequirementDiff: true })
    expect(result.requirementSync).toBe('patched')
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(proposed)
    expect(readPrototypeHtml(spec, id)).toBe(HTML)
  })

  it('基线冲突返回可解释失败并保留 staged.json', () => {
    const { spec, id } = makeSpec()
    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: '过期的正文基线', proposedContent: '新正文', summary: '补充口径' },
    }))
    expect(() => commitStagedPrototype(spec, id, { applyRequirementDiff: true })).toThrow(/基线不一致|REQUIREMENT_BASELINE_CONFLICT/)
    expect(readStagedPrototype(spec, id)?.html).toBe(HTML)
  })

  it('draft 有 pending 评审时原型落盘但拒绝改正文（skipped_pending）', () => {
    const { spec, id } = makeSpec()
    recordRequirementReview(spec, id, {
      report: `requirements/${id}/reviews/R1.md`,
      at: '2026-11-23T01:00:00.000Z',
    })
    const proposed = `${CONTENT}\n## 不应写入\n`
    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: CONTENT, proposedContent: proposed, summary: '不应写入的正文' },
    }))
    const result = commitStagedPrototype(spec, id, { applyRequirementDiff: true })
    expect(result.requirementSync).toBe('skipped_pending')
    expect(result.message).toContain('未处置的评审')
    expect(readPrototypeHtml(spec, id)).toBe(HTML)
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(CONTENT)
  })

  it('confirmed 无论 patch 还是 amend 模式都跳过正文（skipped_locked）', () => {
    const { spec, id } = makeSpec()
    saveRequirement(spec, { ...loadRequirement(spec, id), state: 'confirmed' })
    const proposed = `${CONTENT}\n## 锁定后不应写入\n`
    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: CONTENT, proposedContent: proposed, summary: '锁定后的正文' },
    }))
    const patched = commitStagedPrototype(spec, id, { applyRequirementDiff: true, requirementAmendMode: 'patch' })
    expect(patched.requirementSync).toBe('skipped_locked')
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(CONTENT)

    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: CONTENT, proposedContent: proposed, summary: '锁定后的正文' },
    }))
    const amended = commitStagedPrototype(spec, id, { applyRequirementDiff: true, requirementAmendMode: 'amend' })
    expect(amended.requirementSync).toBe('skipped_locked')
    expect(amended.message).toContain('amend 模式')
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(CONTENT)
    expect(readPrototypeHtml(spec, id)).toBe(HTML)
  })

  it('未开启 applyRequirementDiff 时存在提案也不改正文', () => {
    const { spec, id } = makeSpec()
    writeStagedPrototype(spec, id, stage(id, HTML, {
      requirementDiff: { baseContent: CONTENT, proposedContent: `${CONTENT}\n改稿`, summary: '不应生效' },
    }))
    const result = commitStagedPrototype(spec, id)
    expect(result.requirementSync).toBe('none')
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(CONTENT)
  })
})

describe('discard、快照恢复与路径穿越拒绝', () => {
  it('discardStaged 只删暂存，正式版与正文零污染', () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const docBefore = readFileSync(join(spec, 'requirements', `${id}.md`))
    writeStagedPrototype(spec, id, stage(id, HTML))
    discardStagedPrototype(spec, id)
    expect(readStagedPrototype(spec, id)).toBeNull()
    expect(readPrototypeHtml(spec, id)).toBe(HTML)
    expect(readFileSync(join(spec, 'requirements', `${id}.md`)).equals(docBefore)).toBe(true)
  })

  it('恢复按倒序取快照，当前版先归档，REQ yaml 的 generatedAt 同步刷新', () => {
    const { spec, id } = makeSpec()
    writeCommitted(spec, id, HTML)
    const first = HTML.replace('页脚', '第一版')
    const second = HTML.replace('页脚', '第二版')
    writeStagedPrototype(spec, id, stage(id, first))
    commitStagedPrototype(spec, id)
    writeStagedPrototype(spec, id, stage(id, second))
    commitStagedPrototype(spec, id)

    const before = listSnapshots(spec, id)
    expect(before).toHaveLength(2)
    expect(before[0]!.snapshotId > before[1]!.snapshotId).toBe(true)
    const target = before[0]!
    const result = restoreSnapshot(spec, id, target.snapshotId)
    expect(result.html).toBe(first)
    expect(readPrototypeHtml(spec, id)).toBe(first)
    expect(typeof loadRequirement(spec, id).prototype?.generatedAt).toBe('string')
    expect(loadRequirement(spec, id).prototype?.generatedAt).toBe(result.restoredAt)
    expect(listSnapshots(spec, id)).toHaveLength(3)
  })

  it('快照编号的路径穿越与越界形态被拒，控制器只回结构化失败', async () => {
    const { spec, id, repo } = makeSpec()
    for (const value of ['..', '../secret', 'a/b', 'C:\\secret', 'snapshot.html', '']) {
      expect(() => prototypeSnapshotPath(spec, id, value)).toThrow()
    }
    const controller = makeController(repo)
    const sessionId = SessionId('s1')
    const answer = await controller.restoreSnapshot({ sessionId, requirementId: id, snapshotId: '../secret' })
    expect(answer).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/FAILED' } })
    expect(existsSync(join(spec, 'prototypes', id, 'history'))).toBe(false)
  })
})

describe('5 个暂存 Remote 的统一 { input } 契约', () => {
  it('getStaged / commitStaged / discardStaged / listSnapshots / restoreSnapshot 都经失败包装', async () => {
    const { spec, id, repo } = makeSpec()
    const controller = makeController(repo)
    const sessionId = SessionId('s1')

    const empty = await controller.getStaged({ sessionId, requirementId: id })
    expect(empty).toEqual({ ok: true, value: { staged: null, committedHtml: null } })

    const noStaged = await controller.commitStaged({ sessionId, requirementId: id })
    expect(noStaged).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/NO_STAGED' } })

    writeCommitted(spec, id, HTML)
    writeStagedPrototype(spec, id, stage(id, HTML))
    const staged = await controller.getStaged({ sessionId, requirementId: id })
    expect(staged).toMatchObject({ ok: true, value: { staged: { requirementId: id, html: HTML } } })

    const committed = await controller.commitStaged({ sessionId, requirementId: id })
    expect(committed.ok).toBe(true)
    const snapshots = await controller.listSnapshots({ sessionId, requirementId: id })
    expect(snapshots.ok).toBe(true)
    if (snapshots.ok) expect(snapshots.value.snapshots).toHaveLength(1)

    const discarded = await controller.discardStaged({ sessionId, requirementId: id })
    expect(discarded).toEqual({ ok: true, value: { ok: true } })
    expect(readStagedPrototype(spec, id)).toBeNull()

    if (snapshots.ok && snapshots.value.snapshots[0] !== undefined) {
      const restored = await controller.restoreSnapshot({
        sessionId,
        requirementId: id,
        snapshotId: snapshots.value.snapshots[0].snapshotId,
      })
      expect(restored.ok).toBe(true)
    }
  })
})
