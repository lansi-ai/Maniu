/** 设置页：只读模型服务、外观、字体、语言、手动更新与关于。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, ListBox, Select, Separator, Switch } from '@heroui/react'
import { Globe, Info, Moon, Palette, RefreshCw, Sun, Type } from 'lucide-react'
import type { LocaleId, MessageKey, Translate } from '../locale.ts'
import { APPEARANCES, FONTS, type AppearanceId, type FontId, type PreferencesHandle } from '../prefs.ts'
import { ModelPanel } from './model-panel.tsx'

/** 设置页属性。 */
export interface SettingsPageProps {
  readonly t: Translate
  readonly prefs: PreferencesHandle
}

/** 外观词典键。 */
const APPEARANCE_KEY: Readonly<Record<AppearanceId, MessageKey>> = {
  light: 'settings.appearanceLight',
  dark: 'settings.appearanceDark',
  system: 'settings.appearanceSystem',
}

/** 字体词典键。 */
const FONT_KEY: Readonly<Record<FontId, MessageKey>> = {
  system: 'settings.fontSystem',
  modern: 'settings.fontModern',
}

/** 语言词典键。 */
const LOCALE_KEY: Readonly<Record<LocaleId, MessageKey>> = {
  zh: 'settings.languageZh',
  en: 'settings.languageEn',
}

/**
 * 设置页。
 * @param props - 词典与偏好。
 * @returns Bento 分组卡片；外观、字体与语言直接写回 prefs。
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

  const selectFont = (key: unknown): void => {
    if (key !== 'system' && key !== 'modern') return
    prefs.setFont(key)
  }

  return (
    <section className="page settings-page" data-testid="page-settings">
      <header className="page-head">
        <div>
          <h2>{t('settings.title')}</h2>
          <p className="page-sub">{t('settings.subtitle')}</p>
        </div>
      </header>

      <div className="bento-grid">
        <ModelPanel t={t} />

        <Card className="bento-card bento-appearance" data-testid="settings-appearance">
          <Card.Header className="bento-card-head">
            <span className="bento-icon bento-icon-accent" aria-hidden="true"><Palette /></span>
            <div className="bento-heading">
              <Card.Title>{t('settings.appearance')}</Card.Title>
              <Card.Description>{t('settings.skinHint')}</Card.Description>
            </div>
            <div className="appearance-quick" role="group" aria-label={t('settings.skin')}>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={prefs.skin === 'light' ? 'quick-mode gradient-primary' : 'quick-mode'}
                data-testid="settings-quick-light"
                aria-label={t('settings.appearanceLight')}
                onPress={() => { prefs.setSkin('light') }}
              >
                <Sun />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={prefs.skin === 'dark' ? 'quick-mode gradient-primary' : 'quick-mode'}
                data-testid="settings-quick-dark"
                aria-label={t('settings.appearanceDark')}
                onPress={() => { prefs.setSkin('dark') }}
              >
                <Moon />
              </Button>
            </div>
          </Card.Header>
          <Separator className="bento-divider" />
          <Card.Content className="bento-card-body">
            <div className="bento-row">
              <span className="settings-label">{t('settings.skin')}</span>
              <div className="bento-segments" role="group" aria-label={t('settings.skin')}>
                {APPEARANCES.map(appearance => (
                  <Button
                    key={appearance}
                    className={
                      prefs.skin === appearance
                        ? 'bento-segment active gradient-primary'
                        : 'bento-segment'
                    }
                    data-testid={`settings-appearance-${appearance}`}
                    aria-pressed={prefs.skin === appearance}
                    variant={prefs.skin === appearance ? 'primary' : 'secondary'}
                    size="sm"
                    onPress={() => { prefs.setSkin(appearance) }}
                  >
                    {t(APPEARANCE_KEY[appearance])}
                  </Button>
                ))}
              </div>
            </div>
            <div className="bento-row">
              <span className="settings-label">{t('settings.appearanceSystem')}</span>
              <Switch
                className="bento-switch"
                size="lg"
                isSelected={prefs.skin === 'system'}
                onChange={(selected) => { prefs.setSkin(selected ? 'system' : 'dark') }}
              >
                <Switch.Control><Switch.Thumb /></Switch.Control>
                <Switch.Content data-testid="settings-follow-system" aria-label={t('settings.appearanceSystem')} />
              </Switch>
            </div>
          </Card.Content>
        </Card>

        <Card className="bento-card bento-font" data-testid="settings-font-card">
          <Card.Header className="bento-card-head">
            <span className="bento-icon bento-icon-violet" aria-hidden="true"><Type /></span>
            <div className="bento-heading">
              <Card.Title>{t('settings.font')}</Card.Title>
              <Card.Description>{t('settings.fontHint')}</Card.Description>
            </div>
          </Card.Header>
          <Separator className="bento-divider" />
          <Card.Content className="bento-card-body">
            <Select
              className="bento-select"
              data-testid="settings-font-select"
              value={prefs.font}
              onChange={selectFont}
              aria-label={t('settings.font')}
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {FONTS.map(font => (
                    <ListBox.Item key={font} id={font} data-testid={`settings-font-${font}`}>
                      {t(FONT_KEY[font])}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </Card.Content>
        </Card>

        <Card className="bento-card bento-language" data-testid="settings-language-card">
          <Card.Header className="bento-card-head">
            <span className="bento-icon bento-icon-teal" aria-hidden="true"><Globe /></span>
            <div className="bento-heading">
              <Card.Title>{t('settings.language')}</Card.Title>
              <Card.Description>{t('settings.languageHint')}</Card.Description>
            </div>
          </Card.Header>
          <Separator className="bento-divider" />
          <Card.Content className="bento-card-body">
            <div className="bento-row">
              <span className="settings-label">{t('settings.language')}</span>
              <div className="bento-segments" role="group" aria-label={t('settings.language')}>
                {(['zh', 'en'] as const).map(locale => (
                  <Button
                    key={locale}
                    className={
                      prefs.locale === locale
                        ? 'bento-segment active gradient-primary'
                        : 'bento-segment'
                    }
                    data-testid={`settings-locale-${locale}`}
                    aria-pressed={prefs.locale === locale}
                    variant={prefs.locale === locale ? 'primary' : 'secondary'}
                    size="sm"
                    onPress={() => { prefs.setLocale(locale) }}
                  >
                    {t(LOCALE_KEY[locale])}
                  </Button>
                ))}
              </div>
            </div>
          </Card.Content>
        </Card>

        <Card className="bento-card bento-update" data-testid="settings-update">
          <Card.Header className="bento-card-head">
            <span className="bento-icon bento-icon-amber" aria-hidden="true"><RefreshCw /></span>
            <div className="bento-heading">
              <Card.Title>{t('settings.update')}</Card.Title>
              <Card.Description>{t('settings.updateHint')}</Card.Description>
            </div>
          </Card.Header>
          <Separator className="bento-divider" />
          <Card.Content className="bento-card-body">
            <div className="bento-row">
              <span className="settings-label" data-testid="settings-version">
                {version === null ? t('settings.loading') : t('settings.updateCurrent', { version })}
              </span>
            </div>
            <p className="settings-muted" data-testid="settings-update-state">{t('settings.updateManual')}</p>
          </Card.Content>
        </Card>

        <Card className="bento-card bento-about" data-testid="settings-about">
          <Card.Header className="bento-card-head">
            <span className="bento-icon bento-icon-slate" aria-hidden="true"><Info /></span>
            <div className="bento-heading">
              <Card.Title>{t('settings.about')}</Card.Title>
              <Card.Description>{version === null ? t('settings.loading') : t('settings.aboutVersion', { version })}</Card.Description>
            </div>
          </Card.Header>
          <Separator className="bento-divider" />
          <Card.Content className="bento-card-body">
            {hostUrl === null ? null : <p className="settings-muted">{t('settings.aboutHost', { url: hostUrl })}</p>}
          </Card.Content>
        </Card>
      </div>
    </section>
  )
}
