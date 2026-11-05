import { afterEach, expect, it, vi } from 'vitest'
import { projectDirectoryPicker } from '../src/client/shell/project-directory.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('falls back to the manual path when the desktop picker is absent', () => {
  expect(projectDirectoryPicker()).toBeUndefined()
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick: vi.fn() })
  expect(projectDirectoryPicker()).toBeUndefined()
})

it('returns the project picker exposed by the desktop preload', async () => {
  const pickProjectDirectory = vi.fn(async () => '/repo')
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick: vi.fn(), pickProjectDirectory })
  expect(await projectDirectoryPicker()?.pickProjectDirectory()).toBe('/repo')
})
