/** 设置页：模型、外观、语言、更新与关于。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { MessageKey, Translate } from '../locale.ts'
import { FONTS, SKINS, type FontId, type PreferencesHandle, type SkinId } from '../prefs.ts'
import type { UpdateCheck } from '@lcoder/desktop/contract'
import { ModelPanel } from './model-panel.tsx'

/** 设置页属性。 */
export interface SettingsPageProps {
  readonly t: Translate
  readonly prefs: PreferencesHandle
  /** 当前会话；模型面板用它保存默认模型。 */
  readonly sessionId: string | null
  /** 模型写入成功后通知外壳重查模型可用性。 */
  readonly onModelsChanged: () => void
}

/** 皮肤词典键。 */
const SKIN_KEY: Readonly<Record<SkinId, MessageKey>> = {
  'liquid-glass': 'settings.skinLiquidGlass',
  neon: 'settings.skinNeon',
  silver: 'settings.skinSilver',
  rose: 'settings.skinRose',
}

/** 字体词典键。 */
const FONT_KEY: Readonly<Record<FontId, MessageKey>> = {
  system: 'settings.fontSystem',
  modern: 'settings.fontModern',
}

/**
 * 设置页。
 * @param props - 词典、偏好、会话与变更回调。
 * @returns 整页设置。
 */
export function SettingsPage({ t, prefs, sessionId, onModelsChanged }: SettingsPageProps): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [hostUrl, setHostUrl] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.lcoder.appInfo().then((info) => {
      setVersion(info.version)
      setHostUrl(info.hostUrl ?? null)
    }).catch(() => undefined)
  }, [])

  const check = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    try {
      setUpdate(await window.lcoder.update())
    } catch (error: unknown) {
      setUpdate({ kind: 'error', version: version ?? '', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setChecking(false)
    }
  }

  const updateText = update === null
    ? t('settings.updateIdle')
    : update.kind === 'unavailable'
      ? t('settings.updateUnavailable')
      : update.kind === 'up-to-date'
        ? t('settings.updateUpToDate')
        : update.kind === 'error'
          ? t('settings.updateError', { detail: update.detail })
          : t('settings.updateChecking')

  return (
    <section className="page" data-testid="page-settings">
      <header className="page-head">
        <div>
          <h2>{t('settings.title')}</h2>
          <p className="page-sub">{t('settings.subtitle')}</p>
        </div>
      </header>

      <ModelPanel t={t} sessionId={sessionId} onChanged={onModelsChanged} />

      <section className="settings-section lg-glass-card" data-testid="settings-appearance">
        <header className="settings-section-head">
          <div>
            <h3>{t('settings.appearance')}</h3>
            <p>{t('settings.skinHint')}</p>
          </div>
        </header>
        <div className="settings-row">
          <span className="settings-label">{t('settings.skin')}</span>
          <div className="settings-chips" role="group" aria-label={t('settings.skin')}>
            {SKINS.map(skin => (
              <button
                key={skin}
                type="button"
                className={prefs.skin === skin ? 'settings-chip active' : 'settings-chip'}
                data-testid={`settings-skin-${skin}`}
                aria-pressed={prefs.skin === skin}
                onClick={() => { prefs.setSkin(skin) }}
              >
                <span className={`skin-swatch skin-swatch-${skin}`} aria-hidden="true" />
                {t(SKIN_KEY[skin])}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">{t('settings.font')}</span>
          <div className="settings-chips" role="group" aria-label={t('settings.font')}>
            {FONTS.map(font => (
              <button
                key={font}
                type="button"
                className={prefs.font === font ? 'settings-chip active' : 'settings-chip'}
                data-testid={`settings-font-${font}`}
                aria-pressed={prefs.font === font}
                onClick={() => { prefs.setFont(font) }}
              >
                {t(FONT_KEY[font])}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-muted">{t('settings.fontHint')}</p>
        <div className="settings-row">
          <span className="settings-label">{t('settings.language')}</span>
          <div className="settings-chips" role="group" aria-label={t('settings.language')}>
            <button
              type="button"
              className={prefs.locale === 'zh' ? 'settings-chip active' : 'settings-chip'}
              data-testid="settings-locale-zh"
              aria-pressed={prefs.locale === 'zh'}
              onClick={() => { prefs.setLocale('zh') }}
            >
              {t('settings.languageZh')}
            </button>
            <button
              type="button"
              className={prefs.locale === 'en' ? 'settings-chip active' : 'settings-chip'}
              data-testid="settings-locale-en"
              aria-pressed={prefs.locale === 'en'}
              onClick={() => { prefs.setLocale('en') }}
            >
              {t('settings.languageEn')}
            </button>
          </div>
        </div>
        <p className="settings-muted">{t('settings.languageHint')}</p>
      </section>

      <section className="settings-section lg-glass-card" data-testid="settings-update">
        <header className="settings-section-head">
          <div>
            <h3>{t('settings.update')}</h3>
            <p>{t('settings.updateHint')}</p>
          </div>
        </header>
        <div className="settings-row">
          <span className="settings-label" data-testid="settings-version">
            {version === null ? t('settings.loading') : t('settings.updateCurrent', { version })}
          </span>
          <button
            type="button"
            className="pill"
            data-testid="settings-update-check"
            disabled={checking}
            onClick={() => { void check() }}
          >
            {checking ? t('settings.updateChecking') : t('settings.updateCheck')}
          </button>
        </div>
        <p className="settings-muted" data-testid="settings-update-state">{updateText}</p>
      </section>

      <section className="settings-section lg-glass-card" data-testid="settings-about">
        <header className="settings-section-head">
          <div>
            <h3>{t('settings.about')}</h3>
            <p>{version === null ? t('settings.loading') : t('settings.aboutVersion', { version })}</p>
          </div>
        </header>
        {hostUrl === null ? null : <p className="settings-muted">{t('settings.aboutHost', { url: hostUrl })}</p>}
      </section>
    </section>
  )
}
