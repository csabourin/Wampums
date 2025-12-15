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
  markMedicationDistributionAsGiven,
  getFicheMedications
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
    this.ficheMedications = [];
    this.activeTab = "planning";
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
    const [participantsResponse, requirementsResponse, assignmentsResponse, distributionsResponse, ficheMedicationsResponse] = await Promise.all([
      getParticipants(),
      getMedicationRequirements(),
      getParticipantMedications(),
      getMedicationDistributions({ upcoming_only: true }),
      getFicheMedications()
    ]);

    this.participants = participantsResponse?.data || participantsResponse?.participants || [];
    this.requirements = requirementsResponse?.data?.requirements || requirementsResponse?.requirements || [];
    this.participantMedications = assignmentsResponse?.data?.participant_medications
      || assignmentsResponse?.participant_medications
      || [];
    this.distributions = distributionsResponse?.data?.distributions || distributionsResponse?.distributions || [];
    this.ficheMedications = ficheMedicationsResponse?.data?.medications || ficheMedicationsResponse?.medications || [];
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

      .tab-nav {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-top: 0.75rem;
      }

      .tab-button {
        border: 1px solid #d1d5db;
        background: #fff;
        padding: 0.5rem 0.75rem;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-weight: 600;
      }

      .tab-button.active {
        background: #0b3c5d;
        color: #fff;
        border-color: #0b3c5d;
      }

      .tab-panel.hidden {
        display: none;
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

      .frequency-time-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.5rem;
      }

      .slot-label {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
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

  /**
   * Generate the HTML block for frequency preset inputs.
   * @param {string} presetType
   * @returns {string}
   */
  getFrequencyPresetFieldsMarkup(presetType = "time_of_day") {
    const mealSlots = this.getMealSlots();
    if (presetType === "interval") {
      return `
        <span>${escapeHTML(translate("medication_frequency_interval_label"))}</span>
        <div class="frequency-time-grid">
          <label class="slot-label">
            <input type="number" name="frequency_interval_hours" min="1" step="1" value="6" aria-label="${escapeHTML(translate("medication_frequency_interval_hours"))}" />
            <span>${escapeHTML(translate("medication_frequency_interval_hours"))}</span>
          </label>
          <label class="slot-label">
            <input type="time" name="frequency_interval_start" value="08:00" aria-label="${escapeHTML(translate("medication_frequency_anchor_time"))}" />
            <span>${escapeHTML(translate("medication_frequency_anchor_time"))}</span>
          </label>
        </div>
        <p class="help-text">${escapeHTML(translate("medication_frequency_interval_hint"))}</p>
      `;
    }

    if (presetType === "meal") {
      return `
        <span>${escapeHTML(translate("medication_frequency_meal_label"))}</span>
        <div class="participant-grid">
          ${mealSlots
            .map(
              (slot) => `
                <label class="participant-pill" style="align-items:center;">
                  <input type="checkbox" name="frequency_meal_${slot.key}" value="${slot.key}" checked />
                  <span>${escapeHTML(translate(slot.labelKey))}</span>
                  <input type="time" name="frequency_meal_${slot.key}_time" value="${slot.defaultTime}" aria-label="${escapeHTML(translate(slot.labelKey))}" />
                </label>
              `
            )
            .join("")}
        </div>
        <p class="help-text">${escapeHTML(translate("medication_frequency_meal_hint"))}</p>
      `;
    }

    if (presetType === "prn") {
      return `<p class="help-text">${escapeHTML(translate("medication_frequency_prn_hint"))}</p>`;
    }

    return `
      <span>${escapeHTML(translate("medication_frequency_time_of_day_label"))}</span>
      <div class="frequency-time-grid">
        <input type="time" name="frequency_times" value="08:00" aria-label="${escapeHTML(translate("medication_frequency_time_one"))}" />
        <input type="time" name="frequency_times" value="12:00" aria-label="${escapeHTML(translate("medication_frequency_time_two"))}" />
        <input type="time" name="frequency_times" value="20:00" aria-label="${escapeHTML(translate("medication_frequency_time_three"))}" />
      </div>
      <p class="help-text">${escapeHTML(translate("medication_frequency_time_of_day_hint"))}</p>
    `;
  }

  /**
   * Normalize time values to HH:MM.
   * @param {string|null} value
   * @returns {string|null}
   */
  normalizeTimeValue(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    const [hour, minute] = value.split(":").map((part) => Number(part));
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return null;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  getMealSlots() {
    return [
      { key: "breakfast", labelKey: "medication_frequency_breakfast", defaultTime: "08:00" },
      { key: "lunch", labelKey: "medication_frequency_lunch", defaultTime: "12:00" },
      { key: "dinner", labelKey: "medication_frequency_dinner", defaultTime: "18:00" },
      { key: "bedtime", labelKey: "medication_frequency_bedtime", defaultTime: "21:00" }
    ];
  }

  /**
   * Build a structured frequency configuration from the requirement form.
   * @param {FormData} formData
   */
  buildFrequencyConfigFromForm(formData) {
    const presetType = formData.get("frequency_preset_type") || "time_of_day";
    const config = { type: presetType, times: [], slots: {}, intervalHours: null, intervalStart: null };

    if (presetType === "interval") {
      config.intervalHours = formData.get("frequency_interval_hours") ? Number(formData.get("frequency_interval_hours")) : null;
      config.intervalStart = this.normalizeTimeValue(formData.get("frequency_interval_start")) || null;
      config.times = this.computeIntervalTimes(config.intervalStart || "08:00", config.intervalHours || 1);
    } else if (presetType === "meal") {
      this.getMealSlots().forEach((slot) => {
        if (formData.get(`frequency_meal_${slot.key}`)) {
          const slotTime = this.normalizeTimeValue(formData.get(`frequency_meal_${slot.key}_time`)) || slot.defaultTime;
          config.slots[slot.key] = slotTime;
          config.times.push(slotTime);
        }
      });
    } else if (presetType === "time_of_day") {
      config.times = formData
        .getAll("frequency_times")
        .map((value) => this.normalizeTimeValue(value))
        .filter(Boolean);
    }

    config.text = this.buildFrequencyText(config);
    return config;
  }

  buildFrequencyText(config) {
    if (config.type === "interval" && config.intervalHours) {
      return translate("medication_frequency_interval_text").replace("{hours}", config.intervalHours);
    }
    if (config.type === "meal" && config.times.length) {
      return translate("medication_frequency_meal_text");
    }
    if (config.type === "time_of_day" && config.times.length) {
      return translate("medication_frequency_time_of_day_text");
    }
    return translate("medication_frequency_prn_text");
  }

  /**
   * Compute interval times within a 24-hour window.
   * @param {string} startTime
   * @param {number} intervalHours
   * @returns {string[]}
   */
  computeIntervalTimes(startTime, intervalHours) {
    const normalizedStart = this.normalizeTimeValue(startTime) || "08:00";
    const hours = intervalHours && intervalHours > 0 ? intervalHours : 1;
    const [startHour, startMinute] = normalizedStart.split(":").map((value) => Number(value));
    const anchor = new Date();
    anchor.setHours(startHour, startMinute, 0, 0);
    const times = [];
    const cutoff = new Date(anchor.getTime() + 24 * 60 * 60 * 1000);
    let cursor = new Date(anchor);
    while (cursor < cutoff && times.length < 12) {
      times.push(`${String(cursor.getHours()).padStart(2, "0")}:${String(cursor.getMinutes()).padStart(2, "0")}`);
      cursor = new Date(cursor.getTime() + hours * 60 * 60 * 1000);
    }
    return Array.from(new Set(times));
  }

  buildDateTimeISO(date, time) {
    const normalizedTime = this.normalizeTimeValue(time) || "00:00";
    return `${date}T${normalizedTime}:00`;
  }

  getRequirementFrequencyConfig(requirement) {
    if (!requirement) {
      return {};
    }
    let times = [];
    if (Array.isArray(requirement.frequency_times)) {
      times = requirement.frequency_times;
    } else if (typeof requirement.frequency_times === "string") {
      const trimmed = requirement.frequency_times.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            times = parsed;
          }
        } catch (error) {
          debugError("Unable to parse frequency_times", error);
        }
      } else {
        times = trimmed
          .split(",")
          .map((value) => this.normalizeTimeValue(value))
          .filter(Boolean);
      }
    }

    const slots = typeof requirement.frequency_slots === "object" && requirement.frequency_slots !== null
      ? requirement.frequency_slots
      : {};

    return {
      type: requirement.frequency_preset_type || requirement.frequency_type || null,
      times: times.filter(Boolean),
      slots,
      intervalHours: requirement.frequency_interval_hours || null,
      intervalStart: requirement.frequency_interval_start || null,
      text: requirement.frequency_text || null
    };
  }

  buildSlotsForRequirement(requirement, date, anchorTime) {
    if (!requirement) {
      return [];
    }
    const config = this.getRequirementFrequencyConfig(requirement);
    const selectedDate = date || getTodayISO();
    const slots = [];

    if (config.type === "interval" && config.intervalHours) {
      const intervalTimes = this.computeIntervalTimes(config.intervalStart || anchorTime, config.intervalHours);
      intervalTimes.forEach((time) => {
        slots.push({
          key: `interval-${time}`,
          iso: this.buildDateTimeISO(selectedDate, time),
          label: translate("medication_frequency_interval_slot").replace("{time}", time)
        });
      });
    } else if (config.type === "meal") {
      const slotMap = Object.keys(config.slots).length ? config.slots : this.getMealSlots().reduce((map, slot) => {
        map[slot.key] = slot.defaultTime;
        return map;
      }, {});
      Object.entries(slotMap).forEach(([slotKey, time]) => {
        slots.push({
          key: `meal-${slotKey}`,
          iso: this.buildDateTimeISO(selectedDate, time),
          label: translate(`medication_frequency_${slotKey}`)
        });
      });
    } else if (config.type === "time_of_day" && config.times?.length) {
      config.times.forEach((time, index) => {
        slots.push({
          key: `time-${index}-${time}`,
          iso: this.buildDateTimeISO(selectedDate, time),
          label: translate("medication_frequency_specific_time").replace("{time}", time)
        });
      });
    }

    return slots;
  }

  renderScheduleFrequencyHelper() {
    const requirementSelect = document.getElementById("medicationRequirementSelect");
    const requirementId = requirementSelect ? Number(requirementSelect.value) : null;
    const requirement = requirementId ? this.getRequirementById(requirementId) : null;
    const dateField = document.querySelector("input[name='scheduled_date']");
    const timeField = document.querySelector("input[name='scheduled_time']");
    const scheduledDate = dateField?.value || getTodayISO();
    const anchorTime = timeField?.value || "08:00";

    if (!requirement) {
      return `<p class="help-text">${escapeHTML(translate("medication_schedule_frequency_helper"))}</p>`;
    }

    const slots = this.buildSlotsForRequirement(requirement, scheduledDate, anchorTime);
    if (!slots.length) {
      return `<p class="help-text">${escapeHTML(translate("medication_schedule_frequency_missing"))}</p>`;
    }

    return `
      <span>${escapeHTML(translate("medication_schedule_frequency_label"))}</span>
      <div class="participant-grid">
        ${slots
          .map(
            (slot) => `
              <label class="participant-pill" style="align-items:center;">
                <input type="checkbox" name="schedule_slots" value="${slot.iso}" checked />
                <span>${escapeHTML(slot.label)}</span>
              </label>
            `
          )
          .join("")}
      </div>
      <p class="help-text">${escapeHTML(translate("medication_schedule_frequency_hint"))}</p>
    `;
  }

  updateScheduleFrequencyHelper() {
    const helper = document.getElementById("scheduleFrequencyHelper");
    if (helper) {
      helper.innerHTML = this.renderScheduleFrequencyHelper();
    }
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

    const medicationSuggestions = this.ficheMedications
      .map((medication) => `<option value="${escapeHTML(medication)}"></option>`)
      .join("");

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${escapeHTML(translate("back_to_dashboard"))}">🏠</a>
      <section class="page medication-page">
        <div class="card">
          <h1>${escapeHTML(translate("medication_management_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("medication_management_description"))}</p>
          <div class="pill">${escapeHTML(translate("medication_management_alert_window_hint"))}</div>
          <div class="tab-nav" role="tablist" aria-label="${escapeHTML(translate("medication_management_title"))}">
            <button type="button" class="tab-button ${this.activeTab === "planning" ? "active" : ""}" data-medication-tab="planning" aria-selected="${this.activeTab === "planning"}">
              ${escapeHTML(translate("medication_planning_tab"))}
            </button>
            <button type="button" class="tab-button ${this.activeTab === "dispensing" ? "active" : ""}" data-medication-tab="dispensing" aria-selected="${this.activeTab === "dispensing"}">
              ${escapeHTML(translate("medication_dispensing_tab"))}
            </button>
          </div>
        </div>

        <div class="tab-panel ${this.activeTab === "planning" ? "" : "hidden"}" data-tab-panel="planning">
          ${this.renderPlanningSection({ medicationSuggestions, participantOptions })}
        </div>

        <div class="tab-panel ${this.activeTab === "dispensing" ? "" : "hidden"}" data-tab-panel="dispensing">
          ${this.renderDispensingSection({ today, timeValue, requirementOptions, participantOptions })}
        </div>
      </section>
    `;

    if (this.activeTab === "dispensing") {
      this.renderAlertArea();
      this.updateScheduleFrequencyHelper();
    }
  }

  renderPlanningSection({ medicationSuggestions, participantOptions }) {
    const suggestionList = medicationSuggestions
      ? `<datalist id="ficheMedicationsList">${medicationSuggestions}</datalist>`
      : "";

    return `
      <div class="card">
        <h2>${escapeHTML(translate("medication_requirement_form_title"))}</h2>
        <form id="medicationRequirementForm" class="medication-grid">
          <label class="field-group">
            <span>${escapeHTML(translate("medication_name_label"))}</span>
            <input type="text" name="medication_name" list="ficheMedicationsList" required maxlength="200" />
            ${medicationSuggestions ? `<p class="help-text">${escapeHTML(translate("medication_fiche_suggestions_hint"))}</p>` : ""}
            ${suggestionList}
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_dosage_label"))}</span>
            <input type="text" name="dosage_instructions" maxlength="200" placeholder="${escapeHTML(translate("dose"))}" />
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_frequency_label"))}</span>
            <select name="frequency_preset_type" id="frequencyPreset" required>
              <option value="interval">${escapeHTML(translate("medication_frequency_interval"))}</option>
              <option value="time_of_day" selected>${escapeHTML(translate("medication_frequency_time_of_day"))}</option>
              <option value="meal">${escapeHTML(translate("medication_frequency_meal"))}</option>
              <option value="prn">${escapeHTML(translate("medication_frequency_prn"))}</option>
            </select>
          </label>
          <div class="field-group" id="frequencyPresetFields" style="grid-column: 1 / -1;">
            ${this.getFrequencyPresetFieldsMarkup("time_of_day")}
          </div>
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
          <label class="field-group" style="grid-column: 1 / -1;">
            <span>${escapeHTML(translate("medication_assign_participants"))}</span>
            <select name="participant_id" id="requirementParticipantSelect" required>
              <option value="">${escapeHTML(translate("select_option"))}</option>
              ${participantOptions}
            </select>
            <p class="help-text">${escapeHTML(translate("medication_requirement_single_participant_hint"))}</p>
          </label>
          <button class="btn primary" type="submit">${escapeHTML(translate("medication_save_requirement"))}</button>
        </form>
      </div>
      <div class="card">
        <h2>${escapeHTML(translate("medication_existing_requirements_title"))}</h2>
        ${this.renderRequirementTable()}
      </div>
    `;
  }

  renderDispensingSection({ today, timeValue, requirementOptions, participantOptions }) {
    return `
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
            <p class="help-text">${escapeHTML(translate("medication_schedule_time_hint"))}</p>
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_requirement_form_title"))}</span>
            <select name="medication_requirement_id" id="medicationRequirementSelect" required>
              <option value="">${escapeHTML(translate("select_option"))}</option>
              ${requirementOptions}
            </select>
          </label>
          <div class="field-group" id="scheduleFrequencyHelper" style="grid-column: 1 / -1;">
            ${this.renderScheduleFrequencyHelper()}
          </div>
          <label class="field-group">
            <span>${escapeHTML(translate("participants"))}</span>
            <select name="distribution_participant_id" id="distributionParticipant" required>
              <option value="">${escapeHTML(translate("select_option"))}</option>
              ${participantOptions}
            </select>
            <p class="help-text">${escapeHTML(translate("medication_one_alert_hint"))}</p>
          </label>
          <label class="field-group" style="grid-column: 1 / -1;">
            <span>${escapeHTML(translate("medication_schedule_activity"))}</span>
            <input type="text" name="activity_name" maxlength="200" />
          </label>
          <label class="field-group" style="grid-column: 1 / -1;">
            <span>${escapeHTML(translate("medication_schedule_notes"))}</span>
            <textarea name="dose_notes" rows="2" maxlength="500"></textarea>
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_witness_label"))}</span>
            <input type="text" name="witness_name" maxlength="150" placeholder="${escapeHTML(this.getDefaultWitness())}" />
          </label>
          <button class="btn primary" type="submit">${escapeHTML(translate("medication_schedule_button"))}</button>
        </form>
      </div>

      <div class="card">
        <h2>${escapeHTML(translate("medication_alerts_heading"))}</h2>
        <div id="medication-alerts"></div>
      </div>

      <div class="card">
        <h2>${escapeHTML(translate("medication_upcoming_schedule"))}</h2>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>${escapeHTML(translate("date"))}</th>
                <th>${escapeHTML(translate("time"))}</th>
                <th>${escapeHTML(translate("participants"))}</th>
                <th>${escapeHTML(translate("medication"))}</th>
                <th>${escapeHTML(translate("medication_default_dose"))}</th>
                <th>${escapeHTML(translate("medication_frequency"))}</th>
                <th>${escapeHTML(translate("notes"))}</th>
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
    `;
  }

  renderRequirementTable() {
    if (!this.requirements.length) {
      return `<p>${escapeHTML(translate("medication_requirements_empty"))}</p>`;
    }

    const rows = this.requirements.map((req) => {
      const assigned = this.participantMedications.find((assignment) => assignment.medication_requirement_id === req.id);
      const participantName = assigned ? this.getParticipantName(assigned.participant_id) : translate("unknown");
      return `
        <tr>
          <td>${escapeHTML(req.medication_name)}</td>
          <td>${escapeHTML(participantName)}</td>
          <td>${escapeHTML(req.frequency_text || translate("medication_frequency"))}</td>
          <td>${escapeHTML(req.general_notes || req.dosage_instructions || "-")}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHTML(translate("medication"))}</th>
              <th>${escapeHTML(translate("participants"))}</th>
              <th>${escapeHTML(translate("medication_frequency"))}</th>
              <th>${escapeHTML(translate("notes"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
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
    const frequencyPresetSelect = document.getElementById("frequencyPreset");
    const scheduleDateField = document.querySelector("input[name='scheduled_date']");
    const scheduleTimeField = document.querySelector("input[name='scheduled_time']");

    document.querySelectorAll("[data-medication-tab]").forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        const nextTab = tabButton.dataset.medicationTab;
        if (nextTab && nextTab !== this.activeTab) {
          this.activeTab = nextTab;
          this.render();
          this.attachEventListeners();
        }
      });
    });

    requirementForm?.addEventListener("submit", (event) => this.handleRequirementSubmit(event));
    scheduleForm?.addEventListener("submit", (event) => this.handleScheduleSubmit(event));

    frequencyPresetSelect?.addEventListener("change", (event) => {
      const container = document.getElementById("frequencyPresetFields");
      if (container) {
        container.innerHTML = this.getFrequencyPresetFieldsMarkup(event.target.value);
      }
    });

    requirementSelect?.addEventListener("change", (event) => {
      const requirementId = Number(event.target.value);
      this.prefillFromRequirement(requirementId);
      this.updateScheduleFrequencyHelper();
    });

    scheduleDateField?.addEventListener("change", () => this.updateScheduleFrequencyHelper());
    scheduleTimeField?.addEventListener("change", () => this.updateScheduleFrequencyHelper());

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
    const participantSelect = document.getElementById("distributionParticipant");
    const noteField = document.querySelector("textarea[name='dose_notes']");

    if (!requirement || !participantSelect) {
      return;
    }

    const participantId = this.participantMedications
      .find((assignment) => assignment.medication_requirement_id === requirementId)?.participant_id;

    participantSelect.value = participantId ? String(participantId) : "";

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
    const participantSelect = document.getElementById("distributionParticipant");
    const dateField = document.querySelector("input[name='scheduled_date']");
    const timeField = document.querySelector("input[name='scheduled_time']");
    const requirementSelect = document.getElementById("medicationRequirementSelect");

    if (dateField) dateField.value = scheduledDate;
    if (timeField) timeField.value = scheduledTime;
    if (requirementSelect && requirementId) requirementSelect.value = requirementId;

    const participantId = matchingAlert.items[0]?.participant_id || null;
    if (participantSelect) {
      participantSelect.value = participantId ? String(participantId) : "";
    }

    this.updateScheduleFrequencyHelper();
  }

  async handleRequirementSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const participantId = Number(formData.get("participant_id"));
    const frequencyConfig = this.buildFrequencyConfigFromForm(formData);

    if (!formData.get("medication_name") || !participantId) {
      this.app.showMessage(translate("medication_requirement_fields_missing"), "warning");
      return;
    }

    const payload = {
      medication_name: formData.get("medication_name")?.trim(),
      dosage_instructions: formData.get("dosage_instructions")?.trim() || null,
      frequency_text: frequencyConfig.text,
      frequency_preset_type: frequencyConfig.type,
      frequency_times: frequencyConfig.times,
      frequency_slots: frequencyConfig.slots,
      frequency_interval_hours: frequencyConfig.intervalHours,
      frequency_interval_start: frequencyConfig.intervalStart,
      route: formData.get("route")?.trim() || null,
      default_dose_amount: formData.get("default_dose_amount") ? Number(formData.get("default_dose_amount")) : null,
      default_dose_unit: formData.get("default_dose_unit")?.trim() || null,
      general_notes: formData.get("general_notes")?.trim() || null,
      participant_ids: [participantId]
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
    const participantId = Number(formData.get("distribution_participant_id"));
    const participantIds = Number.isFinite(participantId) && participantId > 0 ? [participantId] : [];
    const requirementId = Number(formData.get("medication_requirement_id"));
    const requirement = this.getRequirementById(requirementId);
    const frequencyConfig = this.getRequirementFrequencyConfig(requirement);

    if (!formData.get("medication_requirement_id") || !formData.get("scheduled_date") || !formData.get("scheduled_time") || participantIds.length === 0) {
      this.app.showMessage(translate("medication_distribution_fields_missing"), "warning");
      return;
    }

    const scheduledDate = formData.get("scheduled_date");
    const anchorTime = formData.get("scheduled_time");
    const slotSelections = Array.from(formData.getAll("schedule_slots"));
    const timesToSchedule = (slotSelections.length ? slotSelections : [this.buildDateTimeISO(scheduledDate, anchorTime)])
      .filter(Boolean);

    const payloads = Array.from(new Set(timesToSchedule)).map((scheduledFor) => ({
      medication_requirement_id: requirementId,
      participant_ids: participantIds,
      scheduled_for: scheduledFor,
      activity_name: formData.get("activity_name")?.trim() || null,
      dose_notes: formData.get("dose_notes")?.trim() || null,
      witness_name: formData.get("witness_name")?.trim() || null,
      general_notice: formData.get("dose_notes")?.trim() || null,
      frequency_text: frequencyConfig.text || requirement?.frequency_text || null,
      frequency_preset_type: frequencyConfig.type || null,
      frequency_times: frequencyConfig.times?.length ? frequencyConfig.times : null
    }));

    try {
      await Promise.all(payloads.map((payload) => recordMedicationDistribution(payload)));
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
