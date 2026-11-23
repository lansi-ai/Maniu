/**
 * 原型 Remote 的 wire 层：生成的 typert 结果 codec 与 JSON 载体往返。
 *
 * 本 spec 读构建产物 `@maniu/kernel/typert`（`lib/typert.host.js`），因此改过
 * `src/prototype/**` 后要先跑 `lcoder\scripts\rebuild.cmd kernel`；产物过期时
 * 下面的类型符号表会直接失败，不会静默通过。
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { InvocationDescriptor, RemoteErrorCode } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT } from '@maniu/kernel/typert'
import { afterAll, describe, expect, it } from 'vitest'

import { createRequirement } from '../src/kernel/requirement-store.js'
import { PrototypeController } from '../src/prototype/controller.js'
import { writeStagedPrototype } from '../src/prototype/store.js'
import { rejectsWithCode } from './prototype-remote-assert.js'

/** 生成物里的方法面；`TYPERT` 本身以 `unknown` 发布。 */
interface GeneratedHostFace {
  readonly invocations: readonly InvocationDescriptor[]
}

const FACE = TYPERT as GeneratedHostFace

/** 通过质量门禁的正式版 HTML。 */
const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Wire 测试</title><style>body{color:#123456}</style></head><body><nav>导航</nav><h1>Wire 测试</h1><section class="features"><ul><li>一段正文</li></ul></section><footer>页脚</footer></body></html>'
const STAGED_HTML = HTML.replace('页脚', '暂存页脚')

/** 9 个原型 Remote 的期望结果类型：裸业务值，不是 `PrototypeResult` 信封。 */
const BARE_RESULT_SYMBOLS: Readonly<Record<string, string>> = {
  'prototype/prefetch': '@maniu/kernel/prototype/summary#StyleSummary',
  'prototype/uploadRef': '@maniu/kernel/prototype/types#PrototypeRefValue',
  'prototype/clear': '@maniu/kernel/prototype/types#PrototypeOkValue',
  'prototype/adopt': '@maniu/kernel/prototype/types#PrototypeOkValue',
  'prototype/getStaged': '@maniu/kernel/prototype/types#PrototypeStagedView',
  'prototype/commitStaged': '@maniu/kernel/prototype/types#PrototypeCommitResult',
  'prototype/discardStaged': '@maniu/kernel/prototype/types#PrototypeOkValue',
  'prototype/listSnapshots': '@maniu/kernel/prototype/types#PrototypeListSnapshotsValue',
  'prototype/restoreSnapshot': '@maniu/kernel/prototype/types#PrototypeRestoreSnapshotValue',
}

/** 声明合并后应可用的原型错误码。 */
const PROTOTYPE_CODES: readonly RemoteErrorCode[] = [
  'PROTOTYPE/NO_WORKSPACE',
  'PROTOTYPE/NO_STAGED',
  'PROTOTYPE/SNAPSHOT_NOT_FOUND',
  'PROTOTYPE/REQUIREMENT_BASELINE_CONFLICT',
  'PROTOTYPE/INVALID_URL',
  'PROTOTYPE/WEB_UNAVAILABLE',
  'PROTOTYPE/UNSUPPORTED_CONTENT',
  'PROTOTYPE/FAILED',
]

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** 建一个带需求与暂存原型的工程；返回控制器与需求编号。 */
function makeFixture(): { controller: PrototypeController; id: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-proto-wire-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  const spec = join(repo, '.spec')
  const draft = createRequirement(spec, {
    title: 'Wire 测试',
    content: '# Wire 测试\n\n一段正文。\n',
    opened_at: '2026-11-23T00:00:00.000Z',
  })
  const id = draft.requirement.id
  const committed = join(spec, 'prototypes', id, 'index.html')
  mkdirSync(dirname(committed), { recursive: true })
  writeFileSync(committed, HTML, 'utf8')
  writeStagedPrototype(spec, id, {
    requirementId: id,
    html: STAGED_HTML,
    changeKind: 'visual',
    summary: ['页脚换个颜色'],
    changedDomPaths: ['body:nth-child(2) > footer:nth-child(4)'],
    createdAt: '2026-11-23T00:00:00.000Z',
  })
  const ctx = new Context()
  ctx.provide('sessions', { get: () => ({ header: { cwd: repo } }) } as never)
  return { controller: new PrototypeController(ctx), id }
}

/**
 * 取生成物里一个端点的方法描述。
 * @param endpoint - 形如 `prototype/getStaged` 的端点。
 * @returns 该端点的生成描述。
 */
function descriptorOf(endpoint: string): InvocationDescriptor {
  const found = FACE.invocations.find(item => item.id === `@maniu/kernel#${endpoint}`)
  if (found === undefined) throw new Error(`生成的 typert 产物里没有 ${endpoint}；先跑 rebuild kernel`)
  return found
}

/**
 * 取结果的 strict codec；非 strict 的生成物说明产物过期。
 * @param endpoint - 原型端点。
 * @returns 该端点结果的 parser。
 */
function resultCodecOf(endpoint: string): { parse(value: unknown): unknown } {
  const result = descriptorOf(endpoint).result
  if (result.mode !== 'strict') throw new Error(`${endpoint} 的结果 codec 不是 strict`)
  return result.create()
}

/** 按 JSON 载体往返一次：宿主与客户端之间只有 JSON。 */
function overTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

/** 断言值是一个普通对象并返回它。 */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('wire 值不是对象')
  return value
}

describe('生成的 typert 结果 codec 与裸值一致', () => {
  it('9 个原型方法的结果类型都是裸业务值，不再是 PrototypeResult', () => {
    for (const [endpoint, symbol] of Object.entries(BARE_RESULT_SYMBOLS)) {
      const result = descriptorOf(endpoint).result
      expect(result.mode).toBe('strict')
      if (result.mode !== 'strict') continue
      expect({ endpoint, typeSymbol: result.typeSymbol },
        `${endpoint}: 生成产物过期或结果类型不是裸值；先跑 lcoder\\scripts\\rebuild.cmd kernel`)
        .toEqual({ endpoint, typeSymbol: symbol })
    }
  })

  it('getStaged 过 JSON 载体后，客户端只剥一层就拿到暂存视图', async () => {
    const { controller, id } = makeFixture()
    const bare = await controller.getStaged({ sessionId: SessionId('s1'), requirementId: id })

    // 宿主 encodeRpcResult：JSON 值原样进 `{ ok, value }` 信封，codec 不额外包装。
    const wire = overTheWire({ ok: true, value: bare })
    const envelope = recordOf(wire)
    expect(envelope.ok).toBe(true)
    // 客户端 invoke() 交出 answer.value；界面 unwrap 只剥这一层。
    const view = recordOf(envelope.value)
    expect(view).toMatchObject({ staged: { html: STAGED_HTML }, committedHtml: HTML })
    // 旧的双层信封已经不存在：value 里没有第二组 ok/value。
    expect(view).not.toHaveProperty('ok')
    expect(view).not.toHaveProperty('value')

    // 结果 codec 接受裸值，拒绝旧的双层信封。
    const codec = resultCodecOf('prototype/getStaged')
    expect(codec.parse(envelope.value)).toEqual(bare)
    expect(() => codec.parse({ ok: true, value: bare })).toThrow()
  })

  it('失败是 RemoteError，PROTOTYPE/* 码原样过 wire', async () => {
    expect(PROTOTYPE_CODES).toHaveLength(8)
    const { controller, id } = makeFixture()
    const error = await rejectsWithCode(
      controller.restoreSnapshot({ sessionId: SessionId('s1'), requirementId: id, snapshotId: '1769000000000-0' }),
      'PROTOTYPE/SNAPSHOT_NOT_FOUND',
    )
    const code: RemoteErrorCode = error.code
    expect(code).toBe('PROTOTYPE/SNAPSHOT_NOT_FOUND')

    // 宿主 rpcFailure：`{ ok: false, error: { code, message, details } }` 过 JSON 载体。
    const wire = recordOf(overTheWire({ ok: false, error: { code: error.code, message: error.message, details: error.details } }))
    expect(wire.ok).toBe(false)
    const failure = recordOf(wire.error)
    expect(failure.code).toBe('PROTOTYPE/SNAPSHOT_NOT_FOUND')
    expect(failure.message).toBe(error.message)

    // 客户端 rebuiltFailure：wire 上的码必须落在已声明的码表里才能原样重建。
    expect(PROTOTYPE_CODES).toContain(failure.code)
    const declared = PROTOTYPE_CODES.find(known => known === failure.code)
    if (declared === undefined || typeof failure.message !== 'string') throw new Error('wire 失败字段不完整')
    expect(new RemoteError(declared, failure.message, {}).code).toBe('PROTOTYPE/SNAPSHOT_NOT_FOUND')
  })
})
