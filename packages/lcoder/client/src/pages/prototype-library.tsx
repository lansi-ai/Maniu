/** 原型库页：内置 4 套组件素材库浏览、实时沙箱预览、设为默认与自定义库新建/复制/编辑/删除。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip, Modal, Separator, useOverlayState } from '@heroui/react'
import { Check, Copy, Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import { translate, type Translate } from '../locale.ts'
import {
  createCustomLibrary,
  DEFAULT_PROTOTYPE_LIBRARY_ID,
  deleteCustomLibrary,
  effectivePreviewHtml,
  parseCommaList,
  resolveLibraryCopy,
  resolvePrototypeLibrary,
  setDefaultPrototypeLibraryId,
  updateCustomLibrary,
  usePrototypeLibraryState,
  type PrototypeLibrary,
  type PrototypeLibraryDraft,
} from '../prototype/libraries.ts'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 弹窗打开模式：新建、复制既有库或编辑自定义库。 */
type ModalMode =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'duplicate'; readonly source: PrototypeLibrary }
  | { readonly kind: 'edit'; readonly target: PrototypeLibrary }

interface FormState {
  readonly name: string
  readonly summary: string
  readonly tagsText: string
  readonly paletteText: string
  readonly designTokens: string
  readonly componentGuidelines: string
  readonly previewHtml: string
}

const EMPTY_FORM: FormState = {
  name: '',
  summary: '',
  tagsText: '',
  paletteText: '#6366F1, #F97316, #0F172A, #E2E8F0',
  designTokens: '',
  componentGuidelines: '',
  previewHtml: '',
}

/** 原型库页属性。 */
export interface PrototypeLibraryPageProps {
  readonly t?: Translate | undefined
}

/**
 * 原型库页面：左侧展示全部组件素材库卡片，右侧提供沙箱预览与 Design Tokens / 组件规范详情。
 * @param props - 本地化取词函数。
 * @returns 原型库主视图与编辑弹窗。
 */
export function PrototypeLibraryPage(props: PrototypeLibraryPageProps): JSX.Element {
  const t = props.t ?? zhText
  const state = usePrototypeLibraryState()
  const [selectedId, setSelectedId] = useState<string>(state.defaultLibraryId)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode>({ kind: 'closed' })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const selected = resolvePrototypeLibrary(selectedId, state)
  const selectedCopy = resolveLibraryCopy(selected, t)

  useEffect(() => {
    if (!state.libraries.some(lib => lib.id === selectedId)) {
      setSelectedId(state.defaultLibraryId || DEFAULT_PROTOTYPE_LIBRARY_ID)
    }
  }, [selectedId, state.defaultLibraryId, state.libraries])

  const overlayState = useOverlayState({
    isOpen: modal.kind !== 'closed',
    onOpenChange: (open) => {
      if (!open) {
        setModal({ kind: 'closed' })
        setFormError(null)
      }
    },
  })

  const openCreate = (): void => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setModal({ kind: 'create' })
  }

  const openDuplicate = (source: PrototypeLibrary): void => {
    const copy = resolveLibraryCopy(source, t)
    setForm({
      name: `${copy.name}${t('protoLib.copySuffix')}`,
      summary: copy.summary,
      tagsText: copy.tags.join(', '),
      paletteText: source.palette.join(', '),
      designTokens: source.designTokens,
      componentGuidelines: source.componentGuidelines,
      previewHtml: source.previewHtml,
    })
    setFormError(null)
    setModal({ kind: 'duplicate', source })
  }

  const openEdit = (target: PrototypeLibrary): void => {
    setForm({
      name: target.name,
      summary: target.summary,
      tagsText: target.tags.join(', '),
      paletteText: target.palette.join(', '),
      designTokens: target.designTokens,
      componentGuidelines: target.componentGuidelines,
      previewHtml: target.previewHtml,
    })
    setFormError(null)
    setModal({ kind: 'edit', target })
  }

  const handleSave = (): void => {
    const trimmedName = form.name.trim()
    if (trimmedName === '') {
      setFormError(t('protoLib.errorNameRequired'))
      return
    }
    if (form.designTokens.trim() === '') {
      setFormError(t('protoLib.errorTokensRequired'))
      return
    }
    if (form.componentGuidelines.trim() === '') {
      setFormError(t('protoLib.errorGuidelinesRequired'))
      return
    }
    const draft: PrototypeLibraryDraft = {
      name: trimmedName,
      summary: form.summary.trim(),
      tags: parseCommaList(form.tagsText),
      palette: parseCommaList(form.paletteText),
      designTokens: form.designTokens.trim(),
      componentGuidelines: form.componentGuidelines.trim(),
      previewHtml: form.previewHtml,
    }
    if (modal.kind === 'edit') {
      updateCustomLibrary(modal.target.id, draft)
      setSelectedId(modal.target.id)
    } else {
      const { created } = createCustomLibrary(draft)
      setSelectedId(created.id)
    }
    setFormError(null)
    setModal({ kind: 'closed' })
  }

  const handleSetDefault = (id: string): void => {
    setDefaultPrototypeLibraryId(id)
    setSelectedId(id)
  }

  const handleConfirmDelete = (id: string): void => {
    const next = deleteCustomLibrary(id)
    setConfirmDeleteId(null)
    if (selectedId === id) {
      setSelectedId(next.defaultLibraryId)
    }
  }

  const modalHeading = modal.kind === 'edit'
    ? t('protoLib.modalEditTitle', { name: modal.target.name })
    : modal.kind === 'duplicate'
      ? t('protoLib.modalDuplicateTitle')
      : t('protoLib.modalCreateTitle')

  const previewDoc = effectivePreviewHtml(selected, selectedCopy)

  return (
    <section className="page proto-lib-page" data-testid="page-prototype-library">
      <header className="page-head">
        <div>
          <h2>{t('protoLib.title')}</h2>
          <p className="page-sub">{t('protoLib.subtitle')}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            size="sm"
            data-testid="proto-lib-create"
            onPress={openCreate}
          >
            <Plus size={14} aria-hidden="true" />
            {t('protoLib.create')}
          </Button>
        </div>
      </header>

      <div className="proto-lib-layout">
        <aside className="proto-lib-sidebar" aria-label={t('protoLib.listHeading', { count: state.libraries.length })}>
          <div className="proto-lib-list-head">
            <span>{t('protoLib.listHeading', { count: state.libraries.length })}</span>
          </div>
          <div className="proto-lib-list" data-testid="proto-lib-list">
            {state.libraries.map((lib) => {
              const copy = resolveLibraryCopy(lib, t)
              const isSelected = selected.id === lib.id
              const isDefault = state.defaultLibraryId === lib.id
              const isConfirmingDelete = confirmDeleteId === lib.id
              return (
                <article
                  key={lib.id}
                  className={isSelected ? 'proto-lib-card-shell selected' : 'proto-lib-card-shell'}
                  data-testid="proto-lib-card"
                  data-library-id={lib.id}
                  data-builtin={lib.builtin ? 'true' : 'false'}
                  data-selected={isSelected ? 'true' : 'false'}
                  onClick={() => { setSelectedId(lib.id) }}
                >
                  <Card className={isSelected ? 'info-card proto-lib-card active' : 'info-card proto-lib-card'}>
                    <Card.Header className="proto-lib-card-head">
                      <div className="proto-lib-card-title-row">
                        <Card.Title className="proto-lib-card-title">{copy.name}</Card.Title>
                        <div className="proto-lib-badges">
                          <Chip
                            size="sm"
                            variant="soft"
                            color={lib.builtin ? 'accent' : 'default'}
                            data-testid="proto-lib-kind-badge"
                          >
                            {lib.builtin ? t('protoLib.badgeBuiltin') : t('protoLib.badgeCustom')}
                          </Chip>
                          {isDefault && (
                            <Chip
                              size="sm"
                              variant="soft"
                              color="success"
                              data-testid="proto-lib-default-badge"
                            >
                              {t('protoLib.badgeDefault')}
                            </Chip>
                          )}
                        </div>
                      </div>
                    </Card.Header>
                    <Card.Content className="proto-lib-card-body">
                      {copy.summary !== '' && (
                        <p className="proto-lib-summary">{copy.summary}</p>
                      )}
                      <div className="proto-lib-palette" aria-label={t('protoLib.paletteTitle')}>
                        {lib.palette.map((color, index) => (
                          <span
                            key={`${lib.id}-swatch-${String(index)}`}
                            className="proto-lib-swatch"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      {copy.tags.length > 0 && (
                        <div className="proto-lib-tags" aria-label={t('protoLib.tagsTitle')}>
                          {copy.tags.map(tag => (
                            <span key={tag} className="tag proto-lib-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </Card.Content>
                    <Card.Footer className="proto-lib-card-actions" onClick={(event) => { event.stopPropagation() }}>
                      {isConfirmingDelete ? (
                        <div className="proto-lib-delete-confirm-bar" data-testid="proto-lib-delete-confirm-bar">
                          <span className="proto-lib-delete-hint">{t('protoLib.deleteHint')}</span>
                          <div className="proto-lib-action-group">
                            <Button
                              size="sm"
                              variant="danger"
                              data-testid="proto-lib-delete-confirm"
                              onPress={() => { handleConfirmDelete(lib.id) }}
                            >
                              {t('protoLib.deleteConfirm')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid="proto-lib-delete-cancel"
                              onPress={() => { setConfirmDeleteId(null) }}
                            >
                              {t('protoLib.deleteCancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant={isDefault ? 'ghost' : 'secondary'}
                            data-testid="proto-lib-set-default"
                            isDisabled={isDefault}
                            onPress={() => { handleSetDefault(lib.id) }}
                          >
                            {isDefault ? <Check size={12} aria-hidden="true" /> : <Star size={12} aria-hidden="true" />}
                            {isDefault ? t('protoLib.isDefault') : t('protoLib.setDefault')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid="proto-lib-duplicate"
                            onPress={() => { openDuplicate(lib) }}
                          >
                            <Copy size={12} aria-hidden="true" />
                            {t('protoLib.duplicate')}
                          </Button>
                          {!lib.builtin && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="proto-lib-edit"
                                onPress={() => { openEdit(lib) }}
                              >
                                <Pencil size={12} aria-hidden="true" />
                                {t('protoLib.edit')}
                              </Button>
                              <Button
                                size="sm"
                                variant="danger-soft"
                                data-testid="proto-lib-delete"
                                onPress={() => { setConfirmDeleteId(lib.id) }}
                              >
                                <Trash2 size={12} aria-hidden="true" />
                                {t('protoLib.delete')}
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </Card.Footer>
                  </Card>
                </article>
              )
            })}
          </div>
        </aside>

        <section className="proto-lib-detail info-card" data-testid="proto-lib-detail" data-library-id={selected.id}>
          <header className="proto-lib-detail-head">
            <div className="proto-lib-detail-title-wrap">
              <div className="proto-lib-detail-title-row">
                <h3 data-testid="proto-lib-detail-name">{selectedCopy.name}</h3>
                <Chip size="sm" variant="soft" color={selected.builtin ? 'accent' : 'default'}>
                  {selected.builtin ? t('protoLib.badgeBuiltin') : t('protoLib.badgeCustom')}
                </Chip>
                {state.defaultLibraryId === selected.id && (
                  <Chip size="sm" variant="soft" color="success">
                    {t('protoLib.badgeDefault')}
                  </Chip>
                )}
              </div>
              {selectedCopy.summary !== '' && (
                <p className="detail-line proto-lib-detail-summary">{selectedCopy.summary}</p>
              )}
            </div>
            <div className="proto-lib-detail-actions">
              {state.defaultLibraryId !== selected.id && (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="proto-lib-detail-set-default"
                  onPress={() => { handleSetDefault(selected.id) }}
                >
                  <Star size={13} aria-hidden="true" />
                  {t('protoLib.setDefault')}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                data-testid="proto-lib-detail-duplicate"
                onPress={() => { openDuplicate(selected) }}
              >
                <Copy size={13} aria-hidden="true" />
                {t('protoLib.duplicate')}
              </Button>
              {!selected.builtin && (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="proto-lib-detail-edit"
                  onPress={() => { openEdit(selected) }}
                >
                  <Pencil size={13} aria-hidden="true" />
                  {t('protoLib.edit')}
                </Button>
              )}
            </div>
          </header>

          <Separator className="proto-lib-divider" />

          <div className="proto-lib-preview-box">
            <div className="proto-lib-section-head">
              <h4>{t('protoLib.previewTitle')}</h4>
              <span className="proto-lib-preview-note">{t('protoLib.previewNote')}</span>
            </div>
            <iframe
              title={selectedCopy.name}
              className="proto-lib-iframe"
              data-testid="proto-lib-preview-iframe"
              sandbox=""
              srcDoc={previewDoc}
            />
          </div>

          <div className="proto-lib-spec-grid">
            <div className="proto-lib-spec-block" data-testid="proto-lib-tokens">
              <h4>{t('protoLib.tokensTitle')}</h4>
              <pre className="proto-lib-code">{selected.designTokens}</pre>
            </div>
            <div className="proto-lib-spec-block" data-testid="proto-lib-guidelines">
              <h4>{t('protoLib.guidelinesTitle')}</h4>
              <pre className="proto-lib-code">{selected.componentGuidelines}</pre>
            </div>
          </div>
        </section>
      </div>

      <Modal.Root state={overlayState}>
        <Modal.Backdrop isDismissable variant="transparent" className="glass-modal-backdrop">
          <Modal.Container placement="center" size="lg" className="glass-modal">
            <Modal.Dialog className="glass-modal-panel proto-lib-modal-panel" data-testid="proto-lib-modal">
              <Modal.Header>
                <Modal.Heading>{modalHeading}</Modal.Heading>
                <Modal.CloseTrigger data-testid="proto-lib-modal-close" aria-label={t('protoLib.modalClose')} />
              </Modal.Header>
              <Modal.Body>
                <div className="proto-lib-form">
                  <div className="proto-lib-form-grid">
                    <label className="proto-lib-field">
                      <span>{t('protoLib.fieldName')}</span>
                      <input
                        className="proto-lib-input"
                        data-testid="proto-lib-form-name"
                        value={form.name}
                        placeholder={t('protoLib.fieldNamePlaceholder')}
                        onChange={(event) => { setForm(current => ({ ...current, name: event.target.value })) }}
                      />
                    </label>
                    <label className="proto-lib-field">
                      <span>{t('protoLib.fieldTags')}</span>
                      <input
                        className="proto-lib-input"
                        data-testid="proto-lib-form-tags"
                        value={form.tagsText}
                        placeholder={t('protoLib.fieldTagsPlaceholder')}
                        onChange={(event) => { setForm(current => ({ ...current, tagsText: event.target.value })) }}
                      />
                    </label>
                  </div>

                  <div className="proto-lib-form-grid">
                    <label className="proto-lib-field">
                      <span>{t('protoLib.fieldSummary')}</span>
                      <input
                        className="proto-lib-input"
                        data-testid="proto-lib-form-summary"
                        value={form.summary}
                        placeholder={t('protoLib.fieldSummaryPlaceholder')}
                        onChange={(event) => { setForm(current => ({ ...current, summary: event.target.value })) }}
                      />
                    </label>
                    <label className="proto-lib-field">
                      <span>{t('protoLib.fieldPalette')}</span>
                      <input
                        className="proto-lib-input"
                        data-testid="proto-lib-form-palette"
                        value={form.paletteText}
                        placeholder={t('protoLib.fieldPalettePlaceholder')}
                        onChange={(event) => { setForm(current => ({ ...current, paletteText: event.target.value })) }}
                      />
                    </label>
                  </div>

                  <label className="proto-lib-field">
                    <span>{t('protoLib.fieldTokens')}</span>
                    <textarea
                      className="proto-lib-textarea"
                      data-testid="proto-lib-form-tokens"
                      rows={4}
                      value={form.designTokens}
                      placeholder={t('protoLib.fieldTokensPlaceholder')}
                      onChange={(event) => { setForm(current => ({ ...current, designTokens: event.target.value })) }}
                    />
                  </label>

                  <label className="proto-lib-field">
                    <span>{t('protoLib.fieldGuidelines')}</span>
                    <textarea
                      className="proto-lib-textarea"
                      data-testid="proto-lib-form-guidelines"
                      rows={4}
                      value={form.componentGuidelines}
                      placeholder={t('protoLib.fieldGuidelinesPlaceholder')}
                      onChange={(event) => { setForm(current => ({ ...current, componentGuidelines: event.target.value })) }}
                    />
                  </label>

                  <label className="proto-lib-field">
                    <span>{t('protoLib.fieldPreview')}</span>
                    <textarea
                      className="proto-lib-textarea mono"
                      data-testid="proto-lib-form-preview"
                      rows={4}
                      value={form.previewHtml}
                      placeholder={t('protoLib.fieldPreviewPlaceholder')}
                      onChange={(event) => { setForm(current => ({ ...current, previewHtml: event.target.value })) }}
                    />
                  </label>

                  {formError !== null && (
                    <p className="problem" data-testid="proto-lib-form-error">{formError}</p>
                  )}

                  <div className="proto-lib-modal-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="proto-lib-form-cancel"
                      onPress={() => { setModal({ kind: 'closed' }); setFormError(null) }}
                    >
                      {t('protoLib.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="proto-lib-form-submit"
                      onPress={handleSave}
                    >
                      <Sparkles size={13} aria-hidden="true" />
                      {t('protoLib.save')}
                    </Button>
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </section>
  )
}
