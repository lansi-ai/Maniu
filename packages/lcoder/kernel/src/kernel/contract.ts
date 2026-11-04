/**
 * 契约文件的读、写与复算。
 *
 * 一条必须说清的分工：`sig.hash` 不是文件里的正文，而是**签署那一刻正文的复算结果**。
 * 事后任何人按同一套规则再算一遍，和签名里的值对不上，就说明字签了、内容又被人改过。
 * 所以「读一份契约」必须连复算出的哈希一起交出去——只交文件内容，检查器就只能信
 * 文件自己说的话，签名也就退化成一个装饰字段。
 *
 * 落盘前一律再过一遍 schema：写坏一个 `.spec` 文件比读不到更糟，因为屏幕上会画出假事实。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { Contract } from '../schema/spec.js'

/** 契约的落盘位置；与 `SpecLayout` 里 `contracts/*.contract.yaml` 同一条约定。 */
export function contractPath(root: string, taskId: string): string {
  return join(root, 'contracts', `${taskId}.contract.yaml`)
}

/**
 * 契约正文的稳定哈希：字段顺序写死，`sig` 不参与——签名不能覆盖它自己。
 * @param contract - 契约正文（多余的 `sig` 字段被忽略）。
 * @returns `sha256:<十六进制>` 形式的哈希。
 */
export function contractHash(contract: Omit<Contract, 'sig'>): string {
  const canonical = JSON.stringify({
    id: contract.id,
    change: contract.change,
    not_change: contract.not_change,
    acceptance: contract.acceptance,
    affected_tests: contract.affected_tests,
    fail_if: contract.fail_if,
  })
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

/** 磁盘上的一份契约，连同按当前正文复算出的哈希。 */
export interface ContractFact {
  readonly contract: Contract
  readonly bodyHash: string
}

/**
 * 读一份契约并复算正文哈希。
 * @param root - 规格库根。
 * @param taskId - 任务编号，契约与任务同号。
 * @returns 契约与哈希；文件不存在返回 null——「没有契约」本身就是 P3 要判的一种状态。
 * @throws YAML 或形状读不懂时抛出，由调用方决定是人话还是栈。
 */
export function loadContractFact(root: string, taskId: string): ContractFact | null {
  const path = contractPath(root, taskId)
  if (!existsSync(path)) return null
  const contract = Contract.parse(parseYaml(readFileSync(path, 'utf8')))
  return { contract, bodyHash: contractHash(contract) }
}

/**
 * 写回契约。
 * @param root - 规格库根。
 * @param contract - 待写入的契约；写前按 schema 归一。
 * @returns 落盘路径。
 */
export function saveContract(root: string, contract: Contract): string {
  const path = contractPath(root, contract.id)
  const data = Contract.parse(contract)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(data), 'utf8')
  return path
}
