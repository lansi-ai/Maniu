/**
 * 文件投影的读取与解析。
 *
 * 全部走假的文件面（内存数据），不碰真远程：要确认的是「读什么、怎么解析、
 * 失败怎么降级」，不是 workspaceFiles 怎么走线。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  loadLocalSecrets, loadProjectInfo, loadWorkspaceProjection, CONTRACTS_DIR, LOCAL_FILE, PROJECT_FILE,
  contractTextToRow, rulesTextToRows, RULES_FILE, SPEC_DIR, TASKS_DIR, taskTextToRow,
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

/**
 * 造一次远程失败。参数就用 `RemoteFailure` 本身：它是 code 判别联合，
 * 一个带泛型参数的 `RemoteError<Code>` 落不进去，具体的实例才可以。
 */
function fail(error: RemoteFailure): RemoteResult<never> {
  return { ok: false, error }
}

/** 目标不存在——投影把它当空集的那一种。显式标注 `RemoteFailure`：构造器泛型默认会放宽成全联合。 */
function notFound(path: string): RemoteFailure {
  return new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
}

/** 最小的文件面替身：目录与文件都从内存映射里来。 */
function fakeFiles(
  dirs: Record<string, string[]>,
  files: Record<string, string>,
  listError?: RemoteResult<never>,
): ProjectionFilesRemote {
  return {
    list: async (_sessionId, path) => {
      if (listError !== undefined && path === TASKS_DIR) return listError
      return ok({
        path,
        entries: (dirs[path] ?? []).map(name => ({ name, type: 'file' as const })),
        truncated: false,
      } satisfies WorkspaceDirectoryListing)
    },
    readPage: async (_sessionId, path) => {
      const text = files[path]
      if (text === undefined) return fail(notFound(path))
      return ok({
        absolutePath: `/w/${path}`, version: 'v1', offset: 1, text, lines: text.split('\n').length, eof: true,
      } satisfies WorkspaceFileText)
    },
  }
}

describe('项目信息', () => {
  const PROJECT_YAML = [
    'kind: web',
    'repo:',
    '  url: https://example.com/r.git',
    '  branch: main',
    'docs:',
    '  product: docs/PROJECT-RULES.md',
    '  architecture: docs/prd-and-design.md',
    '  tests: tests',
    'environments:',
    '  dev:',
    '    server: https://dev.example.com',
    '    database:',
    '      host: db.example.com',
    '      port: 5432',
    '      name: app',
    '      user: app',
    '      passwordRef: DB_PASSWORD',
  ].join('\n')

  it('loadProjectInfo 读仓库、文档与 web 环境；缺失返回 null', async () => {
    const info = await loadProjectInfo(
      fakeFiles({}, { [PROJECT_FILE]: PROJECT_YAML }),
      SESSION,
      new AbortController().signal,
    )
    expect(info).toMatchObject({
      info: {
        kind: 'web',
        repoUrl: 'https://example.com/r.git',
        branch: 'main',
        docs: { product: 'docs/PROJECT-RULES.md', architecture: 'docs/prd-and-design.md', tests: 'tests' },
        environments: [{
          id: 'dev',
          server: 'https://dev.example.com',
          database: {
            host: 'db.example.com',
            port: '5432',
            name: 'app',
            user: 'app',
            passwordRef: 'DB_PASSWORD',
          },
        }],
      },
      problems: [],
    })

    const missing = await loadProjectInfo(fakeFiles({}, {}), SESSION, new AbortController().signal)
    expect(missing).toEqual({ info: null, problems: [] })
  })

  it('loadLocalSecrets 读 secrets 映射；缺失返回空表', async () => {
    const secrets = await loadLocalSecrets(
      fakeFiles({}, { [LOCAL_FILE]: 'secrets:\n  DB_PASSWORD: local-secret\n' }),
      SESSION,
      new AbortController().signal,
    )
    expect(secrets).toEqual({ DB_PASSWORD: 'local-secret' })
    expect(await loadLocalSecrets(fakeFiles({}, {}), SESSION, new AbortController().signal)).toEqual({})
  })
})

describe('文件投影', () => {
  it('taskTextToRow 读标准任务文件；title 缺失就放弃这一行', () => {
    expect(taskTextToRow('T-014.yaml', TASK_YAML)).toEqual({
      id: 'T-014',
      title: '登录接口限流',
      state: 'contracted',
      grade: 'B',
      rules: ['R-LOGIN-01'],
      evidence: ['test'],
      session: undefined,
    })
    expect(taskTextToRow('T-015.yaml', 'grade: A')).toBeUndefined()
    // 认领会话号原样透给外壳：卡片靠它决定是切到已有会话，还是新开一条再绑。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: session-8676\n`)?.session).toBe('session-8676')
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: ''\n`)?.session).toBeUndefined()
    expect(taskTextToRow('T-016.yaml', '- 只是\n- 一个数组')).toBeUndefined()
    // id 缺失时退回文件名，不丢整行。
    expect(taskTextToRow('T-017.yaml', 'title: 只有标题')?.id).toBe('T-017')
    // 任务与会话的归属权威在文件里：写了才认领，没写就是未绑定。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: session-9`)?.session).toBe('session-9')
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.session).toBeUndefined()
  })

  it('rulesTextToRows 跳过缺 id / text 的条目，不替规格库补事实', () => {
    const rows = rulesTextToRows(RULES_YAML)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'R-LOGIN-01', status: 'confirmed' })
    expect(rulesTextToRows('not: a rules file')).toEqual([])
  })

  it('读的路径就是 kernel 落盘的路径：规格库根是 .spec', () => {
    // 这条断言是防分叉的：kernel 的 taskPath(root, id) 是 `<root>/tasks/<id>.yaml`、
    // saveRules 写 `<root>/spec/rules.yaml`，而它的 root 是 `.spec` 目录。
    // 投影一旦改成别的路径，画出来的就是另一套事实，而这里不会有任何类型错误。
    expect(SPEC_DIR).toBe('.spec')
    expect(TASKS_DIR).toBe('.spec/tasks')
    expect(RULES_FILE).toBe('.spec/spec/rules.yaml')
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
    // 一个真实的「不是缺失」的失败码：投影必须把它说出来，不能当空集咽掉。
    const refused = new RemoteError('workspace-file/too-large', '"tasks" refused', { path: TASKS_DIR, limit: 1 })
    const files = fakeFiles({}, {}, fail(refused))
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.tasks).toEqual([])
    expect(projection.problems[0]).toContain('refused')
    expect(projection.problems[0]).toContain(TASKS_DIR)
  })
})

describe('契约', () => {
  const CONTRACT_YAML = [
    'id: T-014',
    'change:',
    '  - 佣金下限改为可配置',
    'not_change:',
    '  - 结算表结构',
    'acceptance:',
    '  - 费率为 0 时不生成结算记录',
    'affected_tests: []',
    'fail_if:',
    '  - 历史结算金额变化',
    'sig:',
    '  by: human',
    '  at: 2026-11-04T10:00:00+08:00',
    '  hash: sha256:abcdef0123456789',
  ].join('\n')

  it('一份已签署的契约读成展示行，签名状态照文件说', () => {
    expect(contractTextToRow('T-014.contract.yaml', CONTRACT_YAML)).toEqual({
      id: 'T-014',
      change: ['佣金下限改为可配置'],
      notChange: ['结算表结构'],
      acceptance: ['费率为 0 时不生成结算记录'],
      failIf: ['历史结算金额变化'],
      signedBy: 'human',
      signedAt: '2026-11-04T10:00:00+08:00',
    })
  })

  it('未签署与 agent 自签分开：后者不算签过', () => {
    const unsigned = CONTRACT_YAML.replace(/sig:[\s\S]*$/, 'sig: null')
    expect(contractTextToRow('T-014.contract.yaml', unsigned)?.signedBy).toBeNull()
    expect(contractTextToRow('T-014.contract.yaml', CONTRACT_YAML.replace('by: human', 'by: agent'))?.signedBy).toBe('agent')
  })

  it('读不懂的契约给 undefined：缺正文或缺验收都算', () => {
    expect(contractTextToRow('T-014.contract.yaml', 'id: T-014\nchange: 不是数组\nacceptance: [x]\n')).toBeUndefined()
    expect(contractTextToRow('T-014.contract.yaml', 'id: T-014\nchange: [x]\n')).toBeUndefined()
    expect(contractTextToRow('T-014.contract.yaml', '{{{')).toBeUndefined()
  })

  it('投影带出 contracts 目录，坏文件只记说明', async () => {
    const files = fakeFiles(
      { [CONTRACTS_DIR]: ['T-014.contract.yaml', '坏掉的.contract.yaml'], [TASKS_DIR]: [] },
      {
        [`${CONTRACTS_DIR}/T-014.contract.yaml`]: CONTRACT_YAML,
        [`${CONTRACTS_DIR}/坏掉的.contract.yaml`]: 'not: a: contract',
      },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.contracts.map(row => row.id)).toEqual(['T-014'])
    expect(projection.problems.join(' ')).toContain('坏掉的.contract.yaml')
  })

  it('还没有 contracts 目录时是空集，不算故障', async () => {
    const projection = await loadWorkspaceProjection(
      fakeFiles({}, {}), SESSION, new AbortController().signal,
    )
    expect(projection.contracts).toEqual([])
    expect(projection.problems).toEqual([])
  })
})
