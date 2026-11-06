/**
 * `@lcoder/kernel/cloud` 的 Cordis 入口：全局挂载云端控制器与令牌生命周期。
 *
 * 这个插件不属于任何角色 preset；它必须在第一条会话出现之前就在，才能给
 * 顶栏、门禁与模型请求提供同一个令牌供应器。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { CloudApi } from './api.ts'
import { CloudController } from './controller.ts'
import { cloudDeviceFingerprint } from './fingerprint.ts'
import { CloudGuestManager } from './guest.ts'
import { CloudTokenManager, cloudErrorInfo } from './tokens.ts'
import type { CloudSecretStore } from './tokens.ts'
import { CLOUD_GUEST_ROUTE, CLOUD_USER_ROUTE } from './types.ts'

/** 插件配置；部署可覆盖默认地址与刷新余量。 */
export interface CloudPluginConfig {
  /** 云端 `/v1` 基地址；默认 `LCODER_CLOUD_BASE_URL`，再退到本机 mock。 */
  readonly baseUrl?: string
  /** 访问令牌少于该秒数就刷新；默认 60。 */
  readonly refreshSkewSeconds?: number
  /** 刷新最多阻塞秒数；默认 5。 */
  readonly refreshTimeoutMs?: number
  /** 普通请求超时；默认 10 秒。 */
  readonly requestTimeoutMs?: number
  /** 随请求发送的客户端版本。 */
  readonly clientVersion?: string
}

/** 插件名，与 loader 行一致。 */
export const name = 'lcoder-cloud'

/** 令牌生命周期依赖凭据存储；模型请求钩子由 agent 事件提供。 */
export const inject = ['credentials']

/** 开发默认地址；生产由 profile 的 `!!js` 或环境变量覆盖。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:5091/v1'

/** 把宿主凭据面收成 token 模块要的最小读写形状。 */
function secretStore(credentials: Context['credentials']): CloudSecretStore {
  return {
    read: async (ref) => {
      const hit = await credentials.resolve(credentialRef(ref))
      return hit?.value
    },
    write: async (ref, value) => { await credentials.set(credentialRef(ref), value) },
    remove: async (ref) => { await credentials.unset(credentialRef(ref)) },
  }
}

/**
 * 挂载云端控制器、预刷新与 401 单次重试。
 * @param ctx - 宿主上下文。
 * @param config - 云端地址与令牌余量。
 */
export function apply(ctx: Context, config: CloudPluginConfig = {}): void {
  const baseUrl = config.baseUrl ?? process.env.LCODER_CLOUD_BASE_URL ?? DEFAULT_BASE_URL
  const clientVersion = config.clientVersion ?? process.env.DSH_CLIENT_VERSION
  const api = new CloudApi({
    baseUrl,
    ...clientVersion === undefined ? {} : { clientVersion },
    ...config.requestTimeoutMs === undefined ? {} : { timeoutMs: config.requestTimeoutMs },
  })
  const store = secretStore(ctx.credentials)
  const tokens = new CloudTokenManager(api, store, {
    logger: ctx.logger,
    ...config.refreshSkewSeconds === undefined ? {} : { refreshSkewMs: config.refreshSkewSeconds * 1000 },
    ...config.refreshTimeoutMs === undefined ? {} : { refreshTimeoutMs: config.refreshTimeoutMs * 1000 },
  })
  const fingerprint = (): string => cloudDeviceFingerprint()
  const guest = new CloudGuestManager(api, store, fingerprint, {
    ...clientVersion === undefined ? {} : { clientVersion },
  })
  new CloudController(ctx, { api, tokens, guest, fingerprint })
  void tokens.hydrate()

  /** 每次重试只对同一 step 放行一次。 */
  const retried = new Map<string, number>()

  ctx.effect(() => ctx.on('agent/request', async (_payload, next) => {
    const request = await next()
    if (request.provider === CLOUD_USER_ROUTE) await tokens.ensureFresh(120_000)
    else if (request.provider === CLOUD_GUEST_ROUTE) await guest.ensureUsable()
    return request
  }), 'lcoder-cloud: pre-request token freshness')

  ctx.effect(() => ctx.on('agent/request-error', async (payload, next) => {
    const action = await next()
    if (action?.kind === 'retry') return action
    if (payload.provider !== CLOUD_USER_ROUTE) return action
    if (payload.failure.code !== 'AUTH') return action
    // pi-ai 把 401 与 403 都归成 AUTH；封禁不是过期，刷新令牌也换不回权限。
    if (/\b403\b/.test(payload.failure.message) || /"code"\s*:\s*"banned"/.test(payload.failure.message)) return action
    const key = `${String(payload.agent.id)}:${String(payload.turn)}:${String(payload.step)}`
    if (retried.has(key)) return action
    if (retried.size > 512) retried.clear()
    retried.set(key, Date.now())
    try {
      await tokens.refresh(true)
      return { kind: 'retry' }
    } catch (error: unknown) {
      ctx.logger.warn('lcoder-cloud: 401 refresh failed (%s)', cloudErrorInfo(error).code)
      return action
    }
  }), 'lcoder-cloud: single 401 retry')

  ctx.effect(() => () => { tokens.dispose() }, 'lcoder-cloud: refresh timer')
}
