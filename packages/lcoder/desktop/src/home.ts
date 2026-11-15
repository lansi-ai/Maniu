/** 桌面壳的宿主 home 解析：发布态用用户目录，开发态留在仓内，显式覆盖优先。 */

import { join, resolve } from 'node:path'

/**
 * 发布态 Electron userData 目录名。
 *
 * 品牌改名不搬走已发布版本的设置与登录缓存，因此这里保持改名前的目录名；
 * 它与产品显示名、安装目录和 exe 名无关。
 */
export const RELEASED_USER_DATA_DIRECTORY = 'LCoder'

/**
 * 解析发布态的 Electron userData 目录。
 * @param appData - Electron `appData` 根目录。
 * @returns 固定目录下的 userData 路径。
 */
export function releasedUserDataPath(appData: string): string {
  return join(appData, RELEASED_USER_DATA_DIRECTORY)
}

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
