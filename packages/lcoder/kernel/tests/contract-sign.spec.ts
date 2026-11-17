/**
 * 人机命令 `contract_sign` 的行为测：签署只由命令写、只写 `sig`、并把签名钉在正文上。
 *
 * 这里不启动 Loader——命令面的装配证据按既有做法走桌面端启动（`lcoder/RUN.md`），
 * 本测钉住处理器自己的判定：编号、缺文件、重复签署、签后改正文、agent 签的作废。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { createContractSignCommand } from '../src/commands/contract-sign.js'
import type { SignCommandResult } from '../src/commands/contract-sign.js'
import { contractHash, contractPath } from '../src/kernel/contract.js'
import { Contract } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** 一个带 `.spec/contracts` 的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-sign-'))
  dirs.push(repo)
  mkdirSync(join(repo, '.spec', 'contracts'), { recursive: true })
  return join(repo, '.spec')
}

/** 往规格根写一份契约；`over.sig` 不给就是未签署。 */
function writeContract(root: string, over: Record<string, unknown> = {}): Contract {
  const contract = Contract.parse({
    id: 'T-01',
    change: ['佣金允许为 0'],
    acceptance: ['单测覆盖自营订单'],
    ...over,
  })
  writeFileSync(contractPath(root, contract.id), stringifyYaml(contract), 'utf8')
  return contract
}

function body(root: string): Contract {
  return Contract.parse(parseYaml(readFileSync(contractPath(root, 'T-01'), 'utf8')))
}

/** 命令名后的原文就是任务编号；规格根按固定路径解析，这里不传会话事实。 */
function sign(root: string, rawInput: string, at = '2026-11-04T10:00:00+08:00'): SignCommandResult {
  return createContractSignCommand(root, () => at).handler({ rawInput })
}

/** 先认失败种类再把消息交出来断言，比把匹配器塞进对象字面量更精确。 */
function errorText(result: SignCommandResult): string {
  expect(result.kind).toBe('error')
  return result.kind === 'error' ? result.text : ''
}

/** 成功回执的正文；同时把「这是一次成功」的判定收在一处。 */
function successText(result: SignCommandResult): string {
  expect(result.kind).toBe('success')
  return result.kind === 'success' ? (result.text ?? '') : ''
}

describe('contract_sign', () => {
  it('编号缺失或非法 → 报错并给出用法', () => {
    const root = makeSpec()
    expect(errorText(sign(root, ''))).toContain('/contract_sign')
    expect(errorText(sign(root, '随便写点什么'))).toContain('非法的任务编号')
  })

  it('没有 .spec 规格库 → 报没有可签的契约', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-sign-nospec-'))
    dirs.push(repo)
    expect(errorText(sign(join(repo, '.spec'), 'T-01'))).toContain('还没有 .spec')
  })

  it('契约文件不存在 → 指向 contract_draft，不凭空建文件', () => {
    const root = makeSpec()
    expect(errorText(sign(root, 'T-01'))).toContain('contract_draft')
    expect(existsSync(contractPath(root, 'T-01'))).toBe(false)
  })

  it('未签署的契约 → 写入人签、时刻与正文哈希', () => {
    const root = makeSpec()
    const draft = writeContract(root)
    expect(successText(sign(root, 'T-01'))).toContain('T-01')
    expect(body(root).sig).toEqual({ by: 'human', at: '2026-11-04T10:00:00+08:00', hash: contractHash(draft) })
  })

  it('正文没变却再签一次 → 拒绝，文件保持原样', () => {
    const root = makeSpec()
    const draft = writeContract(root)
    writeContract(root, { sig: { by: 'human', at: '2026-11-04T09:00:00+08:00', hash: contractHash(draft) } })
    const before = readFileSync(contractPath(root, 'T-01'), 'utf8')

    expect(errorText(sign(root, 'T-01'))).toContain('无需重复签署')
    expect(readFileSync(contractPath(root, 'T-01'), 'utf8')).toBe(before)
  })

  it('签署后正文被改过 → 重签换新哈希，并说明是重签', () => {
    const root = makeSpec()
    const old = writeContract(root)
    writeContract(root, {
      change: ['佣金允许为 0', '对账口径同步改'],
      sig: { by: 'human', at: '2026-11-04T09:00:00+08:00', hash: contractHash(old) },
    })

    expect(successText(sign(root, 'T-01', '2026-11-04T11:00:00+08:00'))).toContain('重签')
    const signed = body(root)
    expect(signed.sig).toEqual({ by: 'human', at: '2026-11-04T11:00:00+08:00', hash: contractHash(signed) })
  })

  it('AI 自签的契约 → 人可以覆盖重签', () => {
    const root = makeSpec()
    const draft = writeContract(root)
    writeContract(root, {
      sig: {
        by: 'agent',
        at: '2026-11-04T09:00:00+08:00',
        hash: contractHash(draft),
        actor: 'maniu-flow',
        authorization: { policy: 'automation.yaml', hash: 'sha256:策略', at: '2026-11-04T08:00:00+08:00' },
      },
    })

    expect(sign(root, 'T-01').kind).toBe('success')
    expect(body(root).sig?.by).toBe('human')
  })

  it('契约文件读不懂 → 报错指向该文件，不写回', () => {
    const root = makeSpec()
    const broken = 'id: T-01\nchange: 不是数组\n'
    writeFileSync(contractPath(root, 'T-01'), broken, 'utf8')

    expect(errorText(sign(root, 'T-01'))).toContain('读不懂')
    expect(readFileSync(contractPath(root, 'T-01'), 'utf8')).toBe(broken)
  })

  it('命令定义只带命令面需要的四项', () => {
    const definition = createContractSignCommand(makeSpec())
    expect(Object.keys(definition).sort()).toEqual(['description', 'handler', 'input', 'name'])
    expect(definition.name).toBe('contract_sign')
  })
})
