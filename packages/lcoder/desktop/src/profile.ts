/** 把 S1 宿主 profile 落到仓内 home；只写 `profiles/s1`，不碰其他 profile。 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 仓库根：`packages/lcoder/desktop/lib/types` 往上五级。 */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../../..')

/** 模板里的文档目录占位符。 */
const DOCUMENTS_PLACEHOLDER = '__LCODER_S1_DOCUMENTS__'

/**
 * 落一份可启动的 S1 profile。
 * @param home - 仓内 DSH home。
 * @returns profile 目录的绝对路径。
 */
export function materializeS1Profile(home: string): string {
  const profileDir = join(home, 'profiles', 's1')
  const documents = join(home, 'documents')
  mkdirSync(documents, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  const template = readFileSync(join(REPO_ROOT, 'lcoder', 's1-profile.patch.yml'), 'utf8')
  const patch = template.replaceAll(DOCUMENTS_PLACEHOLDER, documents.replaceAll('\\', '/'))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch)
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-s1',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`)
  return profileDir
}
