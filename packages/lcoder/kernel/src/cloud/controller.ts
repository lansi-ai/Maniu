/**
 * 云端的 Remote 控制器：把登录、刷新、登出、匿名领取收成带判别的结果。
 *
 * 所有返回值只含公开资料；令牌、密码与验证码不跨 Remote。业务失败也走
 * `ok: false`，界面按 `error.code` 分支。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CloudApiError } from './api.ts'
import type { CloudAuthApi, CloudAuthSession } from './api.ts'
import type { CloudGuestManager } from './guest.ts'
import { cloudErrorInfo, type CloudTokenManager } from './tokens.ts'
import type {
  CloudAuthValue, CloudErrorInfo, CloudGuestClaimInput, CloudGuestView, CloudLoginPasswordInput,
  CloudLoginSmsInput, CloudOkValue, CloudQuota, CloudRegisterInput, CloudResult, CloudSendSmsInput,
  CloudSmsValue, CloudState, CloudUser,
} from './types.ts'

/** 控制器依赖；由插件入口装配。 */
export interface CloudControllerDeps {
  readonly api: CloudAuthApi
  readonly tokens: CloudTokenManager
  readonly guest: CloudGuestManager
  readonly fingerprint: () => string | Promise<string>
}

/** 把登录会话折成公开结果。 */
function authOf(session: CloudAuthSession): CloudAuthValue {
  return { user: session.user, quota: session.user.quota, expiresIn: session.expiresIn }
}

/** 把一次失败折成界面可直接分支的结果。 */
function failureOf(error: unknown): { readonly ok: false; readonly error: CloudErrorInfo } {
  return { ok: false, error: cloudErrorInfo(error) }
}

/** 云端 Remote 服务。 */
export class CloudController extends TypertRemoteService {
  /**
   * @param ctx - 宿主上下文。
   * @param deps - HTTP 面、令牌管理与匿名授权。
   */
  constructor(ctx: Context, private readonly deps: CloudControllerDeps) {
    super(ctx, 'lcoderCloud', { namespace: 'lcoderCloud' })
  }

  /**
   * 读完整登录状态：用户、额度、匿名剩余量与最近错误。
   * @returns 顶栏与门禁需要的状态。
   */
  @Remote
  async state(): Promise<CloudResult<CloudState>> {
    const auth = await this.deps.tokens.state()
    const guest = await this.deps.guest.snapshot()
    return {
      ok: true,
      value: {
        ...auth,
        guest: guest.guest,
        guestExpired: guest.expired,
        lastError: auth.lastError ?? guest.lastError,
      },
    }
  }

  /**
   * 发送短信验证码。
   * @param input - 手机号与用途。
   * @returns 重发倒计时与有效期。
   */
  @Remote
  async sendSms(input: CloudSendSmsInput): Promise<CloudResult<CloudSmsValue>> {
    try {
      return { ok: true, value: await this.deps.api.sendSms(input) }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 注册并登录。
   * @param input - 手机号、验证码、密码与展示名。
   * @returns 登录资料。
   */
  @Remote
  async register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthValue>> {
    return this.loginWith(token => this.deps.api.register(input, token))
  }

  /**
   * 验证码登录。
   * @param input - 手机号与验证码。
   * @returns 登录资料。
   */
  @Remote
  async loginSms(input: CloudLoginSmsInput): Promise<CloudResult<CloudAuthValue>> {
    return this.loginWith(token => this.deps.api.loginSms(input, token))
  }

  /**
   * 密码登录。
   * @param input - 手机号与密码。
   * @returns 登录资料。
   */
  @Remote
  async loginPassword(input: CloudLoginPasswordInput): Promise<CloudResult<CloudAuthValue>> {
    return this.loginWith(token => this.deps.api.loginPassword(input, token))
  }

  /**
   * 强制刷新访问令牌；每次成功都会轮换刷新令牌。
   * @returns 刷新后的登录资料。
   */
  @Remote
  async refresh(): Promise<CloudResult<CloudAuthValue>> {
    try {
      return { ok: true, value: await this.deps.tokens.refreshNow() }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 重新读当前用户与额度。
   * @returns 登录资料。
   */
  @Remote
  async me(): Promise<CloudResult<CloudAuthValue>> {
    try {
      return { ok: true, value: await this.deps.tokens.me() }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 登出并清除本机两个令牌；服务端撤销失败也清本地。
   * @returns 成功标记。
   */
  @Remote
  async logout(): Promise<CloudResult<CloudOkValue>> {
    try {
      await this.deps.tokens.logout()
      return { ok: true, value: { ok: true } }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 领取或复用今日匿名立项授权。
   * @param input - 可选客户端版本与人机验证令牌。
   * @returns 服务端承认的授权状态。
   */
  @Remote
  async claimGuest(input: CloudGuestClaimInput): Promise<CloudResult<CloudGuestView>> {
    try {
      return { ok: true, value: await this.deps.guest.claim(input) }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  private async loginWith(
    operation: (deviceFingerprint: string) => Promise<CloudAuthSession>,
  ): Promise<CloudResult<CloudAuthValue>> {
    try {
      const session = await operation(await this.deps.fingerprint())
      await this.deps.tokens.login(session)
      return { ok: true, value: authOf(session) }
    } catch (error: unknown) {
      if (error instanceof CloudApiError) return failureOf(error)
      return { ok: false, error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

/** 公开类型只用于生成 Remote 描述；不额外导出令牌形状。 */
export type { CloudQuota, CloudUser }
