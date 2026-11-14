/** A prepared payload is reused only while its manifest and entry points match the locked inputs. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { payloadReusable, type PayloadIdentity } from '../scripts/prepare-development-runtime.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-development-runtime-'))
  roots.push(root)
  return root
}

const identity: PayloadIdentity = {
  desktopVersion: '1.2.3',
  platform: 'win32',
  arch: 'x64',
  node: '24.21.0',
  pnpm: '11.7.0',
}

function prepared(root: string, manifest: Record<string, unknown> = {}): string {
  const payload = join(root, 'primary-runtime')
  const dependencies = join(payload, 'dependencies')
  for (const path of [
    join(dependencies, 'node', 'bin', 'node.exe'),
    join(dependencies, 'pnpm', 'bin', 'pnpm.mjs'),
  ]) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '')
  }
  writeFileSync(join(payload, 'runtime.json'), JSON.stringify({
    desktopVersion: identity.desktopVersion,
    platform: identity.platform,
    arch: identity.arch,
    payloadDigest: 'digest',
    python: '3.12.14',
    node: identity.node,
    pnpm: identity.pnpm,
    pythonPackages: {},
    ...manifest,
  }))
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('development primary runtime reuse', () => {
  it('reuses a payload whose manifest and entry points match the inputs', () => {
    expect(payloadReusable(prepared(temporaryRoot()), identity)).toBe(true)
  })

  it('rejects a payload built for other locked versions', () => {
    const root = prepared(temporaryRoot(), { pnpm: '11.6.0' })
    expect(payloadReusable(root, identity)).toBe(false)
    const versions = prepared(temporaryRoot(), { node: '24.17.0' })
    expect(payloadReusable(versions, identity)).toBe(false)
  })

  it('rejects a payload missing any entry point or manifest', () => {
    const missingNode = prepared(temporaryRoot())
    rmSync(join(missingNode, 'primary-runtime', 'dependencies', 'node'), { recursive: true })
    expect(payloadReusable(missingNode, identity)).toBe(false)
    const missingManifest = prepared(temporaryRoot())
    rmSync(join(missingManifest, 'primary-runtime', 'runtime.json'))
    expect(payloadReusable(missingManifest, identity)).toBe(false)
    const truncated = prepared(temporaryRoot())
    writeFileSync(join(truncated, 'primary-runtime', 'runtime.json'), '{"python":')
    expect(payloadReusable(truncated, identity)).toBe(false)
  })

  it('rejects an empty runtime directory', () => {
    expect(payloadReusable(temporaryRoot(), identity)).toBe(false)
  })
})
