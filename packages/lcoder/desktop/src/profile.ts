/** 把发布 profile 落到 DSH home；只写 `profiles/lcoder`，不碰其他 profile。 */

import { lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 仓库根：`packages/lcoder/desktop/lib/types` 往上五级。 */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../../..')

/**
 * 发布 profile 的追加层来源，按顺序拼接：先装配十个角色，再关浏览器面，
 * 再关只服务上游 UI 的宿主行，最后关新壳不用的浏览器行并补工作台 preset。
 */
export const RELEASE_PROFILE_SOURCES = [
  'desktop-profile.patch.yml',
  'host-only-profile.patch.yml',
  'host-only-minimal.patch.yml',
  'host-workbench.patch.yml',
] as const

/** 装配源里的文档目录占位行；落盘时替换成本 home 下真实存在的目录。 */
const DOCUMENTS_LINE = /^(\s*documentsDirectory:\s*).*$/mu

/**
 * 解析装配源目录：开发态读仓内 `lcoder/`，发布态读 `resources/profile/`。
 * @param packaged - Electron `app.isPackaged`。
 * @param resourcesPath - 打包态资源目录；开发态忽略。
 * @returns 装配源目录的绝对路径。
 */
export function releaseProfileSourceDir(packaged: boolean, resourcesPath: string): string {
  return packaged ? join(resourcesPath, 'profile') : join(REPO_ROOT, 'lcoder')
}

/**
 * 拼出发布 profile 的 `cordis.patch.yml` 正文。
 * @param sourceDir - 含 `RELEASE_PROFILE_SOURCES` 的目录。
 * @param documents - 本 home 下真实存在的文档目录。
 * @returns 追加层 YAML 文本。
 */
export function composeReleasePatch(sourceDir: string, documents: string): string {
  const quoted = `'${documents.replaceAll("'", "''")}'`
  const sections = RELEASE_PROFILE_SOURCES.map(file => readFileSync(join(sourceDir, file), 'utf8').trimEnd())
  const composed = `${sections.join('\n\n')}\n`
  if (!DOCUMENTS_LINE.test(composed)) {
    throw new Error(`lcoder desktop: 发布 profile 缺少 documentsDirectory 行（PITFALLS W-08）：${sourceDir}`)
  }
  return composed.replace(DOCUMENTS_LINE, `$1${quoted}`)
}

/**
 * 落一份可启动的发布 profile。
 * @param home - DSH home（开发态仓内，发布态 `~/.dsh`）。
 * @param sourceDir - 装配源目录，见 {@link releaseProfileSourceDir}。
 * @param nodeModulesDir - 发布态宿主依赖树里的 `node_modules`；profile 里的插件按包名解析，
 * 用户 home 没有仓根祖先目录，必须把安装树接进来。开发态留空，走仓根解析。
 * @returns profile 目录的绝对路径。
 */
export function materializeReleaseProfile(home: string, sourceDir: string, nodeModulesDir?: string): string {
  const profileDir = join(home, 'profiles', 'lcoder')
  const documents = join(home, 'documents')
  mkdirSync(documents, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'cordis.patch.yml'), composeReleasePatch(sourceDir, documents))
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-lcoder',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`)
  if (nodeModulesDir !== undefined) {
    const link = join(profileDir, 'node_modules')
    try {
      const existing = lstatSync(link)
      if (!existing.isSymbolicLink()) throw new Error(`lcoder desktop: ${link} 已存在且不是链接`)
      unlinkSync(link)
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (!(typeof code === 'string' && code === 'ENOENT')) throw error
    }
    symlinkSync(nodeModulesDir, link, process.platform === 'win32' ? 'junction' : 'dir')
  }
  return profileDir
}
