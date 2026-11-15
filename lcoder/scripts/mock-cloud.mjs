#!/usr/bin/env node
/**
 * LCoder 桌面端的 dev-only mock 云端。
 *
 * 只用于本地联调，不打包进产物；所有数据都在内存里，重启即清空。
 * 端口固定 5091，端点与 `LCoder-cloud/docs/api/openapi.yaml` 的桌面接入面一致。
 *
 * 启动：
 *   node lcoder/scripts/mock-cloud.mjs
 *
 * 错误开关：
 *   curl -X POST http://127.0.0.1:5091/_mock/control \
 *     -H 'content-type: application/json' -d '{"mode":"quota_exhausted"}'
 *   可用 mode：quota_exhausted / banned / upstream_unavailable / upstream_timeout /
 *   guest_quota_exhausted / rate_limited / null。
 *   另支持 {"expireAccess":true}（下一次模型请求 401 token_expired）、
 *   {"guestUsedRequests":20}、{"setGuestExpiryPast":true} 与 {"reset":true}。
 *
 * 统计：
 *   curl http://127.0.0.1:5091/_mock/state
 *
 * 探针回合（T-195）：用户消息里带下列口令时，chat completions 按「本轮阶段」
 * 返回 OpenAI 兼容的 tool_calls，而不是默认正文：
 *   T195:approve — 调用 pwsh 并申请 danger-full-access 扩权（会弹审批卡），
 *                  通过后继续返回正文；T195:deny 走同一条调用链但被拒绝。
 *   T195:ask     — 调用 ask_user_question（会弹提问卡），回答后继续返回正文。
 * 阶段由 messages 推出：最后一次带口令的用户消息之后还没有 tool 结果就发工具
 * 调用，有了就发最终正文；默认（无口令）仍是立项正文，不干扰 S1/M1 探针。
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_CLOUD_PORT ?? 5091)
const HOST = process.env.MOCK_CLOUD_HOST ?? '127.0.0.1'
const SIGNING_KEY = 'lcoder-mock-signing-key'
const ACCESS_TTL_SECONDS = Number(process.env.MOCK_ACCESS_TTL_SECONDS ?? 900)
const GUEST_TTL_SECONDS = Number(process.env.MOCK_GUEST_TTL_SECONDS ?? 7200)
const DAILY_RESET_TIMEZONE = 'Asia/Shanghai'
const MAX_REQUESTS = 20
const MAX_COST_MICRO_USD = 150_000
const USER_GRANT_MICRO_USD = 20_000_000

/** 演示用单价（微美元/百万 token）；按云端同一口径折出 token 区间。 */
const UNIT_PRICE = { inputMicroUsdPerMtok: 260_000, cachedInputMicroUsdPerMtok: 8_000, outputMicroUsdPerMtok: 500_000 }
const INPUT_OUTPUT_RATIO = '8:2'
const MODEL = 'deepseek-flash'

/** T-195 探针口令；按最后一次带口令的用户消息决定这一轮返回什么。 */
const PROBE_MARKERS = { approve: 'T195:approve', deny: 'T195:deny', ask: 'T195:ask' }
/** 审批卡上显示的扩权理由；探针按它断言卡片内容。 */
const PROBE_JUSTIFICATION = 'T195 approval probe needs one escalated command'
/** 批准后真正执行的命令；探针按它的输出确认工具执行过。 */
const PROBE_COMMAND = "Write-Output 'T195-PROBE-ALLOWED'"
/** 提问卡上唯一选项的标签；回答会原样回到模型，探针按它断言回执。 */
const PROBE_QUESTION_LABEL = '继续（推荐）'
/** mock 侧留存的探针回合轨迹上限。 */
const PROBE_LOG_LIMIT = 64

/**
 * 按云端口径折出 token 预估：下界用全部未命中缓存的输入价，上界用缓存输入价。
 * @param availableMicroUsd - 可折算余额。
 * @param options - `noPrice`/`zeroPrice` 用来演示不可用分支。
 * @returns 与云端同形的预估对象。
 */
function tokenEstimate(availableMicroUsd, options = {}) {
  const base = {
    available: false,
    unavailableReason: null,
    model: MODEL,
    availableMicroUsd,
    lowerBoundTokens: 0,
    upperBoundTokens: 0,
    inputOutputRatio: INPUT_OUTPUT_RATIO,
    price: null,
  }
  if (options.noPrice === true) return { ...base, unavailableReason: 'no_effective_price' }
  if (options.zeroPrice === true) {
    return { ...base, unavailableReason: 'zero_unit_price', price: { inputMicroUsdPerMtok: 0, cachedInputMicroUsdPerMtok: 0, outputMicroUsdPerMtok: 0 } }
  }
  if (availableMicroUsd <= 0) return { ...base, unavailableReason: 'zero_balance', price: UNIT_PRICE }
  const unit = (input, output) => Math.floor((availableMicroUsd * 1_000_000) / (0.8 * input + 0.2 * output))
  return {
    ...base,
    available: true,
    lowerBoundTokens: unit(UNIT_PRICE.inputMicroUsdPerMtok, UNIT_PRICE.outputMicroUsdPerMtok),
    upperBoundTokens: unit(UNIT_PRICE.cachedInputMicroUsdPerMtok, UNIT_PRICE.outputMicroUsdPerMtok),
    price: UNIT_PRICE,
  }
}


const users = new Map()
const refreshTokens = new Map()
const guestGrants = new Map()
const smsCodes = new Map()
const state = {
  mode: null,
  /** 用户令牌代数；`expireAccess` 加一后，旧代令牌立即失效，新代令牌照常可用。 */
  accessGeneration: 0,
  /** 用量演示开关：`noPrice` 让预估报「没有生效价格」，`usageEmpty` 清空流水。 */
  noPrice: false,
  usageEmpty: false,
  stats: { login: 0, refresh: 0, chat: 0, guestClaim: 0, logout: 0 },
  /** T-195 探针：每类回合的工具调用与最终正文次数，以及最近的阶段轨迹。 */
  probe: {
    approve: { toolCalls: 0, finals: 0 },
    deny: { toolCalls: 0, finals: 0 },
    ask: { toolCalls: 0, finals: 0 },
    log: [],
  },
}

const now = () => Date.now()
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_RESET_TIMEZONE }).format(new Date())
const requestId = () => `mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const b64url = value => Buffer.from(value).toString('base64url')

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = b64url(createHmac('sha256', SIGNING_KEY).update(`${header}.${body}`).digest())
  return `${header}.${body}.${signature}`
}

function verifyToken(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = b64url(createHmac('sha256', SIGNING_KEY).update(`${parts[0]}.${parts[1]}`).digest())
  if (expected !== parts[2]) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) return null
  return payload
}

function accessTokenFor(user) {
  return signToken({
    sub: user.id,
    aud: 'lcoder-api',
    scope: 'user',
    gen: state.accessGeneration,
    iat: Math.floor(now() / 1000),
    exp: Math.floor(now() / 1000) + ACCESS_TTL_SECONDS,
    jti: randomUUID(),
    nbf: Math.floor(now() / 1000) - 1,
  })
}

function guestTokenFor(grant) {
  return signToken({
    sub: grant.deviceId,
    aud: 'lcoder-guest',
    scope: 'onboarding',
    grant_id: grant.id,
    grant_date: grant.grantDate,
    model: 'deepseek-flash',
    iat: Math.floor(now() / 1000),
    exp: Math.floor(now() / 1000) + GUEST_TTL_SECONDS,
  })
}

function quotaOf(user) {
  return {
    grantedMicroUsd: user.grantedMicroUsd,
    reservedMicroUsd: user.reservedMicroUsd,
    spentMicroUsd: user.spentMicroUsd,
    availableMicroUsd: Math.max(0, user.grantedMicroUsd - user.spentMicroUsd - user.reservedMicroUsd),
    currency: 'USD',
    updatedAt: new Date().toISOString(),
  }
}

function userProfile(user) {
  return {
    id: user.id,
    displayName: user.displayName ?? null,
    phoneMasked: `${user.phone.slice(0, 4)}****${user.phone.slice(-4)}`,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    quota: quotaOf(user),
  }
}

/** 演示单价开关对应的预估选项。 */
function estimateOptions() {
  return state.noPrice ? { noPrice: true } : {}
}

/** 给一个账号生成固定 25 条演示流水；游标就是偏移量。 */
function usageItemsOf(user) {
  if (state.usageEmpty) return []
  const base = Date.parse(user.createdAt)
  return Array.from({ length: 25 }, (_, index) => ({
    requestId: `mock_usage_${user.id.slice(0, 8)}_${String(index).padStart(3, '0')}`,
    source: 'user',
    model: MODEL,
    promptTokens: 1_200 + index * 40,
    cachedTokens: index % 3 === 0 ? 0 : 300,
    completionTokens: 400 + index * 10,
    costMicroUsd: 2_000,
    status: index === 0 ? 'reserved' : 'settled',
    createdAt: new Date(base + (25 - index) * 60_000).toISOString(),
  }))
}

/** 按游标与 limit 切一页流水。 */
function usagePageOf(user, searchParams) {
  const items = usageItemsOf(user)
  const rawLimit = Number(searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 20
  const rawCursor = Number(searchParams.get('cursor') ?? 0)
  const offset = Number.isFinite(rawCursor) ? Math.max(0, Math.trunc(rawCursor)) : 0
  const page = items.slice(offset, offset + limit)
  const next = offset + limit < items.length ? String(offset + limit) : null
  return { items: page, nextCursor: next }
}

/**
 * 建号并落库：注册与短信自动注册共用；短信建号没有密码。
 * @param input - 手机号、可选密码与显示名。
 * @returns 新建的用户记录。
 */
function createAccount({ phone, password = null, displayName = null }) {
  const user = {
    id: randomUUID(),
    phone,
    password,
    displayName,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    grantedMicroUsd: USER_GRANT_MICRO_USD,
    reservedMicroUsd: 0,
    spentMicroUsd: 0,
  }
  users.set(user.id, user)
  return user
}

function issueSession(user) {
  const refreshToken = randomBytes(32).toString('base64url')
  const familyId = randomUUID()
  refreshTokens.set(refreshToken, {
    userId: user.id,
    familyId,
    expiresAt: now() + 30 * 24 * 3600 * 1000,
    rotated: false,
  })
  user.lastLoginAt = new Date().toISOString()
  state.stats.login += 1
  return {
    accessToken: accessTokenFor(user),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
    refreshExpiresAt: new Date(now() + 30 * 24 * 3600 * 1000).toISOString(),
    user: userProfile(user),
  }
}

function guestView(grant) {
  return {
    grantDate: grant.grantDate,
    expiresAt: new Date(grant.expiresAt).toISOString(),
    remainingRequests: Math.max(0, MAX_REQUESTS - grant.usedRequests),
    remainingCostMicroUsd: Math.max(0, MAX_COST_MICRO_USD - grant.costUsed),
    limits: { maxRequests: MAX_REQUESTS, maxCostMicroUsd: MAX_COST_MICRO_USD, dailyGrantLimit: 1 },
    model: 'deepseek-flash',
    scope: 'onboarding',
    revoked: grant.revoked,
  }
}

function sendJson(response, status, body, requestIdValue = requestId()) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': requestIdValue,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  response.end(text)
}

function sendError(response, status, code, message, rid, retryAfter) {
  if (retryAfter !== undefined) response.setHeader('retry-after', String(retryAfter))
  sendJson(response, status, {
    error: { code, message, type: errorType(code), requestId: rid },
  }, rid)
}

function errorType(code) {
  if (code === 'invalid_credentials' || code === 'unauthorized' || code === 'token_expired') return 'authentication_error'
  if (code === 'banned' || code === 'forbidden' || code === 'model_not_allowed') return 'permission_error'
  if (code === 'quota_exhausted' || code === 'guest_quota_exhausted') return 'quota_error'
  if (code === 'rate_limited' || code === 'sms_rate_limited' || code === 'guest_ip_limited') return 'rate_limit_error'
  if (code === 'conflict' || code === 'device_already_granted' || code === 'idempotency_conflict') return 'conflict_error'
  if (code === 'upstream_unavailable' || code === 'upstream_timeout') return 'upstream_error'
  if (code === 'internal_error') return 'server_error'
  return 'invalid_request_error'
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function authOf(request) {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const payload = verifyToken(header.slice('Bearer '.length))
  if (payload === null) return null
  if (payload.aud === 'lcoder-api' && (payload.gen ?? 0) < state.accessGeneration) return null
  return payload
}

function userOf(payload) {
  if (payload?.aud !== 'lcoder-api') return null
  for (const user of users.values()) if (user.id === payload.sub) return user
  return null
}

function guestOf(payload) {
  if (payload?.aud !== 'lcoder-guest') return null
  for (const grant of guestGrants.values()) {
    if (grant.id === payload.grant_id) return grant
  }
  return null
}

function validatePhone(phone) {
  return typeof phone === 'string' && /^\+[1-9][0-9]{6,14}$/.test(phone)
}

function modelList() {
  return {
    object: 'list',
    data: [{
      id: 'deepseek-flash',
      object: 'model',
      created: 1_760_000_000,
      owned_by: 'lcoder',
      lcoder: {
        contextWindow: 131072,
        maxOutputTokens: 8192,
        tools: true,
        model: 'deepseek-flash',
      },
    }],
  }
}

function chatChunks(messageId, created, content, finish) {
  const chunk = delta => ({
    id: messageId,
    object: 'chat.completion.chunk',
    created,
    model: 'deepseek-flash',
    choices: [{ index: 0, delta, finish_reason: null }],
  })
  return [
    chunk({ role: 'assistant', content: '' }),
    ...content.map(part => chunk({ content: part })),
    {
      id: messageId,
      object: 'chat.completion.chunk',
      created,
      model: 'deepseek-flash',
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      lcoder: { requestId: messageId, effectiveMaxTokens: 8192 },
    },
  ]
}

function usageChunk(messageId, created, promptTokens, completionTokens) {
  return {
    id: messageId,
    object: 'chat.completion.chunk',
    created,
    model: 'deepseek-flash',
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 一条 wire 消息的文本：字符串或文本块数组。 */
function wireTextOf(message) {
  if (!isRecord(message)) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(part => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
    .join('')
}

/**
 * 最后一条以 T-195 口令开头的用户消息，以及它之后是否已经有工具结果。
 *
 * 只认「开头就是口令」的消息：宿主会把运行时上下文、技能目录与时间快照
 * 作为额外的 user 消息追加在同一条提示之后，标题生成请求里也会在 JSON 中
 * 带出原话——按「开头匹配」才能只命中真正的探针提示。
 * @param messages - 请求里的 OpenAI 消息数组。
 * @returns 本轮的口令与阶段；没有口令时 undefined（走默认立项正文）。
 */
function probeRoundOf(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'user') continue
    const text = wireTextOf(message).trimStart()
    const scenario = Object.keys(PROBE_MARKERS).find(key => text.startsWith(PROBE_MARKERS[key]))
    if (scenario === undefined) continue
    const toolMessages = messages.slice(index + 1).filter(candidate => isRecord(candidate) && candidate.role === 'tool')
    return { scenario, stage: toolMessages.length === 0 ? 'call' : 'final', toolMessages }
  }
  return undefined
}

/** 一条 OpenAI 兼容的工具调用。 */
function toolCallOf(name, args) {
  return {
    id: `call_t195_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

/**
 * 本轮要发的工具调用：审批两轮都调 `pwsh` 申请扩权，提问一轮调 `ask_user_question`。
 * @param scenario - `approve` / `deny` / `ask`。
 * @returns OpenAI 兼容的工具调用。
 */
function probeToolCallOf(scenario) {
  if (scenario === 'ask') {
    return toolCallOf('ask_user_question', {
      questions: [{
        id: 't195_choice',
        header: 'T195 提问',
        question: 'T195：请选择这次探针的继续方式',
        options: [
          { label: PROBE_QUESTION_LABEL, description: '保持当前设置把这一轮跑完' },
          { label: '停止', description: '不再继续本轮回合' },
        ],
        multi_select: false,
      }],
    })
  }
  return toolCallOf('pwsh', {
    description: 'Run the T-195 escalation probe command',
    command: PROBE_COMMAND,
    sandbox_permissions: 'danger-full-access',
    justification: PROBE_JUSTIFICATION,
  })
}

/** 工具结果的可读摘要，用于失败正文回显 mock 实际看到了什么。 */
function probeDigestOf(toolMessages) {
  const last = toolMessages.at(-1)
  if (!isRecord(last)) return '(没有工具结果)'
  const text = wireTextOf(last).replace(/\s+/gu, ' ').trim()
  return text === '' ? '(空结果)' : text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/**
 * 工具回合之后的最终正文。
 * 按观察到的工具结果生成：探针把正文当断言时，mock 不能无条件宣称成功。
 * @param scenario - 本轮口令。
 * @param toolMessages - 口令之后出现的工具结果消息。
 * @returns 一段最终正文。
 */
function probeFinalOf(scenario, toolMessages) {
  const observed = toolMessages.map(message => wireTextOf(message)).join('\n')
  if (scenario === 'ask') {
    return observed.includes(PROBE_QUESTION_LABEL)
      ? `T195-ASK-DONE：已收到选择「${PROBE_QUESTION_LABEL}」。`
      : `T195-ASK-FAILED：提问结果里没有选中项（${probeDigestOf(toolMessages)}）`
  }
  if (scenario === 'deny') {
    return /rejected|denied/iu.test(observed)
      ? 'T195-DENIED-DONE：审批拒绝后工具没有执行。'
      : `T195-DENIED-FAILED：拒绝路径没有留下拒绝记录（${probeDigestOf(toolMessages)}）`
  }
  return observed.includes('T195-PROBE-ALLOWED')
    ? 'T195-APPROVED-DONE：审批通过后命令已执行。'
    : `T195-APPROVED-FAILED：批准后没有看到命令输出（${probeDigestOf(toolMessages)}）`
}

/** 记一条探针轨迹，供 `/_mock/state` 与探针核对轮次。 */
function noteProbe(scenario, stage, detail) {
  state.probe[scenario][stage === 'call' ? 'toolCalls' : 'finals'] += 1
  state.probe.log.push({ scenario, stage, detail, at: new Date().toISOString() })
  if (state.probe.log.length > PROBE_LOG_LIMIT) state.probe.log.shift()
}

/** 工具调用的 SSE 帧：先给身份，再给参数，最后以 tool_calls 收尾。 */
function toolCallChunks(messageId, created, call) {
  const chunk = delta => ({
    id: messageId,
    object: 'chat.completion.chunk',
    created,
    model: 'deepseek-flash',
    choices: [{ index: 0, delta, finish_reason: null }],
  })
  return [
    chunk({
      role: 'assistant',
      content: null,
      tool_calls: [{
        index: 0,
        id: call.id,
        type: 'function',
        function: { name: call.function.name, arguments: '' },
      }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: call.function.arguments } }] }),
    {
      id: messageId,
      object: 'chat.completion.chunk',
      created,
      model: 'deepseek-flash',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      lcoder: { requestId: messageId, effectiveMaxTokens: 8192 },
    },
  ]
}

async function handleChat(request, response, body) {
  const rid = requestId()
  if (body.baseURL !== undefined || body.provider !== undefined || body.apiKey !== undefined) {
    sendError(response, 400, 'invalid_request', '路由字段不允许由客户端传入。', rid)
    return
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendError(response, 422, 'validation_failed', 'messages 不能为空。', rid)
    return
  }
  const payload = authOf(request)
  if (payload === null) {
    sendError(response, 401, 'token_expired', '访问令牌已过期。', rid)
    return
  }
  const user = userOf(payload)
  const guest = user === null ? guestOf(payload) : null
  if (user === null && guest === null) {
    sendError(response, 401, 'unauthorized', '令牌无效。', rid)
    return
  }
  if (state.mode === 'banned' && user !== null) {
    sendError(response, 403, 'banned', '账号已被封禁。', rid)
    return
  }
  if (state.mode === 'quota_exhausted') {
    sendError(response, 402, 'quota_exhausted', '免费额度已用完。', rid)
    return
  }
  if (state.mode === 'upstream_unavailable') {
    sendError(response, 502, 'upstream_unavailable', '模型服务暂时不可用。', rid)
    return
  }
  if (state.mode === 'upstream_timeout') {
    sendError(response, 504, 'upstream_timeout', '模型响应超时。', rid)
    return
  }
  if (state.mode === 'rate_limited') {
    sendError(response, 429, 'rate_limited', '操作太频繁，请稍后再试。', rid, 15)
    return
  }
  if (guest !== null) {
    if (guest.revoked || guest.expiresAt <= now()) {
      sendError(response, 401, 'token_expired', '今日免费立项已结束。', rid)
      return
    }
    if (state.mode === 'guest_quota_exhausted' || guest.usedRequests >= MAX_REQUESTS) {
      sendError(response, 429, 'guest_quota_exhausted', '今日免费立项次数已用完。', rid, 3600)
      return
    }
    if (guest.costUsed >= MAX_COST_MICRO_USD) {
      sendError(response, 402, 'quota_exhausted', '匿名授权成本上限已用完。', rid, 3600)
      return
    }
    guest.usedRequests += 1
    guest.costUsed += 2_000
  } else if (user !== null) {
    if (user.status === 'banned') {
      sendError(response, 403, 'banned', '账号已被封禁。', rid)
      return
    }
    user.spentMicroUsd += 2_000
  }
  state.stats.chat += 1

  const created = Math.floor(now() / 1000)
  const messageId = `chatcmpl_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const probe = probeRoundOf(body.messages)
  const call = probe?.stage === 'call' ? probeToolCallOf(probe.scenario) : undefined
  const parts = call !== undefined
    ? []
    : probe === undefined
      ? [
        '我已经读过仓库结构和已有规格。',
        '当前没有可执行的开发任务，我先按立项流程整理交付物与范围：',
        '\n1. 明确产品目标与首个可验收切片；\n2. 把调研结论落成起草态任务；\n3. 等你确认后再进入架构与契约。',
      ]
      : [probeFinalOf(probe.scenario, probe.toolMessages)]
  if (probe !== undefined) noteProbe(probe.scenario, probe.stage, call?.function.name ?? 'text')
  const promptTokens = Math.max(1, Math.ceil(JSON.stringify(body.messages).length / 3))
  const completionTokens = Math.max(1, Math.ceil((call?.function.arguments ?? parts.join('')).length / 3))

  if (body.stream === true) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-request-id': rid,
      'access-control-allow-origin': '*',
    })
    const write = value => response.write(`data: ${JSON.stringify(value)}\n\n`)
    const chunks = call === undefined
      ? chatChunks(messageId, created, parts, 'stop')
      : toolCallChunks(messageId, created, call)
    for (const chunk of chunks) {
      write(chunk)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    write(usageChunk(messageId, created, promptTokens, completionTokens))
    response.write('data: [DONE]\n\n')
    response.end()
    return
  }

  sendJson(response, 200, {
    id: messageId,
    object: 'chat.completion',
    created,
    model: 'deepseek-flash',
    choices: [{
      index: 0,
      message: call === undefined
        ? { role: 'assistant', content: parts.join('') }
        : { role: 'assistant', content: null, tool_calls: [call] },
      finish_reason: call === undefined ? 'stop' : 'tool_calls',
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    lcoder: { requestId: rid, effectiveMaxTokens: 8192 },
  }, rid)
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${String(PORT)}`}`)
  const path = url.pathname
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    })
    response.end()
    return
  }
  if (path === '/_mock/state' && request.method === 'GET') {
    sendJson(response, 200, {
      mode: state.mode,
      noPrice: state.noPrice,
      usageEmpty: state.usageEmpty,
      stats: state.stats,
      probe: state.probe,
      users: [...users.values()].map(user => ({ id: user.id, phone: userProfile(user).phoneMasked, status: user.status })),
      guests: [...guestGrants.values()].map(grant => ({ id: grant.id, grantDate: grant.grantDate, usedRequests: grant.usedRequests })),
      refreshTokens: refreshTokens.size,
    })
    return
  }
  if (path === '/_mock/control' && request.method === 'POST') {
    const body = await readJson(request)
    if (body.reset === true) {
      users.clear(); refreshTokens.clear(); guestGrants.clear(); smsCodes.clear()
      state.mode = null; state.accessGeneration = 0
      state.noPrice = false; state.usageEmpty = false
      state.stats = { login: 0, refresh: 0, chat: 0, guestClaim: 0, logout: 0 }
      state.probe = {
        approve: { toolCalls: 0, finals: 0 },
        deny: { toolCalls: 0, finals: 0 },
        ask: { toolCalls: 0, finals: 0 },
        log: [],
      }
    }
    if ('mode' in body) state.mode = body.mode ?? null
    if (body.noPrice === true) state.noPrice = true
    if (body.noPrice === false) state.noPrice = false
    if (body.usageEmpty === true) state.usageEmpty = true
    if (body.usageEmpty === false) state.usageEmpty = false
    if (body.expireAccess === true) state.accessGeneration += 1
    if (typeof body.guestUsedRequests === 'number') {
      for (const grant of guestGrants.values()) grant.usedRequests = body.guestUsedRequests
    }
    if (body.setGuestExpiryPast === true) {
      for (const grant of guestGrants.values()) grant.expiresAt = now() - 1000
    }
    sendJson(response, 200, { ok: true, mode: state.mode, stats: state.stats })
    return
  }

  const rid = requestId()
  if (path === '/v1/models' && request.method === 'GET') {
    if (authOf(request) === null) { sendError(response, 401, 'unauthorized', '需要令牌。', rid); return }
    sendJson(response, 200, modelList(), rid)
    return
  }
  if (path === '/v1/me' && request.method === 'GET') {
    const payload = authOf(request)
    const user = payload === null ? null : userOf(payload)
    if (user === null) { sendError(response, 401, 'unauthorized', '需要用户令牌。', rid); return }
    const quota = quotaOf(user)
    sendJson(response, 200, {
      user: userProfile(user),
      quota,
      tokenEstimate: tokenEstimate(quota.availableMicroUsd, estimateOptions()),
    }, rid)
    return
  }
  if (path === '/v1/me/usage' && request.method === 'GET') {
    const payload = authOf(request)
    const user = payload === null ? null : userOf(payload)
    if (user === null) { sendError(response, 401, 'unauthorized', '需要用户令牌。', rid); return }
    sendJson(response, 200, usagePageOf(user, url.searchParams), rid)
    return
  }
  if (path === '/v1/auth/sms/send' && request.method === 'POST') {
    const body = await readJson(request)
    if (!validatePhone(body.phone) || (body.purpose !== 'register' && body.purpose !== 'login')) {
      sendError(response, 422, 'validation_failed', '手机号或用途不合法。', rid)
      return
    }
    const key = `${body.phone}:${body.purpose}`
    const existing = smsCodes.get(key)
    if (existing !== undefined && existing.sentAt + 60_000 > now()) {
      sendError(response, 429, 'sms_rate_limited', '验证码发送太频繁。', rid, Math.ceil((existing.sentAt + 60_000 - now()) / 1000))
      return
    }
    smsCodes.set(key, { code: '123456', sentAt: now(), expiresAt: now() + 300_000 })
    sendJson(response, 200, { requestId: rid, resendAfterSeconds: 60, expiresInSeconds: 300 }, rid)
    return
  }
  if (path === '/v1/auth/register' && request.method === 'POST') {
    const body = await readJson(request)
    if (!validatePhone(body.phone) || !/^[0-9]{6}$/.test(String(body.code))
      || typeof body.password !== 'string' || body.password.length < 10) {
      sendError(response, 422, 'validation_failed', '注册信息不完整。', rid)
      return
    }
    const code = smsCodes.get(`${body.phone}:register`)
    if (code === undefined || code.code !== body.code || code.expiresAt < now()) {
      sendError(response, 401, 'invalid_credentials', '验证码不正确。', rid)
      return
    }
    if ([...users.values()].some(user => user.phone === body.phone)) {
      sendError(response, 409, 'conflict', '手机号已注册。', rid)
      return
    }
    const user = createAccount({
      phone: body.phone,
      password: body.password,
      displayName: typeof body.displayName === 'string' ? body.displayName : null,
    })
    sendJson(response, 200, issueSession(user), rid)
    return
  }
  if (path === '/v1/auth/login/sms' && request.method === 'POST') {
    const body = await readJson(request)
    if (!validatePhone(body.phone) || !/^[0-9]{6}$/.test(String(body.code))) {
      sendError(response, 422, 'validation_failed', '手机号或验证码不合法。', rid)
      return
    }
    // 与真实云端一致：先验码，未注册的手机号在同一请求里建号并登录。
    const code = smsCodes.get(`${body.phone}:login`)
    if (code === undefined || code.code !== body.code || code.expiresAt <= now()) {
      sendError(response, 401, 'invalid_code', '验证码不正确或已过期。', rid)
      return
    }
    if (state.mode === 'banned') {
      sendError(response, 403, 'banned', '账号已被封禁。', rid)
      return
    }
    const user = [...users.values()].find(candidate => candidate.phone === body.phone)
      ?? createAccount({ phone: body.phone })
    if (user.status === 'banned') {
      sendError(response, 403, 'banned', '账号已被封禁。', rid)
      return
    }
    sendJson(response, 200, issueSession(user), rid)
    return
  }
  if (path === '/v1/auth/login/password' && request.method === 'POST') {
    const body = await readJson(request)
    const user = [...users.values()].find(candidate => candidate.phone === body.phone)
    if (user === undefined) { sendError(response, 401, 'invalid_credentials', '手机号或密码错误。', rid); return }
    if (state.mode === 'banned' || user.status === 'banned') {
      sendError(response, 403, 'banned', '账号已被封禁。', rid)
      return
    }
    if (typeof user.password !== 'string' || user.password !== body.password) {
      sendError(response, 401, 'invalid_credentials', '手机号或密码错误。', rid)
      return
    }
    sendJson(response, 200, issueSession(user), rid)
    return
  }
  if (path === '/v1/auth/refresh' && request.method === 'POST') {
    const body = await readJson(request)
    const entry = typeof body.refreshToken === 'string' ? refreshTokens.get(body.refreshToken) : undefined
    if (entry === undefined || entry.expiresAt <= now()) {
      sendError(response, 401, 'token_expired', '刷新令牌已失效。', rid)
      return
    }
    if (entry.rotated) {
      for (const [token, candidate] of refreshTokens) {
        if (candidate.familyId === entry.familyId) refreshTokens.delete(token)
      }
      sendError(response, 401, 'token_expired', '刷新令牌已被使用，整族撤销。', rid)
      return
    }
    const user = users.get(entry.userId)
    if (user === undefined) { sendError(response, 401, 'token_expired', '账号不存在。', rid); return }
    entry.rotated = true
    state.stats.refresh += 1
    sendJson(response, 200, issueSession(user), rid)
    return
  }
  if (path === '/v1/auth/logout' && request.method === 'POST') {
    const payload = authOf(request)
    const user = payload === null ? null : userOf(payload)
    if (user === null) { sendError(response, 401, 'unauthorized', '需要用户令牌。', rid); return }
    for (const [token, entry] of refreshTokens) if (entry.userId === user.id) refreshTokens.delete(token)
    state.stats.logout += 1
    response.writeHead(204, { 'x-request-id': rid, 'access-control-allow-origin': '*' })
    response.end()
    return
  }
  if (path === '/v1/guest/sessions' && request.method === 'POST') {
    const body = await readJson(request)
    const fingerprint = body.deviceFingerprint
    if (typeof fingerprint !== 'string' || fingerprint.length < 32 || fingerprint.length > 128) {
      sendError(response, 400, 'invalid_request', '设备指纹不合法。', rid)
      return
    }
    if (state.mode === 'guest_ip_limited') {
      sendError(response, 429, 'guest_ip_limited', '当前网络领取次数过多。', rid, 600)
      return
    }
    const existing = guestGrants.get(fingerprint)
    if (existing !== undefined && existing.grantDate === today() && !existing.revoked) {
      sendError(response, 409, 'device_already_granted', '今天已领取过免费立项。', rid)
      return
    }
    const deviceId = createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)
    const grant = {
      id: randomUUID(),
      fingerprint,
      deviceId,
      grantDate: today(),
      expiresAt: now() + GUEST_TTL_SECONDS * 1000,
      usedRequests: 0,
      costUsed: 0,
      revoked: false,
    }
    guestGrants.set(fingerprint, grant)
    state.stats.guestClaim += 1
    sendJson(response, 200, {
      guestToken: guestTokenFor(grant),
      tokenType: 'Bearer',
      expiresAt: new Date(grant.expiresAt).toISOString(),
      grantDate: grant.grantDate,
      limits: { maxRequests: MAX_REQUESTS, maxCostMicroUsd: MAX_COST_MICRO_USD, dailyGrantLimit: 1 },
      model: 'deepseek-flash',
      scope: 'onboarding',
      tokenEstimate: tokenEstimate(Math.max(0, MAX_COST_MICRO_USD - grant.costUsed), estimateOptions()),
    }, rid)
    return
  }
  if (path === '/v1/guest/session' && request.method === 'GET') {
    const payload = authOf(request)
    const grant = payload === null ? null : guestOf(payload)
    if (grant === null) { sendError(response, 401, 'unauthorized', '匿名令牌无效。', rid); return }
    if (grant.revoked || grant.expiresAt <= now()) {
      sendError(response, 401, 'token_expired', '匿名授权已结束。', rid)
      return
    }
    sendJson(response, 200, {
      ...guestView(grant),
      tokenEstimate: tokenEstimate(Math.max(0, MAX_COST_MICRO_USD - grant.costUsed), estimateOptions()),
    }, rid)
    return
  }
  if (path === '/v1/chat/completions' && request.method === 'POST') {
    await handleChat(request, response, await readJson(request))
    return
  }
  sendError(response, 404, 'not_found', `没有这个端点：${request.method ?? 'GET'} ${path}`, rid)
}

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    console.error('[mock-cloud] request failed', error)
    if (!response.headersSent) {
      sendError(response, 500, 'internal_error', 'mock 内部错误。', requestId())
    } else {
      response.end()
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[mock-cloud] listening http://${HOST}:${String(PORT)}/v1`)
  console.log('[mock-cloud] sms code is fixed to 123456; reset with POST /_mock/control {"reset":true}')
})
