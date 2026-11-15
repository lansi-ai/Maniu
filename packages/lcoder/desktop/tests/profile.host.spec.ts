/** 发布 profile 的拼装：来源目录、文档目录替换与落盘三件。 */
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  composeReleasePatch,
  materializeReleaseProfile,
  releaseProfileSourceDir,
  RELEASE_PROFILE_SOURCES,
} from '../src/profile.ts'

const scratchDirs: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lcoder-profile-'))
  scratchDirs.push(dir)
  return dir
}

function writeSource(dir: string, documentsLine = '    documentsDirectory: \'D:/old/documents\''): void {  writeFileSync(join(dir, RELEASE_PROFILE_SOURCES[0]), `- id: workspace-controller\n  config:\n${documentsLine}\n`)
  for (const file of RELEASE_PROFILE_SOURCES.slice(1)) writeFileSync(join(dir, file), `- id: ${file}\n`)
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('releaseProfileSourceDir', () => {
  it('发布态取 resources/profile', () => {
    expect(releaseProfileSourceDir(true, join('C:', 'app', 'resources')))
      .toBe(join('C:', 'app', 'resources', 'profile'))
  })

  it('开发态取仓内 lcoder', () => {
    expect(releaseProfileSourceDir(false, 'ignored')).toMatch(/lcoder$/u)
  })
})

describe('composeReleasePatch', () => {
  it('按固定顺序拼接四层并把文档目录换成本 home 的真实目录', () => {
    const dir = scratch()
    writeSource(dir)
    const target = 'E:\\home\\documents'
    const composed = composeReleasePatch(dir, target)
    expect(composed).toContain(`    documentsDirectory: '${target}'`)
    expect(composed).not.toContain('D:/old/documents')
    expect(composed).toContain('- id: workspace-controller')
    for (const file of RELEASE_PROFILE_SOURCES.slice(1)) expect(composed).toContain(`- id: ${file}`)
  })

  it('YAML 单引号路径里的引号翻倍', () => {
    const dir = scratch()
    writeSource(dir)
    const path = 'E:\\it\'s here'
    expect(composeReleasePatch(dir, path)).toContain(`documentsDirectory: '${path.replaceAll("'", "''")}'`)
  })

  it('装配源缺文档目录行时直接失败', () => {
    const dir = scratch()
    writeSource(dir, '    other: value')
    expect(() => composeReleasePatch(dir, 'E:\\home')).toThrow(/documentsDirectory/u)
  })
})

describe('materializeReleaseProfile', () => {
  it('只写 profiles/lcoder 的三件，并建好文档目录', () => {
    const home = scratch()
    const sources = scratch()
    writeSource(sources)
    const profileDir = materializeReleaseProfile(home, sources)
    expect(profileDir).toBe(join(home, 'profiles', 'lcoder'))
    expect(readFileSync(join(profileDir, 'cordis.yml'), 'utf8')).toBe('[]\n')
    const documents = join(home, 'documents')
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
      .toContain(`documentsDirectory: '${documents.replaceAll("'", "''")}'`)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { name: string }
    expect(manifest.name).toBe('dsh-profile-lcoder')
  })

  it('发布态把宿主依赖树的 node_modules 接进 profile，重复落盘可覆盖旧链接', () => {
    const home = scratch()
    const sources = scratch()
    const modules = scratch()
    writeSource(sources)
    const profileDir = materializeReleaseProfile(home, sources, modules)
    expect(lstatSync(join(profileDir, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(() => materializeReleaseProfile(home, sources, modules)).not.toThrow()
  })
})
