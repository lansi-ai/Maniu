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
  loadLocalSecrets, loadProjectInfo, loadWorkspaceProjection, AUTOMATION_FILE, CONTRACTS_DIR, LOCAL_FILE, PROJECT_FILE,
  REQUIREMENTS_DIR, SCHEDULING_DIR, automationTextToRow, contractTextToRow, groupTextToRow, loadAutomationPolicy,
  rulesTextToRows, RULES_FILE, SPEC_DIR, TASKS_DIR, taskTextToRow,
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
      description: '',
      attachments: [],
      state: 'contracted',
      grade: 'B',
      rules: ['R-LOGIN-01'],
      evidence: ['test'],
      session: undefined,
      dependsOn: [],
      paths: [],
      irreversible: [],
    })
    // 描述、两维分类与附件是任务文件里的事实：写了就原样透给外壳，没写就是空。
    const withMetadata = taskTextToRow('T-014.yaml', `${TASK_YAML}
description: "第一行\\n第二行"
category: page
change_type: bug
attachments:
  - attachments/T-014/shot.png
`)
    expect(withMetadata?.description).toBe('第一行\n第二行')
    expect(withMetadata?.category).toBe('page')
    expect(withMetadata?.changeType).toBe('bug')
    expect(withMetadata?.attachments).toEqual(['attachments/T-014/shot.png'])
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.category).toBeUndefined()
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.attachments).toEqual([])
    // 依赖是任务文件里的事实：写了就原样读回，空着就是没有依赖。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}
depends_on:
  - T-010
`)?.dependsOn).toEqual(['T-010'])
    expect(taskTextToRow('T-015.yaml', 'grade: A')).toBeUndefined()
    // 认领会话号原样透给外壳：卡片靠它决定是切到已有会话，还是新开一条再绑。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: session-8676\n`)?.session).toBe('session-8676')
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: ''\n`)?.session).toBeUndefined()
    // 需求卡片要的创建时间只读文件里的 opened_at；没写就不补事实。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nopened_at: 2026-11-12T09:00:02.084Z\n`)?.openedAt)
      .toBe('2026-11-12T09:00:02.084Z')
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.openedAt).toBeUndefined()
    expect(taskTextToRow('T-016.yaml', '- 只是\n- 一个数组')).toBeUndefined()
    // id 缺失时退回文件名，不丢整行。
    expect(taskTextToRow('T-017.yaml', 'title: 只有标题')?.id).toBe('T-017')
    // 任务与会话的归属权威在文件里：写了才认领，没写就是未绑定。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}\nsession: session-9`)?.session).toBe('session-9')
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.session).toBeUndefined()
    // 允许路径是调度「落点重叠」的输入；没写就是空集，不猜。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}
scope:
  allowed_paths:
    - src/login
    - src/session
`)?.paths).toEqual(['src/login', 'src/session'])
    // 不可逆动作是建议层转人工的依据；没写就是空集。
    expect(taskTextToRow('T-014.yaml', `${TASK_YAML}
scope:
  irreversible:
    - settlement_formula
`)?.irreversible).toEqual(['settlement_formula'])
    expect(taskTextToRow('T-014.yaml', TASK_YAML)?.irreversible).toEqual([])
  })

  it('rulesTextToRows 跳过缺 id / text 的条目，不替规格库补事实', () => {
    const rows = rulesTextToRows(RULES_YAML)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'R-LOGIN-01', module: '登录', status: 'confirmed' })
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

  it('联调组从 evidence/scheduling 读回，缺会话或成员的文件不冒充', async () => {
    const groupYaml = [
      'id: group-1',
      'session: session-a',
      'members:',
      '  - T-01',
      '  - T-02',
      'created_at: 2026-11-06T04:00:00.000Z',
    ].join('\n')
    const files = fakeFiles(
      { [TASKS_DIR]: [], [SCHEDULING_DIR]: ['group-1.yaml', 'group-broken.yaml'] },
      { [`${SCHEDULING_DIR}/group-1.yaml`]: groupYaml, [`${SCHEDULING_DIR}/group-broken.yaml`]: 'session: only' },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.groups).toEqual([{
      id: 'group-1',
      sessionId: 'session-a',
      members: ['T-01', 'T-02'],
      createdAt: '2026-11-06T04:00:00.000Z',
    }])
    expect(projection.problems).toHaveLength(1)
    expect(projection.problems[0]).toContain('group-broken.yaml')
    expect(groupTextToRow('group-2.yaml', 'session: s\nmembers: [T-01]\ncreated_at: 2026-11-06T04:00:00.000Z')?.id)
      .toBe('group-2')
    expect(groupTextToRow('group-3.yaml', 'session: s\nmembers: []\ncreated_at: x')).toBeUndefined()
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

  it('未签署与 AI 自签分开，自签带出 actor', () => {
    const unsigned = CONTRACT_YAML.replace(/sig:[\s\S]*$/, 'sig: null')
    expect(contractTextToRow('T-014.contract.yaml', unsigned)?.signedBy).toBeNull()
    expect(contractTextToRow('T-014.contract.yaml', CONTRACT_YAML.replace('by: human', 'by: agent'))?.signedBy).toBe('agent')

    const aiSigned = CONTRACT_YAML.replace('by: human', 'by: agent').replace(
      'hash: sha256:abcdef0123456789',
      'hash: sha256:abcdef0123456789\n  actor: lcoder-flow',
    )
    expect(contractTextToRow('T-014.contract.yaml', aiSigned)?.signedActor).toBe('lcoder-flow')
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

describe('需求文档', () => {
  it('读 .spec/requirements 下的 md，编号取文件名，正文原样保留', async () => {
    const text = '# 项目需求概要 V0.1\n\n- 记一笔、翻记录、看合计'
    const files = fakeFiles(
      { [REQUIREMENTS_DIR]: ['P-02.md', 'P-01.md', 'notes.txt'] },
      {
        [`${REQUIREMENTS_DIR}/P-01.md`]: text,
        [`${REQUIREMENTS_DIR}/P-02.md`]: '# 另一份需求',
        [`${REQUIREMENTS_DIR}/notes.txt`]: '不是需求文档',
      },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.requirements).toEqual([
      { id: 'P-01', text },
      { id: 'P-02', text: '# 另一份需求' },
    ])
    expect(projection.problems).toEqual([])
  })

  it('目录缺失是空集不是故障', async () => {
    const projection = await loadWorkspaceProjection(
      fakeFiles({}, {}), SESSION, new AbortController().signal,
    )
    expect(projection.requirements).toEqual([])
    expect(projection.problems).toEqual([])
  })

  it('读不到或正文为空的文件只记说明，不冒充需求', async () => {
    const files = fakeFiles(
      { [REQUIREMENTS_DIR]: ['P-01.md', 'P-02.md', 'P-03.md'] },
      {
        [`${REQUIREMENTS_DIR}/P-01.md`]: '  \n\t\n',
        [`${REQUIREMENTS_DIR}/P-02.md`]: '# 正常的',
      },
    )
    const projection = await loadWorkspaceProjection(files, SESSION, new AbortController().signal)

    expect(projection.requirements).toEqual([{ id: 'P-02', text: '# 正常的' }])
    expect(projection.problems).toHaveLength(2)
    expect(projection.problems.join(' ')).toContain('P-01.md')
    expect(projection.problems.join(' ')).toContain('P-03.md')
  })
})

describe('自动化策略', () => {
  const POLICY_YAML = [
    'actions:',
    '  sign: auto',
    '  implement: auto',
    'limits:',
    '  token_budget: 200000',
    '  max_consecutive_failures: 0',
    'tasks:',
    '  - T-014',
  ].join('\n')

  it('读出按动作开关、停止条件与任务范围；缺省动作按手动', () => {
    expect(automationTextToRow(POLICY_YAML)).toEqual({
      actions: {
        draft: 'manual',
        contract: 'manual',
        sign: 'auto',
        implement: 'auto',
        verify: 'manual',
        close: 'manual',
        commit: 'manual',
      },
      limits: {
        tokenBudget: 200000,
        maxMinutes: null,
        maxConsecutiveFailures: 0,
        maxParallel: null,
      },
      tasks: ['T-014'],
    })
  })

  it('读不懂的策略给 undefined', () => {
    expect(automationTextToRow('{{{')).toBeUndefined()
    expect(automationTextToRow('- 不是对象')).toBeUndefined()
  })

  it('缺文件 → policy 为 null（按全手动渲染），不算故障', async () => {
    const loaded = await loadAutomationPolicy(fakeFiles({}, {}), SESSION, new AbortController().signal)
    expect(loaded).toEqual({ policy: null, problems: [] })
  })

  it('读到文件 → 返回展示行；读不懂只记说明', async () => {
    const loaded = await loadAutomationPolicy(
      fakeFiles({}, { [AUTOMATION_FILE]: POLICY_YAML }), SESSION, new AbortController().signal,
    )
    expect(loaded.policy?.actions.sign).toBe('auto')
    expect(loaded.problems).toEqual([])

    const broken = await loadAutomationPolicy(
      fakeFiles({}, { [AUTOMATION_FILE]: '- 不是对象' }), SESSION, new AbortController().signal,
    )
    expect(broken.policy).toBeNull()
    expect(broken.problems.join(' ')).toContain(AUTOMATION_FILE)
  })
})
