/**
 * 三条需求人机命令的行为测：状态流转的每条边与它的前置条件。
 *
 * 与 `proposal_approve`、`contract_sign` 同档：模型拿不到这三条命令，
 * 所以这里只测命令面本身；工具面的缺席由 `surface.spec.ts` 钉住。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createRequirementApproveCommand } from '../src/commands/requirement-approve.js'
import { createRequirementCloseCommand } from '../src/commands/requirement-close.js'
import { createRequirementReleaseCommand } from '../src/commands/requirement-release.js'
import { loadRequirement, saveRequirement } from '../src/kernel/requirement-store.js'
import { saveTask } from '../src/kernel/task-store.js'
import { Requirement } from '../src/schema/spec.js'
import type { RequirementState, TaskState } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-requirement-cmd-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'requirements'), { recursive: true })
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return root
}

function writeRequirement(root: string, state: RequirementState = 'draft', withDocument = true): Requirement {
  const requirement = Requirement.parse({
    id: 'REQ-01',
    title: '支持自营与代发两种佣金',
    state,
    options: [{ name: '加参数', summary: '增加可选第三参数' }],
    opened_at: '2026-11-13T09:00:00+08:00',
  })
  saveRequirement(root, requirement)
  if (withDocument) writeFileSync(join(root, 'requirements', 'REQ-01.md'), '# 佣金改造\n', 'utf8')
  return requirement
}

function writeTask(root: string, id: string, state: TaskState, requirement = 'REQ-01'): void {
  saveTask(root, {
    id,
    title: `任务 ${id}`,
    description: '',
    attachments: [],
    grade: 'B',
    state,
    rules: [],
    requirement,
    depends_on: [],
    scope: { irreversible: [], allowed_paths: [] },
    evidence_required: [],
    opened_at: '2026-11-13T10:00:00+08:00',
    closed_at: null,
  })
}

const AT = '2026-11-13T12:00:00+08:00'
const approve = (root: string, raw: string) => createRequirementApproveCommand(root, () => AT).handler({ rawInput: raw })
const release = (root: string, raw: string) => createRequirementReleaseCommand(root, () => AT).handler({ rawInput: raw })
const close = (root: string, raw: string) => createRequirementCloseCommand(root, () => AT).handler({ rawInput: raw })

describe('需求确认命令', () => {
  it('起草态且正文存在：状态与确认时刻写入，正文与候选不变', () => {
    const root = makeSpec()
    const before = writeRequirement(root)

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = loadRequirement(root, 'REQ-01')
    expect(after.state).toBe('confirmed')
    expect(after.confirmed_at).toBe(AT)
    expect({ ...after, state: 'draft', confirmed_at: undefined }).toEqual(before)
  })

  it('正文不存在时拒绝确认', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft', false)

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('还没有正文')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('非起草态拒绝重复确认', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('只有起草态')
  })

  it('编号缺失或不存在都报人话', () => {
    const root = makeSpec()
    expect(approve(root, '')).toMatchObject({ kind: 'error' })
    expect(approve(root, 'REQ-09')).toMatchObject({ kind: 'error' })
    expect(approve(root, 'P-01')).toMatchObject({ kind: 'error' })
  })
})

describe('需求发布命令', () => {
  it('已确认且关联任务全部收口：标为已上线并写发布时刻', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')
    writeTask(root, 'T-01', 'closed')
    writeTask(root, 'T-02', 'closed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = loadRequirement(root, 'REQ-01')
    expect(after.state).toBe('released')
    expect(after.released_at).toBe(AT)
  })

  it('没有关联任务时拒绝，并提示先拆任务', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('还没有关联任务')
    expect(loadRequirement(root, 'REQ-01').state).toBe('confirmed')
  })

  it('还有未关闭任务时拒绝，并列出任务编号与状态', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')
    writeTask(root, 'T-01', 'closed')
    writeTask(root, 'T-02', 'implementing')
    writeTask(root, 'T-03', 'verifying')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    const text = result.kind === 'error' ? result.text : ''
    expect(text).toContain('T-02（implementing）')
    expect(text).toContain('T-03（verifying）')
    expect(text).not.toContain('T-01')
  })

  it('未确认的需求不能发布', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')
    writeTask(root, 'T-01', 'closed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('只有已确认')
  })
})

describe('需求关闭命令', () => {
  it('起草态可以直接关闭，写关闭时刻', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(loadRequirement(root, 'REQ-01')).toMatchObject({ state: 'closed', closed_at: AT })
  })

  it('已确认的需求可以关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    expect(close(root, 'REQ-01')).toMatchObject({ kind: 'success' })
    expect(loadRequirement(root, 'REQ-01').state).toBe('closed')
  })

  it('已关闭的需求不再重复关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'closed')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('不需要重复关闭')
  })

  it('已上线是终态，拒绝关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'released')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('终态')
    expect(loadRequirement(root, 'REQ-01').state).toBe('released')
  })

  it('编号形态不对直接报错，不碰文件', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')

    const result = close(root, 'REQ-1')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('非法的需求编号')
  })
})
