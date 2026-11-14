/** 宿主 home 的两分支：发布态落用户目录，开发态留仓内，显式覆盖永远优先。 */
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopHome } from '../src/home.ts'

const userHome = join('C:', 'Users', 'probe-user')
const repoRoot = join('E:', 'Projects', 'probe-repo')

describe('resolveDesktopHome', () => {
  it('发布态用用户目录下的 .dsh', () => {
    expect(resolveDesktopHome({ isPackaged: true, userHome, repoRoot }))
      .toBe(join(userHome, '.dsh'))
  })

  it('开发态留在仓内 .dsh-home', () => {
    expect(resolveDesktopHome({ isPackaged: false, userHome, repoRoot }))
      .toBe(join(repoRoot, '.dsh-home'))
  })

  it('显式 DSH_HOME 在两种形态下都优先', () => {
    const override = join('E:', 'Projects', 'probe-home')
    expect(resolveDesktopHome({ isPackaged: true, userHome, repoRoot, override })).toBe(override)
    expect(resolveDesktopHome({ isPackaged: false, userHome, repoRoot, override })).toBe(override)
  })

  it('空覆盖等同未设置，不把 home 指到当前目录', () => {
    expect(resolveDesktopHome({ isPackaged: false, userHome, repoRoot, override: '   ' }))
      .toBe(join(repoRoot, '.dsh-home'))
  })

  it('相对覆盖折成绝对路径，宿主子进程不必依赖工作目录', () => {
    expect(resolveDesktopHome({ isPackaged: false, userHome, repoRoot, override: 'probe-home' }))
      .toBe(resolve('probe-home'))
  })
})
