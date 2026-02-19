/**
 * Incident Report Module
 *
 * Provides a full-featured interface for creating, editing, viewing, and
 * listing incident/accident reports. Uses the formBuilder system for the
 * form template and supports pre-filling from participant, user, and
 * activity data.
 *
 * Views: list | create | edit | view
 */
import { translate } from '../../app.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';

import { hasPermission } from '../../utils/PermissionUtils.js';
import { JSONFormRenderer } from '../../JSONFormRenderer.js';
import { API } from '../../api/api-core.js';
import {
  getIncidentReports,
  getIncidentReport,
  createIncidentReport,
  updateIncidentReport,
  deleteIncidentReport,
  submitIncidentReport,
  getIncidentPrefillParticipant,
  getIncidentPrefillUser,
  getIncidentPrefillActivity,
  getEscalationContacts,
  addEscalationContact,
  deleteEscalationContact
} from '../../api/api-incidents.js';
import { getParticipants, getUsers } from '../../api/api-endpoints.js';
import { getActivities } from '../../api/api-activities.js';

export class IncidentReport {
  constructor(app, options = {}) {
    this.app = app;
    this.view = options.view || 'list';
    this.incidentId = options.incidentId || null;
    this.canManage = hasPermission('incidents.manage');

    // Data
    this.incidents = [];
    this.currentIncident = null;
    this.formStructure = null;
    this.formRenderer = null;
    this.participants = [];
    this.users = [];
    this.activities = [];
    this.escalationContacts = [];

    // Form state
    this.victimType = 'participant';
    this.selectedParticipantId = null;
    this.selectedUserId = null;
    this.selectedActivityId = null;
    this.prefillData = {};
  }

  async init() {
    debugLog('IncidentReport init, view:', this.view);
    try {
      this.injectStyles();
      switch (this.view) {
        case 'list':
          await this.initList();
          break;
        case 'create':
          await this.initForm();
          break;
        case 'edit':
          await this.initForm(this.incidentId);
          break;
        case 'view':
          await this.initView(this.incidentId);
          break;
      }
    } catch (err) {
      debugError('IncidentReport init error:', err);
      this.app.showMessage(translate('error_loading_data'), 'error');
    }
  }

  destroy() {
    debugLog('IncidentReport destroy');
  }

  // ============================================================
  // List view
  // ============================================================

  async initList() {
    this.incidents = await getIncidentReports({ forceRefresh: true });
    this.renderList();
    this.attachListListeners();
  }

  renderList() {
    const container = document.getElementById('app');
    const lang = localStorage.getItem('language') || 'en';

    const rows = this.incidents.map(inc => {
      const victimName = this.getVictimDisplayName(inc);
      const statusClass = inc.status === 'submitted' ? 'badge--success' : 'badge--warning';
      const statusLabel = inc.status === 'submitted'
        ? translate('incident_status_submitted')
        : translate('incident_status_draft');
      const dateStr = inc.incident_date ? formatDate(inc.incident_date, lang) : '—';

      return `
        <tr>
          <td>${escapeHTML(dateStr)}</td>
          <td>${escapeHTML(victimName)}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
          <td>
            ${inc.status === 'draft' && this.canManage
              ? `<button class="btn btn--small btn--secondary incident-edit-btn" data-id="${inc.id}">${translate('Edit')}</button>`
              : `<button class="btn btn--small btn--secondary incident-view-btn" data-id="${inc.id}">${translate('View')}</button>`
            }
            ${inc.status === 'draft' && this.canManage
              ? `<button class="btn btn--small btn--danger incident-delete-btn" data-id="${inc.id}">${translate('Delete')}</button>`
              : ''
            }
          </td>
        </tr>`;
    }).join('');

    const html = `
      <section class="page incident-reports-page">
        <header class="page__header">
          <h1>${translate('incident_reports_title')}</h1>
          <div class="page__actions">
            ${this.canManage ? `
              <button class="btn btn--secondary" id="incident-escalation-btn">
                ${translate('incident_escalation_settings')}
              </button>
              <button class="btn btn--primary" id="incident-new-btn">
                + ${translate('incident_new')}
              </button>
            ` : ''}
          </div>
        </header>

        ${this.incidents.length === 0 ? `
          <div class="empty-state">
            <p>${translate('incident_empty_list')}</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>${translate('incident_list_date')}</th>
                  <th>${translate('incident_list_victim')}</th>
                  <th>${translate('incident_list_status')}</th>
                  <th>${translate('incident_list_actions')}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `}
      </section>`;

    setContent(container, html);
  }

  attachListListeners() {
    document.getElementById('incident-new-btn')?.addEventListener('click', () => {
      this.app.router.navigate('/incident-reports/new');
    });

    document.getElementById('incident-escalation-btn')?.addEventListener('click', () => {
      this.showEscalationModal();
    });

    document.querySelectorAll('.incident-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.app.router.navigate(`/incident-reports/${btn.dataset.id}/edit`);
      });
    });

    document.querySelectorAll('.incident-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.app.router.navigate(`/incident-reports/${btn.dataset.id}`);
      });
    });

    document.querySelectorAll('.incident-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(translate('incident_confirm_delete'))) return;
        try {
          await deleteIncidentReport(parseInt(btn.dataset.id));
          this.app.showMessage(translate('incident_deleted'), 'success');
          await this.initList();
        } catch (err) {
          debugError('Delete incident failed:', err);
          this.app.showMessage(translate('error_generic'), 'error');
        }
      });
    });
  }

  // ============================================================
  // Form view (create/edit)
  // ============================================================

  async initForm(incidentId = null) {
    // Load form structure
    const formStructureResponse = await API.get('v1/forms/structure/incident_report');
    this.formStructure = formStructureResponse?.data?.form_structure || formStructureResponse?.form_structure;

    if (!this.formStructure) {
      this.app.showMessage(translate('error_loading_data'), 'error');
      return;
    }

    // Load supporting data in parallel
    const [participantsResp, activitiesResp] = await Promise.all([
      getParticipants({ forceRefresh: false }),
      getActivities({ forceRefresh: false })
    ]);

    this.participants = Array.isArray(participantsResp) ? participantsResp : (participantsResp?.data || []);
    this.activities = Array.isArray(activitiesResp) ? activitiesResp : (activitiesResp?.data || []);

    // If editing, load existing data
    let existingFormData = {};
    if (incidentId) {
      this.currentIncident = await getIncidentReport(incidentId);
      if (this.currentIncident) {
        existingFormData = this.currentIncident.submission_data || {};
        this.victimType = this.currentIncident.victim_type || 'participant';
        this.selectedParticipantId = this.currentIncident.victim_participant_id;
        this.selectedUserId = this.currentIncident.victim_user_id;
        this.selectedActivityId = this.currentIncident.activity_id;
      }
    } else {
      // Pre-fill author from current user
      const fullName = localStorage.getItem('userFullName') || '';
      const parts = fullName.trim().split(/\s+/);
      existingFormData.author_first_name = parts[0] || '';
      existingFormData.author_last_name = parts.slice(1).join(' ') || '';
      existingFormData.author_email = localStorage.getItem('userEmail') || '';
      existingFormData.report_date = new Date().toISOString().split('T')[0];
    }

    this.formRenderer = new JSONFormRenderer(this.formStructure, existingFormData, 'incident_report');
    this.renderForm();
    this.attachFormListeners();
  }

  renderForm() {
    const container = document.getElementById('app');
    const isEdit = !!this.incidentId;
    const title = isEdit ? translate('incident_edit') : translate('incident_new');
    const lang = localStorage.getItem('language') || 'en';

    const participantOptions = this.participants.map(p =>
      `<option value="${p.id}" ${p.id === this.selectedParticipantId ? 'selected' : ''}>${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}</option>`
    ).join('');

    const activityOptions = this.activities.map(a => {
      const dateStr = a.activity_date ? formatDate(a.activity_date, lang) : '';
      return `<option value="${a.id}" ${a.id === this.selectedActivityId ? 'selected' : ''}>${escapeHTML(a.name)} (${dateStr})</option>`;
    }).join('');

    const formHtml = this.formRenderer.render();

    const html = `
      <section class="page incident-form-page">
        <header class="page__header">
          <button class="btn btn--secondary" id="incident-back-btn">&larr; ${translate('Back')}</button>
          <h1>${title}</h1>
        </header>

        <div class="incident-form-container">
          <!-- Victim type selector -->
          <div class="form-section">
            <h3>${translate('incident_select_victim_type')}</h3>
            <div class="radio-group">
              <label><input type="radio" name="victim_type" value="participant" ${this.victimType === 'participant' ? 'checked' : ''}> ${translate('incident_victim_participant')}</label>
              <label><input type="radio" name="victim_type" value="leader" ${this.victimType === 'leader' ? 'checked' : ''}> ${translate('incident_victim_leader')}</label>
              <label><input type="radio" name="victim_type" value="parent" ${this.victimType === 'parent' ? 'checked' : ''}> ${translate('incident_victim_parent')}</label>
              <label><input type="radio" name="victim_type" value="other" ${this.victimType === 'other' ? 'checked' : ''}> ${translate('incident_victim_other')}</label>
            </div>
          </div>

          <!-- Participant selector (shown when victim_type=participant) -->
          <div class="form-section" id="participant-selector-section" style="${this.victimType === 'participant' ? '' : 'display:none'}">
            <label for="participant-select">${translate('incident_select_participant')}</label>
            <select id="participant-select" class="form-control">
              <option value="">-- ${translate('incident_select_participant')} --</option>
              ${participantOptions}
            </select>
          </div>

          <!-- User selector (shown when victim_type=leader or parent) -->
          <div class="form-section" id="user-selector-section" style="${['leader', 'parent'].includes(this.victimType) ? '' : 'display:none'}">
            <label for="user-select">${translate('incident_select_victim_type')}</label>
            <select id="user-select" class="form-control">
              <option value="">-- ${translate('incident_select_victim_type')} --</option>
            </select>
          </div>

          <!-- Activity link -->
          <div class="form-section">
            <label for="activity-select">${translate('incident_select_activity')}</label>
            <select id="activity-select" class="form-control">
              <option value="">${translate('incident_manual_entry')}</option>
              ${activityOptions}
            </select>
          </div>

          <!-- Form body rendered by JSONFormRenderer -->
          <form id="incident-form" class="incident-form">
            ${formHtml}
          </form>

          <!-- Action buttons -->
          <div class="form-actions">
            <button class="btn btn--secondary" id="incident-save-draft-btn">
              ${translate('incident_save_draft')}
            </button>
            <button class="btn btn--primary" id="incident-submit-btn">
              ${translate('incident_submit')}
            </button>
          </div>
        </div>
      </section>`;

    setContent(container, html);

    // If user type needs users list, load it
    if (['leader', 'parent'].includes(this.victimType)) {
      this.loadUsersDropdown();
    }
  }

  attachFormListeners() {
    // Back button
    document.getElementById('incident-back-btn')?.addEventListener('click', () => {
      this.app.router.navigate('/incident-reports');
    });

    // Victim type radio
    document.querySelectorAll('input[name="victim_type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.victimType = e.target.value;
        const participantSection = document.getElementById('participant-selector-section');
        const userSection = document.getElementById('user-selector-section');

        if (participantSection) {
          participantSection.style.display = this.victimType === 'participant' ? '' : 'none';
        }
        if (userSection) {
          userSection.style.display = ['leader', 'parent'].includes(this.victimType) ? '' : 'none';
          if (['leader', 'parent'].includes(this.victimType)) {
            this.loadUsersDropdown();
          }
        }
      });
    });

    // Participant selector -> prefill
    document.getElementById('participant-select')?.addEventListener('change', async (e) => {
      const pid = parseInt(e.target.value);
      if (!pid) return;
      this.selectedParticipantId = pid;
      try {
        const prefill = await getIncidentPrefillParticipant(pid);
        this.applyPrefill(prefill);
        this.app.showMessage(translate('incident_prefill_applied'), 'success');
      } catch (err) {
        debugError('Participant prefill failed:', err);
      }
    });

    // User selector -> prefill
    document.getElementById('user-select')?.addEventListener('change', async (e) => {
      const uid = e.target.value;
      if (!uid) return;
      this.selectedUserId = uid;
      try {
        const prefill = await getIncidentPrefillUser(uid);
        this.applyPrefill(prefill);
        this.app.showMessage(translate('incident_prefill_applied'), 'success');
      } catch (err) {
        debugError('User prefill failed:', err);
      }
    });

    // Activity selector -> prefill
    document.getElementById('activity-select')?.addEventListener('change', async (e) => {
      const aid = parseInt(e.target.value);
      if (!aid) {
        this.selectedActivityId = null;
        return;
      }
      this.selectedActivityId = aid;
      try {
        const prefill = await getIncidentPrefillActivity(aid);
        this.applyPrefill(prefill);
        this.app.showMessage(translate('incident_activity_prefill_applied'), 'success');
      } catch (err) {
        debugError('Activity prefill failed:', err);
      }
    });

    // Save draft
    document.getElementById('incident-save-draft-btn')?.addEventListener('click', async () => {
      await this.handleSave();
    });

    // Submit
    document.getElementById('incident-submit-btn')?.addEventListener('click', async () => {
      if (!confirm(translate('incident_confirm_submit'))) return;
      await this.handleSubmit();
    });

    // Wire up dependsOn conditional logic
    this.setupDependsOn();
  }

  /**
   * Load users dropdown for leader/parent victim type
   */
  async loadUsersDropdown() {
    try {
      const usersResp = await getUsers();
      this.users = usersResp?.data || usersResp || [];
      const select = document.getElementById('user-select');
      if (!select) return;

      const currentVal = this.selectedUserId || '';
      select.textContent = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = `-- ${translate('incident_select_victim_type')} --`;
      select.appendChild(defaultOpt);
      (Array.isArray(this.users) ? this.users : []).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.full_name || u.email;
        if (u.id === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      debugError('Failed to load users:', err);
    }
  }

  /**
   * Apply prefill data to form fields
   */
  applyPrefill(prefill) {
    if (!prefill) return;
    const form = document.getElementById('incident-form');
    if (!form) return;

    Object.entries(prefill).forEach(([fieldName, value]) => {
      if (!value) return;
      const field = form.querySelector(`[name="${fieldName}"]`);
      if (field) {
        field.value = value;
        // Trigger change event for dependsOn
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  /**
   * Setup dependsOn conditional field toggling
   */
  setupDependsOn() {
    const form = document.getElementById('incident-form');
    if (!form || !this.formStructure?.fields) return;

    const dependentFields = this.formStructure.fields.filter(f => f.dependsOn);

    dependentFields.forEach(depField => {
      const controlField = depField.dependsOn.field;
      const requiredValue = depField.dependsOn.value;

      // Find controlling elements (could be radio group)
      const controllers = form.querySelectorAll(`[name="${controlField}"]`);
      const depElements = form.querySelectorAll(`[name="${depField.name}"]`);
      const depGroup = depElements[0]?.closest('.form-group');

      const updateVisibility = () => {
        let controlValue = '';
        controllers.forEach(c => {
          if (c.type === 'radio' && c.checked) controlValue = c.value;
          else if (c.type !== 'radio') controlValue = c.value;
        });

        // For multi-select checkboxes, check if value is in the selected set
        const isVisible = controlValue === requiredValue ||
          (controlValue && controlValue.split(',').includes(requiredValue));

        if (depGroup) {
          depGroup.style.display = isVisible ? '' : 'none';
        }
        depElements.forEach(el => {
          el.disabled = !isVisible;
        });
      };

      controllers.forEach(c => {
        c.addEventListener('change', updateVisibility);
      });

      // Initial state
      updateVisibility();
    });
  }

  /**
   * Collect form data from the DOM
   */
  collectFormData() {
    const form = document.getElementById('incident-form');
    if (!form) return {};

    if (this.formRenderer) {
      return this.formRenderer.getFormData(form);
    }

    // Fallback
    const formData = new FormData(form);
    const result = {};
    const allKeys = [...formData.keys()];
    const multiKeys = new Set(allKeys.filter((k, i) => allKeys.indexOf(k) !== i));

    for (const [key, val] of formData.entries()) {
      if (multiKeys.has(key)) {
        if (!result[key]) {
          result[key] = formData.getAll(key).join(',');
        }
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * Save incident report as draft
   */
  async handleSave() {
    const formData = this.collectFormData();

    const payload = {
      victim_type: this.victimType,
      victim_participant_id: this.victimType === 'participant' ? this.selectedParticipantId : null,
      victim_user_id: ['leader', 'parent'].includes(this.victimType) ? this.selectedUserId : null,
      victim_name: this.victimType === 'other'
        ? `${formData.victim_first_name || ''} ${formData.victim_last_name || ''}`.trim()
        : null,
      activity_id: this.selectedActivityId,
      form_data: formData
    };

    try {
      if (this.incidentId) {
        await updateIncidentReport(this.incidentId, payload);
        this.app.showMessage(translate('incident_updated'), 'success');
      } else {
        const created = await createIncidentReport(payload);
        this.incidentId = created.id;
        this.currentIncident = created;
        this.app.showMessage(translate('incident_created'), 'success');
        // Update URL to edit mode without re-rendering
        history.replaceState(null, '', `/incident-reports/${this.incidentId}/edit`);
      }
    } catch (err) {
      debugError('Save incident failed:', err);
      this.app.showMessage(translate('error_generic'), 'error');
    }
  }

  /**
   * Submit incident report (save + submit)
   */
  async handleSubmit() {
    // Save first
    await this.handleSave();

    if (!this.incidentId) {
      this.app.showMessage(translate('error_generic'), 'error');
      return;
    }

    try {
      const result = await submitIncidentReport(this.incidentId);

      if (result && result.status === 'submitted') {
        if (!navigator.onLine) {
          this.app.showMessage(translate('incident_submitted_offline'), 'info');
        } else {
          this.app.showMessage(translate('incident_submitted'), 'success');
        }
        this.app.router.navigate('/incident-reports');
      }
    } catch (err) {
      debugError('Submit incident failed:', err);
      // If offline, the mutation was queued by OfflineManager
      if (!navigator.onLine) {
        this.app.showMessage(translate('incident_submitted_offline'), 'info');
        this.app.router.navigate('/incident-reports');
      } else {
        this.app.showMessage(translate('error_generic'), 'error');
      }
    }
  }

  // ============================================================
  // View (read-only)
  // ============================================================

  async initView(incidentId) {
    if (!incidentId) return;
    this.currentIncident = await getIncidentReport(incidentId);
    if (!this.currentIncident) {
      this.app.showMessage(translate('error_loading_data'), 'error');
      return;
    }

    // Load form structure for field labels
    const formStructureResponse = await API.get('v1/forms/structure/incident_report');
    this.formStructure = formStructureResponse?.data?.form_structure || formStructureResponse?.form_structure;

    this.renderView();
    this.attachViewListeners();
  }

  renderView() {
    const container = document.getElementById('app');
    const inc = this.currentIncident;
    const formData = inc.submission_data || {};
    const lang = localStorage.getItem('language') || 'en';

    // Render form read-only if structure available
    let formHtml = '';
    if (this.formStructure) {
      const renderer = new JSONFormRenderer(this.formStructure, formData, 'incident_report_view');
      formHtml = renderer.render();
    }

    const victimName = this.getVictimDisplayName(inc);
    const statusClass = inc.status === 'submitted' ? 'badge--success' : 'badge--warning';
    const statusLabel = inc.status === 'submitted'
      ? translate('incident_status_submitted')
      : translate('incident_status_draft');

    const html = `
      <section class="page incident-view-page">
        <header class="page__header">
          <button class="btn btn--secondary" id="incident-back-btn">&larr; ${translate('Back')}</button>
          <h1>${translate('incident_view')}</h1>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </header>

        <div class="incident-view-meta">
          <p><strong>${translate('incident_list_victim')}:</strong> ${escapeHTML(victimName)}</p>
          <p><strong>${translate('incident_list_date')}:</strong> ${inc.incident_date ? formatDate(inc.incident_date, lang) : '—'}</p>
          ${inc.activity_name ? `<p><strong>${translate('incident_select_activity')}:</strong> ${escapeHTML(inc.activity_name)}</p>` : ''}
          ${inc.escalation_sent_to && inc.escalation_sent_to.length > 0
            ? `<p><strong>${translate('incident_escalation_settings')}:</strong> ${inc.escalation_sent_to.map(e => escapeHTML(e)).join(', ')}</p>`
            : ''}
        </div>

        <div class="incident-view-form" style="pointer-events: none; opacity: 0.85;">
          <form id="incident-form-readonly">
            ${formHtml}
          </form>
        </div>

        ${inc.status === 'draft' && this.canManage ? `
          <div class="form-actions">
            <button class="btn btn--primary" id="incident-edit-from-view-btn">${translate('Edit')}</button>
          </div>
        ` : ''}
      </section>`;

    setContent(container, html);

    // Disable all form inputs
    const form = document.getElementById('incident-form-readonly');
    if (form) {
      form.querySelectorAll('input, textarea, select').forEach(el => {
        el.disabled = true;
      });
    }
  }

  attachViewListeners() {
    document.getElementById('incident-back-btn')?.addEventListener('click', () => {
      this.app.router.navigate('/incident-reports');
    });

    document.getElementById('incident-edit-from-view-btn')?.addEventListener('click', () => {
      this.app.router.navigate(`/incident-reports/${this.incidentId}/edit`);
    });
  }

  // ============================================================
  // Escalation contacts modal
  // ============================================================

  async showEscalationModal() {
    try {
      this.escalationContacts = await getEscalationContacts();
    } catch (err) {
      debugError('Failed to load escalation contacts:', err);
      this.escalationContacts = [];
    }

    const contactRows = this.escalationContacts.length === 0
      ? `<p class="empty-state">${translate('incident_escalation_none')}</p>`
      : this.escalationContacts.map(c => `
        <div class="escalation-contact-row" data-id="${c.id}">
          <span>${escapeHTML(c.name || '')} &lt;${escapeHTML(c.email)}&gt;</span>
          <span class="escalation-role">${escapeHTML(c.role_description || '')}</span>
          <button class="btn btn--small btn--danger escalation-delete-btn" data-id="${c.id}">&times;</button>
        </div>
      `).join('');

    const modalHtml = `
      <div class="modal-overlay" id="escalation-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>${translate('incident_escalation_settings')}</h2>
            <button class="modal-close-btn" id="escalation-modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div id="escalation-contacts-list">${contactRows}</div>

            <div class="escalation-add-form">
              <h3>${translate('incident_escalation_add')}</h3>
              <div class="form-group">
                <label>${translate('incident_escalation_email')}</label>
                <input type="email" id="escalation-new-email" class="form-control" placeholder="email@example.com">
              </div>
              <div class="form-group">
                <label>${translate('incident_escalation_name')}</label>
                <input type="text" id="escalation-new-name" class="form-control">
              </div>
              <div class="form-group">
                <label>${translate('incident_escalation_role')}</label>
                <input type="text" id="escalation-new-role" class="form-control">
              </div>
              <button class="btn btn--primary" id="escalation-add-btn">${translate('incident_escalation_add')}</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Event listeners
    document.getElementById('escalation-modal-close')?.addEventListener('click', () => {
      document.getElementById('escalation-modal')?.remove();
    });

    document.getElementById('escalation-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'escalation-modal') {
        e.target.remove();
      }
    });

    document.getElementById('escalation-add-btn')?.addEventListener('click', async () => {
      const email = document.getElementById('escalation-new-email')?.value?.trim();
      const name = document.getElementById('escalation-new-name')?.value?.trim();
      const role_description = document.getElementById('escalation-new-role')?.value?.trim();

      if (!email) {
        this.app.showMessage(translate('incident_escalation_email') + ' required', 'error');
        return;
      }

      try {
        await addEscalationContact({ email, name, role_description });
        document.getElementById('escalation-modal')?.remove();
        this.showEscalationModal(); // Refresh
      } catch (err) {
        debugError('Add escalation contact failed:', err);
        this.app.showMessage(translate('error_generic'), 'error');
      }
    });

    document.querySelectorAll('.escalation-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await deleteEscalationContact(parseInt(btn.dataset.id));
          document.getElementById('escalation-modal')?.remove();
          this.showEscalationModal(); // Refresh
        } catch (err) {
          debugError('Delete escalation contact failed:', err);
          this.app.showMessage(translate('error_generic'), 'error');
        }
      });
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  getVictimDisplayName(incident) {
    if (incident.victim_first_name && incident.victim_last_name) {
      return `${incident.victim_first_name} ${incident.victim_last_name}`;
    }
    if (incident.victim_user_name) {
      return incident.victim_user_name;
    }
    if (incident.victim_name) {
      return incident.victim_name;
    }
    // Try from submission_data
    const fd = incident.submission_data || {};
    if (fd.victim_first_name || fd.victim_last_name) {
      return `${fd.victim_first_name || ''} ${fd.victim_last_name || ''}`.trim();
    }
    return '—';
  }

  injectStyles() {
    if (document.getElementById('incident-report-styles')) return;

    const style = document.createElement('style');
    style.id = 'incident-report-styles';
    style.textContent = `
      .incident-reports-page .page__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
      }
      .incident-reports-page .page__actions {
        display: flex;
        gap: 8px;
      }
      .incident-form-container {
        max-width: 800px;
      }
      .incident-form-container .form-section {
        margin-bottom: 20px;
        padding: 16px;
        background: var(--card-bg, #fff);
        border-radius: 8px;
        border: 1px solid var(--border-color, #ddd);
      }
      .incident-form-container .radio-group {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }
      .incident-form-container .radio-group label {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .incident-form .info-text {
        font-weight: bold;
        font-size: 1.1em;
        margin: 24px 0 12px;
        padding: 8px 12px;
        background: var(--primary-light, #e8f0fe);
        border-radius: 6px;
        border-left: 4px solid var(--primary-color, #1a73e8);
      }
      .incident-form .form-group {
        margin-bottom: 14px;
      }
      .incident-form .form-group label {
        display: block;
        font-weight: 500;
        margin-bottom: 4px;
      }
      .incident-form .form-group input,
      .incident-form .form-group textarea,
      .incident-form .form-group select {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--border-color, #ccc);
        border-radius: 6px;
        font-size: 14px;
        box-sizing: border-box;
      }
      .incident-form .form-group textarea {
        min-height: 80px;
        resize: vertical;
      }
      .incident-form .form-group .field-info {
        font-size: 12px;
        color: var(--text-muted, #666);
        margin-top: 4px;
      }
      .incident-form .checkbox-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
      }
      .incident-form .checkbox-option {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .incident-form .checkbox-option input[type="checkbox"] {
        width: auto;
      }
      .incident-form .checkbox-option label {
        display: inline;
        font-weight: normal;
        margin-bottom: 0;
      }
      .form-actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
        padding: 16px 0;
      }
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
      }
      .badge--success { background: #d4edda; color: #155724; }
      .badge--warning { background: #fff3cd; color: #856404; }
      .incident-view-meta {
        background: var(--card-bg, #fff);
        border: 1px solid var(--border-color, #ddd);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .incident-view-meta p { margin: 6px 0; }

      /* Escalation modal */
      .modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 1000;
        display: flex; align-items: center; justify-content: center;
      }
      .modal-content {
        background: var(--card-bg, #fff);
        border-radius: 12px;
        width: 90%; max-width: 560px;
        max-height: 80vh; overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      }
      .modal-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px 20px; border-bottom: 1px solid var(--border-color, #ddd);
      }
      .modal-header h2 { margin: 0; font-size: 18px; }
      .modal-close-btn {
        background: none; border: none; font-size: 24px; cursor: pointer;
        color: var(--text-muted, #666); line-height: 1;
      }
      .modal-body { padding: 20px; }
      .escalation-contact-row {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee);
      }
      .escalation-contact-row span:first-child { flex: 1; }
      .escalation-role { color: var(--text-muted, #888); font-size: 13px; }
      .escalation-add-form {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color, #ddd);
      }
      .escalation-add-form h3 { margin: 0 0 12px; font-size: 15px; }
      .escalation-add-form .form-group { margin-bottom: 10px; }
      .escalation-add-form .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
      .escalation-add-form .form-group input {
        width: 100%; padding: 8px 10px;
        border: 1px solid var(--border-color, #ccc); border-radius: 6px;
        box-sizing: border-box;
      }

      /* Table responsive */
      .table-responsive { overflow-x: auto; }
      .table { width: 100%; border-collapse: collapse; }
      .table th, .table td {
        padding: 10px 12px; text-align: left;
        border-bottom: 1px solid var(--border-color, #eee);
      }
      .table th { font-weight: 600; background: var(--table-header-bg, #f8f9fa); }

      @media (max-width: 600px) {
        .incident-reports-page .page__header { flex-direction: column; align-items: flex-start; }
        .form-actions { flex-direction: column; }
        .form-actions .btn { width: 100%; }
        .incident-form-container .radio-group { flex-direction: column; gap: 10px; }
      }
    `;
    document.head.appendChild(style);
  }
}
