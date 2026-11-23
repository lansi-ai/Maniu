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
      summary: [],
    })).rejects.toThrow(/1 到 4 条/)
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

/** patches 的目标元素在 {@link HTML} 里的 DOM 路径。 */
const LI_PATH = 'body:nth-child(2) > section.features:nth-child(3) > ul:nth-child(1) > li:nth-child(1)'
const H1_PATH = 'body:nth-child(2) > h1:nth-child(2)'
const NAV_PATH = 'body:nth-child(2) > nav:nth-child(1)'
const FOOTER_PATH = 'body:nth-child(2) > footer:nth-child(4)'
const LI_HTML = '<li>一段正文</li>'

/**
 * 断言只改动了目标区间：目标前后的字节逐字一致。
 * @param before - 改动前 HTML。
 * @param after - 改动后 HTML。
 * @param removed - 被替换掉的原文。
 * @param added - 替换进去的新文。
 */
function expectOnlyEdited(before: string, after: string, removed: string, added: string): void {
  const at = before.indexOf(removed)
  expect(at).toBeGreaterThan(-1)
  expect(after).toBe(before.slice(0, at) + added + before.slice(at + removed.length))
}

describe('prototype_stage 的 patches 在现有原型上做局部修改', () => {
  it('remove 删掉目标元素，其余字节不变且正式版与正文零改动', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const indexPath = join(spec, 'prototypes', id, 'index.html')
    const committedBefore = readFileSync(indexPath, 'utf8')

    const result = await callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删掉列表里那条正文'],
      patches: [{ domPath: LI_PATH, action: 'remove' }],
    })

    expect(result.ok).toBe(true)
    expect(result.patch_count).toBe(1)
    const stored = readStagedPrototype(spec, id)
    expect(stored).not.toBeNull()
    expectOnlyEdited(committedBefore, stored?.html ?? '', LI_HTML, '')
    expect(stored?.changedDomPaths).toEqual([LI_PATH])
    expect(readFileSync(indexPath, 'utf8')).toBe(committedBefore)
    expect(readFileSync(join(spec, 'requirements', `${id}.md`), 'utf8')).toBe(CONTENT)
  })

  it('replace 换掉目标元素、style 只改目标元素的内联样式，两条 patch 按序生效', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const replacement = '<h1 class="headline">原型测试需求 · 已改</h1>'

    const result = await callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['换掉标题', '导航换一个颜色'],
      patches: [
        { domPath: H1_PATH, action: 'replace', newHtml: replacement },
        { domPath: NAV_PATH, action: 'style', newCss: 'color: #ff0000' },
      ],
    })

    expect(result.ok).toBe(true)
    const stored = readStagedPrototype(spec, id)
    expect(stored?.html).toBe(HTML
      .replace('<h1>原型测试需求</h1>', replacement)
      .replace('<nav>', '<nav style="color: #ff0000">'))
    expect(stored?.changedDomPaths).toEqual([H1_PATH, NAV_PATH])
  })

  it('没传 html 时以暂存版为基准，而不是磁盘正式版', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const stagedBase = HTML.replace('页脚', '暂存页脚')
    writeStagedPrototype(spec, id, stage(id, stagedBase))

    const result = await callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['页脚换个颜色'],
      patches: [{ domPath: FOOTER_PATH, action: 'style', newCss: 'color: #00aa00' }],
    })

    expect(result.ok).toBe(true)
    expect(readStagedPrototype(spec, id)?.html)
      .toBe(stagedBase.replace('<footer>', '<footer style="color: #00aa00">'))
  })

  it('domPath 没有精确命中时按末段标签降级匹配唯一元素', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)

    const result = await callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删掉列表里那条正文'],
      patches: [{ domPath: 'li:nth-child(1)', action: 'remove' }],
    })

    expect(result.ok).toBe(true)
    expectOnlyEdited(HTML, readStagedPrototype(spec, id)?.html ?? '', LI_HTML, '')
  })

  it('降级匹配到多个同类元素时报错，不猜也不误删', async () => {
    const { spec, id } = makeSpec()
    const twoItems = HTML.replace('<ul><li>一段正文</li></ul>', '<ul><li>一段正文</li><li>第二项</li></ul>')
    writeCommitted(spec, id, twoItems)

    await expect(callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删掉列表里那条正文'],
      patches: [{ domPath: 'li:nth-child(1)', action: 'remove' }],
    })).rejects.toThrow(/降级匹配到 2 个元素/)
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(false)
    expect(readFileSync(join(spec, 'prototypes', id, 'index.html'), 'utf8')).toBe(twoItems)
  })

  it('目标元素不存在、replace 缺 newHtml、质量门禁失败都报错且不写暂存', async () => {
    const { spec, id } = makeSpec()
    seedCommitted(spec, id)
    const stagedPath = join(spec, 'prototypes', id, 'staged.json')

    await expect(callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删一个不存在的元素'],
      patches: [{ domPath: 'body:nth-child(2) > table#nope:nth-child(9)', action: 'remove' }],
    })).rejects.toThrow(/找不到元素/)
    expect(existsSync(stagedPath)).toBe(false)

    await expect(callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['换掉标题'],
      patches: [{ domPath: H1_PATH, action: 'replace' }],
    })).rejects.toThrow(/必须给非空 newHtml/)
    expect(existsSync(stagedPath)).toBe(false)

    // 删掉导航会让必需区块缺失：结构化失败，暂存文件不落盘。
    const rejected = await callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删掉导航'],
      patches: [{ domPath: NAV_PATH, action: 'remove' }],
    })
    expect(rejected.ok).toBe(false)
    expect((rejected.failed as readonly { code: string }[]).map(item => item.code)).toContain('MISSING_SECTIONS')
    expect(existsSync(stagedPath)).toBe(false)
  })

  it('html 与 patches 都缺、或还没有原型就只给 patches 时都报错', async () => {
    const { spec, id } = makeSpec()

    await expect(callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['只有摘要'],
    })).rejects.toThrow(/html 或至少一条 patches/)

    await expect(callStage(spec, {
      requirementId: id,
      changeKind: 'visual',
      summary: ['删掉列表项'],
      patches: [{ domPath: LI_PATH, action: 'remove' }],
    })).rejects.toThrow(/先传完整 html/)
    expect(existsSync(join(spec, 'prototypes', id, 'staged.json'))).toBe(false)
  })
})
