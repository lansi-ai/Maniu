/** 宿主子进程监督：拉起、读 ready、暴露退出诊断、优雅关停。 */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { materializeReleaseProfile } from './profile.ts'

/** 宿主失败时携带的完整 stderr 尾部。 */
export class HostFatalError extends Error {
  /** 已就绪后是否还收到过失败事件。 */
  readonly stopping: boolean

  /**
   * @param message - 诊断摘要。
   * @param stopping - 是否为主动关停。
   */
  constructor(message: string, stopping = false) {
    super(message)
    this.stopping = stopping
  }
}

type HostMessage = { readonly type: 'ready'; readonly url: string }
  | { readonly type: 'fatal'; readonly message: string }
  | { readonly type: 'shutdown-complete' }

function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const type: unknown = value.type
  if (type === 'shutdown-complete') return true
  if (type === 'ready') return 'url' in value && typeof value.url === 'string'
  if (type === 'fatal') return 'message' in value && typeof value.message === 'string'
  return false
}

const MAX_STDERR_CHARS = 16 * 1024

/** 优雅关停等待上限；宿主写完会话日志通常远低于此值。 */
const GRACEFUL_STOP_MS = 6_000

/** SIGTERM 后的等待上限；到点直接 SIGKILL，避免把关窗拖成驻留。 */
const TERM_WAIT_MS = 2_000

/** 发布态宿主入口与打包载荷；开发态由本包决定。 */
export interface HostLaunch {
  /** `host-entry.js` 的绝对路径。 */
  readonly entry?: string | undefined
  /** 打包载荷里的 pnpm 入口与 node 启动器目录。 */
  readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string } | undefined
  /** 打包载荷的 `node_modules`；用户 home 的 profile 靠它解析插件包。 */
  readonly nodeModules?: string | undefined
}

/** 一条宿主子进程。 */
export class HostSupervisor {
  private child: ChildProcess | undefined
  private readonly stderrTail: string[] = []
  private url: string | undefined

  /** 已就绪的宿主地址。 */
  get readyUrl(): string | undefined { return this.url }

  /**
   * 拉起宿主并等待 ready。
   * @param home - DSH home（开发态仓内，发布态 `~/.dsh`）。
   * @param sourceDir - 发布 profile 装配源目录。
   * @param inspectPort - 可选的宿主 inspector 端口。
   * @param launch - 打包态的入口与载荷覆盖；缺省走本包编译产物与系统环境。
   * @returns 已就绪的宿主地址。
   */
  async start(home: string, sourceDir: string, inspectPort?: number, launch: HostLaunch = {}): Promise<string> {
    const profileDir = materializeReleaseProfile(home, sourceDir, launch.nodeModules)
    const entry = launch.entry ?? join(import.meta.dirname, 'host-entry.js')
    const packageManager = launch.packageManager
    const child = spawn(process.execPath, [
      '--expose-internals',
      ...(inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${String(inspectPort)}`]),
      entry,
      profileDir,
    ], {
      cwd: profileDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: home,
        ...(packageManager === undefined ? {} : {
          LCODER_HOST_PNPM: packageManager.pnpm,
          LCODER_HOST_NODE_BIN: packageManager.nodeBin,
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stdout?.pipe(process.stdout)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail.push(chunk)
      let total = this.stderrTail.reduce((sum, value) => sum + value.length, 0)
      while (total > MAX_STDERR_CHARS && this.stderrTail.length > 1) total -= this.stderrTail.shift()?.length ?? 0
      process.stderr.write(chunk)
    })
    const url = await new Promise<string>((resolve, reject) => {
      let settled = false
      child.on('message', (message: unknown) => {
        if (!isHostMessage(message)) return
        if (message.type === 'ready' && !settled) {
          settled = true
          this.url = message.url
          resolve(message.url)
        } else if (message.type === 'fatal' && !settled) {
          settled = true
          reject(new HostFatalError(message.message))
        }
      })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      child.once('close', (code) => {
        if (settled) return
        settled = true
        reject(new HostFatalError(`宿主在就绪前退出（${String(code)}）：${this.stderrText()}`))
      })
    })
    return url
  }

  /** 请求优雅关停；超时则依次 SIGTERM、SIGKILL。 */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    this.url = undefined
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
    console.log(`lcoder desktop: 宿主 ${String(child.pid)} 收到关停请求（通道=${child.connected ? '在' : '断'}）`)
    if (child.connected) child.send({ type: 'shutdown' })
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => { setTimeout(() => { resolve(false) }, GRACEFUL_STOP_MS).unref() }),
    ])
    if (!graceful) {
      console.warn(`lcoder desktop: 宿主 ${String(child.pid)} 优雅关停超时，发送 SIGTERM`)
      child.kill('SIGTERM')
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          console.error(`lcoder desktop: 宿主 ${String(child.pid)} SIGTERM 后仍未退出，发送 SIGKILL`)
          child.kill('SIGKILL')
          resolve()
        }, TERM_WAIT_MS).unref()
      }),
    ])
  }

  /** 关停超时的最后手段：直接杀掉宿主，避免孤儿进程继续占住会话库与端口。 */
  terminate(): void {
    const child = this.child
    this.child = undefined
    this.url = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  private stderrText(): string {
    return this.stderrTail.join('').trim().slice(-2_000)
  }
}
