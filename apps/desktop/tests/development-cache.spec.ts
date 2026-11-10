/** Cache records only describe inputs that still produce the prepared artifact. */

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fileStamp,
  inputsDigest,
  linkStamp,
  readCacheRecord,
  treeDigest,
  writeCacheRecord,
} from '../scripts/development-cache.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-development-cache-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('development cache records', () => {
  it('stamps absent paths and follows directory links only when asked', () => {
    const root = temporaryRoot()
    const target = join(root, 'target')
    const link = join(root, 'link')
    mkdirSync(target)
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(fileStamp(join(root, 'absent'))).toBe('missing')
    expect(linkStamp(join(root, 'absent'))).toBe('missing')
    expect(linkStamp(link).startsWith('link:')).toBe(true)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fileStamp(link)).toBe(fileStamp(target))
  })

  it('reads only complete JSON object records', () => {
    const root = temporaryRoot()
    const path = join(root, 'record.json')
    expect(readCacheRecord(path)).toBeUndefined()
    writeFileSync(path, '{"inputs":"abc"}')
    expect(readCacheRecord(path)).toEqual({ inputs: 'abc' })
    writeFileSync(path, '{"inputs":')
    expect(readCacheRecord(path)).toBeUndefined()
    writeFileSync(path, '[1,2]')
    expect(readCacheRecord(path)).toBeUndefined()
  })

  it('replaces records atomically and leaves no temporary file behind', () => {
    const root = temporaryRoot()
    const path = join(root, 'nested', 'record.json')
    writeCacheRecord(path, { inputs: 'first' })
    writeCacheRecord(path, { inputs: 'second' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ inputs: 'second' })
    expect(readCacheRecord(path)).toEqual({ inputs: 'second' })
  })

  it('digests whole directory trees independently of listing order', () => {
    const root = temporaryRoot()
    const left = join(root, 'left')
    const right = join(root, 'right')
    const fixed = new Date('2026-01-01T00:00:00Z')
    mkdirSync(left)
    mkdirSync(right)
    writeFileSync(join(left, 'a.txt'), 'a')
    writeFileSync(join(left, 'b.txt'), 'b')
    writeFileSync(join(right, 'b.txt'), 'b')
    writeFileSync(join(right, 'a.txt'), 'a')
    for (const path of [join(left, 'a.txt'), join(left, 'b.txt'), join(right, 'a.txt'), join(right, 'b.txt')]) {
      utimesSync(path, fixed, fixed)
    }
    expect(treeDigest(left)).toBe(treeDigest(right))
    expect(treeDigest(left)).toBe(treeDigest(left))
    writeFileSync(join(right, 'b.txt'), 'changed size')
    expect(treeDigest(left)).not.toBe(treeDigest(right))
  })

  it('distinguishes different inputs but not equivalent serializations', () => {
    expect(inputsDigest({ target: 'win-x64', version: '1.0.0' })).toBe(inputsDigest({ target: 'win-x64', version: '1.0.0' }))
    expect(inputsDigest({ target: 'win-x64' })).not.toBe(inputsDigest({ target: 'mac-arm64' }))
  })
})
