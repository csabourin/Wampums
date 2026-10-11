/**
 * Form Builder Module
 *
 * Allows admins to create and edit form formats stored in organization_form_formats table
 * Supports drag-and-drop reordering, field management, conditional logic, and translations
 *
 * @module formBuilder
 */

import { debugLog, debugError } from './utils/DebugUtils.js';
import { API } from './api/api-core.js';
import { app, translate } from './app.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { JSONFormRenderer } from './JSONFormRenderer.js';
import { setContent, insertHTML } from './utils/DOMUtils.js';
import { openModal, closeModal } from './utils/ModalUtils.js';
import { BaseModule } from './utils/BaseModule.js';
import { confirmDestructive } from './utils/DialogUtils.js';
import { DEFAULT_LANG, FORM_CONTENT_LANGS } from './config/languages.js';
import {
  formInfoHtml,
  hasOwnText,
  resolveFormText,
  sanitizeRichText,
} from './utils/FormTextUtils.js';
import {
  attachRichTextEditor,
  getRichTextValue,
  richTextEditorHTML,
} from './modules/form-builder/RichTextEditor.js';

/** Field types whose answer can show or hide another field. */
const CONTROLLING_FIELD_TYPES = ['select', 'radio', 'checkbox'];

/** Value a checked checkbox is compared against (see FormDependencyUtils). */
const CHECKBOX_CHECKED_VALUE = 'yes';

/**
 * The two texts a field can carry in several languages: its label (plain
 * text, keyed by `label`) and an information text's content (rich text,
 * keyed by `infoText`).
 */
const FIELD_TEXT_KINDS = {
  labelText: { keyInput: 'field-label', keyProperty: 'label', rich: false },
  infoHtml: { keyInput: 'field-info-text', keyProperty: 'infoText', rich: true },
};

/**
 * The language the builder is shown in.
 *
 * @returns {string} Language code
 */
function builderLanguage() {
  return app?.lang || DEFAULT_LANG;
}

/**
 * A language's name in the builder's language ("italien", "Italian").
 *
 * @param {string} code - Language code
 * @returns {string} Display name, or the code when the browser cannot name it
 */
function languageName(code) {
  try {
    const name = new Intl.DisplayNames([builderLanguage()], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(builderLanguage()) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/**
 * FormBuilder class - Main form builder component
 */
export class FormBuilder extends BaseModule {
  constructor(app) {
    super(app);
    this.formFormats = [];
    this.userOrganizations = [];
    this.currentFormat = null;
    this.currentFields = [];
    this.draggedElement = null;
    this.draggedIndex = null;
  }

  /**
     * Initialize the form builder
     */
  async init() {
    debugLog('Initializing FormBuilder');
    await this.loadData();
    this.render();
    this.attachEventListeners();
  }

  /**
     * Load initial data
     */
  async loadData() {
    try {
      // Load form formats
      const formatsResponse = await API.get('v1/form-builder/form-formats');

      if (formatsResponse.success) {
        this.formFormats = formatsResponse.data || [];
      }

      // Load user organizations for copy functionality
      const orgsResponse = await API.get('v1/form-builder/user-organizations');

      if (orgsResponse.success) {
        this.userOrganizations = orgsResponse.data || [];
      }
    } catch (error) {
      debugError('Error loading form builder data:', error);
      this.app.showMessage(translate('error_loading_data'), 'error');
    }
  }

  /**
     * Render the main form builder UI
     */
  render() {
    const container = document.getElementById('app');
    setContent(container, `
            <div class="form-builder">
                <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
                <h1>${translate('form_builder_title')}</h1>
                
                <div class="form-builder-toolbar">
                    <button id="create-new-format" class="btn btn-primary">
                        ${translate('create_new_form_format')}
                    </button>
                </div>

                <div class="form-formats-list">
                    <h2>${translate('existing_form_formats')}</h2>
                    <div id="formats-list">
                        ${this.renderFormatsList()}
                    </div>
                </div>

                <div id="form-editor" class="form-editor" style="display: none;">
                    <!-- Form editor will be rendered here -->
                </div>
            </div>
        `);
  }

  /**
     * Render the list of existing form formats
     */
  renderFormatsList() {
    if (this.formFormats.length === 0) {
      return `<p class="no-data">${translate('no_form_formats_found')}</p>`;
    }

    return `
            <div class="formats-grid">
                ${this.formFormats.map(format => `
                    <div class="format-card" data-format-id="${format.id}">
                        <h3>${escapeHTML(format.form_type)}</h3>
                        <p class="format-meta">
                            ${translate('fields')}: ${format.form_structure?.fields?.length || 0}
                        </p>
                        <div class="format-actions">
                            <button class="btn btn-sm edit-format" data-format-id="${format.id}">
                                ${translate('edit')}
                            </button>
                            <button class="btn btn-sm btn-danger delete-format" data-format-id="${format.id}">
                                ${translate('delete')}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
  }

  /**
     * Render the form editor
     */
  renderFormEditor() {
    if (!this.currentFormat) {return;}

    const editor = document.getElementById('form-editor');
    editor.style.display = 'block';
    setContent(editor, `
            <div class="editor-header">
                <h2>${translate('editing_form')}: ${escapeHTML(this.currentFormat.form_type)}</h2>
                <div class="editor-actions">
                    <button id="save-format" class="btn btn-primary">${translate('save')}</button>
                    <button id="preview-format" class="btn btn-secondary">${translate('preview')}</button>
                    <button id="copy-format" class="btn btn-secondary">${translate('copy_to_org')}</button>
                    <button id="close-editor" class="btn btn-secondary">${translate('close')}</button>
                </div>
            </div>

            <div class="editor-body">
                <div class="fields-list">
                    <h3>${translate('form_fields')}</h3>
                    <button id="add-field" class="btn btn-sm btn-primary">
                        ${translate('add_field')}
                    </button>
                    <div id="fields-container" class="fields-container">
                        ${this.renderFieldsList()}
                    </div>
                </div>
            </div>
        `);
  }

  /**
     * Render the list of fields with drag-and-drop
     */
  renderFieldsList() {
    if (!this.currentFields || this.currentFields.length === 0) {
      return `<p class="no-data">${translate('no_fields_yet')}</p>`;
    }

    return `
            <div class="fields-sortable" role="list" aria-label="${translate('form_fields')}">
                ${this.currentFields.map((field, index) => `
                    <div class="field-item" 
                         data-field-index="${index}"
                         draggable="true"
                         role="listitem"
                         aria-label="${translate('field')} ${index + 1}">
                        <div class="field-handle" aria-hidden="true">
                            <span>☰</span>
                        </div>
                        <div class="field-info">
                            <strong>${escapeHTML(field.name || field.type)}</strong>
                            <span class="field-type">${escapeHTML(field.type)}</span>
                            ${field.required ? `<span class="badge">${translate('required')}</span>` : ''}
                            ${field.dependsOn ? `<span class="badge badge-info">${translate('conditional')}: ${escapeHTML(`${field.dependsOn.field} = ${field.dependsOn.value}`)}</span>` : ''}
                            ${this.checkTranslation(field) ? '' : `<span class="badge badge-warning" title="${translate('translation_missing')}"><span aria-hidden="true">⚠</span><span class="sr-only">${translate('translation_missing')}</span></span>`}
                        </div>
                        <div class="field-actions">
                            <button class="btn-icon move-up" data-index="${index}" 
                                    aria-label="${translate('move_up')}"
                                    ${index === 0 ? 'disabled' : ''}>↑</button>
                            <button class="btn-icon move-down" data-index="${index}" 
                                    aria-label="${translate('move_down')}"
                                    ${index === this.currentFields.length - 1 ? 'disabled' : ''}>↓</button>
                            <button class="btn-icon edit-field" data-index="${index}" 
                                    aria-label="${translate('edit_field')}">✏️</button>
                            <button class="btn-icon delete-field" data-index="${index}" 
                                    aria-label="${translate('delete_field')}">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
  }

  /**
   * Whether a field shows a real text rather than its bare key: the unit
   * wrote its own, or the key has a translation in the app's bundle.
   *
   * @param {Object} field - Form field
   * @returns {boolean}
   */
  checkTranslation(field) {
    const kind = field.type === 'infoText' ? 'infoHtml' : 'labelText';
    if (hasOwnText(field[kind])) {
      return true;
    }
    const key = field[FIELD_TEXT_KINDS[kind].keyProperty];
    return Boolean(key) && translate(key) !== key;
  }

  /**
   * The text a field would show in the builder's language, for the editor's
   * preview line.
   *
   * @param {string} kind - `labelText` or `infoHtml`
   * @returns {string} HTML
   */
  renderTextPreview(kind) {
    const { keyInput, rich } = FIELD_TEXT_KINDS[kind];
    const key = document.getElementById(keyInput)?.value.trim();
    const texts = this.editorTexts?.[kind];
    if (rich) {
      return formInfoHtml({ infoHtml: texts, infoText: key }, builderLanguage(), translate);
    }
    const { text, own } = resolveFormText(texts, key, builderLanguage(), translate);
    return own ? escapeHTML(text) : text;
  }

  /**
   * Refresh the preview lines and which key inputs are required: a key is
   * optional once the field has a text of its own.
   *
   * @returns {void}
   */
  syncFieldTexts() {
    const type = document.getElementById('field-type')?.value;
    Object.entries(FIELD_TEXT_KINDS).forEach(([kind, { keyInput }]) => {
      const input = document.getElementById(keyInput);
      const preview = document.getElementById(`${keyInput}-preview`);
      const applies = (kind === 'infoHtml') === (type === 'infoText');
      if (input) {
        input.required = applies && !hasOwnText(this.editorTexts?.[kind]);
      }
      if (preview) {
        setContent(preview, this.renderTextPreview(kind));
      }
    });
  }

  /**
     * Render field editor modal
     */
  renderFieldEditor(fieldIndex = null) {
    const isEdit = fieldIndex !== null;
    const field = isEdit ? this.currentFields[fieldIndex] : this.getDefaultField();

    const controllingFields = this.getControllingFieldCandidates(fieldIndex, field.dependsOn?.field);
    const controllingField = controllingFields.find(f => f.name === field.dependsOn?.field);
    // Edited in the translations dialog, written to the field on save.
    this.editorTexts = {
      labelText: { ...(field.labelText || {}) },
      infoHtml: { ...(field.infoHtml || {}) },
    };

    openModal({
      id: 'field-editor-modal',
      title: isEdit ? translate('edit_field') : translate('add_field'),
      body: `
            <form id="field-editor-form" class="field-editor-form">
                <div class="form-group">
                    <label for="field-type">${translate('field_type')} *</label>
                    <select id="field-type" name="type" required>
                        <option value="text" ${field.type === 'text' ? 'selected' : ''}>${translate('text')}</option>
                        <option value="email" ${field.type === 'email' ? 'selected' : ''}>${translate('email')}</option>
                        <option value="tel" ${field.type === 'tel' ? 'selected' : ''}>${translate('telephone')}</option>
                        <option value="date" ${field.type === 'date' ? 'selected' : ''}>${translate('date')}</option>
                        <option value="select" ${field.type === 'select' ? 'selected' : ''}>${translate('select')}</option>
                        <option value="radio" ${field.type === 'radio' ? 'selected' : ''}>${translate('radio')}</option>
                        <option value="checkbox" ${field.type === 'checkbox' ? 'selected' : ''}>${translate('checkbox')}</option>
                        <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>${translate('textarea')}</option>
                        <option value="infoText" ${field.type === 'infoText' ? 'selected' : ''}>${translate('info_text')}</option>
                    </select>
                </div>

                <div class="form-group" id="field-name-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="field-name">${translate('field_name')} *</label>
                    <input type="text" id="field-name" name="field_name" value="${escapeHTML(field.name || '')}"
                           placeholder="field_name" pattern="[a-z_]+" required>
                    <small>${translate('field_name_hint')}</small>
                </div>

                <div class="form-group" id="field-label-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="field-label">${translate('label_translation_key')} *</label>
                    <div class="input-with-button">
                        <input type="text" id="field-label" name="label" value="${escapeHTML(field.label || '')}" 
                               placeholder="field_name_label" required>
                        <button type="button" id="add-label-translation" class="btn btn-sm">
                            ${translate('add_translation')}
                        </button>
                    </div>
                    <small>${translate('auto_suggest_key')}</small>
                    <p class="field-text-preview"><span class="field-text-preview__label">${translate('text_preview')}</span>
                        <span id="field-label-preview" aria-live="polite"></span></p>
                </div>

                <div class="form-group" id="field-info-text-group" ${field.type === 'infoText' ? '' : 'style="display:none;"'}>
                    <label for="field-info-text">${translate('info_text_key')}</label>
                    <div class="input-with-button">
                        <input type="text" id="field-info-text" name="infoText" value="${escapeHTML(field.infoText || '')}"
                               placeholder="info_text_key" aria-describedby="field-info-text-hint">
                        <button type="button" id="add-info-translation" class="btn btn-sm">
                            ${translate('add_translation')}
                        </button>
                    </div>
                    <small id="field-info-text-hint">${translate('info_text_key_hint')}</small>
                    <div class="field-text-preview field-text-preview--rich">
                        <span class="field-text-preview__label">${translate('text_preview')}</span>
                        <div id="field-info-text-preview" aria-live="polite"></div>
                    </div>
                </div>

                <div class="form-group" id="field-options-group" style="display: ${['select', 'radio'].includes(field.type) ? 'block' : 'none'};">
                    <p class="form-label" id="field-options-label">${translate('options')}</p>
                    <div id="options-container" role="group" aria-labelledby="field-options-label">
                        ${this.renderOptionsEditor(field.options || [])}
                    </div>
                    <button type="button" id="add-option" class="btn btn-sm">${translate('add_option')}</button>
                </div>

                <div class="form-group">
                    <label>
                        <input type="checkbox" id="field-required" name="required" ${field.required ? 'checked' : ''}>
                        ${translate('required_field')}
                    </label>
                </div>

                <div class="form-group" id="depends-on-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="depends-on-field">${translate('depends_on')}</label>
                    <select id="depends-on-field" name="dependsOnField" aria-describedby="depends-on-hint">
                        <option value="">${translate('none')}</option>
                        ${controllingFields.map(f => `
                            <option value="${escapeHTML(f.name)}" 
                                    ${field.dependsOn?.field === f.name ? 'selected' : ''}>
                                ${escapeHTML(f.name)}
                            </option>
                        `).join('')}
                    </select>
                    <small id="depends-on-hint">${translate('depends_on_hint')}</small>
                </div>

                <div class="form-group" id="depends-on-value-group" 
                     style="display: ${field.dependsOn?.field ? 'block' : 'none'};">
                    ${this.renderDependsOnValueControl(controllingField, field.dependsOn?.value)}
                </div>

                <input type="hidden" id="field-index" value="${fieldIndex !== null ? fieldIndex : ''}">
            </form>
            `,
      footer: `
                <button type="button" data-modal-close class="btn btn-secondary">${translate('cancel')}</button>
                <button type="submit" form="field-editor-form" class="btn btn-primary">${translate('save_field')}</button>
            `,
    });
    this.updateFieldEditorVisibility(field.type);
    this.attachFieldEditorListeners();
    this.syncFieldTexts();
  }

  /**
     * Render options editor for select/radio fields
     */
  renderOptionsEditor(options) {
    if (!options || options.length === 0) {
      return `<div class="no-options">${translate('no_options_yet')}</div>`;
    }

    return options.map((option, index) => this.renderOptionItem(option, index)).join('');
  }

  /**
     * Render one editable option row. Placeholders vanish once typed into, so
     * each control carries its own accessible name, numbered by row.
     *
     * @param {{label?: string, value?: string}} option - Option to edit
     * @param {number} index - Zero-based row index
     * @returns {string} Option row HTML
     */
  renderOptionItem(option, index) {
    const position = index + 1;
    return `
            <div class="option-item" data-option-index="${index}">
                <input type="text" class="option-label" value="${escapeHTML(option.label || '')}"
                       placeholder="${translate('label_key')}"
                       aria-label="${escapeHTML(`${translate('label_key')} ${position}`)}">
                <input type="text" class="option-value" value="${escapeHTML(option.value || '')}"
                       placeholder="${translate('value')}"
                       aria-label="${escapeHTML(`${translate('value')} ${position}`)}">
                <button type="button" class="btn-icon remove-option" data-index="${index}"
                        aria-label="${escapeHTML(`${translate('remove_option')} ${position}`)}"><span aria-hidden="true">🗑️</span></button>
            </div>
        `;
  }

  /**
     * Fields that another field can depend on: every named select, radio or
     * checkbox except the field being edited (a field cannot hide itself).
     *
     * A condition saved against a field that has since been deleted or turned
     * into another type stays listed, so opening and re-saving the field does not
     * silently drop its condition.
     *
     * @param {number|null} editedIndex - Index of the field being edited, or null for a new one
     * @param {string} [currentController] - Name of the field the edited field depends on today
     * @returns {Object[]} Candidate controlling field definitions
     */
  getControllingFieldCandidates(editedIndex, currentController) {
    const candidates = this.currentFields.filter((f, index) =>
      index !== editedIndex && f.name && CONTROLLING_FIELD_TYPES.includes(f.type)
    );

    const editedName = editedIndex === null ? undefined : this.currentFields[editedIndex]?.name;
    if (currentController && currentController !== editedName &&
            !candidates.some(f => f.name === currentController)) {
      const existing = this.currentFields.find(f => f.name === currentController);
      candidates.push(existing || { name: currentController });
    }

    return candidates;
  }

  /**
     * Render the "depends on value" control for a controlling field.
     *
     * A select or radio offers its own options, so the admin picks "Autre"
     * instead of having to type its stored value exactly. A checkbox only has
     * one meaningful trigger — checked. Anything else (a legacy condition on a
     * field that is no longer a choice) falls back to a free-text value.
     *
     * @param {Object|undefined} controller - The controlling field definition
     * @param {string} [currentValue] - The value saved in the condition today
     * @returns {string} HTML for the label, control and hint
     */
  renderDependsOnValueControl(controller, currentValue = '') {
    const label = `<label for="depends-on-value">${translate('depends_on_value')}</label>`;
    const hint = `<small id="depends-on-value-hint">${translate('depends_on_value_hint')}</small>`;
    const options = Array.isArray(controller?.options)
      ? controller.options.filter(option => option && option.value !== undefined && option.value !== '')
      : [];

    let choices = null;
    if (controller?.type === 'checkbox') {
      choices = [{ value: CHECKBOX_CHECKED_VALUE, text: translate('depends_on_checked') }];
    } else if (['select', 'radio'].includes(controller?.type) && options.length > 0) {
      choices = options.map(option => ({
        value: String(option.value),
        text: `${translate(option.label || option.value)} (${option.value})`
      }));
    }

    if (!choices) {
      return `${label}
                <input type="text" id="depends-on-value" name="dependsOnValue"
                       value="${escapeHTML(currentValue || '')}"
                       placeholder="${CHECKBOX_CHECKED_VALUE}" aria-describedby="depends-on-value-hint">
                ${hint}`;
    }

    // Keep a saved value the controller no longer offers, rather than
    // quietly swapping the condition for the first option on re-save.
    if (currentValue && !choices.some(choice => choice.value === String(currentValue))) {
      choices.push({ value: String(currentValue), text: String(currentValue) });
    }

    return `${label}
            <select id="depends-on-value" name="dependsOnValue" aria-describedby="depends-on-value-hint">
                ${choices.map(choice => `
                    <option value="${escapeHTML(choice.value)}" ${String(currentValue) === choice.value ? 'selected' : ''}>
                        ${escapeHTML(choice.text)}
                    </option>
                `).join('')}
            </select>
            ${hint}`;
  }

  /**
     * Get default field structure
     */
  getDefaultField() {
    return {
      name: '',
      type: 'text',
      label: '',
      required: false
    };
  }

  /**
     * Attach event listeners
     */
  attachEventListeners() {
    // Create new format button
    const createBtn = document.getElementById('create-new-format');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.createNewFormat());
    }

    // Edit format buttons
    document.querySelectorAll('.edit-format').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const formatId = parseInt(e.target.dataset.formatId);
        this.editFormat(formatId);
      });
    });

    // Delete format buttons
    document.querySelectorAll('.delete-format').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const formatId = parseInt(e.target.dataset.formatId);
        this.deleteFormat(formatId);
      });
    });

  }

  /**
     * Attach editor event listeners
     */
  attachEditorListeners() {
    // Save format
    const saveBtn = document.getElementById('save-format');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveFormat());
    }

    // Preview format
    const previewBtn = document.getElementById('preview-format');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => this.previewFormat());
    }

    // Copy format
    const copyBtn = document.getElementById('copy-format');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.showCopyDialog());
    }

    // Close editor
    const closeBtn = document.getElementById('close-editor');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeEditor());
    }

    // Add field
    const addFieldBtn = document.getElementById('add-field');
    if (addFieldBtn) {
      addFieldBtn.addEventListener('click', () => this.renderFieldEditor());
    }

    // Field action buttons
    this.attachFieldActionListeners();

    // Drag and drop
    this.attachDragDropListeners();
  }

  /**
     * Attach field action listeners (edit, delete, move)
     */
  attachFieldActionListeners() {
    document.querySelectorAll('.edit-field').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.renderFieldEditor(index);
      });
    });

    document.querySelectorAll('.delete-field').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.deleteField(index);
      });
    });

    document.querySelectorAll('.move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.moveField(index, -1);
      });
    });

    document.querySelectorAll('.move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.moveField(index, 1);
      });
    });
  }

  /**
     * Attach drag and drop listeners
     */
  attachDragDropListeners() {
    const fieldItems = document.querySelectorAll('.field-item');

    fieldItems.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        this.draggedElement = e.target;
        this.draggedIndex = parseInt(e.target.dataset.fieldIndex);
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', (e) => {
        e.target.classList.remove('dragging');
        this.draggedElement = null;
        this.draggedIndex = null;
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const targetIndex = parseInt(e.currentTarget.dataset.fieldIndex);
        if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
          e.currentTarget.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', (e) => {
        e.currentTarget.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');

        const targetIndex = parseInt(e.currentTarget.dataset.fieldIndex);
        if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
          this.reorderField(this.draggedIndex, targetIndex);
        }
      });
    });

    // Keyboard navigation
    fieldItems.forEach(item => {
      item.setAttribute('tabindex', '0');
      item.addEventListener('keydown', (e) => {
        const index = parseInt(e.target.dataset.fieldIndex);
        if (e.key === 'ArrowUp' && e.ctrlKey) {
          e.preventDefault();
          this.moveField(index, -1);
        } else if (e.key === 'ArrowDown' && e.ctrlKey) {
          e.preventDefault();
          this.moveField(index, 1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.renderFieldEditor(index);
        } else if (e.key === 'Delete') {
          e.preventDefault();
          this.deleteField(index);
        }
      });
    });
  }

  /**
     * Attach field editor listeners
     */
  attachFieldEditorListeners() {
    // Field type change
    const typeSelect = document.getElementById('field-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        this.updateFieldEditorVisibility(e.target.value);
      });
    }

    // Field name auto-suggest label
    const nameInput = document.getElementById('field-name');
    const labelInput = document.getElementById('field-label');
    if (nameInput && labelInput) {
      nameInput.addEventListener('input', (e) => {
        if (!labelInput.value || labelInput.value === `${nameInput.dataset.oldValue}_label`) {
          labelInput.value = e.target.value ? `${e.target.value}_label` : '';
        }
        nameInput.dataset.oldValue = e.target.value;
        this.syncFieldTexts();
      });
    }

    // Add option button
    const addOptionBtn = document.getElementById('add-option');
    if (addOptionBtn) {
      addOptionBtn.addEventListener('click', () => this.addOptionToEditor());
    }

    // Remove option buttons
    document.querySelectorAll('.remove-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.currentTarget.closest('.option-item').remove();
      });
    });

    // DependsOn field change
    const dependsOnField = document.getElementById('depends-on-field');
    if (dependsOnField) {
      dependsOnField.addEventListener('change', (e) => {
        const valueGroup = document.getElementById('depends-on-value-group');
        if (valueGroup) {
          // The trigger values come from the newly chosen field's options
          const controller = this.currentFields.find(f => f.name === e.target.value);
          setContent(valueGroup, this.renderDependsOnValueControl(controller));
          valueGroup.style.display = e.target.value ? 'block' : 'none';
        }
      });
    }

    // Add translation buttons
    document.getElementById('add-label-translation')
      ?.addEventListener('click', () => this.showTranslationEditor('labelText'));
    document.getElementById('add-info-translation')
      ?.addEventListener('click', () => this.showTranslationEditor('infoHtml'));
    ['field-label', 'field-info-text'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => this.syncFieldTexts());
    });

    // Form submit
    const form = document.getElementById('field-editor-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveField();
      });
    }

  }

  /**
     * Update field editor visibility based on field type
     */
  updateFieldEditorVisibility(fieldType) {
    const nameGroup = document.getElementById('field-name-group');
    const labelGroup = document.getElementById('field-label-group');
    const infoTextGroup = document.getElementById('field-info-text-group');
    const optionsGroup = document.getElementById('field-options-group');
    const dependsOnGroup = document.getElementById('depends-on-group');
    const nameInput = document.getElementById('field-name');

    if (fieldType === 'infoText') {
      nameGroup.style.display = 'none';
      labelGroup.style.display = 'none';
      infoTextGroup.style.display = 'block';
      optionsGroup.style.display = 'none';
      dependsOnGroup.style.display = 'none';

      if (nameInput) {nameInput.required = false;}
    } else {
      nameGroup.style.display = 'block';
      labelGroup.style.display = 'block';
      infoTextGroup.style.display = 'none';
      dependsOnGroup.style.display = 'block';
      optionsGroup.style.display = ['select', 'radio'].includes(fieldType) ? 'block' : 'none';

      if (nameInput) {nameInput.required = true;}
    }
    this.syncFieldTexts();
  }

  /**
     * Add option to editor
     */
  addOptionToEditor() {
    const container = document.getElementById('options-container');
    const index = container.querySelectorAll('.option-item').length;

    container.querySelector('.no-options')?.remove();
    insertHTML(container, 'beforeend', this.renderOptionItem({}, index));

    // Attach remove listener
    const newOption = container.lastElementChild;
    newOption.querySelector('.remove-option').addEventListener('click', (e) => {
      e.currentTarget.closest('.option-item').remove();
    });
    newOption.querySelector('.option-label').focus();
  }

  /**
   * Each content language's starting text: the field's own text, else the
   * app's bundle text for its key in that language.
   *
   * @param {string} kind - `labelText` or `infoHtml`
   * @param {string} key - Translation key, possibly empty
   * @returns {Promise<Object<string, {text: string, bundle: string}>>}
   */
  async loadTranslationDrafts(kind, key) {
    if (key && typeof app?.loadTranslation === 'function') {
      await Promise.all(FORM_CONTENT_LANGS.map((lang) => app.loadTranslation(lang)));
    }
    const own = this.editorTexts?.[kind] || {};
    return Object.fromEntries(FORM_CONTENT_LANGS.map((lang) => {
      const bundle = (key && app?.translations?.[lang]?.[key]) || '';
      return [lang, { text: own[lang] ?? bundle, bundle }];
    }));
  }

  /**
   * Edit a field's label or information text in every content language.
   *
   * Opens over the field editor and writes into its draft; the texts reach
   * the form format when the field is saved. Each language starts from the
   * field's own text or, failing that, the app's text for the key.
   *
   * @param {string} kind - `labelText` or `infoHtml`
   * @returns {Promise<void>}
   */
  async showTranslationEditor(kind) {
    const { keyInput, rich } = FIELD_TEXT_KINDS[kind];
    const key = document.getElementById(keyInput)?.value.trim() || '';
    const drafts = await this.loadTranslationDrafts(kind, key);

    const languageRows = FORM_CONTENT_LANGS.map((lang) => {
      const id = `trans-${lang}`;
      const name = escapeHTML(languageName(lang));
      if (rich) {
        return `
          <div class="form-group">
            <span class="form-label" id="${id}-label" lang="${builderLanguage()}">${name}</span>
            ${richTextEditorHTML({ id, labelId: `${id}-label`, html: drafts[lang].text })}
          </div>`;
      }
      return `
        <div class="form-group">
          <label for="${id}">${name}</label>
          <input type="text" id="${id}" name="${lang}" lang="${lang}" value="${escapeHTML(drafts[lang].text)}">
        </div>`;
    }).join('');

    openModal({
      id: 'translation-modal',
      title: translate('add_translation'),
      size: rich ? 'large' : null,
      body: `
        <form id="translation-form">
          ${key ? `<p class="muted-text">${translate('translation_key')} : <code>${escapeHTML(key)}</code></p>` : ''}
          <p class="muted-text">${translate('translations_hint')}</p>
          ${languageRows}
        </form>`,
      footer: `
        <button type="button" class="btn btn-secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" form="translation-form" class="btn btn-primary">${translate('save')}</button>`,
    });

    if (rich) {
      document.querySelectorAll('#translation-form [data-rte]').forEach((root) => attachRichTextEditor(root));
      FORM_CONTENT_LANGS.forEach((lang) => document.getElementById(`trans-${lang}`)?.setAttribute('lang', lang));
    }

    document.getElementById('translation-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const texts = {};
      FORM_CONTENT_LANGS.forEach((lang) => {
        const control = document.getElementById(`trans-${lang}`);
        const value = rich ? getRichTextValue(control) : control.value.trim();
        const bundle = rich ? sanitizeRichText(drafts[lang].bundle) : drafts[lang].bundle.trim();
        // Only what differs from the app's own text is the unit's; an empty
        // language falls back to the key's text or another language.
        if (value && value !== bundle) {
          texts[lang] = value;
        }
      });
      this.editorTexts[kind] = texts;
      closeModal('translation-modal');
      this.syncFieldTexts();
    });
  }

  /**
     * Save field from editor
     */
  saveField() {
    const form = document.getElementById('field-editor-form');
    const formData = new FormData(form);
    const fieldIndex = document.getElementById('field-index').value;

    const field = {
      type: formData.get('type'),
      // See field_name input: DOMPurify strips name="name" inside a form
      name: formData.get('field_name'),
      label: formData.get('label'),
      required: document.getElementById('field-required').checked
    };

    // Handle infoText type
    if (field.type === 'infoText') {
      field.infoText = formData.get('infoText') || undefined;
      delete field.name;
      delete field.label;
    }

    // The unit's own texts, from the translations dialog
    const textKind = field.type === 'infoText' ? 'infoHtml' : 'labelText';
    if (hasOwnText(this.editorTexts?.[textKind])) {
      field[textKind] = { ...this.editorTexts[textKind] };
    }
    if (!field.label) {
      delete field.label;
    }
    if (!field.infoText) {
      delete field.infoText;
    }

    // Handle options for select/radio
    if (['select', 'radio'].includes(field.type)) {
      const options = [];
      document.querySelectorAll('#options-container .option-item').forEach(item => {
        const label = item.querySelector('.option-label').value;
        const value = item.querySelector('.option-value').value;
        if (label && value) {
          options.push({ label, value });
        }
      });
      field.options = options;
    }

    // Handle dependsOn
    const dependsOnField = formData.get('dependsOnField');
    if (dependsOnField && field.type !== 'infoText') {
      field.dependsOn = {
        field: dependsOnField,
        value: formData.get('dependsOnValue') || 'yes'
      };
    }

    // Add or update field
    if (fieldIndex === '') {
      this.currentFields.push(field);
    } else {
      const index = parseInt(fieldIndex, 10);
      const previousName = this.currentFields[index]?.name;
      this.currentFields[index] = field;
      this.renameDependencies(previousName, field.name);
    }

    // Close modal and re-render
    closeModal('field-editor-modal');
    this.updateFieldsList();
  }

  /**
     * Update fields list after changes
     */
  updateFieldsList() {
    const container = document.getElementById('fields-container');
    if (container) {
      setContent(container, this.renderFieldsList());
      this.attachFieldActionListeners();
      this.attachDragDropListeners();
    }
  }

  /**
     * Delete a field
     */
  async deleteField(index) {
    const deletedName = this.currentFields[index]?.name;
    const hasDependents = Boolean(deletedName) &&
            this.currentFields.some(f => f.dependsOn?.field === deletedName);
    const message = hasDependents
      ? translate('confirm_delete_field_with_dependents')
      : translate('confirm_delete_field');

    if (await confirmDestructive(message)) {
      this.currentFields.splice(index, 1);
      // A condition on a field that no longer exists could never be met,
      // so its dependents would stay hidden for good. Drop the condition.
      if (hasDependents) {
        this.currentFields.forEach(f => {
          if (f.dependsOn?.field === deletedName) {
            delete f.dependsOn;
          }
        });
      }
      this.updateFieldsList();
    }
  }

  /**
     * Point the conditions of dependent fields at a controlling field's new name.
     *
     * @param {string|undefined} previousName - The field's name before the edit
     * @param {string|undefined} newName - The field's name after the edit
     * @returns {void}
     */
  renameDependencies(previousName, newName) {
    if (!previousName || !newName || previousName === newName) {
      return;
    }
    this.currentFields.forEach(f => {
      if (f.dependsOn?.field === previousName) {
        f.dependsOn.field = newName;
      }
    });
  }

  /**
     * Move field up or down
     */
  moveField(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.currentFields.length) {return;}

    // Re-rendering the list destroys the focused control; remember which
    // one it was so keyboard users keep their place (WCAG 2.4.3).
    const active = document.activeElement;
    const focusedButton = ['move-up', 'move-down'].find((cls) => active?.classList?.contains(cls));

    const field = this.currentFields[index];
    this.currentFields.splice(index, 1);
    this.currentFields.splice(newIndex, 0, field);
    this.updateFieldsList();

    const movedItem = document.querySelector(`.field-item[data-field-index="${newIndex}"]`);
    const sameButton = focusedButton && movedItem?.querySelector(`.${focusedButton}:not([disabled])`);
    // At the top or bottom the same arrow is disabled: fall back to the row.
    (sameButton || movedItem)?.focus();
  }

  /**
     * Reorder field via drag-drop
     */
  reorderField(fromIndex, toIndex) {
    const field = this.currentFields[fromIndex];
    this.currentFields.splice(fromIndex, 1);
    this.currentFields.splice(toIndex, 0, field);
    this.updateFieldsList();
  }

  /**
     * Create new format
     */
  async createNewFormat() {
    // Show a modal for form type input instead of browser prompt


    openModal({
      id: 'create-format-modal',
      title: translate('create_new_form_format'),
      body: `
            <form id="create-format-form">
                <div class="form-group">
                    <label for="new-form-type">${translate('form_type_name')} *</label>
                    <input type="text" id="new-form-type" name="formType" required 
                           pattern="[a-z_]+" 
                           placeholder="participant_registration"
                           title="${translate('field_name_hint')}">
                    <small>${translate('field_name_hint')}</small>
                </div>
            </form>
            `,
      footer: `
                <button type="button" class="btn btn-secondary" data-modal-close>${translate('cancel')}</button>
                <button type="submit" form="create-format-form" class="btn btn-primary">${translate('create')}</button>
            `,
    });

    // Attach listeners
    const form = document.getElementById('create-format-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formType = document.getElementById('new-form-type').value;
      closeModal('create-format-modal');
      await this.doCreateFormat(formType);
    });
  }

  /**
     * Actually create the format
     */
  async doCreateFormat(formType) {

    try {
      const response = await API.post('v1/form-builder/form-formats', {
        form_type: formType,
        form_structure: { fields: [] },
        display_type: null
      });

      if (response.success) {
        this.app.showMessage(translate('form_format_created'), 'success');
        await this.loadData();
        this.render();
        this.attachEventListeners();
        this.editFormat(response.data.id);
      } else {
        this.app.showMessage(translate('error_creating_format'), 'error');
      }
    } catch (error) {
      debugError('Error creating format:', error);
      this.app.showMessage(translate('error_creating_format'), 'error');
    }
  }

  /**
     * Edit format
     */
  async editFormat(formatId) {
    const format = this.formFormats.find(f => f.id === formatId);
    if (!format) {return;}

    this.currentFormat = format;
    this.currentFields = format.form_structure?.fields || [];

    this.renderFormEditor();
    this.attachEditorListeners();

    // Scroll to editor
    document.getElementById('form-editor').scrollIntoView({ behavior: 'smooth' });
  }

  /**
     * Delete format
     */
  async deleteFormat(formatId) {
    if (!(await confirmDestructive(translate('confirm_delete_format')))) {return;}

    try {
      const response = await API.delete(`v1/form-builder/form-formats/${formatId}`);

      if (response.success) {
        this.app.showMessage(translate('format_deleted'), 'success');
        await this.loadData();
        const formatsList = document.getElementById('formats-list');
        if (formatsList) {
          setContent(formatsList, this.renderFormatsList());
          this.attachEventListeners();
        }
      } else {
        this.app.showMessage(translate('error_deleting_format'), 'error');
      }
    } catch (error) {
      debugError('Error deleting format:', error);
      this.app.showMessage(translate('error_deleting_format'), 'error');
    }
  }

  /**
     * Save format
     */
  async saveFormat() {
    if (!this.currentFormat) {return;}

    try {
      const response = await API.put(`v1/form-builder/form-formats/${this.currentFormat.id}`, {
        form_structure: { fields: this.currentFields }
      });

      if (response.success) {
        this.app.showMessage(translate('format_saved'), 'success');
        this.currentFormat.form_structure = response.data.form_structure;
      } else {
        this.app.showMessage(translate('error_saving_format'), 'error');
      }
    } catch (error) {
      debugError('Error saving format:', error);
      this.app.showMessage(translate('error_saving_format'), 'error');
    }
  }

  /**
     * Preview format
     */
  previewFormat() {
    if (!this.currentFormat || !this.currentFields.length) {
      this.app.showMessage(translate('no_fields_to_preview'), 'warning');
      return;
    }

    const renderer = new JSONFormRenderer(
      { fields: this.currentFields },
      {},
      this.currentFormat.form_type
    );

    openModal({
      id: 'preview-modal',
      title: translate('form_preview'),
      size: 'large',
      body: renderer.render(),
      initialFocus: false,
    });
  }

  /**
     * Show copy dialog
     */
  showCopyDialog() {
    if (this.userOrganizations.length === 0) {
      this.app.showMessage(translate('no_other_organizations'), 'warning');
      return;
    }

    // Show a modal for organization selection


    openModal({
      id: 'copy-format-modal',
      title: translate('copy_to_org'),
      body: `
            <form id="copy-format-form">
                <div class="form-group">
                    <label for="target-org">${translate('select_target_organization')} *</label>
                    <select id="target-org" name="targetOrg" required>
                        <option value="">${translate('select_organization')}</option>
                        ${this.userOrganizations.map(org => `
                            <option value="${org.id}">${escapeHTML(org.name)} (ID: ${org.id})</option>
                        `).join('')}
                    </select>
                </div>
            </form>
            `,
      footer: `
                <button type="button" class="btn btn-secondary" data-modal-close>${translate('cancel')}</button>
                <button type="submit" form="copy-format-form" class="btn btn-primary">${translate('copy')}</button>
            `,
    });

    // Attach listeners
    const form = document.getElementById('copy-format-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetOrgId = parseInt(document.getElementById('target-org').value);
      closeModal('copy-format-modal');
      await this.copyFormat(targetOrgId);
    });
  }

  /**
     * Copy format to another organization
     */
  async copyFormat(targetOrgId) {
    if (!this.currentFormat) {return;}

    try {
      // First save current changes
      await this.saveFormat();

      // Get current organization ID from user context
      const currentOrgId = this.app.organizationId;
      if (!currentOrgId) {
        this.app.showMessage(translate('error_organization_not_found'), 'error');
        return;
      }

      // Then copy - use simple POST body instead of path params
      const response = await API.post(`v1/form-builder/form-formats/${currentOrgId}/${this.currentFormat.form_type}/copy`, { targetOrgId });

      if (response.success) {
        this.app.showMessage(translate('format_copied'), 'success');
      } else {
        this.app.showMessage(translate('error_copying_format'), 'error');
      }
    } catch (error) {
      debugError('Error copying format:', error);
      this.app.showMessage(translate('error_copying_format'), 'error');
    }
  }

  /**
     * Close editor
     */
  closeEditor() {
    this.currentFormat = null;
    this.currentFields = [];
    document.getElementById('form-editor').style.display = 'none';
  }

  /**
     * Clean up resources when navigating away
     * Called automatically by router
     */
  destroy() {
    super.destroy();
    // Clear data references
    this.formFormats = [];
    this.userOrganizations = [];
    this.currentFormat = null;
    this.currentFields = [];
    this.draggedElement = null;
    this.draggedIndex = null;
  }
}
