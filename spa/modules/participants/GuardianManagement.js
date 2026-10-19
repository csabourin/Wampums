/**
 * Guardian Management — view, edit, add and remove one participant's guardians.
 *
 * Mirrors mobile/src/screens/GuardianManagementScreen.js.
 *
 * @module spa/modules/participants/GuardianManagement
 */

import { translate } from '../../app.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import {
  getGuardiansForParticipant,
  saveGuardian,
  removeGuardians,
  linkGuardianToParticipant,
} from '../../api/api-endpoints.js';
import { validateEmail } from '../../utils/ValidationUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

/** Where this page is reached from, and returns to. */
const BACK_HREF = '/manage-participants';

/** The form's fields, in order: [data key, id suffix, label key, input type, required]. */
const FIELDS = [
  ['prenom', 'prenom', 'first_name', 'text', true],
  ['nom', 'nom', 'last_name', 'text', true],
  ['lien', 'lien', 'relationship', 'text', true],
  ['courriel', 'courriel', 'email', 'email', false],
  ['telephone_cellulaire', 'telephone-cellulaire', 'cell_phone', 'tel', false],
  ['telephone_residence', 'telephone-residence', 'home_phone', 'tel', false],
  ['telephone_travail', 'telephone-travail', 'work_phone', 'tel', false],
];

/** The message shown when a required field is empty, by data key. */
const REQUIRED_MESSAGES = {
  prenom: 'first_name_required',
  nom: 'last_name_required',
  lien: 'relationship_required',
};

export class GuardianManagementModule {
  constructor(app, participantId, participantName) {
    this.app = app;
    this.participantId = participantId;
    this.participantName = participantName;
    this.guardians = [];
    this.editingGuardianId = null;
    this.isAdding = false;
    this.destroyed = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('guardian_management'), className: 'guardian-management', backHref: BACK_HREF };
  }

  async init() {
    debugLog('[GuardianManagement] Initializing for participant:', this.participantId);
    showPageLoading(this.root(), this.pageOptions());
    try {
      await this.loadGuardians();
    } catch (error) {
      debugError('[GuardianManagement] Error loading guardians:', error);
      if (!this.destroyed) {
        showPageError(this.root(), {
          ...this.pageOptions(),
          message: apiErrorMessage(error, 'error_loading_guardians'),
        }, () => this.init());
      }
      return;
    }
    if (!this.destroyed) {
      this.render();
    }
  }

  async loadGuardians() {
    const response = await getGuardiansForParticipant(this.participantId);
    if (!response?.success) {
      throw Object.assign(new Error('guardians_not_loaded'), { status: response?.status });
    }
    this.guardians = Array.isArray(response.data) ? response.data : [];
    debugLog('[GuardianManagement] Loaded guardians:', this.guardians.length);
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const idle = !this.isAdding && !this.editingGuardianId;
    setContent(this.root(), `
      <section class="page guardian-management">
        ${renderBackLink(BACK_HREF)}
        <header class="page__header">
          <h1>${translate('guardian_management')}</h1>
          <p class="page__subtitle">
            ${translate('for_participant')}: <strong>${escapeHTML(this.participantName)}</strong>
          </p>
        </header>

        <div class="guardian-management__content">
          ${idle ? `
            <button type="button" class="button button--success mb-3" id="add-guardian-btn">
              <span aria-hidden="true">➕</span> ${translate('add_guardian')}
            </button>
          ` : ''}

          <div id="guardian-list">
            ${this.renderGuardiansList()}
          </div>

          ${this.isAdding ? this.renderForm('add', null) : ''}
        </div>
      </section>
    `);
    this.attachEventListeners();
  }

  renderGuardiansList() {
    if (this.guardians.length === 0) {
      return `
        <div class="empty-state">
          <p>${translate('no_guardians_found')}</p>
        </div>
      `;
    }

    return this.guardians.map((guardian) => (
      this.editingGuardianId === guardian.id ? this.renderForm('edit', guardian) : this.renderGuardianCard(guardian)
    )).join('');
  }

  /**
   * @param {string} labelKey - Translation key of the label
   * @param {string} value - Raw value
   * @returns {string} HTML for one line of the card, or nothing when empty
   */
  infoRow(labelKey, value) {
    if (!value) {
      return '';
    }
    return `
          <div class="info-row">
            <span class="info-label">${translate(labelKey)}:</span>
            <span class="info-value">${escapeHTML(value)}</span>
          </div>`;
  }

  renderGuardianCard(guardian) {
    const name = `${guardian.prenom || ''} ${guardian.nom || ''}`.trim();
    const canRemove = this.guardians.length > 1;
    const id = Number(guardian.id);

    return `
      <div class="card guardian-card" data-guardian-id="${id}">
        <div class="card__header">
          <h2 class="card__title">${escapeHTML(name)}</h2>
          ${guardian.is_primary ? `<span class="badge badge--primary">${translate('primary')}</span>` : ''}
        </div>

        <div class="card__body">
          ${this.infoRow('relationship', guardian.lien || '-')}
          ${this.infoRow('email', guardian.courriel)}
          ${this.infoRow('cell_phone', guardian.telephone_cellulaire)}
          ${this.infoRow('home_phone', guardian.telephone_residence)}
          ${this.infoRow('work_phone', guardian.telephone_travail)}
        </div>

        <div class="card__footer">
          <button type="button" class="button button--secondary button--small edit-guardian-btn" data-guardian-id="${id}">
            ${translate('edit')}<span class="sr-only"> ${escapeHTML(name)}</span>
          </button>
          <button type="button" class="button button--danger button--small remove-guardian-btn" data-guardian-id="${id}"
                  ${canRemove ? '' : 'disabled'}>
            ${translate('remove')}<span class="sr-only"> ${escapeHTML(name)}</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * The add or edit form. Its submit button sits in the card footer and names
   * the form, so Enter in any field saves instead of reloading the page.
   *
   * @param {'add'|'edit'} mode
   * @param {Object|null} guardian - The guardian being edited
   * @returns {string} HTML
   */
  renderForm(mode, guardian) {
    const formId = `${mode}-guardian-form`;
    const fields = FIELDS.map(([key, suffix, labelKey, type, required]) => {
      const id = `${mode}-${suffix}`;
      return `
            <div class="form-group">
              <label for="${id}"${required ? ' class="required"' : ''}>${translate(labelKey)}</label>
              <input type="${type}" id="${id}" name="${key}" class="form-control"
                     value="${escapeHTML(guardian?.[key] || '')}"${required ? ' required aria-required="true"' : ''}
                     aria-describedby="${id}-error">
              <p id="${id}-error" class="field-error" role="alert"></p>
            </div>`;
    }).join('');

    return `
      <div class="card guardian-${mode}-form"${guardian ? ` data-guardian-id="${Number(guardian.id)}"` : ''}>
        <div class="card__header">
          <h2 class="card__title">${translate(mode === 'add' ? 'add_guardian' : 'edit_guardian')}</h2>
        </div>

        <div class="card__body">
          <form id="${formId}" novalidate>${fields}</form>
        </div>

        <div class="card__footer">
          <button type="button" class="button button--secondary" id="cancel-${mode}-btn">
            ${translate('cancel')}
          </button>
          <button type="submit" form="${formId}" class="button ${mode === 'add' ? 'button--success' : 'button--primary'}">
            ${translate(mode === 'add' ? 'add' : 'save')}
          </button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    document.getElementById('add-guardian-btn')?.addEventListener('click', () => {
      this.isAdding = true;
      this.render();
      document.getElementById('add-prenom')?.focus();
    });

    document.querySelectorAll('.edit-guardian-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.editingGuardianId = Number(e.currentTarget.dataset.guardianId);
        this.render();
        document.getElementById('edit-prenom')?.focus();
      });
    });

    document.querySelectorAll('.remove-guardian-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => this.handleRemove(Number(e.currentTarget.dataset.guardianId)));
    });

    for (const mode of ['add', 'edit']) {
      const form = document.getElementById(`${mode}-guardian-form`);
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        withFormBusy(form, () => (mode === 'add' ? this.handleSaveAdd(form) : this.handleSaveEdit(form)));
      });
      // A field's message clears as soon as it changes.
      form?.addEventListener('input', (event) => this.setFieldError(event.target, ''));
      document.getElementById(`cancel-${mode}-btn`)?.addEventListener('click', () => {
        this.isAdding = false;
        this.editingGuardianId = null;
        this.render();
      });
    }
  }

  /**
   * @param {HTMLInputElement} field
   * @param {string} message - Empty to clear
   * @returns {void}
   */
  setFieldError(field, message) {
    const error = document.getElementById(`${field.id}-error`);
    if (!error) {
      return;
    }
    error.textContent = message;
    field.setAttribute('aria-invalid', String(Boolean(message)));
  }

  /**
   * @param {HTMLFormElement} form
   * @returns {Object} The guardian as the API takes it
   */
  readForm(form) {
    const data = { participant_id: this.participantId };
    FIELDS.forEach(([key]) => {
      data[key] = form.elements.namedItem(key)?.value.trim() || '';
    });
    return data;
  }

  /**
   * Check the form before sending; each problem is shown under its field.
   *
   * @param {HTMLFormElement} form
   * @param {Object} guardianData
   * @returns {boolean} Whether the form can be sent
   */
  validateGuardian(form, guardianData) {
    const problems = {};
    Object.entries(REQUIRED_MESSAGES).forEach(([key, messageKey]) => {
      if (!guardianData[key]) {
        problems[key] = translate(messageKey);
      }
    });
    if (guardianData.courriel && !validateEmail(guardianData.courriel)) {
      problems.courriel = translate('invalid_email');
    }

    FIELDS.forEach(([key]) => {
      const field = form.elements.namedItem(key);
      if (field) {
        this.setFieldError(field, problems[key] || '');
      }
    });
    const firstInvalid = FIELDS.map(([key]) => key).find((key) => problems[key]);
    if (firstInvalid) {
      form.elements.namedItem(firstInvalid)?.focus();
      return false;
    }
    return true;
  }

  async handleSaveEdit(form) {
    const guardianData = { ...this.readForm(form), id: this.editingGuardianId };
    if (!this.validateGuardian(form, guardianData)) {
      return;
    }

    let response;
    try {
      response = await saveGuardian(guardianData);
      if (!response?.success) {
        throw Object.assign(new Error('guardian_not_saved'), { status: response?.status });
      }
    } catch (error) {
      debugError('[GuardianManagement] Error saving guardian:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_saving_guardian'), 'error');
      return;
    }

    this.app.showMessage(translate('guardian_updated_successfully'), 'success');
    this.editingGuardianId = null;
    await this.reload();
  }

  async handleSaveAdd(form) {
    const guardianData = this.readForm(form);
    if (!this.validateGuardian(form, guardianData)) {
      return;
    }

    try {
      const response = await saveGuardian(guardianData);
      if (!response?.success) {
        throw Object.assign(new Error('guardian_not_added'), { status: response?.status });
      }
      const guardianId = response.data?.id || response.data?.parent_id;
      if (guardianId) {
        await linkGuardianToParticipant(this.participantId, guardianId);
      }
    } catch (error) {
      debugError('[GuardianManagement] Error adding guardian:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_adding_guardian'), 'error');
      return;
    }

    this.app.showMessage(translate('guardian_added_successfully'), 'success');
    this.isAdding = false;
    await this.reload();
  }

  async handleRemove(guardianId) {
    if (this.guardians.length === 1) {
      this.app.showMessage(translate('cannot_remove_last_guardian'), 'error');
      return;
    }

    if (!(await confirmDestructive(translate('confirm_remove_guardian')))) {
      return;
    }

    try {
      const response = await removeGuardians(this.participantId, [guardianId]);
      if (!response?.success) {
        throw Object.assign(new Error('guardian_not_removed'), { status: response?.status });
      }
    } catch (error) {
      debugError('[GuardianManagement] Error removing guardian:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_removing_guardian'), 'error');
      return;
    }

    this.app.showMessage(translate('guardian_removed_successfully'), 'success');
    await this.reload();
  }

  /**
   * Reload after a write that the server accepted. The write stands even if the
   * reload fails: the page then offers to try loading again.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    try {
      await this.loadGuardians();
    } catch (error) {
      debugError('[GuardianManagement] Error reloading guardians:', error);
      if (!this.destroyed) {
        showPageError(this.root(), {
          ...this.pageOptions(),
          message: apiErrorMessage(error, 'error_loading_guardians'),
        }, () => this.init());
      }
      return;
    }
    this.render();
  }
}

/**
 * Open guardian management for the participant named in the address
 * (`?participant_id=12&participant_name=…`).
 *
 * @param {Object} app - Application instance
 * @returns {Promise<GuardianManagementModule|null>} The screen, for the router to tear down
 */
export async function initGuardianManagement(app) {
  const urlParams = new URLSearchParams(window.location.search);
  const participantId = Number(urlParams.get('participant_id'));
  const participantName = urlParams.get('participant_name');

  if (!Number.isInteger(participantId) || participantId <= 0 || !participantName) {
    showPageError(document.getElementById('app'), {
      title: translate('guardian_management'),
      className: 'guardian-management',
      backHref: BACK_HREF,
      message: translate('invalid_parameters'),
    });
    return null;
  }

  const module = new GuardianManagementModule(app, participantId, participantName);
  await module.init();
  return module;
}
