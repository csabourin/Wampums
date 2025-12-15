import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError } from "./utils/DebugUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import {
  getParticipants,
  getMedicationRequirements,
  getParticipantMedications,
  getMedicationDistributions,
  saveMedicationRequirement,
  recordMedicationDistribution,
  markMedicationDistributionAsGiven
} from "./api/api-endpoints.js";

/**
 * Medication management module
 * Provides a mobile-first interface to capture medication requirements and
 * efficiently record distribution events with aggregated alerts for time slots.
 */
export class MedicationManagement {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.requirements = [];
    this.participantMedications = [];
    this.distributions = [];
    this.alertInterval = null;
    this.alertWindowMinutes = 90;
    this.alertLookbackMinutes = 30;
    this.alertRefreshMs = 60000;
  }

  async init() {
    try {
      this.injectStyles();
      await this.refreshData();
      this.render();
      this.attachEventListeners();
      this.startAlertTicker();
    } catch (error) {
      debugError("Error initializing medication management", error);
      this.app.showMessage(translate("error_loading_data"), "error");
    }
  }

  /**
   * Load baseline data required for the page.
   */
  async refreshData() {
    const [participantsResponse, requirementsResponse, assignmentsResponse, distributionsResponse] = await Promise.all([
      getParticipants(),
      getMedicationRequirements(),
      getParticipantMedications(),
      getMedicationDistributions({ upcoming_only: true })
    ]);

    this.participants = participantsResponse?.data || participantsResponse?.participants || [];
    this.requirements = requirementsResponse?.data?.requirements || requirementsResponse?.requirements || [];
    this.participantMedications = assignmentsResponse?.data?.participant_medications
      || assignmentsResponse?.participant_medications
      || [];
    this.distributions = distributionsResponse?.data?.distributions || distributionsResponse?.distributions || [];
  }

  /**
   * Inject page-specific styles optimized for mobile screens.
   */
  injectStyles() {
    if (document.getElementById("medication-management-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "medication-management-styles";
    style.textContent = `
      .medication-page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .medication-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }

      .medication-grid .field-group {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }

      .medication-grid label span {
        font-weight: 600;
      }

      .participant-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.5rem;
      }

      .participant-pill {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.65rem;
        background: #f3f4f6;
        border-radius: 10px;
      }

      .participant-pill textarea {
        width: 100%;
        min-height: 48px;
        border-radius: 8px;
        border: 1px solid #d1d5db;
        padding: 0.5rem;
      }

      .alert-group {
        background: #0b3c5d;
        color: #fff;
        padding: 1rem;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .alert-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .alert-participants {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .alert-actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        background: #e0f2fe;
        color: #0b3c5d;
        font-weight: 600;
        font-size: 0.85rem;
      }

      .table-container {
        overflow-x: auto;
      }

      @media (min-width: 640px) {
        .medication-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .alert-actions {
          flex-direction: row;
        }

        .participant-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1024px) {
        .participant-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
    `;

    document.head.appendChild(style);
  }

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    const today = getTodayISO();
    const now = new Date();
    const timeValue = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const requirementOptions = this.requirements
      .map((req) => `<option value="${req.id}">${escapeHTML(req.medication_name)}</option>`)
      .join("");

    const participantOptions = this.participants
      .map((participant) => {
        const label = `${participant.first_name || ""} ${participant.last_name || ""}`.trim();
        return `<option value="${participant.id}">${escapeHTML(label || translate("unknown"))}</option>`;
      })
      .join("");

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${escapeHTML(translate("back_to_dashboard"))}">🏠</a>
      <section class="page medication-page">
        <div class="card">
          <h1>${escapeHTML(translate("medication_management_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("medication_management_description"))}</p>
          <div class="pill">${escapeHTML(translate("medication_management_alert_window_hint"))}</div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("medication_requirement_form_title"))}</h2>
          <form id="medicationRequirementForm" class="medication-grid">
            <label class="field-group">
              <span>${escapeHTML(translate("medication_name_label"))}</span>
              <input type="text" name="medication_name" required maxlength="200" />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_dosage_label"))}</span>
              <input type="text" name="dosage_instructions" maxlength="200" placeholder="${escapeHTML(translate("dose"))}" />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_frequency_label"))}</span>
              <input type="text" name="frequency_text" maxlength="120" placeholder="${escapeHTML(translate("frequency"))}" />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_route_label"))}</span>
              <input type="text" name="route" maxlength="120" />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_default_dose"))}</span>
              <div style="display:flex; gap:0.5rem;">
                <input type="number" step="0.01" name="default_dose_amount" aria-label="${escapeHTML(translate("dose"))}" />
                <input type="text" name="default_dose_unit" maxlength="50" placeholder="mg, ml" aria-label="${escapeHTML(translate("unit"))}" />
              </div>
            </label>
            <label class="field-group" style="grid-column: 1 / -1;">
              <span>${escapeHTML(translate("medication_general_notes_label"))}</span>
              <textarea name="general_notes" rows="3" maxlength="1000"></textarea>
            </label>
            <div class="field-group" style="grid-column: 1 / -1;">
              <span>${escapeHTML(translate("medication_assign_participants"))}</span>
              <div class="participant-grid">
                ${this.participants.map((participant) => {
                  const label = `${participant.first_name || ""} ${participant.last_name || ""}`.trim();
                  return `
                    <div class="participant-pill">
                      <label style="display:flex; align-items:center; gap:0.5rem; width:100%;">
                        <input type="checkbox" name="participant_ids" value="${participant.id}">
                        <span>${escapeHTML(label || translate("unknown"))}</span>
                      </label>
                    </div>
                    <textarea name="participant_note_${participant.id}" placeholder="${escapeHTML(translate("medication_participant_notes_label"))}"></textarea>
                  `;
                }).join("")}
              </div>
              <p class="help-text">${escapeHTML(translate("medication_auto_fill_hint"))}</p>
            </div>
            <button class="btn primary" type="submit">${escapeHTML(translate("medication_save_requirement"))}</button>
          </form>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("medication_schedule_section_title"))}</h2>
          <form id="medicationScheduleForm" class="medication-grid">
            <label class="field-group">
              <span>${escapeHTML(translate("medication_schedule_date"))}</span>
              <input type="date" name="scheduled_date" value="${today}" required />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_schedule_time"))}</span>
              <input type="time" name="scheduled_time" value="${timeValue}" required />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_requirement_form_title"))}</span>
              <select name="medication_requirement_id" id="medicationRequirementSelect" required>
                <option value="">${escapeHTML(translate("select_option"))}</option>
                ${requirementOptions}
              </select>
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("participants"))}</span>
              <select name="distribution_participants" id="distributionParticipants" multiple required>
                ${participantOptions}
              </select>
              <p class="help-text">${escapeHTML(translate("medication_one_alert_hint"))}</p>
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_schedule_activity"))}</span>
              <input type="text" name="activity_name" maxlength="200" />
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_schedule_notes"))}</span>
              <textarea name="dose_notes" rows="2" maxlength="1000"></textarea>
            </label>
            <label class="field-group">
              <span>${escapeHTML(translate("medication_witness_label"))}</span>
              <input type="text" name="witness_name" value="${escapeHTML(this.getDefaultWitness())}" maxlength="150" />
            </label>
            <button class="btn primary" type="submit">${escapeHTML(translate("medication_schedule_button"))}</button>
          </form>
        </div>

        <div class="card">
          <div class="alert-meta">
            <h2>${escapeHTML(translate("medication_alerts_heading"))}</h2>
            <span class="pill">${escapeHTML(translate("medication_management_alert_window_hint"))}</span>
          </div>
          <div id="medication-alerts"></div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("medication_table_heading"))}</h2>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("date"))}</th>
                  <th>${escapeHTML(translate("time"))}</th>
                  <th>${escapeHTML(translate("participant"))}</th>
                  <th>${escapeHTML(translate("medication"))}</th>
                  <th>${escapeHTML(translate("dose"))}</th>
                  <th>${escapeHTML(translate("medication_frequency"))}</th>
                  <th>${escapeHTML(translate("medication_general_note"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.distributions.length === 0
                  ? `<tr><td colspan="7">${escapeHTML(translate("medication_alerts_empty"))}</td></tr>`
                  : this.distributions.map((dist) => {
                      const requirement = this.getRequirementById(dist.medication_requirement_id) || {};
                      const participantName = escapeHTML(this.getParticipantName(dist.participant_id));
                      const dateLabel = formatDate(dist.scheduled_for, this.app.lang || "en", { year: "numeric", month: "short", day: "numeric" });
                      const timeLabel = new Date(dist.scheduled_for).toLocaleTimeString(this.app.lang || "en", { hour: "2-digit", minute: "2-digit" });
                      return `
                        <tr>
                          <td>${escapeHTML(dateLabel)}</td>
                          <td>${escapeHTML(timeLabel)}</td>
                          <td>${participantName}</td>
                          <td>${escapeHTML(requirement.medication_name || translate("medication"))}</td>
                          <td>${escapeHTML(dist.dose_notes || requirement.dosage_instructions || "-")}</td>
                          <td>${escapeHTML(dist.frequency_text || requirement.frequency_text || "-")}</td>
                          <td>${escapeHTML(dist.general_notice || requirement.general_notes || "-")}</td>
                        </tr>
                      `;
                    }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    this.renderAlertArea();
  }

  /**
   * Render aggregated alerts so only one alert is shown per time slot.
   */
  renderAlertArea() {
    const container = document.getElementById("medication-alerts");
    if (!container) {
      return;
    }

    const alerts = this.getAggregatedAlerts();

    if (!alerts.length) {
      container.innerHTML = `<p>${escapeHTML(translate("medication_alerts_empty"))}</p>`;
      return;
    }

    container.innerHTML = alerts.map((alert) => {
      const timeLabel = alert.time.toLocaleTimeString(this.app.lang || "en", { hour: "2-digit", minute: "2-digit" });
      const dateLabel = formatDate(alert.time.toISOString(), this.app.lang || "en", { year: "numeric", month: "short", day: "numeric" });
      const dueLabel = alert.minutesUntil <= 5 ? translate("medication_due_now") : translate("medication_due_in_minutes").replace("{minutes}", alert.minutesUntil);

      return `
        <div class="alert-group" data-slot="${alert.slotKey}">
          <div class="alert-meta">
            <div>
              <div style="font-size:0.9rem; opacity:0.9;">${escapeHTML(dateLabel)}</div>
              <strong>${escapeHTML(translate("medication_alert_due"))} ${escapeHTML(timeLabel)}</strong>
            </div>
            <span class="pill">${escapeHTML(dueLabel)}</span>
          </div>
          <div class="alert-participants">
            <strong>${escapeHTML(translate("medication_alert_group_label"))}</strong>
            <ul style="margin:0; padding-left:1.25rem;">
              ${alert.items.map((item) => {
                const requirement = this.getRequirementById(item.medication_requirement_id) || {};
                return `<li>${escapeHTML(this.getParticipantName(item.participant_id))} · ${escapeHTML(requirement.medication_name || translate("medication"))}</li>`;
              }).join("")}
            </ul>
          </div>
          <div class="alert-actions">
            <button class="btn secondary" data-prefill-slot="${alert.slotKey}" data-requirement-id="${alert.primaryRequirementId}">${escapeHTML(translate("medication_prefill_from_alert"))}</button>
            <button class="btn primary" data-mark-given-slot="${alert.slotKey}" data-distributions="${alert.distributionIds.join(",")}">${escapeHTML(translate("medication_mark_given"))}</button>
          </div>
        </div>
      `;
    }).join("");
  }

  /**
   * Group distributions by time slot to present a single alert when multiple participants share a schedule.
   * @returns {Array} Aggregated alert payloads
   */
  getAggregatedAlerts() {
    const now = new Date();
    const windowLimit = new Date(now.getTime() + this.alertWindowMinutes * 60 * 1000);
    const recentWindow = new Date(now.getTime() - this.alertLookbackMinutes * 60 * 1000);
    const grouped = new Map();

    this.distributions
      .filter((dist) => dist.status === "scheduled")
      .forEach((dist) => {
        const scheduledAt = new Date(dist.scheduled_for);
        if (scheduledAt < recentWindow || scheduledAt > windowLimit) {
          return;
        }
        const slotKey = scheduledAt.toISOString().slice(0, 16);
        if (!grouped.has(slotKey)) {
          grouped.set(slotKey, {
            slotKey,
            time: scheduledAt,
            distributionIds: [],
            items: [],
            primaryRequirementId: dist.medication_requirement_id
          });
        }
        const existing = grouped.get(slotKey);
        existing.distributionIds.push(dist.id);
        existing.items.push(dist);
        if (!existing.primaryRequirementId) {
          existing.primaryRequirementId = dist.medication_requirement_id;
        }
      });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        minutesUntil: Math.max(0, Math.round((group.time.getTime() - now.getTime()) / 60000))
      }))
      .sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  attachEventListeners() {
    const requirementForm = document.getElementById("medicationRequirementForm");
    const scheduleForm = document.getElementById("medicationScheduleForm");
    const requirementSelect = document.getElementById("medicationRequirementSelect");
    const alertContainer = document.getElementById("medication-alerts");

    requirementForm?.addEventListener("submit", (event) => this.handleRequirementSubmit(event));
    scheduleForm?.addEventListener("submit", (event) => this.handleScheduleSubmit(event));

    requirementSelect?.addEventListener("change", (event) => {
      const requirementId = Number(event.target.value);
      this.prefillFromRequirement(requirementId);
    });

    alertContainer?.addEventListener("click", (event) => {
      const prefillSlot = event.target.closest("[data-prefill-slot]");
      const markGiven = event.target.closest("[data-mark-given-slot]");

      if (prefillSlot) {
        this.prefillFromSlot(prefillSlot.dataset.prefillSlot, Number(prefillSlot.dataset.requirementId));
      }

      if (markGiven) {
        const ids = (markGiven.dataset.distributions || "")
          .split(",")
          .map((id) => Number(id))
          .filter(Boolean);
        this.handleMarkGiven(ids, markGiven.dataset.markGivenSlot);
      }
    });
  }

  prefillFromRequirement(requirementId) {
    const requirement = this.getRequirementById(requirementId);
    const participantSelect = document.getElementById("distributionParticipants");
    const noteField = document.querySelector("textarea[name='dose_notes']");

    if (!requirement || !participantSelect) {
      return;
    }

    const participantIds = this.participantMedications
      .filter((assignment) => assignment.medication_requirement_id === requirementId)
      .map((assignment) => assignment.participant_id);

    Array.from(participantSelect.options).forEach((option) => {
      option.selected = participantIds.includes(Number(option.value));
    });

    if (noteField && !noteField.value) {
      noteField.value = requirement.dosage_instructions || requirement.general_notes || "";
    }
  }

  prefillFromSlot(slotKey, requirementId) {
    const matchingAlert = this.getAggregatedAlerts().find((alert) => alert.slotKey === slotKey);
    if (!matchingAlert) {
      return;
    }

    const scheduledDate = matchingAlert.time.toISOString().slice(0, 10);
    const scheduledTime = matchingAlert.time.toISOString().slice(11, 16);
    const participantSelect = document.getElementById("distributionParticipants");
    const dateField = document.querySelector("input[name='scheduled_date']");
    const timeField = document.querySelector("input[name='scheduled_time']");
    const requirementSelect = document.getElementById("medicationRequirementSelect");

    if (dateField) dateField.value = scheduledDate;
    if (timeField) timeField.value = scheduledTime;
    if (requirementSelect && requirementId) requirementSelect.value = requirementId;

    const participantIds = matchingAlert.items.map((item) => item.participant_id);
    if (participantSelect) {
      Array.from(participantSelect.options).forEach((option) => {
        option.selected = participantIds.includes(Number(option.value));
      });
    }
  }

  async handleRequirementSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const participantIds = Array.from(formData.getAll("participant_ids"), (id) => Number(id)).filter(Boolean);

    if (!formData.get("medication_name") || participantIds.length === 0) {
      this.app.showMessage(translate("medication_requirement_fields_missing"), "warning");
      return;
    }

    const payload = {
      medication_name: formData.get("medication_name")?.trim(),
      dosage_instructions: formData.get("dosage_instructions")?.trim() || null,
      frequency_text: formData.get("frequency_text")?.trim() || null,
      route: formData.get("route")?.trim() || null,
      default_dose_amount: formData.get("default_dose_amount") ? Number(formData.get("default_dose_amount")) : null,
      default_dose_unit: formData.get("default_dose_unit")?.trim() || null,
      general_notes: formData.get("general_notes")?.trim() || null,
      participant_ids: participantIds,
      participant_notes: participantIds.reduce((notes, id) => {
        const note = formData.get(`participant_note_${id}`)?.trim();
        if (note) {
          notes[id] = note;
        }
        return notes;
      }, {})
    };

    try {
      await saveMedicationRequirement(payload);
      this.app.showMessage(translate("medication_requirement_saved"), "success");
      await this.refreshData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving medication requirement", error);
      this.app.showMessage(error.message || translate("error_saving"), "error");
    }
  }

  async handleScheduleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const participantIds = Array.from(formData.getAll("distribution_participants"), (id) => Number(id)).filter(Boolean);

    if (!formData.get("medication_requirement_id") || !formData.get("scheduled_date") || !formData.get("scheduled_time") || participantIds.length === 0) {
      this.app.showMessage(translate("medication_distribution_fields_missing"), "warning");
      return;
    }

    const scheduledFor = `${formData.get("scheduled_date")}T${formData.get("scheduled_time")}:00`;

    const payload = {
      medication_requirement_id: Number(formData.get("medication_requirement_id")),
      participant_ids: participantIds,
      scheduled_for: scheduledFor,
      activity_name: formData.get("activity_name")?.trim() || null,
      dose_notes: formData.get("dose_notes")?.trim() || null,
      witness_name: formData.get("witness_name")?.trim() || null,
      general_notice: formData.get("dose_notes")?.trim() || null
    };

    try {
      await recordMedicationDistribution(payload);
      this.app.showMessage(translate("medication_distribution_saved"), "success");
      await this.refreshData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving medication distribution", error);
      this.app.showMessage(error.message || translate("error_saving"), "error");
    }
  }

  async handleMarkGiven(distributionIds, slotKey) {
    if (!distributionIds.length) {
      return;
    }

    const witnessInput = document.querySelector("input[name='witness_name']");
    const witness = witnessInput?.value?.trim() || this.getDefaultWitness();

    try {
      await Promise.all(
        distributionIds.map((id) => markMedicationDistributionAsGiven(id, {
          status: "given",
          administered_at: new Date().toISOString(),
          witness_name: witness
        }))
      );
      this.app.showMessage(translate("medication_mark_given_success"), "success");
      await this.refreshData();
      this.renderAlertArea();
      this.prefillFromSlot(slotKey, this.getAggregatedAlerts().find((a) => a.slotKey === slotKey)?.primaryRequirementId || null);
    } catch (error) {
      debugError("Error marking medication as given", error);
      this.app.showMessage(error.message || translate("error_saving"), "error");
    }
  }

  startAlertTicker() {
    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }
    this.alertInterval = setInterval(() => this.renderAlertArea(), this.alertRefreshMs);
  }

  getRequirementById(requirementId) {
    return this.requirements.find((req) => req.id === requirementId);
  }

  getParticipantName(participantId) {
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant) {
      return translate("unknown");
    }
    return `${participant.first_name || ""} ${participant.last_name || ""}`.trim();
  }

  getDefaultWitness() {
    return this.app?.userFullName || localStorage.getItem("userFullName") || "";
  }
}
