/** 设置页：只读模型服务、外观、语言、手动更新与关于。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { MessageKey, Translate } from '../locale.ts'
import { FONTS, SKINS, type FontId, type PreferencesHandle, type SkinId } from '../prefs.ts'
import { ModelPanel } from './model-panel.tsx'

/** 设置页属性。 */
export interface SettingsPageProps {
  readonly t: Translate
  readonly prefs: PreferencesHandle
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
 * @param props - 词典与偏好。
 * @returns 整页设置。
 */
export function SettingsPage({ t, prefs }: SettingsPageProps): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [hostUrl, setHostUrl] = useState<string | null>(null)

  useEffect(() => {
    void window.lcoder.appInfo().then((info) => {
      setVersion(info.version)
      setHostUrl(info.hostUrl ?? null)
    }).catch(() => undefined)
  }, [])

  return (
    <section className="page" data-testid="page-settings">
      <header className="page-head">
        <div>
          <h2>{t('settings.title')}</h2>
          <p className="page-sub">{t('settings.subtitle')}</p>
        </div>
      </header>

      <ModelPanel t={t} />

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
        </div>
        <p className="settings-muted" data-testid="settings-update-state">{t('settings.updateManual')}</p>
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
