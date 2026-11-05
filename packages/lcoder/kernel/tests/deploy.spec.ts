/**
 * 人机命令 `deploy` 的行为测：只有登记为 human 的命令能被这条命令跑，输出落成证据。
 *
 * 钉三件事：权限档不对就不跑（那是 cmd_run 与审批的路）、执行前先把任务号与档案校验干净、
 * 失败如实报错不写成成功。执行器是注入的假实现，真 spawn 留给桌面端实测。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createDeployCommand } from '../src/commands/deploy.js'
import type { CommandRunner } from '../src/tools/edit-tools.js'
import { openTask, saveTask } from '../src/kernel/task-store.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const ENV = `repo:
  url: https://example.com/r.git
  branch: main
  push_mode: branch
commands:
  - id: build
    cmd: pnpm run build
    exec: ai-auto
  - id: migrate
    cmd: pnpm run migrate
    exec: ai-confirm
  - id: deploy-prod
    cmd: bash deploy/run.sh
    cwd: deploy
    exec: human
`

/** 建一个带 `.spec`、env.yaml 与一条任务的临时检出；返回仓库根。 */
function makeRepo(options: { env?: string; task?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-deploy-'))
  dirs.push(repo)
  const spec = join(repo, '.spec')
  mkdirSync(spec, { recursive: true })
  writeFileSync(join(spec, 'env.yaml'), options.env ?? ENV, 'utf8')
  if (options.task !== false) {
    mkdirSync(join(spec, 'tasks'), { recursive: true })
    saveTask(spec, openTask({ id: 'T-01', title: '上线自营佣金', grade: 'B', opened_at: '2026-11-05T10:00:00+08:00' }))
  }
  return repo
}

/** 记录收到的 Command 与 cwd 的假执行器。 */
function fakeRun(result: { code: number; stdout: string; stderr: string }): { calls: { cmd: string; cwd: string }[]; run: CommandRunner } {
  const calls: { cmd: string; cwd: string }[] = []
  return {
    calls,
    run: async (command) => {
      calls.push({ cmd: command.cmd, cwd: command.cwd ?? '.' })
      return result
    },
  }
}

function run(repo: string, rawInput: string, runner: CommandRunner) {
  return createDeployCommand(join(repo, '.spec'), runner, () => '2026-11-05T12:00:00+08:00').handler({ rawInput })
}

describe('部署命令', () => {
  it('跑登记为 human 的命令，并把输出落成任务证据', async () => {
    const repo = makeRepo()
    const { calls, run: runner } = fakeRun({ code: 0, stdout: 'deployed ok', stderr: '' })

    const result = await run(repo, 'deploy-prod', runner)
    expect(result).toMatchObject({ kind: 'success' })
    expect(String(result.text)).toContain('证据落在')
    expect(calls).toEqual([{ cmd: 'bash deploy/run.sh', cwd: resolve(repo, 'deploy') }])

    const evidence = readFileSync(join(repo, '.spec', 'evidence', 'T-01', 'deploy.log'), 'utf8')
    expect(evidence).toContain('cmd: bash deploy/run.sh')
    expect(evidence).toContain('code: 0')
    expect(evidence).toContain('deployed ok')
  })

  it('权限档不是 human 就拒，并说明那条路归谁', async () => {
    const repo = makeRepo()
    const auto = fakeRun({ code: 0, stdout: '', stderr: '' })

    const autoResult = await run(repo, 'build', auto.run)
    expect(autoResult).toMatchObject({ kind: 'error' })
    expect(String(autoResult.text)).toContain('ai-auto')
    const confirmResult = await run(repo, 'migrate', auto.run)
    expect(confirmResult).toMatchObject({ kind: 'error' })
    expect(String(confirmResult.text)).toContain('ai-confirm')
    expect(auto.calls).toEqual([])
  })

  it('未登记的 id 报出可用清单，参数为空报出用法', async () => {
    const repo = makeRepo()
    const { run: runner } = fakeRun({ code: 0, stdout: '', stderr: '' })

    const unknown = await run(repo, 'deploy-staging', runner)
    expect(String(unknown.text)).toContain('未登记的命令：deploy-staging')
    expect(String(unknown.text)).toContain('deploy-prod(human)')

    const empty = await run(repo, '   ', runner)
    expect(empty).toMatchObject({ kind: 'error' })
    expect(String(empty.text)).toContain('/deploy deploy-prod')
  })

  it('没有规格根就拒；任务号非法时先拒再谈执行', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'lcoder-deploy-bare-'))
    dirs.push(bare)
    const { calls, run: runner } = fakeRun({ code: 0, stdout: '', stderr: '' })

    const bareResult = await run(bare, 'deploy-prod', runner)
    expect(bareResult).toMatchObject({ kind: 'error' })
    expect(String(bareResult.text)).toContain('还没有 .spec')

    const repo = makeRepo()
    const bad = await run(repo, 'deploy-prod 任务一', runner)
    expect(String(bad.text)).toContain('非法的任务编号')
    expect(calls).toEqual([])
  })

  it('命令非零退出就报失败，带上输出尾部', async () => {
    const repo = makeRepo()
    const { run: runner } = fakeRun({ code: 2, stdout: '', stderr: 'connection refused' })

    const result = await run(repo, 'deploy-prod', runner)
    expect(result).toMatchObject({ kind: 'error' })
    expect(String(result.text)).toContain('退出码 2')
    expect(String(result.text)).toContain('connection refused')
    expect(existsSync(join(repo, '.spec', 'evidence', 'T-01', 'deploy.log'))).toBe(false)
  })

  it('没有可依据的任务时仍执行，只说明没落成证据', async () => {
    const repo = makeRepo({ task: false })
    const { run: runner } = fakeRun({ code: 0, stdout: 'ok', stderr: '' })

    const result = await run(repo, 'deploy-prod', runner)
    expect(String(result.text)).toContain('没有对应任务')
    expect(existsSync(join(repo, '.spec', 'evidence'))).toBe(false)
  })
})
