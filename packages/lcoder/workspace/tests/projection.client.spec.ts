/**
 * 文件投影的读取与解析。
 *
 * 全部走假的文件面（内存数据），不碰真远程：要确认的是「读什么、怎么解析、
 * 失败怎么降级」，不是 workspaceFiles 怎么走线。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  loadWorkspaceProjection, rulesTextToRows, RULES_FILE, TASKS_DIR, taskTextToRow,
} from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

const SESSION = 's-1' as SessionId

/** 一个 task YAML 的标准长相（与 kernel 的 schema 对齐）。 */
const TASK_YAML = [
  'id: T-014',
  'title: 登录接口限流',
  'grade: B',
  'state: contracted',
  'rules:',
  '  - R-LOGIN-01',
  'evidence_required:',
  '  - test',
].join('\n')

const RULES_YAML = [
  'rules:',
  '  - id: R-LOGIN-01',
  '    module: 登录',
  '    kind: rule',
  '    text: 登录失败连续 5 次锁定 10 分钟',
  '    source:',
  '      doc: 需求v2',
  '    status: confirmed',
  '  - id: R-BROKEN',
  '    kind: rule',
].join('\n')

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function fail(message: string, code = 'workspace-file/not-found'): RemoteResult<never> {
  return { ok: false, error: Object.assign(new Error(message), { code }) }
}

/** 最小的文件面替身：目录与文件都从内存映射里来。 */
function fakeFiles(
  dirs: Record<string, string[]>,
  files: Record<string, string>,
  listError?: RemoteResult<never>,
): ProjectionFilesRemote {
  return {
    list: async (sessionId, path) => {
      if (listError !== undefined && path === TASKS_DIR) return listError
      return ok({
        path,
        entries: (dirs[path] ?? []).map(name => ({ name, type: 'file' as const })),
        truncated: false,
      } satisfies WorkspaceDirectoryListing)
    },
    readPage: async (_sessionId, path) => {
      const text = files[path]
      if (text === undefined) return fail(`"${path}" does not exist`)
      return ok({
        absolutePath: `/w/${path}`, version: 'v1', path, offset: 1, text, lines: text.split('\n').length, eof: true,
      } satisfies WorkspaceFileText)
    },
  }
}

describe('文件投影', () => {
  it('taskTextToRow 读标准任务文件；title 缺失就放弃这一行', () => {
    expect(taskTextToRow('T-014.yaml', TASK_YAML)).toEqual({
      id: 'T-014',
      title: '登录接口限流',
      state: 'contracted',
      grade: 'B',
    })
    expect(taskTextToRow('T-015.yaml', 'grade: A')).toBeUndefined()
    expect(taskTextToRow('T-016.yaml', '- 只是\n- 一个数组')).toBeUndefined()
    // id 缺失时退回文件名，不丢整行。
    expect(taskTextToRow('T-017.yaml', 'title: 只有标题')?.id).toBe('T-017')
  })

  it('rulesTextToRows 跳过缺 id / text 的条目，不替规格库补事实', () => {
    const rows = rulesTextToRows(RULES_YAML)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'R-LOGIN-01', status: 'confirmed' })
    expect(rulesTextToRows('not: a rules file')).toEqual([])
  })

  it('loadWorkspaceProjection 并行读任务与规则，任务按 id 排序', async () => {
    const files = fakeFiles(
      { [TASKS_DIR]: ['T-015.yaml', 'T-014.yaml'] },
      {
        [`${TASKS_DIR}/T-014.yaml`]: TASK_YAML,
        [`${TASKS_DIR}/T-015.yaml`]: TASK_YAML.replace('T-014', 'T-015'),
        [RULES_FILE]: RULES_YAML,
      },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.tasks.map(task => task.id)).toEqual(['T-014', 'T-015'])
    expect(projection.rules).toHaveLength(1)
    expect(projection.problems).toEqual([])
  })

  it('tasks/ 目录不存在是空集不是故障；单个坏文件只记说明不拖垮其余', async () => {
    const files = fakeFiles(
      { [TASKS_DIR]: ['T-014.yaml', 'T-016-broken.yaml'] },
      {
        [`${TASKS_DIR}/T-014.yaml`]: TASK_YAML,
        [`${TASKS_DIR}/T-016-broken.yaml`]: 'title: 也有\nbroken: [unclosed',
      },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.tasks.map(task => task.id)).toEqual(['T-014'])
    expect(projection.problems).toHaveLength(1)
    expect(projection.problems[0]).toContain('T-016-broken.yaml')
  })

  it('没有 spec/rules.yaml 时规则列为空、没有说明', async () => {
    const files = fakeFiles({ [TASKS_DIR]: ['T-014.yaml'] }, { [`${TASKS_DIR}/T-014.yaml`]: TASK_YAML })
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.rules).toEqual([])
    expect(projection.problems).toEqual([])
  })

  it('目录真的读不了（权限等）时记说明，而不是静默当空', async () => {
    const files = fakeFiles({}, {}, fail('"tasks" refused', 'workspace-file/refused'))
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.tasks).toEqual([])
    expect(projection.problems[0]).toContain('refused')
    expect(projection.problems[0]).toContain(TASKS_DIR)
  })
})
