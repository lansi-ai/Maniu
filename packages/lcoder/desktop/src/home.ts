/** 桌面壳的宿主 home 解析：发布态用用户目录，开发态留在仓内，显式覆盖优先。 */

import { join, resolve } from 'node:path'

/** 解析所需的事实；全部由调用方注入，单测不碰真实用户目录。 */
export interface DesktopHomeInput {
  /** Electron `app.isPackaged`。 */
  readonly isPackaged: boolean
  /** 用户主目录；发布态在这里落 `.dsh`。 */
  readonly userHome: string
  /** 仓库根；开发态在这里落 `.dsh-home`。 */
  readonly repoRoot: string
  /** 显式 `DSH_HOME`；启动器与探针靠它钉住 home。 */
  readonly override?: string | undefined
}

/**
 * 解析本次进程使用的 DSH home。
 * @param input - 打包形态、用户主目录、仓库根与显式覆盖。
 * @returns 绝对 home 路径。
 */
export function resolveDesktopHome(input: DesktopHomeInput): string {
  const override = input.override?.trim()
  if (override !== undefined && override !== '') return resolve(override)
  return input.isPackaged ? join(input.userHome, '.dsh') : join(input.repoRoot, '.dsh-home')
}
