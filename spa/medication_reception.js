import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDate, getTodayISO, parseDate } from "./utils/DateUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import {
  getActivities,
  getParticipants,
  getMedicationRequirements,
  getParticipantMedications,
  getMedicationReceptions,
  saveMedicationReception,
  updateMedicationReception,
  saveMedicationRequirement
} from "./api/api-endpoints.js";

/**
 * Medication Reception module
 * Tracks when medications are received from parents/guardians at activities
 */
export class MedicationReception {
  constructor(app, options = {}) {
    this.app = app;
    this.activities = [];
    this.participants = [];
    this.requirements = [];
    this.participantMedications = [];
    this.receptions = [];
    this.selectedActivityId = options.activityId || null;
    this.showAllParticipants = false;
    this.editingMedications = new Set(); // Track which medications are being edited
  }

  async init() {
    try {
      this.injectStyles();
      await this.loadData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing medication reception", error);
      this.app.showMessage(translate("error_loading_data"), "error");
    }
  }

  async loadData() {
    try {
      // Load activities, participants, requirements, and medications in parallel
      const [activitiesRes, participantsRes, requirementsRes, medicationsRes] = await Promise.all([
        getActivities(),
        getParticipants(),
        getMedicationRequirements(),
        getParticipantMedications()
      ]);

      this.activities = activitiesRes?.data || activitiesRes || [];
      this.participants = participantsRes?.data || participantsRes?.participants || [];
      this.requirements = requirementsRes?.data?.requirements || requirementsRes?.requirements || [];
      this.participantMedications = medicationsRes?.data?.participant_medications || medicationsRes?.participant_medications || [];

      // Preselect today's activity if not already selected
      if (!this.selectedActivityId) {
        this.selectedActivityId = this.getTodaysActivityId();
      }

      // Load receptions for selected activity
      if (this.selectedActivityId) {
        await this.loadReceptions();
      }

      debugLog("Medication reception data loaded", {
        activities: this.activities.length,
        participants: this.participants.length,
        requirements: this.requirements.length,
        receptions: this.receptions.length
      });
    } catch (error) {
      debugError("Error loading medication reception data", error);
      throw error;
    }
  }

  async loadReceptions() {
    if (!this.selectedActivityId) {
      this.receptions = [];
      return;
    }

    try {
      const response = await getMedicationReceptions({ activity_id: this.selectedActivityId });
      this.receptions = response?.data?.receptions || response?.receptions || [];
      debugLog("Loaded receptions for activity", this.selectedActivityId, this.receptions.length);
    } catch (error) {
      debugError("Error loading receptions", error);
      this.receptions = [];
    }
  }

  getTodaysActivityId() {
    const today = getTodayISO();
    const todaysActivity = this.activities.find(activity => {
      const startDate = activity.activity_start_date || activity.activity_date;
      const endDate = activity.activity_end_date || startDate;

      if (!startDate) return false;

      const start = parseDate(startDate);
      const end = parseDate(endDate);
      const todayDate = parseDate(today);

      return todayDate >= start && todayDate <= end;
    });

    return todaysActivity?.id || null;
  }

  injectStyles() {
    if (document.getElementById("medication-reception-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "medication-reception-styles";
    style.textContent = `
      .medication-reception-page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .activity-selector {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .activity-selector select {
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 1rem;
      }

      .participant-filter {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: #f3f4f6;
        border-radius: 8px;
      }

      .participant-reception-card {
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
      }

      .participant-reception-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 0.75rem;
        border-bottom: 2px solid #e5e7eb;
        margin-bottom: 1rem;
      }

      .participant-reception-header h3 {
        margin: 0;
        font-size: 1.25rem;
        color: #0b3c5d;
      }

      .bulk-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .medication-reception-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .medication-reception-item {
        background: #f9fafb;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 1rem;
      }

      .medication-reception-item.editing {
        border-color: #0b3c5d;
        background: #fff;
      }

      .med-item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.75rem;
      }

      .med-item-info strong {
        display: block;
        font-size: 1.1rem;
        color: #111827;
        margin-bottom: 0.25rem;
      }

      .med-item-details {
        font-size: 0.9rem;
        color: #6b7280;
        margin-bottom: 0.5rem;
      }

      .edit-toggle-btn {
        background: transparent;
        border: 1px solid #d1d5db;
        color: #6b7280;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s;
      }

      .edit-toggle-btn:hover {
        border-color: #0b3c5d;
        color: #0b3c5d;
      }

      .med-item-editable-fields {
        display: none;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px solid #e5e7eb;
      }

      .med-item-editable-fields.visible {
        display: grid;
      }

      .med-item-editable-fields label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        color: #374151;
      }

      .med-item-editable-fields input,
      .med-item-editable-fields textarea {
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 0.9rem;
      }

      .med-item-reception {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #e5e7eb;
      }

      .reception-status-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .status-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .status-option:hover {
        border-color: #d1d5db;
      }

      .status-option.selected {
        border-color: #0b3c5d;
        background: #e0f2fe;
      }

      .status-option input[type="radio"] {
        margin: 0;
      }

      .reception-quantity,
      .reception-notes {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .reception-quantity label,
      .reception-notes label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #374151;
      }

      .reception-quantity input,
      .reception-notes textarea {
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 0.9rem;
      }

      .reception-notes textarea {
        resize: vertical;
        min-height: 60px;
      }

      .save-status {
        font-size: 0.85rem;
        color: #6b7280;
        font-style: italic;
        margin-left: 0.5rem;
      }

      .save-status.success {
        color: #10b981;
      }

      .save-status.error {
        color: #ef4444;
      }

      @media (max-width: 768px) {
        .med-item-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .med-item-editable-fields {
          grid-template-columns: 1fr;
        }

        .med-item-reception {
          grid-template-columns: 1fr;
        }

        .bulk-actions {
          flex-direction: column;
          width: 100%;
        }

        .bulk-actions button {
          width: 100%;
        }
      }
    `;

    document.head.appendChild(style);
  }

  render() {
    const container = document.getElementById("app");
    if (!container) return;

    const activityOptions = this.renderActivityOptions();
    const selectedActivity = this.activities.find(a => a.id === this.selectedActivityId);
    const activityName = selectedActivity ? escapeHTML(selectedActivity.name) : translate("med_reception_select_activity");

    setContent(container, `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <section class="page medication-reception-page">
        <div class="card">
          <h1>🏥 ${translate("med_reception_title")}</h1>
          <p class="subtitle">${translate("med_reception_description")}</p>
        </div>

        <div class="card">
          <div class="activity-selector">
            <label>
              <strong>${translate("med_reception_select_activity_label")}</strong>
              <select id="activitySelect">
                <option value="">${translate("select_option")}</option>
                ${activityOptions}
              </select>
            </label>
          </div>
        </div>

        ${this.selectedActivityId ? `
          <div class="card">
            <div class="participant-filter">
              <input type="checkbox" id="showAllParticipants" ${this.showAllParticipants ? 'checked' : ''} />
              <label for="showAllParticipants">${translate("med_reception_show_all_participants")}</label>
            </div>
          </div>

          <div class="card">
            <h2>${translate("med_reception_for_activity")}: ${activityName}</h2>
            <div id="participant-reception-list">
              ${this.renderParticipantReceptionCards()}
            </div>
          </div>
        ` : `
          <div class="card">
            <p class="subtitle" style="text-align: center; padding: 2rem;">
              ${translate("med_reception_select_activity_prompt")}
            </p>
          </div>
        `}
      </section>
    `);
  }

  renderActivityOptions() {
    const today = getTodayISO();

    // Filter to upcoming and current activities (exclude past)
    const relevantActivities = this.activities.filter(activity => {
      const endDate = activity.activity_end_date || activity.activity_start_date || activity.activity_date;
      if (!endDate) return true; // Include if no date

      const end = parseDate(endDate);
      const todayDate = parseDate(today);

      return end >= todayDate;
    });

    // Sort by start date
    relevantActivities.sort((a, b) => {
      const dateA = parseDate(a.activity_start_date || a.activity_date);
      const dateB = parseDate(b.activity_start_date || b.activity_date);
      return dateA - dateB;
    });

    return relevantActivities.map(activity => {
      const startDate = activity.activity_start_date || activity.activity_date;
      const dateLabel = startDate ? formatDate(startDate, this.app.lang || 'en') : '';
      const selected = activity.id === this.selectedActivityId ? 'selected' : '';

      return `<option value="${activity.id}" ${selected}>
        ${escapeHTML(activity.name)}${dateLabel ? ` - ${dateLabel}` : ''}
      </option>`;
    }).join('');
  }

  renderParticipantReceptionCards() {
    const participantsWithMeds = this.getParticipantsWithMedications();

    if (participantsWithMeds.length === 0) {
      return `<p class="subtitle" style="text-align: center; padding: 2rem;">
        ${translate("med_reception_no_participants")}
      </p>`;
    }

    return participantsWithMeds.map(participant => {
      return this.renderParticipantCard(participant);
    }).join('');
  }

  getParticipantsWithMedications() {
    let filteredParticipants;

    if (this.showAllParticipants) {
      filteredParticipants = [...this.participants];
    } else {
      // Only show participants with medication requirements
      const participantIdsWithMeds = new Set(
        this.participantMedications.map(pm => pm.participant_id)
      );
      filteredParticipants = this.participants.filter(p =>
        participantIdsWithMeds.has(p.id)
      );
    }

    // Sort by last name, first name
    return filteredParticipants.sort((a, b) => {
      const lastNameCompare = (a.last_name || '').localeCompare(b.last_name || '');
      if (lastNameCompare !== 0) return lastNameCompare;
      return (a.first_name || '').localeCompare(b.first_name || '');
    });
  }

  renderParticipantCard(participant) {
    const participantName = escapeHTML(`${participant.first_name} ${participant.last_name}`);
    const medications = this.getParticipantMedications(participant.id);

    if (medications.length === 0 && !this.showAllParticipants) {
      return '';
    }

    const allReceived = medications.length > 0 && medications.every(med => {
      const reception = this.getReception(participant.id, med.requirement.id);
      return reception && reception.status === 'received';
    });

    const headerActions = medications.length > 0
      ? `
        <button class="btn btn-small secondary mark-all-received" data-participant-id="${participant.id}">
          ✓ ${translate("med_reception_mark_all_received")}
        </button>
        ${allReceived ? `<span class="pill" style="background: #10b981; color: white;">
          ${translate("med_reception_all_received")}
        </span>` : ''}
      `
      : `<a href="/medication-planning/${participant.id}" class="btn btn-small secondary">
          + ${translate("manage_medications")}
        </a>`;

    return `
      <div class="participant-reception-card" data-participant-id="${participant.id}">
        <div class="participant-reception-header">
          <h3>${participantName}</h3>
          <div class="bulk-actions">
            ${headerActions}
          </div>
        </div>
        <div class="medication-reception-list">
          ${medications.length > 0
            ? medications.map(med => this.renderMedicationItem(participant, med)).join('')
            : `<p class="subtitle">${translate("med_reception_no_medications")}</p>`
          }
        </div>
      </div>
    `;
  }

  getParticipantMedications(participantId) {
    const assignments = this.participantMedications.filter(pm => pm.participant_id === participantId);

    return assignments.map(assignment => {
      const requirement = this.requirements.find(req => req.id === assignment.medication_requirement_id);
      if (!requirement) return null;

      return {
        assignment,
        requirement
      };
    }).filter(Boolean);
  }

  getReception(participantId, requirementId) {
    return this.receptions.find(r =>
      r.participant_id === participantId &&
      r.medication_requirement_id === requirementId
    );
  }

  renderMedicationItem(participant, medication) {
    const req = medication.requirement;
    const reception = this.getReception(participant.id, req.id);
    const isEditing = this.editingMedications.has(`${participant.id}-${req.id}`);

    const doseInfo = req.default_dose_amount
      ? `${req.default_dose_amount}${req.default_dose_unit || ''}`
      : req.dosage_instructions || '';
    const route = req.route ? ` · ${req.route}` : '';
    const frequency = req.frequency_text || translate("medication_frequency_prn_text");

    const status = reception?.status || 'not_received';
    const quantity = reception?.quantity_received || '';
    const notes = reception?.reception_notes || '';

    return `
      <div class="medication-reception-item ${isEditing ? 'editing' : ''}"
           data-participant-id="${participant.id}"
           data-requirement-id="${req.id}">
        <div class="med-item-header">
          <div class="med-item-info">
            <strong>${escapeHTML(req.medication_name)}</strong>
            <div class="med-item-details">
              ${escapeHTML(doseInfo)}${escapeHTML(route)}
              <br>${escapeHTML(frequency)}
            </div>
            ${req.general_notes ? `<div class="med-item-details" style="font-style: italic;">
              ${escapeHTML(req.general_notes)}
            </div>` : ''}
          </div>
          <button class="edit-toggle-btn" data-participant-id="${participant.id}" data-requirement-id="${req.id}">
            ${isEditing ? translate("med_reception_done_editing") : translate("med_reception_edit")}
          </button>
        </div>

        <div class="med-item-editable-fields ${isEditing ? 'visible' : ''}" id="edit-fields-${participant.id}-${req.id}">
          <label>
            ${translate("medication_name_label")}
            <input type="text" data-field="medication_name" value="${escapeHTML(req.medication_name)}" />
          </label>
          <label>
            ${translate("medication_dosage_label")}
            <input type="text" data-field="dosage" value="${escapeHTML(req.dosage_instructions || '')}" />
          </label>
          <label style="grid-column: 1 / -1;">
            ${translate("medication_general_notes_label")}
            <textarea data-field="notes" rows="2">${escapeHTML(req.general_notes || '')}</textarea>
          </label>
        </div>

        <div class="med-item-reception">
          <div class="reception-status-group">
            <strong>${translate("med_reception_status_label")}</strong>
            <div class="status-option ${status === 'received' ? 'selected' : ''}"
                 data-status="received">
              <input type="radio" name="status-${participant.id}-${req.id}" value="received"
                     ${status === 'received' ? 'checked' : ''} />
              <span>✓ ${translate("med_reception_status_received")}</span>
            </div>
            <div class="status-option ${status === 'partial' ? 'selected' : ''}"
                 data-status="partial">
              <input type="radio" name="status-${participant.id}-${req.id}" value="partial"
                     ${status === 'partial' ? 'checked' : ''} />
              <span>⚠️ ${translate("med_reception_status_partial")}</span>
            </div>
            <div class="status-option ${status === 'not_received' ? 'selected' : ''}"
                 data-status="not_received">
              <input type="radio" name="status-${participant.id}-${req.id}" value="not_received"
                     ${status === 'not_received' ? 'checked' : ''} />
              <span>✗ ${translate("med_reception_status_not_received")}</span>
            </div>
          </div>

          <div class="reception-quantity">
            <label>${translate("med_reception_quantity_label")}</label>
            <input type="text"
                   placeholder="${translate("med_reception_quantity_placeholder")}"
                   data-participant-id="${participant.id}"
                   data-requirement-id="${req.id}"
                   data-field="quantity"
                   value="${escapeHTML(quantity)}" />
          </div>

          <div class="reception-notes">
            <label>${translate("med_reception_notes_label")}</label>
            <textarea
              placeholder="${translate("med_reception_notes_placeholder")}"
              data-participant-id="${participant.id}"
              data-requirement-id="${req.id}"
              data-field="reception_notes"
            >${escapeHTML(notes)}</textarea>
          </div>
        </div>
        <span class="save-status" id="save-status-${participant.id}-${req.id}"></span>
      </div>
    `;
  }

  attachEventListeners() {
    const activitySelect = document.getElementById('activitySelect');
    const showAllCheckbox = document.getElementById('showAllParticipants');
    const appContainer = document.getElementById('app');

    // Activity selection
    activitySelect?.addEventListener('change', async (e) => {
      this.selectedActivityId = e.target.value ? parseInt(e.target.value) : null;
      if (this.selectedActivityId) {
        await this.loadReceptions();
      }
      this.render();
      this.attachEventListeners();
    });

    // Show all participants toggle
    showAllCheckbox?.addEventListener('change', (e) => {
      this.showAllParticipants = e.target.checked;
      this.render();
      this.attachEventListeners();
    });

    // Edit toggle buttons
    appContainer?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-toggle-btn');
      if (editBtn) {
        const participantId = parseInt(editBtn.dataset.participantId);
        const requirementId = parseInt(editBtn.dataset.requirementId);
        this.toggleEdit(participantId, requirementId);
      }

      // Mark all received button
      const markAllBtn = e.target.closest('.mark-all-received');
      if (markAllBtn) {
        const participantId = parseInt(markAllBtn.dataset.participantId);
        this.markAllReceived(participantId);
      }

      // Status option selection
      const statusOption = e.target.closest('.status-option');
      if (statusOption) {
        const status = statusOption.dataset.status;
        const radio = statusOption.querySelector('input[type="radio"]');
        if (radio) {
          radio.checked = true;
          this.handleStatusChange(radio);
        }
      }
    });

    // Status changes
    appContainer?.addEventListener('change', (e) => {
      if (e.target.type === 'radio' && e.target.name.startsWith('status-')) {
        this.handleStatusChange(e.target);
      }

      // Quantity and notes changes (debounced save)
      if (e.target.dataset.field === 'quantity' || e.target.dataset.field === 'reception_notes') {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
          const participantId = parseInt(e.target.dataset.participantId);
          const requirementId = parseInt(e.target.dataset.requirementId);
          this.saveReception(participantId, requirementId);
        }, 1000);
      }
    });

    // Save editable fields on blur
    appContainer?.addEventListener('blur', (e) => {
      if (e.target.dataset.field === 'medication_name' ||
          e.target.dataset.field === 'dosage' ||
          e.target.dataset.field === 'notes') {
        const item = e.target.closest('.medication-reception-item');
        if (item) {
          const participantId = parseInt(item.dataset.participantId);
          const requirementId = parseInt(item.dataset.requirementId);
          this.saveRequirementEdits(requirementId, item);
        }
      }
    }, true);
  }

  toggleEdit(participantId, requirementId) {
    const key = `${participantId}-${requirementId}`;

    if (this.editingMedications.has(key)) {
      this.editingMedications.delete(key);
    } else {
      this.editingMedications.add(key);
    }

    // Re-render just this medication item
    const item = document.querySelector(`.medication-reception-item[data-participant-id="${participantId}"][data-requirement-id="${requirementId}"]`);
    if (item) {
      const participant = this.participants.find(p => p.id === participantId);
      const medication = this.getParticipantMedications(participantId).find(m => m.requirement.id === requirementId);

      if (participant && medication) {
        const newHtml = this.renderMedicationItem(participant, medication);
        const temp = document.createElement('div');
        setContent(temp, newHtml);
        item.replaceWith(temp.firstElementChild);
      }
    }
  }

  async markAllReceived(participantId) {
    const medications = this.getParticipantMedications(participantId);

    for (const med of medications) {
      await this.saveReception(participantId, med.requirement.id, 'received');
    }

    this.app.showMessage(translate("med_reception_all_marked_received"), "success");
    await this.loadReceptions();
    this.render();
    this.attachEventListeners();
  }

  async handleStatusChange(radio) {
    const name = radio.name;
    const parts = name.split('-');
    const participantId = parseInt(parts[1]);
    const requirementId = parseInt(parts[2]);
    const status = radio.value;

    await this.saveReception(participantId, requirementId, status);
  }

  async saveReception(participantId, requirementId, statusOverride = null) {
    try {
      const item = document.querySelector(
        `.medication-reception-item[data-participant-id="${participantId}"][data-requirement-id="${requirementId}"]`
      );

      if (!item) return;

      const statusRadios = item.querySelectorAll('input[type="radio"]');
      let status = statusOverride;

      if (!status) {
        const checkedRadio = Array.from(statusRadios).find(r => r.checked);
        status = checkedRadio?.value || 'not_received';
      }

      const quantityInput = item.querySelector('[data-field="quantity"]');
      const notesTextarea = item.querySelector('[data-field="reception_notes"]');

      const payload = {
        activity_id: this.selectedActivityId,
        medication_requirement_id: requirementId,
        participant_id: participantId,
        status,
        quantity_received: quantityInput?.value?.trim() || null,
        reception_notes: notesTextarea?.value?.trim() || null
      };

      const result = await saveMedicationReception(payload);

      if (result?.success) {
        this.showSaveStatus(participantId, requirementId, 'success');
        await this.loadReceptions();
      } else {
        throw new Error(result?.message || 'Save failed');
      }
    } catch (error) {
      debugError("Error saving reception", error);
      this.showSaveStatus(participantId, requirementId, 'error');
      this.app.showMessage(translate("error_saving"), "error");
    }
  }

  async saveRequirementEdits(requirementId, item) {
    try {
      const requirement = this.requirements.find(r => r.id === requirementId);
      if (!requirement) return;

      const editFields = item.querySelector('.med-item-editable-fields');
      if (!editFields) return;

      const medicationName = editFields.querySelector('[data-field="medication_name"]')?.value?.trim();
      const dosage = editFields.querySelector('[data-field="dosage"]')?.value?.trim();
      const notes = editFields.querySelector('[data-field="notes"]')?.value?.trim();

      const payload = {
        id: requirementId,
        medication_name: medicationName || requirement.medication_name,
        dosage_instructions: dosage || requirement.dosage_instructions,
        general_notes: notes || requirement.general_notes,
        // Include other required fields
        frequency_preset_type: requirement.frequency_preset_type,
        frequency_times: requirement.frequency_times,
        frequency_text: requirement.frequency_text,
        route: requirement.route,
        default_dose_amount: requirement.default_dose_amount,
        default_dose_unit: requirement.default_dose_unit,
        start_date: requirement.start_date,
        end_date: requirement.end_date,
        participant_ids: [item.dataset.participantId]
      };

      const result = await saveMedicationRequirement(payload);

      if (result?.success) {
        this.app.showMessage(translate("med_reception_requirement_updated"), "success");
        // Update local cache
        Object.assign(requirement, {
          medication_name: medicationName,
          dosage_instructions: dosage,
          general_notes: notes
        });
      } else {
        throw new Error(result?.message || 'Update failed');
      }
    } catch (error) {
      debugError("Error updating requirement", error);
      this.app.showMessage(translate("error_saving"), "error");
    }
  }

  showSaveStatus(participantId, requirementId, type) {
    const statusSpan = document.getElementById(`save-status-${participantId}-${requirementId}`);
    if (!statusSpan) return;

    statusSpan.textContent = type === 'success'
      ? `✓ ${translate("saved")}`
      : `✗ ${translate("error_saving")}`;
    statusSpan.className = `save-status ${type}`;

    setTimeout(() => {
      statusSpan.textContent = '';
      statusSpan.className = 'save-status';
    }, 3000);
  }
}
