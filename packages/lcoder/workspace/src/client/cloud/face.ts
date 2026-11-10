/**
 * 浏览器侧的云端数据面：把生成的 Remote 方法收成界面能直接调的回调。
 *
 * 这一层不碰 ctx；测试可以给一个记录器替身，断言界面发出的调用与参数。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CloudAuthValue, CloudLoginPasswordInput, CloudLoginSmsInput,
  CloudOkValue, CloudRegisterInput, CloudResult, CloudSendSmsInput, CloudSmsValue, CloudState,
  CloudUsagePage, CloudUsageQuery,
} from '@lcoder/kernel/src/cloud/types.ts'
import { CLOUD_MODEL, CLOUD_USER_ROUTE } from './routes.ts'

/** 生成贡献在 `ctx.remote` 上的签名；与 `typert.remote-client.d.ts` 一致。 */
export interface CloudRemoteNamespace {
  state(): Promise<RemoteResult<CloudResult<CloudState>>>
  sendSms(input: CloudSendSmsInput): Promise<RemoteResult<CloudResult<CloudSmsValue>>>
  register(input: CloudRegisterInput): Promise<RemoteResult<CloudResult<CloudAuthValue>>>
  loginSms(input: CloudLoginSmsInput): Promise<RemoteResult<CloudResult<CloudAuthValue>>>
  loginPassword(input: CloudLoginPasswordInput): Promise<RemoteResult<CloudResult<CloudAuthValue>>>
  refresh(): Promise<RemoteResult<CloudResult<CloudAuthValue>>>
  me(): Promise<RemoteResult<CloudResult<CloudAuthValue>>>
  logout(): Promise<RemoteResult<CloudResult<CloudOkValue>>>
  usage(query: CloudUsageQuery): Promise<RemoteResult<CloudResult<CloudUsagePage>>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    lcoderCloud: CloudRemoteNamespace
  }
}

/** 远程面里本页用到的方法；由装配层从 `ctx.remote` 窄化出来。 */
export interface CloudRemotePort {
  state(): Promise<CloudResult<CloudState>>
  sendSms(input: CloudSendSmsInput): Promise<CloudResult<CloudSmsValue>>
  register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthValue>>
  loginSms(input: CloudLoginSmsInput): Promise<CloudResult<CloudAuthValue>>
  loginPassword(input: CloudLoginPasswordInput): Promise<CloudResult<CloudAuthValue>>
  refresh(): Promise<CloudResult<CloudAuthValue>>
  me(): Promise<CloudResult<CloudAuthValue>>
  logout(): Promise<CloudResult<CloudOkValue>>
  usage(query: CloudUsageQuery): Promise<CloudResult<CloudUsagePage>>
}

/** 切模型路由要走会话命令面，不属于云端 Remote。 */
export interface CloudModelPort {
  selectModel(request: {
    sessionId: SessionId
    provider: string
    model: string
  }): Promise<CloudSwitchResult>
}

/** 一次会话模型切换的结果。 */
export type CloudSwitchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 界面使用的云端面。 */
export interface CloudFace extends CloudRemotePort {
  /** Remote 贡献是否成功挂载。 */
  readonly available: boolean
  /**
   * 把一条会话切到用户路由；桌面端已没有匿名路由可切。
   * @param sessionId - 要切换的会话。
   */
  selectRoute(sessionId: SessionId): Promise<CloudResult<{ readonly provider: string; readonly model: string }>>
}

/** 调用抛异常时补出的失败结果；界面不需要崩。 */
function thrown(error: unknown): { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  return {
    ok: false,
    error: {
      code: 'cloud_unavailable',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/**
 * 用一个 Remote 端口构造界面面。
 * @param port - 已挂载的 Remote 方法集合。
 * @returns 带路由切换的云端面。
 */
export function createCloudFace(port: CloudRemotePort & CloudModelPort): CloudFace {
  const call = async <T>(operation: () => Promise<CloudResult<T>>): Promise<CloudResult<T>> => {
    try {
      return await operation()
    } catch (error: unknown) {
      return thrown(error)
    }
  }
  return {
    available: true,
    state: () => call(() => port.state()),
    sendSms: input => call(() => port.sendSms(input)),
    register: input => call(() => port.register(input)),
    loginSms: input => call(() => port.loginSms(input)),
    loginPassword: input => call(() => port.loginPassword(input)),
    refresh: () => call(() => port.refresh()),
    me: () => call(() => port.me()),
    logout: () => call(() => port.logout()),
    usage: query => call(() => port.usage(query)),
    async selectRoute(sessionId) {
      const provider = CLOUD_USER_ROUTE
      let selected: Awaited<ReturnType<CloudModelPort['selectModel']>>
      try {
        selected = await port.selectModel({ sessionId, provider, model: CLOUD_MODEL })
      } catch (error: unknown) {
        return thrown(error)
      }
      if (!selected.ok) return selected
      return { ok: true, value: { provider, model: CLOUD_MODEL } }
    },
  }
}

/** 未挂载时的占位面：所有调用都给出可显示的失败。 */
export function unavailableCloudFace(error: unknown): CloudFace {
  const fail = (): Promise<never> => Promise.reject(error instanceof Error ? error : new Error(String(error)))
  return {
    available: false,
    state: fail,
    sendSms: fail,
    register: fail,
    loginSms: fail,
    loginPassword: fail,
    refresh: fail,
    me: fail,
    logout: fail,
    usage: fail,
    selectRoute: fail,
  }
}
