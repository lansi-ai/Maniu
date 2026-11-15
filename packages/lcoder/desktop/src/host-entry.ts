/** 最小宿主进程：用 `desktop` 启动语义跑一份 profile，并把 ready URL 报回主进程。 */

import { delimiter, join } from 'node:path'
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** 与 `dsh` 安装同一份包目录：本包自己的 package.json。 */
const INSTALL_ANCHOR = join(import.meta.dirname, '../../package.json')

interface HostFatal {
  readonly type: 'fatal'
  readonly message: string
}

function send(message: object): void {
  if (!process.connected) return
  process.send?.(message, (error) => { if (error !== null) console.error(error) })
}

function packageManager(): { command: string; args: string[]; env: Record<string, string> } | undefined {
  const pnpm = process.env.LCODER_HOST_PNPM
  const nodeBin = process.env.LCODER_HOST_NODE_BIN
  if (pnpm === undefined || pnpm === '' || nodeBin === undefined || nodeBin === '') return undefined
  return {
    command: process.execPath,
    args: ['--expose-internals', pnpm],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ''}`,
    },
  }
}

async function main(): Promise<void> {
  const profileDir = process.argv[2]
  if (profileDir === undefined) throw new Error('lcoder host: 缺少 profile 目录参数')
  const profile = loadProfileDirectory('dsh', profileDir, INSTALL_ANCHOR)
  reportSkippedBundles('dsh', profile)
  const manager = packageManager()
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'lcoder',
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
    ...(manager === undefined ? {} : { packageManager: manager }),
  })
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Startup failure is reported below; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
    if (running !== undefined) process.exit()
  })()
  process.on('message', (message: unknown) => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') void stop()
  })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  const url = ctx.connection.authenticatedUrl(`${ctx.webServer.protocol}//127.0.0.1:${String(ctx.webServer.port)}`)
  send({ type: 'ready', url })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const fatal: HostFatal = { type: 'fatal', message }
  send(fatal)
  console.error(error)
  process.exitCode = 1
  if (process.connected) process.disconnect()
})
