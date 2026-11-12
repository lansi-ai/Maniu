// @vitest-environment jsdom
/**
 * 设置页顶部默认模型区：当前默认展示、候选去重、无会话禁用与写入调用。
 *
 * 数据面用记录器替身；这里断言页面可见文案与发给 face 的参数，不涉及远程。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { ModelSettings } from '../src/client/shell/ModelSettings.tsx'
import type {
  ModelProviderRow, ModelSettingsFace, ModelSettingsSnapshot,
} from '../src/client/shell/model-settings.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 一条可展示的行，按需覆盖。 */
function row(overrides: Partial<ModelProviderRow>): ModelProviderRow {
  return {
    provider: 'anthropic',
    displayName: 'anthropic',
    group: 'other',
    active: true,
    declared: false,
    account: false,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'anthropic'],
    revision: 1,
    baseURLEnv: [],
    modelIds: [],
    profilePresent: true,
    removable: false,
    apiKeyConfigured: false,
    apiKeyWritable: true,
    nativeConfigured: false,
    nativeEnv: [],
    models: [],
    accountAvailable: false,
    ...overrides,
  }
}

/** 两个服务商，官方行里带一条重复模型，用来验证候选去重。 */
const ROWS: readonly ModelProviderRow[] = [
  row({
    provider: 'deepseek-official',
    displayName: 'DeepSeek',
    group: 'official',
    settingsNs: 'llm-deepseek',
    settingsPath: [],
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-flash', name: 'DeepSeek Flash' },
    ],
  }),
  row({ models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }] }),
]

/** 一份可用快照；默认模型按需覆盖，传 `null` 表示未设置。 */
function snapshot(
  overrides: Partial<Omit<ModelSettingsSnapshot, 'defaultSelection'>> = {},
  defaultSelection: ModelSettingsSnapshot['defaultSelection'] | null = { provider: 'deepseek-official', model: 'deepseek-chat' },
): ModelSettingsSnapshot {
  return {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: ROWS,
    protocols: [],
    ...defaultSelection === null ? {} : { defaultSelection },
    ...overrides,
  }
}

/** 覆盖 load / setDefault 的记录器替身，其余写入面不会被本轮触发。 */
function faceWith(
  load: ModelSettingsFace['load'],
  setDefault: ModelSettingsFace['setDefault'],
): ModelSettingsFace {
  return {
    load,
    setDefault,
    saveKey: vi.fn().mockResolvedValue(undefined),
    removeKey: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    createProvider: vi.fn().mockResolvedValue(undefined),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue({ kind: 'found', models: [] }),
  }
}

/** 找到默认模型下拉。 */
async function defaultSelect(): Promise<HTMLSelectElement> {
  return await screen.findByLabelText('默认模型') as HTMLSelectElement
}

describe('默认模型区', () => {
  it('展示当前默认；没有默认时如实说未设置', async () => {
    const face = faceWith(vi.fn().mockResolvedValue(snapshot()), vi.fn().mockResolvedValue(undefined))
    const { unmount } = render(<ModelSettings face={face} sessionId={'session-1' as never} t={t} />)
    expect(await screen.findByText('当前默认：DeepSeek · DeepSeek Chat')).toBeTruthy()
    unmount()

    const unsetFace = faceWith(
      vi.fn().mockResolvedValue(snapshot({}, null)),
      vi.fn().mockResolvedValue(undefined),
    )
    render(<ModelSettings face={unsetFace} sessionId={'session-1' as never} t={t} />)
    expect(await screen.findByText('还没有设置默认模型。')).toBeTruthy()
  })

  it('候选按 provider + model 去重', async () => {
    const face = faceWith(vi.fn().mockResolvedValue(snapshot()), vi.fn().mockResolvedValue(undefined))
    render(<ModelSettings face={face} sessionId={'session-1' as never} t={t} />)
    const select = await defaultSelect()
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual([
      'DeepSeek · DeepSeek Chat',
      'DeepSeek · DeepSeek Flash',
      'anthropic · Claude Sonnet 4.5',
    ])
  })

  it('无会话时按钮禁用并提示先打开会话', async () => {
    const face = faceWith(vi.fn().mockResolvedValue(snapshot()), vi.fn().mockResolvedValue(undefined))
    render(<ModelSettings face={face} sessionId={undefined} t={t} />)
    const button = await screen.findByRole('button', { name: '设为默认' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('还没有会话；先打开一个会话再设默认。')).toBeTruthy()
  })

  it('选好候选后点击把 provider 与 model 交给 setDefault，并重新加载', async () => {
    const load = vi.fn().mockResolvedValue(snapshot())
    const setDefault = vi.fn().mockResolvedValue(undefined)
    const onChanged = vi.fn()
    const face = faceWith(load, setDefault)
    render(<ModelSettings face={face} sessionId={'session-1' as never} t={t} onChanged={onChanged} />)
    const select = await defaultSelect()
    const option = within(select).getByText('anthropic · Claude Sonnet 4.5') as HTMLOptionElement
    fireEvent.change(select, { target: { value: option.value } })
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }))
    await waitFor(() => {
      expect(setDefault).toHaveBeenCalledWith('session-1', 'anthropic', 'claude-sonnet-4-5')
    })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('写入失败就地显示原文，不再重新加载', async () => {
    const load = vi.fn().mockResolvedValue(snapshot())
    const face = faceWith(load, vi.fn().mockResolvedValue('没有这个模型'))
    render(<ModelSettings face={face} sessionId={'session-1' as never} t={t} />)
    await defaultSelect()
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }))
    expect(await screen.findByText('没有这个模型')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
