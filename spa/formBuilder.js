/**
 * Form Builder Module
 *
 * Allows admins to create and edit form formats stored in organization_form_formats table
 * Supports drag-and-drop reordering, field management, conditional logic, and translations
 *
 * @module formBuilder
 */

import { debugLog, debugError, debugWarn } from "./utils/DebugUtils.js";
import { API } from "./api/api-core.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { CONFIG } from "./config.js";
import { JSONFormRenderer } from "./JSONFormRenderer.js";
import { setContent } from "./utils/DOMUtils.js";
import { BaseModule } from "./utils/BaseModule.js";

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
        debugLog("Initializing FormBuilder");
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
            debugError("Error loading form builder data:", error);
            this.app.showMessage(translate("error_loading_data"), "error");
        }
    }

    /**
     * Render the main form builder UI
     */
    render() {
        const container = document.getElementById("app");
        setContent(container, `
            <div class="form-builder">
                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                <h1>${translate("form_builder_title")}</h1>
                
                <div class="form-builder-toolbar">
                    <button id="create-new-format" class="btn btn-primary">
                        ${translate("create_new_form_format")}
                    </button>
                </div>

                <div class="form-formats-list">
                    <h2>${translate("existing_form_formats")}</h2>
                    <div id="formats-list">
                        ${this.renderFormatsList()}
                    </div>
                </div>

                <div id="form-editor" class="form-editor" style="display: none;">
                    <!-- Form editor will be rendered here -->
                </div>
            </div>

            <!-- Field Editor Modal -->
            <div id="field-editor-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <h2 id="field-editor-title">${translate("edit_field")}</h2>
                    <div id="field-editor-content">
                        <!-- Field editor form will be rendered here -->
                    </div>
                </div>
            </div>

            <!-- Preview Modal -->
            <div id="preview-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <h2>${translate("form_preview")}</h2>
                    <div id="preview-content">
                        <!-- Form preview will be rendered here -->
                    </div>
                </div>
            </div>

            <!-- Translation Editor Modal -->
            <div id="translation-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <h2>${translate("add_translation")}</h2>
                    <div id="translation-content">
                        <!-- Translation form will be rendered here -->
                    </div>
                </div>
            </div>
        `);
    }

    /**
     * Render the list of existing form formats
     */
    renderFormatsList() {
        if (this.formFormats.length === 0) {
            return `<p class="no-data">${translate("no_form_formats_found")}</p>`;
        }

        return `
            <div class="formats-grid">
                ${this.formFormats.map(format => `
                    <div class="format-card" data-format-id="${format.id}">
                        <h3>${escapeHTML(format.form_type)}</h3>
                        <p class="format-meta">
                            ${translate("fields")}: ${format.form_structure?.fields?.length || 0}
                        </p>
                        <div class="format-actions">
                            <button class="btn btn-sm edit-format" data-format-id="${format.id}">
                                ${translate("edit")}
                            </button>
                            <button class="btn btn-sm btn-danger delete-format" data-format-id="${format.id}">
                                ${translate("delete")}
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
        if (!this.currentFormat) return;

        const editor = document.getElementById("form-editor");
        editor.style.display = "block";
        setContent(editor, `
            <div class="editor-header">
                <h2>${translate("editing_form")}: ${escapeHTML(this.currentFormat.form_type)}</h2>
                <div class="editor-actions">
                    <button id="save-format" class="btn btn-primary">${translate("save")}</button>
                    <button id="preview-format" class="btn btn-secondary">${translate("preview")}</button>
                    <button id="copy-format" class="btn btn-secondary">${translate("copy_to_org")}</button>
                    <button id="close-editor" class="btn btn-secondary">${translate("close")}</button>
                </div>
            </div>

            <div class="editor-body">
                <div class="fields-list">
                    <h3>${translate("form_fields")}</h3>
                    <button id="add-field" class="btn btn-sm btn-primary">
                        ${translate("add_field")}
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
            return `<p class="no-data">${translate("no_fields_yet")}</p>`;
        }

        return `
            <div class="fields-sortable">
                ${this.currentFields.map((field, index) => `
                    <div class="field-item" 
                         data-field-index="${index}"
                         draggable="true"
                         role="listitem"
                         aria-label="${translate("field")} ${index + 1}">
                        <div class="field-handle" aria-label="${translate("drag_handle")}">
                            <span>☰</span>
                        </div>
                        <div class="field-info">
                            <strong>${escapeHTML(field.name || field.type)}</strong>
                            <span class="field-type">${escapeHTML(field.type)}</span>
                            ${field.required ? `<span class="badge">${translate("required")}</span>` : ''}
                            ${field.dependsOn ? `<span class="badge badge-info">${translate("conditional")}</span>` : ''}
                            ${this.checkTranslation(field.label) ? '' : `<span class="badge badge-warning" title="${translate("translation_missing")}">⚠</span>`}
                        </div>
                        <div class="field-actions">
                            <button class="btn-icon move-up" data-index="${index}" 
                                    aria-label="${translate("move_up")}"
                                    ${index === 0 ? 'disabled' : ''}>↑</button>
                            <button class="btn-icon move-down" data-index="${index}" 
                                    aria-label="${translate("move_down")}"
                                    ${index === this.currentFields.length - 1 ? 'disabled' : ''}>↓</button>
                            <button class="btn-icon edit-field" data-index="${index}" 
                                    aria-label="${translate("edit_field")}">✏️</button>
                            <button class="btn-icon delete-field" data-index="${index}" 
                                    aria-label="${translate("delete_field")}">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * Check if a translation key exists (simplified - checks if it's a plain key pattern)
     */
    checkTranslation(key) {
        if (!key) return false;
        // Translation key pattern: lowercase letters and underscores only
        const TRANSLATION_KEY_PATTERN = /^[a-z_]+$/;
        return TRANSLATION_KEY_PATTERN.test(key);
    }

    /**
     * Render field editor modal
     */
    renderFieldEditor(fieldIndex = null) {
        const isEdit = fieldIndex !== null;
        const field = isEdit ? this.currentFields[fieldIndex] : this.getDefaultField();

        const modal = document.getElementById("field-editor-modal");
        const content = document.getElementById("field-editor-content");

        document.getElementById("field-editor-title").textContent =
            isEdit ? translate("edit_field") : translate("add_field");

        // Get boolean fields for dependsOn dropdown
        const booleanFields = this.currentFields.filter(f =>
            ['radio', 'checkbox'].includes(f.type) && f.name
        );

        setContent(content, `
            <form id="field-editor-form" class="field-editor-form">
                <div class="form-group">
                    <label for="field-type">${translate("field_type")} *</label>
                    <select id="field-type" name="type" required>
                        <option value="text" ${field.type === 'text' ? 'selected' : ''}>${translate("text")}</option>
                        <option value="email" ${field.type === 'email' ? 'selected' : ''}>${translate("email")}</option>
                        <option value="tel" ${field.type === 'tel' ? 'selected' : ''}>${translate("telephone")}</option>
                        <option value="date" ${field.type === 'date' ? 'selected' : ''}>${translate("date")}</option>
                        <option value="select" ${field.type === 'select' ? 'selected' : ''}>${translate("select")}</option>
                        <option value="radio" ${field.type === 'radio' ? 'selected' : ''}>${translate("radio")}</option>
                        <option value="checkbox" ${field.type === 'checkbox' ? 'selected' : ''}>${translate("checkbox")}</option>
                        <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>${translate("textarea")}</option>
                        <option value="infoText" ${field.type === 'infoText' ? 'selected' : ''}>${translate("info_text")}</option>
                    </select>
                </div>

                <div class="form-group" id="field-name-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="field-name">${translate("field_name")} *</label>
                    <input type="text" id="field-name" name="name" value="${escapeHTML(field.name || '')}" 
                           placeholder="field_name" pattern="[a-z_]+" required>
                    <small>${translate("field_name_hint")}</small>
                </div>

                <div class="form-group" id="field-label-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="field-label">${translate("label_translation_key")} *</label>
                    <div class="input-with-button">
                        <input type="text" id="field-label" name="label" value="${escapeHTML(field.label || '')}" 
                               placeholder="field_name_label" required>
                        <button type="button" id="add-label-translation" class="btn btn-sm">
                            ${translate("add_translation")}
                        </button>
                    </div>
                    <small>${translate("auto_suggest_key")}</small>
                </div>

                <div class="form-group" id="field-info-text-group" ${field.type === 'infoText' ? '' : 'style="display:none;"'}>
                    <label for="field-info-text">${translate("info_text_key")} *</label>
                    <div class="input-with-button">
                        <input type="text" id="field-info-text" name="infoText" value="${escapeHTML(field.infoText || '')}" 
                               placeholder="info_text_key">
                        <button type="button" id="add-info-translation" class="btn btn-sm">
                            ${translate("add_translation")}
                        </button>
                    </div>
                </div>

                <div class="form-group" id="field-options-group" style="display: ${['select', 'radio'].includes(field.type) ? 'block' : 'none'};">
                    <label>${translate("options")}</label>
                    <div id="options-container">
                        ${this.renderOptionsEditor(field.options || [])}
                    </div>
                    <button type="button" id="add-option" class="btn btn-sm">${translate("add_option")}</button>
                </div>

                <div class="form-group">
                    <label>
                        <input type="checkbox" id="field-required" name="required" ${field.required ? 'checked' : ''}>
                        ${translate("required_field")}
                    </label>
                </div>

                <div class="form-group" id="depends-on-group" ${field.type === 'infoText' ? 'style="display:none;"' : ''}>
                    <label for="depends-on-field">${translate("depends_on")}</label>
                    <select id="depends-on-field" name="dependsOnField">
                        <option value="">${translate("none")}</option>
                        ${booleanFields.map(f => `
                            <option value="${escapeHTML(f.name)}" 
                                    ${field.dependsOn?.field === f.name ? 'selected' : ''}>
                                ${escapeHTML(f.name)}
                            </option>
                        `).join('')}
                    </select>
                    <small>${translate("depends_on_hint")}</small>
                </div>

                <div class="form-group" id="depends-on-value-group" 
                     style="display: ${field.dependsOn?.field ? 'block' : 'none'};">
                    <label for="depends-on-value">${translate("depends_on_value")}</label>
                    <input type="text" id="depends-on-value" name="dependsOnValue" 
                           value="${escapeHTML(field.dependsOn?.value || '')}" 
                           placeholder="yes">
                </div>

                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${translate("save_field")}</button>
                    <button type="button" id="cancel-field-edit" class="btn btn-secondary">${translate("cancel")}</button>
                </div>

                <input type="hidden" id="field-index" value="${fieldIndex !== null ? fieldIndex : ''}">
            </form>
        `);

        modal.style.display = "block";
        this.updateFieldEditorVisibility(field.type);
        this.attachFieldEditorListeners();
    }

    /**
     * Render options editor for select/radio fields
     */
    renderOptionsEditor(options) {
        if (!options || options.length === 0) {
            return `<div class="no-options">${translate("no_options_yet")}</div>`;
        }

        return options.map((option, index) => `
            <div class="option-item" data-option-index="${index}">
                <input type="text" class="option-label" value="${escapeHTML(option.label || '')}" 
                       placeholder="${translate("label_key")}">
                <input type="text" class="option-value" value="${escapeHTML(option.value || '')}" 
                       placeholder="${translate("value")}">
                <button type="button" class="btn-icon remove-option" data-index="${index}">🗑️</button>
            </div>
        `).join('');
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
        const createBtn = document.getElementById("create-new-format");
        if (createBtn) {
            createBtn.addEventListener("click", () => this.createNewFormat());
        }

        // Edit format buttons
        document.querySelectorAll(".edit-format").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const formatId = parseInt(e.target.dataset.formatId);
                this.editFormat(formatId);
            });
        });

        // Delete format buttons
        document.querySelectorAll(".delete-format").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const formatId = parseInt(e.target.dataset.formatId);
                this.deleteFormat(formatId);
            });
        });

        // Close modal buttons
        document.querySelectorAll(".modal .close").forEach(btn => {
            this.addEventListener(btn, "click", (e) => {
                e.target.closest(".modal").style.display = "none";
            });
        });

        // Click outside modal to close (using managed listener for cleanup)
        this.addWindowEventListener("click", (e) => {
            if (e.target.classList.contains("modal")) {
                e.target.style.display = "none";
            }
        });
    }

    /**
     * Attach editor event listeners
     */
    attachEditorListeners() {
        // Save format
        const saveBtn = document.getElementById("save-format");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.saveFormat());
        }

        // Preview format
        const previewBtn = document.getElementById("preview-format");
        if (previewBtn) {
            previewBtn.addEventListener("click", () => this.previewFormat());
        }

        // Copy format
        const copyBtn = document.getElementById("copy-format");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => this.showCopyDialog());
        }

        // Close editor
        const closeBtn = document.getElementById("close-editor");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => this.closeEditor());
        }

        // Add field
        const addFieldBtn = document.getElementById("add-field");
        if (addFieldBtn) {
            addFieldBtn.addEventListener("click", () => this.renderFieldEditor());
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
        document.querySelectorAll(".edit-field").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const index = parseInt(e.target.dataset.index);
                this.renderFieldEditor(index);
            });
        });

        document.querySelectorAll(".delete-field").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const index = parseInt(e.target.dataset.index);
                this.deleteField(index);
            });
        });

        document.querySelectorAll(".move-up").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const index = parseInt(e.target.dataset.index);
                this.moveField(index, -1);
            });
        });

        document.querySelectorAll(".move-down").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const index = parseInt(e.target.dataset.index);
                this.moveField(index, 1);
            });
        });
    }

    /**
     * Attach drag and drop listeners
     */
    attachDragDropListeners() {
        const fieldItems = document.querySelectorAll(".field-item");

        fieldItems.forEach(item => {
            item.addEventListener("dragstart", (e) => {
                this.draggedElement = e.target;
                this.draggedIndex = parseInt(e.target.dataset.fieldIndex);
                e.target.classList.add("dragging");
                e.dataTransfer.effectAllowed = "move";
            });

            item.addEventListener("dragend", (e) => {
                e.target.classList.remove("dragging");
                this.draggedElement = null;
                this.draggedIndex = null;
            });

            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";

                const targetIndex = parseInt(e.currentTarget.dataset.fieldIndex);
                if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
                    e.currentTarget.classList.add("drag-over");
                }
            });

            item.addEventListener("dragleave", (e) => {
                e.currentTarget.classList.remove("drag-over");
            });

            item.addEventListener("drop", (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("drag-over");

                const targetIndex = parseInt(e.currentTarget.dataset.fieldIndex);
                if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
                    this.reorderField(this.draggedIndex, targetIndex);
                }
            });
        });

        // Keyboard navigation
        fieldItems.forEach(item => {
            item.setAttribute("tabindex", "0");
            item.addEventListener("keydown", (e) => {
                const index = parseInt(e.target.dataset.fieldIndex);
                if (e.key === "ArrowUp" && e.ctrlKey) {
                    e.preventDefault();
                    this.moveField(index, -1);
                } else if (e.key === "ArrowDown" && e.ctrlKey) {
                    e.preventDefault();
                    this.moveField(index, 1);
                } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.renderFieldEditor(index);
                } else if (e.key === "Delete") {
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
        const typeSelect = document.getElementById("field-type");
        if (typeSelect) {
            typeSelect.addEventListener("change", (e) => {
                this.updateFieldEditorVisibility(e.target.value);
            });
        }

        // Field name auto-suggest label
        const nameInput = document.getElementById("field-name");
        const labelInput = document.getElementById("field-label");
        if (nameInput && labelInput) {
            nameInput.addEventListener("input", (e) => {
                if (!labelInput.value || labelInput.value === `${nameInput.dataset.oldValue}_label`) {
                    labelInput.value = e.target.value ? `${e.target.value}_label` : '';
                }
                nameInput.dataset.oldValue = e.target.value;
            });
        }

        // Add option button
        const addOptionBtn = document.getElementById("add-option");
        if (addOptionBtn) {
            addOptionBtn.addEventListener("click", () => this.addOptionToEditor());
        }

        // Remove option buttons
        document.querySelectorAll(".remove-option").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.target.closest(".option-item").remove();
            });
        });

        // DependsOn field change
        const dependsOnField = document.getElementById("depends-on-field");
        if (dependsOnField) {
            dependsOnField.addEventListener("change", (e) => {
                const valueGroup = document.getElementById("depends-on-value-group");
                if (valueGroup) {
                    valueGroup.style.display = e.target.value ? "block" : "none";
                }
            });
        }

        // Add translation buttons
        const addLabelTransBtn = document.getElementById("add-label-translation");
        if (addLabelTransBtn) {
            addLabelTransBtn.addEventListener("click", () => {
                const key = document.getElementById("field-label").value;
                this.showTranslationEditor(key);
            });
        }

        const addInfoTransBtn = document.getElementById("add-info-translation");
        if (addInfoTransBtn) {
            addInfoTransBtn.addEventListener("click", () => {
                const key = document.getElementById("field-info-text").value;
                this.showTranslationEditor(key);
            });
        }

        // Form submit
        const form = document.getElementById("field-editor-form");
        if (form) {
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                this.saveField();
            });
        }

        // Cancel button
        const cancelBtn = document.getElementById("cancel-field-edit");
        if (cancelBtn) {
            cancelBtn.addEventListener("click", () => {
                document.getElementById("field-editor-modal").style.display = "none";
            });
        }
    }

    /**
     * Update field editor visibility based on field type
     */
    updateFieldEditorVisibility(fieldType) {
        const nameGroup = document.getElementById("field-name-group");
        const labelGroup = document.getElementById("field-label-group");
        const infoTextGroup = document.getElementById("field-info-text-group");
        const optionsGroup = document.getElementById("field-options-group");
        const dependsOnGroup = document.getElementById("depends-on-group");
        const nameInput = document.getElementById("field-name");
        const labelInput = document.getElementById("field-label");
        const infoTextInput = document.getElementById("field-info-text");

        if (fieldType === 'infoText') {
            nameGroup.style.display = "none";
            labelGroup.style.display = "none";
            infoTextGroup.style.display = "block";
            optionsGroup.style.display = "none";
            dependsOnGroup.style.display = "none";

            if (nameInput) nameInput.required = false;
            if (labelInput) labelInput.required = false;
            if (infoTextInput) infoTextInput.required = true;
        } else {
            nameGroup.style.display = "block";
            labelGroup.style.display = "block";
            infoTextGroup.style.display = "none";
            dependsOnGroup.style.display = "block";
            optionsGroup.style.display = ['select', 'radio'].includes(fieldType) ? "block" : "none";

            if (nameInput) nameInput.required = true;
            if (labelInput) labelInput.required = true;
            if (infoTextInput) infoTextInput.required = false;
        }
    }

    /**
     * Add option to editor
     */
    addOptionToEditor() {
        const container = document.getElementById("options-container");
        const index = container.querySelectorAll(".option-item").length;

        const optionHtml = `
            <div class="option-item" data-option-index="${index}">
                <input type="text" class="option-label" placeholder="${translate("label_key")}">
                <input type="text" class="option-value" placeholder="${translate("value")}">
                <button type="button" class="btn-icon remove-option" data-index="${index}">🗑️</button>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', optionHtml);

        // Attach remove listener
        const newOption = container.lastElementChild;
        newOption.querySelector(".remove-option").addEventListener("click", (e) => {
            e.target.closest(".option-item").remove();
        });
    }

    /**
     * Show translation editor
     */
    showTranslationEditor(key) {
        if (!key) {
            this.app.showMessage(translate("enter_translation_key_first"), "warning");
            return;
        }

        const modal = document.getElementById("translation-modal");
        const content = document.getElementById("translation-content");

        setContent(content, `
            <form id="translation-form">
                <div class="form-group">
                    <label>${translate("translation_key")}</label>
                    <input type="text" value="${escapeHTML(key)}" readonly>
                </div>
                <div class="form-group">
                    <label for="trans-en">${translate("english")}</label>
                    <input type="text" id="trans-en" name="en" required>
                </div>
                <div class="form-group">
                    <label for="trans-fr">${translate("french")}</label>
                    <input type="text" id="trans-fr" name="fr" required>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${translate("save")}</button>
                    <button type="button" class="btn btn-secondary" id="cancel-translation">${translate("cancel")}</button>
                </div>
            </form>
        `);
        modal.style.display = "block";

        // Attach listeners
        const form = document.getElementById("translation-form");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            await this.saveTranslation(key, {
                en: document.getElementById("trans-en").value,
                fr: document.getElementById("trans-fr").value
            });
            modal.style.display = "none";
        });

        document.getElementById("cancel-translation").addEventListener("click", () => {
            modal.style.display = "none";
        });
    }

    /**
     * Save translation
     */
    async saveTranslation(key, translations) {
        try {
            const response = await API.post('v1/form-builder/translations', { key, translations });

            if (response.success) {
                this.app.showMessage(translate("translation_saved"), "success");
            } else {
                this.app.showMessage(response.message || translate("error_saving_translation"), "error");
            }
        } catch (error) {
            debugError("Error saving translation:", error);
            this.app.showMessage(translate("error_saving_translation"), "error");
        }
    }

    /**
     * Save field from editor
     */
    saveField() {
        const form = document.getElementById("field-editor-form");
        const formData = new FormData(form);
        const fieldIndex = document.getElementById("field-index").value;

        const field = {
            type: formData.get("type"),
            name: formData.get("name"),
            label: formData.get("label"),
            required: document.getElementById("field-required").checked
        };

        // Handle infoText type
        if (field.type === 'infoText') {
            field.infoText = formData.get("infoText");
            delete field.name;
            delete field.label;
        }

        // Handle options for select/radio
        if (['select', 'radio'].includes(field.type)) {
            const options = [];
            document.querySelectorAll("#options-container .option-item").forEach(item => {
                const label = item.querySelector(".option-label").value;
                const value = item.querySelector(".option-value").value;
                if (label && value) {
                    options.push({ label, value });
                }
            });
            field.options = options;
        }

        // Handle dependsOn
        const dependsOnField = formData.get("dependsOnField");
        if (dependsOnField && field.type !== 'infoText') {
            field.dependsOn = {
                field: dependsOnField,
                value: formData.get("dependsOnValue") || "yes"
            };
        }

        // Add or update field
        if (fieldIndex === "") {
            this.currentFields.push(field);
        } else {
            this.currentFields[parseInt(fieldIndex)] = field;
        }

        // Close modal and re-render
        document.getElementById("field-editor-modal").style.display = "none";
        this.updateFieldsList();
    }

    /**
     * Update fields list after changes
     */
    updateFieldsList() {
        const container = document.getElementById("fields-container");
        if (container) {
            setContent(container, this.renderFieldsList());
            this.attachFieldActionListeners();
            this.attachDragDropListeners();
        }
    }

    /**
     * Delete a field
     */
    deleteField(index) {
        if (confirm(translate("confirm_delete_field"))) {
            this.currentFields.splice(index, 1);
            this.updateFieldsList();
        }
    }

    /**
     * Move field up or down
     */
    moveField(index, direction) {
        // Direction constants
        const DIRECTION_UP = -1;
        const DIRECTION_DOWN = 1;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this.currentFields.length) return;

        const field = this.currentFields[index];
        this.currentFields.splice(index, 1);
        this.currentFields.splice(newIndex, 0, field);
        this.updateFieldsList();
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
        const modal = document.getElementById("translation-modal");
        const content = document.getElementById("translation-content");

        document.querySelector("#translation-modal h2").textContent = translate("create_new_form_format");

        setContent(content, `
            <form id="create-format-form">
                <div class="form-group">
                    <label for="new-form-type">${translate("form_type_name")} *</label>
                    <input type="text" id="new-form-type" name="formType" required 
                           pattern="[a-z_]+" 
                           placeholder="participant_registration"
                           title="${translate("field_name_hint")}">
                    <small>${translate("field_name_hint")}</small>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${translate("create")}</button>
                    <button type="button" class="btn btn-secondary" id="cancel-create">${translate("cancel")}</button>
                </div>
            </form>
        `);
        modal.style.display = "block";

        // Attach listeners
        const form = document.getElementById("create-format-form");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const formType = document.getElementById("new-form-type").value;
            modal.style.display = "none";
            await this.doCreateFormat(formType);
        });

        document.getElementById("cancel-create").addEventListener("click", () => {
            modal.style.display = "none";
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
                this.app.showMessage(translate("form_format_created"), "success");
                await this.loadData();
                this.render();
                this.attachEventListeners();
                this.editFormat(response.data.id);
            } else {
                this.app.showMessage(response.message || translate("error_creating_format"), "error");
            }
        } catch (error) {
            debugError("Error creating format:", error);
            this.app.showMessage(translate("error_creating_format"), "error");
        }
    }

    /**
     * Edit format
     */
    async editFormat(formatId) {
        const format = this.formFormats.find(f => f.id === formatId);
        if (!format) return;

        this.currentFormat = format;
        this.currentFields = format.form_structure?.fields || [];

        this.renderFormEditor();
        this.attachEditorListeners();

        // Scroll to editor
        document.getElementById("form-editor").scrollIntoView({ behavior: 'smooth' });
    }

    /**
     * Delete format
     */
    async deleteFormat(formatId) {
        if (!confirm(translate("confirm_delete_format"))) return;

        try {
            const response = await API.delete(`v1/form-builder/form-formats/${formatId}`);

            if (response.success) {
                this.app.showMessage(translate("format_deleted"), "success");
                await this.loadData();
                const formatsList = document.getElementById("formats-list");
                if (formatsList) {
                    setContent(formatsList, this.renderFormatsList());
                    this.attachEventListeners();
                }
            } else {
                this.app.showMessage(response.message || translate("error_deleting_format"), "error");
            }
        } catch (error) {
            debugError("Error deleting format:", error);
            this.app.showMessage(translate("error_deleting_format"), "error");
        }
    }

    /**
     * Save format
     */
    async saveFormat() {
        if (!this.currentFormat) return;

        try {
            const response = await API.put(`v1/form-builder/form-formats/${this.currentFormat.id}`, {
                form_structure: { fields: this.currentFields }
            });

            if (response.success) {
                this.app.showMessage(translate("format_saved"), "success");
                this.currentFormat.form_structure = response.data.form_structure;
            } else {
                this.app.showMessage(response.message || translate("error_saving_format"), "error");
            }
        } catch (error) {
            debugError("Error saving format:", error);
            this.app.showMessage(translate("error_saving_format"), "error");
        }
    }

    /**
     * Preview format
     */
    previewFormat() {
        if (!this.currentFormat || !this.currentFields.length) {
            this.app.showMessage(translate("no_fields_to_preview"), "warning");
            return;
        }

        const modal = document.getElementById("preview-modal");
        const content = document.getElementById("preview-content");

        const renderer = new JSONFormRenderer(
            { fields: this.currentFields },
            {},
            this.currentFormat.form_type
        );

        setContent(content, renderer.render());
        modal.style.display = "block";
    }

    /**
     * Show copy dialog
     */
    showCopyDialog() {
        if (this.userOrganizations.length === 0) {
            this.app.showMessage(translate("no_other_organizations"), "warning");
            return;
        }

        // Show a modal for organization selection
        const modal = document.getElementById("translation-modal");
        const content = document.getElementById("translation-content");

        document.querySelector("#translation-modal h2").textContent = translate("copy_to_org");

        setContent(content, `
            <form id="copy-format-form">
                <div class="form-group">
                    <label for="target-org">${translate("select_target_organization")} *</label>
                    <select id="target-org" name="targetOrg" required>
                        <option value="">${translate("select_organization")}</option>
                        ${this.userOrganizations.map(org => `
                            <option value="${org.id}">${escapeHTML(org.name)} (ID: ${org.id})</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${translate("copy")}</button>
                    <button type="button" class="btn btn-secondary" id="cancel-copy">${translate("cancel")}</button>
                </div>
            </form>
        `);
        modal.style.display = "block";

        // Attach listeners
        const form = document.getElementById("copy-format-form");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const targetOrgId = parseInt(document.getElementById("target-org").value);
            modal.style.display = "none";
            await this.copyFormat(targetOrgId);
        });

        document.getElementById("cancel-copy").addEventListener("click", () => {
            modal.style.display = "none";
        });
    }

    /**
     * Copy format to another organization
     */
    async copyFormat(targetOrgId) {
        if (!this.currentFormat) return;

        try {
            // First save current changes
            await this.saveFormat();

            // Get current organization ID from user context
            const currentOrgId = this.app.organizationId;
            if (!currentOrgId) {
                this.app.showMessage(translate("error_organization_not_found"), "error");
                return;
            }

            // Then copy - use simple POST body instead of path params
            const response = await API.post(`v1/form-builder/form-formats/${currentOrgId}/${this.currentFormat.form_type}/copy`, { targetOrgId });

            if (response.success) {
                this.app.showMessage(translate("format_copied"), "success");
            } else {
                this.app.showMessage(response.message || translate("error_copying_format"), "error");
            }
        } catch (error) {
            debugError("Error copying format:", error);
            this.app.showMessage(translate("error_copying_format"), "error");
        }
    }

    /**
     * Close editor
     */
    closeEditor() {
        this.currentFormat = null;
        this.currentFields = [];
        document.getElementById("form-editor").style.display = "none";
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
