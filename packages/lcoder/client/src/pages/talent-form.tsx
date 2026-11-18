/** 人才新建/编辑表单：名称、人设、基础 preset、已装插件、工具白名单、模型与预算。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Separator } from '@heroui/react'
import type { Translate } from '../locale.ts'
import { loadModelSettings, type ModelSnapshot } from '../settings/model-settings.ts'
import { loadPresetTools } from '../talents/api.ts'
import type {
  TalentCatalogView, TalentConfigView, TalentPluginView, TalentRow, TalentToolView,
} from '../talents/model.ts'

/** 表单提交的字段。 */
export interface TalentFormValue {
  readonly name: string
  readonly description: string
  readonly config: TalentConfigView
}

/** 表单属性。 */
export interface TalentFormProps {
  readonly t: Translate
  readonly catalog: TalentCatalogView
  readonly scope: 'global' | 'project'
  /** 编辑时的人才；新建为 null。 */
  readonly initial: TalentRow | null
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (value: TalentFormValue) => Promise<string | null>
}

function toggle(values: readonly string[], name: string): string[] {
  return values.includes(name) ? values.filter(value => value !== name) : [...values, name]
}

function integerOf(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : Number.NaN
}

/**
 * 人才表单。
 * @param props - 词典、清单、初值与保存动作。
 * @returns 表单。
 */
export function TalentForm(props: TalentFormProps): JSX.Element {
  const { t, catalog, scope, initial, busy } = props
  const config = initial?.config
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [persona, setPersona] = useState(config?.persona ?? '')
  const [basePreset, setBasePreset] = useState(config?.basePreset ?? '')
  const [plugins, setPlugins] = useState<readonly TalentPluginView[]>(config?.plugins ?? [])
  const [tools, setTools] = useState<readonly TalentToolView[]>([])
  const [loadedPreset, setLoadedPreset] = useState<string | null>(null)
  const [toolsProblem, setToolsProblem] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<readonly string[]>(config?.tools ?? [])
  const [filter, setFilter] = useState('')
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [provider, setProvider] = useState(config?.model?.provider ?? '')
  const [modelId, setModelId] = useState(config?.model?.modelId ?? '')
  const [cost, setCost] = useState(config?.budget?.maxCostMicroUsd === undefined ? '' : String(config.budget.maxCostMicroUsd))
  const [requests, setRequests] = useState(
    config?.budget?.maxRequestsPerSession === undefined ? '' : String(config.budget.maxRequestsPerSession),
  )
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void loadModelSettings().then((value) => {
      setSnapshot(value)
      setModelError(value.status === 'error' ? value.error : null)
    })
  }, [])

  useEffect(() => {
    setTools([])
    setToolsProblem(null)
    setLoadedPreset(null)
    if (basePreset === '') return
    let disposed = false
    void loadPresetTools(basePreset).then((answer) => {
      if (disposed) return
      if (!answer.ok) {
        setToolsProblem(`${answer.code}: ${answer.message}`)
        setLoadedPreset(basePreset)
        return
      }
      setTools(answer.value.tools)
      setToolsProblem(answer.value.broken ?? null)
      setLoadedPreset(basePreset)
    })
    return () => { disposed = true }
  }, [basePreset])

  useEffect(() => {
    if (loadedPreset === null || loadedPreset !== basePreset) return
    setSelectedTools(current => current.filter(name => tools.some(tool => tool.name === name)))
  }, [basePreset, loadedPreset, tools])

  const providers = snapshot?.rows.filter(row => row.models.length > 0) ?? []
  const providerModels = providers.find(row => row.provider === provider)?.models ?? []
  const selectedNames = plugins.map(plugin => plugin.name)
  const visiblePlugins = filter.trim() === ''
    ? catalog.plugins
    : catalog.plugins.filter(plugin => plugin.name.toLowerCase().includes(filter.trim().toLowerCase()))

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setProblem(t('talents.invalidName'))
      return
    }
    const maxCost = cost.trim() === '' ? undefined : integerOf(cost)
    if (typeof maxCost === 'number' && (!Number.isFinite(maxCost) || maxCost < 0)) {
      setProblem(t('talents.invalidCost'))
      return
    }
    const maxRequests = requests.trim() === '' ? undefined : integerOf(requests)
    if (typeof maxRequests === 'number' && (!Number.isFinite(maxRequests) || maxRequests < 1)) {
      setProblem(t('talents.invalidRequests'))
      return
    }
    const model = provider !== '' && modelId !== '' ? { provider, modelId } : undefined
    const budget = maxCost === undefined && maxRequests === undefined
      ? undefined
      : {
        ...maxCost === undefined ? {} : { maxCostMicroUsd: maxCost },
        ...maxRequests === undefined ? {} : { maxRequestsPerSession: maxRequests },
      }
    const next: TalentConfigView = {
      version: 1,
      ...basePreset === '' ? {} : { basePreset },
      ...persona.trim() === '' ? {} : { persona: persona.trim() },
      ...plugins.length === 0 ? {} : { plugins },
      ...selectedTools.length === 0 ? {} : { tools: selectedTools },
      ...model === undefined ? {} : { model },
      ...budget === undefined ? {} : { budget },
    }
    setProblem(null)
    const failure = await props.onSave({ name: trimmed, description: description.trim(), config: next })
    if (failure !== null) setProblem(failure)
  }

  return (
    <section className="talent-form" data-testid="talent-form" data-scope={scope}>
      <header className="settings-section-head">
        <div>
          <h3>{initial === null
            ? scope === 'global' ? t('talents.formNewGlobal') : t('talents.formNewProject')
            : t('talents.formEdit', { name: initial.name })}</h3>
          <p>{scope === 'global' ? t('talents.globalHint') : t('talents.projectHint')}</p>
        </div>
      </header>

      {problem === null ? null : <p className="problem" data-testid="talent-form-problem">{problem}</p>}

      <Card className="talent-form-group">
        <Card.Header className="talent-form-group-head">
          <Card.Title>{t('talents.name')}</Card.Title>
          <Card.Description>{t('talents.namePlaceholder')}</Card.Description>
        </Card.Header>
        <Separator />
        <Card.Content className="talent-form-group-body">
          <div className="talent-form-grid">
            <label className="talent-field">
              <span>{t('talents.name')}</span>
              <input
                className="settings-input"
                data-testid="talent-name"
                value={name}
                maxLength={80}
                placeholder={t('talents.namePlaceholder')}
                onChange={(event) => { setName(event.target.value) }}
              />
            </label>
            <label className="talent-field">
              <span>{t('talents.basePreset')}</span>
              <select
                className="settings-select"
                data-testid="talent-base-preset"
                value={basePreset}
                onChange={(event) => { setBasePreset(event.target.value) }}
              >
                <option value="">{t('talents.basePresetFollow')}</option>
                {catalog.presets.map(preset => (
                  <option key={preset.id} value={preset.id} disabled={preset.broken !== undefined}>
                    {preset.name ?? preset.id}{preset.broken === undefined ? '' : ` · ${t('talents.presetBroken')}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="talent-field">
            <span>{t('talents.description')}</span>
            <input
              className="settings-input"
              data-testid="talent-description"
              value={description}
              maxLength={2000}
              placeholder={t('talents.descriptionPlaceholder')}
              onChange={(event) => { setDescription(event.target.value) }}
            />
          </label>
          <label className="talent-field">
            <span>{t('talents.persona')}</span>
            <textarea
              className="settings-input talent-persona"
              data-testid="talent-persona"
              value={persona}
              rows={4}
              placeholder={t('talents.personaPlaceholder')}
              onChange={(event) => { setPersona(event.target.value) }}
            />
          </label>
        </Card.Content>
      </Card>

      <Card className="talent-form-group">
        <Card.Header className="talent-form-group-head">
          <Card.Title>{t('talents.plugins')}</Card.Title>
          <Card.Description>{t('talents.tools')}</Card.Description>
        </Card.Header>
        <Separator />
        <Card.Content className="talent-form-group-body">
          <div className="talent-form-grid">
            <div className="talent-field">
              <span>{t('talents.plugins')}</span>
              <input
                className="settings-input"
                data-testid="talent-plugin-filter"
                value={filter}
                placeholder={t('talents.pluginsFilter')}
                onChange={(event) => { setFilter(event.target.value) }}
              />
              <div className="talent-checks" data-testid="talent-plugins">
                {visiblePlugins.map(plugin => (
                  <label key={plugin.name} className="talent-check">
                    <input
                      type="checkbox"
                      checked={selectedNames.includes(plugin.name)}
                      onChange={() => {
                        setPlugins(current => current.some(row => row.name === plugin.name)
                          ? current.filter(row => row.name !== plugin.name)
                          : [...current, { name: plugin.name }])
                      }}
                    />
                    <span className="mono">{plugin.name}</span>
                    {plugin.version === undefined ? null : <em>{plugin.version}</em>}
                  </label>
                ))}
                {visiblePlugins.length === 0 ? <p className="empty">{t('talents.pluginsEmpty')}</p> : null}
              </div>
              <p className="settings-muted">{t('talents.pluginsHint')}</p>
            </div>

            <div className="talent-field">
              <span>{t('talents.tools')}</span>
              {basePreset === '' ? <p className="empty">{t('talents.toolsNeedBase')}</p> : null}
              {toolsProblem === null ? null : <p className="problem">{t('talents.toolsUnavailable', { detail: toolsProblem })}</p>}
              <div className="talent-checks" data-testid="talent-tools">
                {tools.map(tool => (
                  <label key={tool.name} className="talent-check" title={tool.description}>
                    <input
                      type="checkbox"
                      checked={selectedTools.includes(tool.name)}
                      onChange={() => { setSelectedTools(current => toggle(current, tool.name)) }}
                    />
                    <span className="mono">{tool.name}</span>
                  </label>
                ))}
                {basePreset !== '' && tools.length === 0 && toolsProblem === null
                  ? <p className="empty">{t('talents.toolsEmpty')}</p> : null}
              </div>
              <p className="settings-muted">{t('talents.toolsHint')}</p>
            </div>
          </div>
        </Card.Content>
      </Card>

      <Card className="talent-form-group">
        <Card.Header className="talent-form-group-head">
          <Card.Title>{t('talents.model')}</Card.Title>
          <Card.Description>{t('talents.budget')}</Card.Description>
        </Card.Header>
        <Separator />
        <Card.Content className="talent-form-group-body">
          <div className="talent-form-grid">
            <div className="talent-field">
              <span>{t('talents.model')}</span>
              <select
                className="settings-select"
                data-testid="talent-model-provider"
                value={provider}
                onChange={(event) => {
                  const next = event.target.value
                  setProvider(next)
                  const row = providers.find(item => item.provider === next)
                  setModelId(row?.models[0]?.id ?? '')
                }}
              >
                <option value="">{t('talents.modelFollow')}</option>
                {providers.map(row => <option key={row.provider} value={row.provider}>{row.displayName}</option>)}
                {provider !== '' && !providers.some(row => row.provider === provider)
                  ? <option value={provider}>{provider}</option> : null}
              </select>
              <select
                className="settings-select"
                data-testid="talent-model-id"
                value={modelId}
                disabled={provider === ''}
                onChange={(event) => { setModelId(event.target.value) }}
              >
                {providerModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                {modelId !== '' && !providerModels.some(model => model.id === modelId)
                  ? <option value={modelId}>{modelId}</option> : null}
              </select>
              <p className="settings-muted">{modelError === null ? t('talents.modelHint') : t('talents.modelUnavailable', { detail: modelError })}</p>
            </div>

            <div className="talent-field">
              <span>{t('talents.budget')}</span>
              <label className="talent-inline">
                <span>{t('talents.budgetCost')}</span>
                <input
                  className="settings-input"
                  data-testid="talent-budget-cost"
                  inputMode="numeric"
                  value={cost}
                  placeholder={t('talents.budgetOptional')}
                  onChange={(event) => { setCost(event.target.value) }}
                />
              </label>
              <label className="talent-inline">
                <span>{t('talents.budgetRequests')}</span>
                <input
                  className="settings-input"
                  data-testid="talent-budget-requests"
                  inputMode="numeric"
                  value={requests}
                  placeholder={t('talents.budgetOptional')}
                  onChange={(event) => { setRequests(event.target.value) }}
                />
              </label>
              <p className="settings-muted">{t('talents.budgetHint')}</p>
            </div>
          </div>
        </Card.Content>
      </Card>

      <div className="talent-actions">
        <Button variant="secondary" data-testid="talent-cancel" isDisabled={busy} onPress={props.onCancel}>
          {t('talents.cancel')}
        </Button>
        <Button variant="primary" data-testid="talent-save" isDisabled={busy} onPress={() => { void save() }}>
          {busy ? t('talents.saving') : t('talents.save')}
        </Button>
      </div>
    </section>
  )
}
