/**
 * Guardian Management Module
 *
 * Allows viewing, editing, and removing guardians for a participant
 * Addresses P0 critical gap: dedicated guardian management post-registration
 * Mirrors mobile/src/screens/GuardianManagementScreen.js functionality
 */

import { translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { sanitizeHTML, escapeHTML } from './utils/SecurityUtils.js';
import { setContent } from './utils/DOMUtils.js';
import {
  getGuardiansForParticipant,
  saveGuardian,
  removeGuardians,
  linkGuardianToParticipant,
} from './api/api-endpoints.js';
import { validateEmail } from './utils/ValidationUtils.js';

export class GuardianManagementModule {
  constructor(app, participantId, participantName) {
    this.app = app;
    this.participantId = participantId;
    this.participantName = participantName;
    this.guardians = [];
    this.editingGuardianId = null;
    this.isAdding = false;
  }

  async init() {
    debugLog('[GuardianManagement] Initializing for participant:', this.participantId);
    await this.loadGuardians();
    this.render();
  }

  async loadGuardians() {
    try {
      debugLog('[GuardianManagement] Loading guardians');
      const response = await getGuardiansForParticipant(this.participantId);

      if (response.success) {
        this.guardians = response.data || [];
        debugLog('[GuardianManagement] Loaded guardians:', this.guardians.length);
      } else {
        throw new Error(response.message || translate('error_loading_guardians'));
      }
    } catch (error) {
      debugError('[GuardianManagement] Error loading guardians:', error);
      this.app.showMessage(translate('error_loading_guardians'), 'error');
      throw error;
    }
  }

  render() {
    const container = document.getElementById('app');

    const html = `
      <section class="page guardian-management">
        <header class="page__header">
          <h1>${translate('guardian_management')}</h1>
          <p class="page__subtitle">
            ${translate('for_participant')}: <strong>${escapeHTML(this.participantName)}</strong>
          </p>
        </header>

        <div class="guardian-management__content">
          ${!this.isAdding && !this.editingGuardianId ? `
            <button class="button button--success mb-3" id="add-guardian-btn">
              ➕ ${translate('add_guardian')}
            </button>
          ` : ''}

          <div id="guardian-list">
            ${this.renderGuardiansList()}
          </div>

          ${this.isAdding ? this.renderAddForm() : ''}
        </div>
      </section>
    `;

    setContent(container, html);
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

    return this.guardians.map((guardian) => {
      if (this.editingGuardianId === guardian.id) {
        return this.renderEditForm(guardian);
      }
      return this.renderGuardianCard(guardian);
    }).join('');
  }

  renderGuardianCard(guardian) {
    const safeName = escapeHTML(`${guardian.prenom || ''} ${guardian.nom || ''}`);
    const safeRelationship = escapeHTML(guardian.lien || '-');
    const safeEmail = escapeHTML(guardian.courriel || '');
    const canRemove = this.guardians.length > 1;

    return `
      <div class="card guardian-card" data-guardian-id="${guardian.id}">
        <div class="card__header">
          <h3 class="card__title">${safeName}</h3>
          ${guardian.is_primary ? `
            <span class="badge badge--primary">${translate('primary')}</span>
          ` : ''}
        </div>

        <div class="card__body">
          <div class="info-row">
            <span class="info-label">${translate('relationship')}:</span>
            <span class="info-value">${safeRelationship}</span>
          </div>

          ${guardian.courriel ? `
            <div class="info-row">
              <span class="info-label">${translate('email')}:</span>
              <span class="info-value">${safeEmail}</span>
            </div>
          ` : ''}

          ${guardian.telephone_cellulaire ? `
            <div class="info-row">
              <span class="info-label">${translate('cell_phone')}:</span>
              <span class="info-value">${escapeHTML(guardian.telephone_cellulaire)}</span>
            </div>
          ` : ''}

          ${guardian.telephone_residence ? `
            <div class="info-row">
              <span class="info-label">${translate('home_phone')}:</span>
              <span class="info-value">${escapeHTML(guardian.telephone_residence)}</span>
            </div>
          ` : ''}

          ${guardian.telephone_travail ? `
            <div class="info-row">
              <span class="info-label">${translate('work_phone')}:</span>
              <span class="info-value">${escapeHTML(guardian.telephone_travail)}</span>
            </div>
          ` : ''}
        </div>

        <div class="card__footer">
          <button class="button button--secondary button--small edit-guardian-btn" data-guardian-id="${guardian.id}">
            ${translate('edit')}
          </button>
          <button class="button button--danger button--small remove-guardian-btn"
                  data-guardian-id="${guardian.id}"
                  ${!canRemove ? 'disabled' : ''}>
            ${translate('remove')}
          </button>
        </div>
      </div>
    `;
  }

  renderEditForm(guardian) {
    return `
      <div class="card guardian-edit-form" data-guardian-id="${guardian.id}">
        <div class="card__header">
          <h3 class="card__title">${translate('edit_guardian')}</h3>
        </div>

        <div class="card__body">
          <form id="edit-guardian-form">
            <div class="form-group">
              <label for="edit-prenom" class="required">${translate('first_name')}</label>
              <input type="text" id="edit-prenom" class="form-control"
                     value="${escapeHTML(guardian.prenom || '')}" required>
            </div>

            <div class="form-group">
              <label for="edit-nom" class="required">${translate('last_name')}</label>
              <input type="text" id="edit-nom" class="form-control"
                     value="${escapeHTML(guardian.nom || '')}" required>
            </div>

            <div class="form-group">
              <label for="edit-lien" class="required">${translate('relationship')}</label>
              <input type="text" id="edit-lien" class="form-control"
                     value="${escapeHTML(guardian.lien || '')}" required>
            </div>

            <div class="form-group">
              <label for="edit-courriel">${translate('email')}</label>
              <input type="email" id="edit-courriel" class="form-control"
                     value="${escapeHTML(guardian.courriel || '')}">
            </div>

            <div class="form-group">
              <label for="edit-telephone-cellulaire">${translate('cell_phone')}</label>
              <input type="tel" id="edit-telephone-cellulaire" class="form-control"
                     value="${escapeHTML(guardian.telephone_cellulaire || '')}">
            </div>

            <div class="form-group">
              <label for="edit-telephone-residence">${translate('home_phone')}</label>
              <input type="tel" id="edit-telephone-residence" class="form-control"
                     value="${escapeHTML(guardian.telephone_residence || '')}">
            </div>

            <div class="form-group">
              <label for="edit-telephone-travail">${translate('work_phone')}</label>
              <input type="tel" id="edit-telephone-travail" class="form-control"
                     value="${escapeHTML(guardian.telephone_travail || '')}">
            </div>
          </form>
        </div>

        <div class="card__footer">
          <button class="button button--secondary cancel-edit-btn" data-guardian-id="${guardian.id}">
            ${translate('cancel')}
          </button>
          <button class="button button--primary save-edit-btn" data-guardian-id="${guardian.id}">
            ${translate('save')}
          </button>
        </div>
      </div>
    `;
  }

  renderAddForm() {
    return `
      <div class="card guardian-add-form">
        <div class="card__header">
          <h3 class="card__title">${translate('add_guardian')}</h3>
        </div>

        <div class="card__body">
          <form id="add-guardian-form">
            <div class="form-group">
              <label for="add-prenom" class="required">${translate('first_name')}</label>
              <input type="text" id="add-prenom" class="form-control" required>
            </div>

            <div class="form-group">
              <label for="add-nom" class="required">${translate('last_name')}</label>
              <input type="text" id="add-nom" class="form-control" required>
            </div>

            <div class="form-group">
              <label for="add-lien" class="required">${translate('relationship')}</label>
              <input type="text" id="add-lien" class="form-control" required>
            </div>

            <div class="form-group">
              <label for="add-courriel">${translate('email')}</label>
              <input type="email" id="add-courriel" class="form-control">
            </div>

            <div class="form-group">
              <label for="add-telephone-cellulaire">${translate('cell_phone')}</label>
              <input type="tel" id="add-telephone-cellulaire" class="form-control">
            </div>

            <div class="form-group">
              <label for="add-telephone-residence">${translate('home_phone')}</label>
              <input type="tel" id="add-telephone-residence" class="form-control">
            </div>

            <div class="form-group">
              <label for="add-telephone-travail">${translate('work_phone')}</label>
              <input type="tel" id="add-telephone-travail" class="form-control">
            </div>
          </form>
        </div>

        <div class="card__footer">
          <button class="button button--secondary" id="cancel-add-btn">
            ${translate('cancel')}
          </button>
          <button class="button button--success" id="save-add-btn">
            ${translate('add')}
          </button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Add guardian button
    document.getElementById('add-guardian-btn')?.addEventListener('click', () => {
      this.isAdding = true;
      this.render();
    });

    // Edit buttons
    document.querySelectorAll('.edit-guardian-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const guardianId = parseInt(e.target.dataset.guardianId);
        this.editingGuardianId = guardianId;
        this.render();
      });
    });

    // Remove buttons
    document.querySelectorAll('.remove-guardian-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const guardianId = parseInt(e.target.dataset.guardianId);
        await this.handleRemove(guardianId);
      });
    });

    // Save edit button
    document.querySelectorAll('.save-edit-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const guardianId = parseInt(e.target.dataset.guardianId);
        await this.handleSaveEdit(guardianId);
      });
    });

    // Cancel edit button
    document.querySelectorAll('.cancel-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editingGuardianId = null;
        this.render();
      });
    });

    // Save add button
    document.getElementById('save-add-btn')?.addEventListener('click', async () => {
      await this.handleSaveAdd();
    });

    // Cancel add button
    document.getElementById('cancel-add-btn')?.addEventListener('click', () => {
      this.isAdding = false;
      this.render();
    });
  }

  validateGuardian(guardianData) {
    if (!guardianData.prenom?.trim()) {
      this.app.showMessage(translate('first_name_required'), 'warning');
      return false;
    }
    if (!guardianData.nom?.trim()) {
      this.app.showMessage(translate('last_name_required'), 'warning');
      return false;
    }
    if (!guardianData.lien?.trim()) {
      this.app.showMessage(translate('relationship_required'), 'warning');
      return false;
    }
    if (guardianData.courriel && !validateEmail(guardianData.courriel)) {
      this.app.showMessage(translate('invalid_email'), 'warning');
      return false;
    }
    return true;
  }

  async handleSaveEdit(guardianId) {
    try {
      const form = document.getElementById('edit-guardian-form');
      const guardianData = {
        id: guardianId,
        prenom: form.querySelector('#edit-prenom').value,
        nom: form.querySelector('#edit-nom').value,
        lien: form.querySelector('#edit-lien').value,
        courriel: form.querySelector('#edit-courriel').value,
        telephone_cellulaire: form.querySelector('#edit-telephone-cellulaire').value,
        telephone_residence: form.querySelector('#edit-telephone-residence').value,
        telephone_travail: form.querySelector('#edit-telephone-travail').value,
        participant_id: this.participantId,
      };

      if (!this.validateGuardian(guardianData)) {
        return;
      }

      debugLog('[GuardianManagement] Saving guardian:', guardianId);

      const response = await saveGuardian(guardianData);

      if (response.success) {
        this.app.showMessage(
          translate('guardian_updated_successfully'),
          'success',
        );
        this.editingGuardianId = null;
        await this.loadGuardians();
        this.render();
      } else {
        throw new Error(response.message || translate('error_saving_guardian'));
      }
    } catch (error) {
      debugError('[GuardianManagement] Error saving guardian:', error);
      this.app.showMessage(translate('error_saving_guardian'), 'error');
    }
  }

  async handleSaveAdd() {
    try {
      const form = document.getElementById('add-guardian-form');
      const guardianData = {
        prenom: form.querySelector('#add-prenom').value,
        nom: form.querySelector('#add-nom').value,
        lien: form.querySelector('#add-lien').value,
        courriel: form.querySelector('#add-courriel').value,
        telephone_cellulaire: form.querySelector('#add-telephone-cellulaire').value,
        telephone_residence: form.querySelector('#add-telephone-residence').value,
        telephone_travail: form.querySelector('#add-telephone-travail').value,
        participant_id: this.participantId,
      };

      if (!this.validateGuardian(guardianData)) {
        return;
      }

      debugLog('[GuardianManagement] Adding new guardian');

      const response = await saveGuardian(guardianData);

      if (response.success) {
        // Link guardian to participant
        const guardianId = response.data?.id || response.data?.parent_id;
        if (guardianId) {
          await linkGuardianToParticipant(this.participantId, guardianId);
        }

        this.app.showMessage(translate('guardian_added_successfully'), 'success');
        this.isAdding = false;
        await this.loadGuardians();
        this.render();
      } else {
        throw new Error(response.message || translate('error_adding_guardian'));
      }
    } catch (error) {
      debugError('[GuardianManagement] Error adding guardian:', error);
      this.app.showMessage(translate('error_adding_guardian'), 'error');
    }
  }

  async handleRemove(guardianId) {
    if (this.guardians.length === 1) {
      this.app.showMessage(translate('cannot_remove_last_guardian'), 'warning');
      return;
    }

    const guardian = this.guardians.find((g) => g.id === guardianId);
    const guardianName = `${guardian.prenom} ${guardian.nom}`;

    if (!confirm(translate('confirm_remove_guardian', { name: guardianName }))) {
      return;
    }

    try {
      debugLog('[GuardianManagement] Removing guardian:', guardianId);

      const response = await removeGuardians(this.participantId, [guardianId]);

      if (response.success) {
        this.app.showMessage(
          translate('guardian_removed_successfully'),
          'success',
        );
        await this.loadGuardians();
        this.render();
      } else {
        throw new Error(response.message || translate('error_removing_guardian'));
      }
    } catch (error) {
      debugError('[GuardianManagement] Error removing guardian:', error);
      this.app.showMessage(translate('error_removing_guardian'), 'error');
    }
  }
}

// Initialize guardian management from URL parameters
export async function initGuardianManagement(app) {
  const urlParams = new URLSearchParams(window.location.search);
  const participantId = parseInt(urlParams.get('participant_id'));
  const participantName = urlParams.get('participant_name');

  if (!participantId || !participantName) {
    this.app.showMessage(translate('invalid_parameters'), 'error');
    window.location.hash = '#/manage_participants';
    return;
  }

  const module = new GuardianManagementModule(app, participantId, decodeURIComponent(participantName));
  await module.init();
}
