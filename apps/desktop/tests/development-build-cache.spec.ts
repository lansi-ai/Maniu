/** Development builds are skipped only while every workspace input still matches the recorded one. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCacheRecord } from '../scripts/development-cache.ts'
import {
  recordedBuildReusable,
  recordSuccessfulBuild,
  workspaceInputsDigest,
} from '../scripts/development-build-cache.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-development-build-'))
  roots.push(root)
  return root
}

function write(root: string, relative: string, content: string): void {
  mkdirSync(join(root, relative, '..'), { recursive: true })
  writeFileSync(join(root, relative), content)
}

/** Inputs plus the artifacts a recorded build must have left behind. */
function builtWorkspace(): string {
  const root = temporaryRoot()
  write(root, 'packages/core/agent/src/index.ts', 'export const answer = 42\n')
  write(root, 'package.json', '{"name":"fixture"}\n')
  for (const artifact of [
    'apps/web/dist/index.html',
    '.dsh-build/client-build-environment.json',
    'apps/desktop/lib/main.js',
    'apps/desktop-host/lib/index.js',
  ]) write(root, artifact, 'artifact\n')
  return root
}

function inputs(root: string): { root: string; recordPath: string; digest: string } {
  return { root, recordPath: join(root, 'apps/desktop/.desktop-build/development/build-inputs.json'),
    digest: workspaceInputsDigest(root) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('development build reuse', () => {
  it('fingerprints source content and restores the digest when the content returns', () => {
    const root = builtWorkspace()
    const original = workspaceInputsDigest(root)
    write(root, 'packages/core/agent/src/index.ts', 'export const answer = 43\n')
    expect(workspaceInputsDigest(root)).not.toBe(original)
    write(root, 'packages/core/agent/src/index.ts', 'export const answer = 42\n')
    expect(workspaceInputsDigest(root)).toBe(original)
  })

  it('treats tests, build outputs, and app scripts as something other than build inputs', () => {
    const root = builtWorkspace()
    const original = workspaceInputsDigest(root)
    write(root, 'packages/core/agent/tests/agent.spec.ts', 'expect(1).toBe(1)\n')
    write(root, 'packages/core/agent/lib/index.js', 'stale bundle\n')
    write(root, 'apps/desktop/scripts/dev.ts', '// edited launcher\n')
    expect(workspaceInputsDigest(root)).toBe(original)
    write(root, 'apps/web/index.html', '<html></html>')
    expect(workspaceInputsDigest(root)).not.toBe(original)
  })

  it('reuses only a recorded digest whose artifacts are still present', () => {
    const root = builtWorkspace()
    const build = inputs(root)
    expect(recordedBuildReusable(build)).toBe(false)
    recordSuccessfulBuild(build, build.digest)
    expect(readCacheRecord(build.recordPath)?.format).toBe(1)
    expect(recordedBuildReusable(build)).toBe(true)
    expect(recordedBuildReusable({ ...build, digest: 'another-input-set' })).toBe(false)
    rmSync(join(root, 'apps/web/dist/index.html'))
    expect(recordedBuildReusable(build)).toBe(false)
  })
})
