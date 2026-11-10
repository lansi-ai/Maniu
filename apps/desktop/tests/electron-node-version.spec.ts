/** The Electron Node version probe runs once per Electron executable identity. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  probe: vi.fn<(file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => string>(),
}))

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => state.probe(file, args, options),
}))

const { electronNodeVersion } = await import('../scripts/electron-node-version.ts')

const roots: string[] = []

function fixture(content = 'electron'): { executable: string; record: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-electron-node-version-'))
  roots.push(root)
  const executable = join(root, 'electron')
  writeFileSync(executable, content)
  return { executable, record: join(root, 'cache', 'electron-node-version.json') }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.probe.mockReturnValue('24.21.0\n')
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('electron node version cache', () => {
  it('probes an Electron runtime once and reuses the recorded version', () => {
    const { executable, record } = fixture()
    expect(electronNodeVersion(executable, record)).toBe('24.21.0')
    expect(electronNodeVersion(executable, record)).toBe('24.21.0')
    expect(state.probe).toHaveBeenCalledTimes(1)
    expect(state.probe.mock.calls[0]?.[0]).toBe(executable)
    expect(state.probe.mock.calls[0]?.[1]).toEqual(['-p', 'process.versions.node'])
    expect(state.probe.mock.calls[0]?.[2].env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('probes again when the executable changes or the record disappears', () => {
    const { executable, record } = fixture('electron')
    electronNodeVersion(executable, record)
    writeFileSync(executable, 'replaced electron')
    expect(electronNodeVersion(executable, record)).toBe('24.21.0')
    rmSync(record)
    expect(electronNodeVersion(executable, record)).toBe('24.21.0')
    expect(state.probe).toHaveBeenCalledTimes(3)
  })

  it('rejects a version the release manifest cannot carry', () => {
    const { executable, record } = fixture()
    state.probe.mockReturnValue('not-a-version\n')
    expect(() => electronNodeVersion(executable, record)).toThrow(/unusable Node version/u)
  })
})
