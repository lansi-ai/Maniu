/**
 * 项目页：切换项目、项目信息与设置三张整页视图。
 *
 * 三页都占满主区域，与看板同级；数据与动作全部由外壳传入，页面只负责画。
 * 原右侧抽屉与设置模态的内容搬到这里，行为不变：切换工作区、打开仓库、
 * 揭示数据库密码、选皮肤与字体、展开专家名册。
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { ExpertPrompt, ExpertRow } from '../experts.ts'
import type { ShellProjectInfo } from './shell-data.ts'
import { ModelSettings } from './ModelSettings.tsx'
import type { ModelSettingsFace } from './model-settings.ts'
import { SKIN_LABEL, SKINS } from './skin.ts'
import type { Skin } from './skin.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 字体预设：A 系统、B 现代。 */
export type FontPreset = 'system' | 'modern'

/** 皮肤到设置页色块的配色。 */
const SKIN_SWATCH: Record<Skin, string | undefined> = {
  neon: css.skinSwatchNeon,
  silver: css.skinSwatchSilver,
  frost: css.skinSwatchFrost,
  rose: css.skinSwatchRose,
}

/** 切换项目页 props：工作区名册、仓库路径草稿与四个动作。 */
export interface SwitchProjectPageProps {
  readonly t: Translate
  readonly workspaces: readonly WorkspaceView[]
  /** 当前工作区标识；没有工作时为 null。 */
  readonly activeWorkspaceId: string | null
  /** 当前项目名；没有工作区时为 null，页头据此显示「选择项目」。 */
  readonly currentName: string | null
  readonly onSelect: (workspaceId: string) => void
  readonly repoPath: string
  readonly onRepoPath: (path: string) => void
  /** 桌面目录选择器可用时才画「浏览…」。 */
  readonly browsable: boolean
  readonly browsing: boolean
  readonly onBrowse: () => void
  /** 打开仓库回调存在时才允许提交。 */
  readonly openable: boolean
  readonly opening: boolean
  readonly onOpen: () => void
  readonly repoError: string | null
}

/**
 * 画切换项目页。
 * @param props - 工作区名册、当前标记与打开仓库动作。
 * @returns 整页的工作区列表与仓库路径入口。
 */
export function SwitchProjectPage({
  t, workspaces, activeWorkspaceId, currentName, onSelect,
  repoPath, onRepoPath, browsable, browsing, onBrowse, openable, opening, onOpen, repoError,
}: SwitchProjectPageProps): ReactNode {
  return (
    <div className={css.panelPage} data-lcoder-page="projects">
      <div className={css.panelHead}>
        <div className={css.grow}>
          <h2>{t('shell.switchProject')}</h2>
          <p className={css.panelHeadHint}>{t('shell.projectPickerHint')}</p>
        </div>
        <span className={css.pill}>{currentName ?? t('shell.chooseProject')}</span>
      </div>
      <section className={css.panelSection}>
        {workspaces.length === 0
          ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
          : (
            <div className={css.projectPicker}>
              {workspaces.map((item) => {
                const id = String(item.workspaceId)
                return (
                  <button
                    type="button"
                    key={id}
                    className={`${css.projectOption} ${id === activeWorkspaceId ? css.projectOptionActive : ''}`}
                    onClick={() => { onSelect(id) }}
                  >
                    <span className={css.psLogo}>{(item.title || 'L').slice(0, 1).toUpperCase()}</span>
                    <span className={css.poText}>
                      <span className={css.poName}>{item.title}</span>
                      <span className={css.poPath}>{item.path}</span>
                    </span>
                    <span className={css.poCount}>{item.sessionIds.length} {t('shell.sessions')}</span>
                    {id === activeWorkspaceId ? <span className={css.poCheck}>✓</span> : null}
                  </button>
                )
              })}
            </div>
          )}
      </section>
      <section className={css.panelSection} data-project-open>
        <div className={css.repoOpen}>
          <input
            className={css.repoInput}
            value={repoPath}
            placeholder={t('shell.repoPathHint')}
            onChange={(event) => { onRepoPath(event.target.value) }}
          />
          {!browsable ? null : (
            <button
              type="button"
              className={css.secondaryBtn}
              disabled={opening || browsing}
              onClick={onBrowse}
            >
              {t('shell.browse')}
            </button>
          )}
          <button
            type="button"
            className={css.primaryBtn}
            disabled={opening || !openable || repoPath.trim() === ''}
            onClick={onOpen}
          >
            {opening ? t('shell.opening') : t('shell.openRepo')}
          </button>
        </div>
        {repoError === null ? null : <p className={css.problem}>{repoError}</p>}
      </section>
    </div>
  )
}

/** 项目信息页 props：项目信息、规格根、计数与密码揭示状态。 */
export interface ProjectInfoPageProps {
  readonly t: Translate
  readonly info: ShellProjectInfo | null
  readonly specRoot: string
  readonly tasksCount: number
  readonly rulesCount: number
  readonly revealed: Readonly<Record<string, boolean>>
  readonly onToggleReveal: (key: string) => void
}

/**
 * 画项目信息页。
 * @param props - 项目信息、计数与密码揭示状态。
 * @returns 基本信息、文档与环境三节整页。
 */
export function ProjectInfoPage({
  t, info, specRoot, tasksCount, rulesCount, revealed, onToggleReveal,
}: ProjectInfoPageProps): ReactNode {
  return (
    <div className={css.panelPage} data-lcoder-page="project-info">
      <div className={css.panelHead}>
        <div className={css.grow}>
          <h2>{t('shell.projectInfo')}</h2>
          <p className={css.panelHeadHint}>{t('shell.projectInfoHint')}</p>
        </div>
      </div>
      <div className={css.panelSections}>
        <details className={css.panelSection}>
          <summary className={css.panelSectionSummary}>
            <span className={css.panelSectionTitle}>{t('shell.basic')}</span>
          </summary>
          <div className={css.infoGrid}>
            <div className={css.infoRow}><span>{t('shell.kind')}</span><b>{info?.kind ?? '—'}</b></div>
            <div className={css.infoRow}>
              <span>{t('shell.repoUrl')}</span>
              {info?.repoUrl === undefined || info.repoUrl === ''
                ? <b>—</b>
                : <a href={info.repoUrl} target="_blank" rel="noreferrer">{info.repoUrl}</a>}
            </div>
            <div className={css.infoRow}><span>{t('shell.branch')}</span><b>{info?.branch ?? '—'}</b></div>
            <div className={css.infoRow}><span>{t('shell.specRoot')}</span><code>{specRoot || '—'}</code></div>
            <div className={css.infoRow}><span>{t('shell.tasks')}</span><b>{tasksCount}</b></div>
            <div className={css.infoRow}><span>{t('shell.rules')}</span><b>{rulesCount}</b></div>
          </div>
        </details>

        <details className={css.panelSection}>
          <summary className={css.panelSectionSummary}>
            <span className={css.panelSectionTitle}>{t('shell.docs')}</span>
          </summary>
          <div className={css.docRow}><span>{t('shell.productDoc')}</span><code>{info?.docs.product || '—'}</code></div>
          <div className={css.docRow}><span>{t('shell.architectureDoc')}</span><code>{info?.docs.architecture || '—'}</code></div>
          <div className={css.docRow}><span>{t('shell.tests')}</span><code>{info?.docs.tests || '—'}</code></div>
        </details>

        <details className={css.panelSection}>
          <summary className={css.panelSectionSummary}>
            <span className={css.panelSectionTitle}>{t('shell.environments')}</span>
          </summary>
          {info === null
            ? <p className={css.empty}>{t('shell.projectInfoMissing')}</p>
            : info.kind !== 'web' || info.environments.length === 0
              ? <p className={css.empty}>{t('shell.webOnly')}</p>
              : info.environments.map((env) => {
                const database = env.database
                const passwordKey = `${env.id}.password`
                const shown = revealed[passwordKey] === true
                return (
                  <div key={env.id} className={css.envCard}>
                    <div className={css.envHead}>
                      <b>{env.label}</b>
                      <span className={css.pill}>{env.note ?? ''}</span>
                    </div>
                    <div className={css.infoRow}><span>{t('shell.server')}</span><code>{env.server ?? '—'}</code></div>
                    {database === undefined ? null : (
                      <>
                        <div className={css.infoRow}><span>{t('shell.dbHost')}</span><code>{database.host}:{database.port ?? '—'}</code></div>
                        <div className={css.infoRow}><span>{t('shell.dbName')}</span><code>{database.name}</code></div>
                        <div className={css.infoRow}><span>{t('shell.dbUser')}</span><code>{database.user}</code></div>
                        <div className={css.infoRow}>
                          <span>{t('shell.password')}</span>
                          <code>{shown ? (database.passwordValue ?? t('shell.unconfigured')) : '••••••'}</code>
                          <button
                            type="button"
                            className={css.eyeBtn}
                            title={shown ? t('shell.hide') : t('shell.reveal')}
                            onClick={() => { onToggleReveal(passwordKey) }}
                          >
                            {shown ? '🙈' : '👁'}
                          </button>
                        </div>
                        <div className={css.secretRef}>{database.passwordRef} · {t('shell.secretNote')}</div>
                      </>
                    )}
                  </div>
                )
              })}
        </details>
      </div>
    </div>
  )
}

/** 设置页 props：模型服务面、皮肤、字体与专家名册。 */
export interface SettingsPageProps {
  readonly t: Translate
  readonly specRoot: string
  readonly modelSettings?: ModelSettingsFace | undefined
  readonly sessionId?: SessionId | undefined
  readonly onModelsChanged: () => void
  readonly skin: Skin
  readonly onSkin: (skin: Skin) => void
  readonly fontPreset: FontPreset
  readonly onFontPreset: (preset: FontPreset) => void
  readonly expertsOpen: boolean
  readonly experts: readonly ExpertRow[]
  readonly expertPrompts: Readonly<Record<string, ExpertPrompt | null>>
  readonly shownExpert: string | null
  readonly onToggleExperts: () => void
  readonly onToggleExpert: (id: string) => void
  readonly onDone: () => void
}

/**
 * 画设置页。
 * @param props - 模型服务、皮肤、字体、专家与完成动作。
 * @returns 整页设置内容；没有遮罩与关闭按钮。
 */
export function SettingsPage({
  t, specRoot, modelSettings, sessionId, onModelsChanged,
  skin, onSkin, fontPreset, onFontPreset,
  expertsOpen, experts, expertPrompts, shownExpert, onToggleExperts, onToggleExpert, onDone,
}: SettingsPageProps): ReactNode {
  return (
    <div className={css.panelPage} data-lcoder-page="settings">
      <div className={css.panelHead}>
        <div className={css.grow}>
          <h2>{t('shell.settings')}</h2>
          <p className={css.panelHeadHint}>{t('shell.settingsHint')}</p>
        </div>
        <button type="button" className={css.primaryBtn} onClick={onDone}>{t('shell.done')}</button>
      </div>
      <div className={css.panelBody}>
        {modelSettings === undefined
          ? null
          : (
            <ModelSettings
              face={modelSettings}
              sessionId={sessionId}
              t={t}
              onChanged={onModelsChanged}
            />
          )}
        <div className={css.settingsGrid}>
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.specRoot')}</span>
              <span className={css.settingLabelSpan}>{specRoot || '—'}</span>
            </div>
            <span className={css.pill}>{t('shell.sessionBound')}</span>
          </div>
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.floating')}</span>
              <span className={css.settingLabelSpan}>{t('shell.floatingHint')}</span>
            </div>
            <button type="button" className={`${css.switch} ${css.switchOn}`} />
          </div>
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.skin')}</span>
              <span className={css.settingLabelSpan}>{t('shell.skinHint')}</span>
            </div>
            <div className={css.skinPresets} role="group" aria-label={t('shell.skin')}>
              {SKINS.map((value) => {
                const label = t(SKIN_LABEL[value])
                return (
                  <button
                    type="button"
                    key={value}
                    className={`${css.skinOption} ${skin === value ? css.skinOptionOn : ''}`}
                    aria-pressed={skin === value}
                    onClick={() => { onSkin(value) }}
                  >
                    <span
                      className={`${css.skinSwatch} ${SKIN_SWATCH[value] ?? ''}`}
                      aria-hidden="true"
                    />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.font')}</span>
              <span className={css.settingLabelSpan}>{t('shell.fontHint')}</span>
            </div>
            <div className={css.fontPresets} role="group" aria-label={t('shell.font')}>
              <button
                type="button"
                className={`${css.fontOption} ${fontPreset === 'system' ? css.fontOptionOn : ''}`}
                aria-pressed={fontPreset === 'system'}
                onClick={() => { onFontPreset('system') }}
              >
                {t('shell.fontSampleA')} {t('shell.fontSystem')}
              </button>
              <button
                type="button"
                className={`${css.fontOption} ${fontPreset === 'modern' ? css.fontOptionOn : ''}`}
                aria-pressed={fontPreset === 'modern'}
                onClick={() => { onFontPreset('modern') }}
              >
                {t('shell.fontSampleB')} {t('shell.fontModern')}
              </button>
            </div>
          </div>
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.experts')}</span>
              <span className={css.settingLabelSpan}>{t('shell.expertsHint')}</span>
            </div>
            <button type="button" className={css.filterChip} onClick={onToggleExperts}>
              {expertsOpen ? t('shell.expertsCollapse') : t('shell.expertsOpen')}
            </button>
          </div>
          {!expertsOpen ? null : (
            <div className={css.expertList}>
              {experts.length === 0
                ? <p className={css.secretRef}>{t('shell.expertsEmpty')}</p>
                : experts.map((expert) => {
                  const prompt = expertPrompts[expert.id]
                  return (
                    <div key={expert.id} className={css.expertItem}>
                      <button type="button" className={css.expertHead} onClick={() => { onToggleExpert(expert.id) }}>
                        <span className={css.expertName}>{expert.name}</span>
                        <span className={css.expertId}>{expert.id}</span>
                        {expert.broken === undefined ? null
                          : <span className={`${css.tag} ${css.tagDanger}`}>{t('shell.expertBroken')}</span>}
                      </button>
                      {expert.description === undefined ? null : <p className={css.expertDesc}>{expert.description}</p>}
                      {expert.broken === undefined ? null : <p className={css.problem}>{expert.broken}</p>}
                      {shownExpert !== expert.id ? null : prompt === undefined
                        ? <p className={css.secretRef}>{t('shell.expertLoading')}</p>
                        : prompt === null
                          ? <p className={css.problem}>{t('shell.expertReadFailed')}</p>
                          : (
                            <>
                              <p className={css.expertPrompt}>{prompt.prompt ?? t('shell.expertNoPersona')}</p>
                              <details className={css.expertDoc}>
                                <summary>{t('shell.expertDocument')}</summary>
                                <pre className={css.expertDocBody}>{prompt.document}</pre>
                              </details>
                            </>
                          )}
                    </div>
                  )
                })}
            </div>
          )}
          <div className={css.settingRow}>
            <div className={css.settingLabel}>
              <span className={css.settingLabelB}>{t('shell.plugins')}</span>
              <span className={css.settingLabelSpan}>{t('shell.onlySettings')}</span>
            </div>
            <span className={css.pill}>{t('shell.hidden')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
