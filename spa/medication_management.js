import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import { deleteCachedData, getCachedData, getCachedDataIgnoreExpiration, setCachedData } from "./indexedDB.js";
import { setContent } from "./utils/DOMUtils.js";
import { OptimisticUpdateManager } from "./utils/OptimisticUpdateManager.js";
import {
  getParticipants,
  getMedicationRequirements,
  getParticipantMedications,
  getMedicationDistributions,
  saveMedicationRequirement,
  recordMedicationDistribution,
  markMedicationDistributionAsGiven,
  getFicheMedications,
  getMedicationReceptions
} from "./api/api-endpoints.js";
import { offlineManager } from "./modules/OfflineManager.js";

/**
 * Medication management module
 * Provides a mobile-first interface to capture medication requirements and
 * efficiently record distribution events with aggregated alerts for time slots.
 */
export class MedicationManagement {
  constructor(app, options = {}) {
    this.app = app;
    this.participants = [];
    this.requirements = [];
    this.participantMedications = [];
    this.distributions = [];
    this.ficheMedications = [];
    this.receptions = [];
    this.view = options.view || "planning";
    this.enableAlerts = options.enableAlerts ?? this.view === "dispensing";
    this.participantId = options.participantId || null;
    this.returnUrl = options.returnUrl || null;
    this.alertInterval = null;
    this.alertWindowMinutes = 90;
    this.alertLookbackMinutes = 30;
    this.alertRefreshMs = 60000;
    this.offlineStatusHandler = null;
    this.optimisticManager = new OptimisticUpdateManager();
  }

  async init() {
    try {
      this.injectStyles();
      await this.refreshData();
      this.render();
      this.attachEventListeners();
      this.registerOfflineListener();
      if (this.enableAlerts) {
        this.startAlertTicker();
      }
    } catch (error) {
      debugError("Error initializing medication management", error);
      this.app.showMessage(translate("error_loading_data"), "error");
    }
  }

  /**
   * Load baseline data required for the page.
   */
  async refreshData(forceRefresh = false) {
    // Check for cached data first (camp mode, prepared date, or offline)
    if (!forceRefresh && (offlineManager.campMode || offlineManager.isDatePrepared(getTodayISO()) || offlineManager.isOffline)) {
      const getCacheFn = offlineManager.isOffline ? getCachedDataIgnoreExpiration : getCachedData;
      const cachedRequirements = await getCacheFn('medication_requirements');
      const cachedDistributions = await getCacheFn('medication_distributions');
      const cachedParticipants = await getCacheFn('participants_v2');
      const cachedAssignments = await getCacheFn('participant_medications');
      const cachedReceptions = await getCacheFn('medication_receptions');

      if (cachedRequirements && cachedDistributions) {
        debugLog('Using cached medication data');

        // Extract data from cache (handle both wrapped and direct formats)
        const reqData = cachedRequirements.data || cachedRequirements;
        const distData = cachedDistributions.data || cachedDistributions;
        const partData = cachedParticipants?.data || cachedParticipants || [];
        const assignData = cachedAssignments?.data || cachedAssignments || {};
        const recData = cachedReceptions?.data || cachedReceptions || {};

        this.requirements = Array.isArray(reqData) ? reqData : (reqData.requirements || []);
        this.distributions = Array.isArray(distData) ? distData : (distData.distributions || []);
        this.participants = Array.isArray(partData) ? partData : [];
        this.participantMedications = Array.isArray(assignData)
          ? assignData
          : (assignData.participant_medications || []);
        this.ficheMedications = [];

        // Load receptions from cache for dispensing view
        if (this.view === "dispensing") {
          this.receptions = Array.isArray(recData)
            ? recData
            : (recData.receptions || []);
        }

        // Filter data if participantId is specified (parent view)
        this.filterDataByParticipant();

        debugLog('Loaded from cache:', {
          requirements: this.requirements.length,
          distributions: this.distributions.length,
          participants: this.participants.length,
          participantMedications: this.participantMedications.length,
          receptions: this.receptions?.length || 0
        });
        return;
      }

      // Offline with no cached data available
      if (offlineManager.isOffline) {
        this.offlineNoData = true;
        return;
      }
    }

    const cacheOptions = forceRefresh ? { forceRefresh: true } : {};
    const [participantsResponse, requirementsResponse, assignmentsResponse, distributionsResponse, ficheMedicationsResponse] = await Promise.all([
      getParticipants(),
      getMedicationRequirements(cacheOptions),
      getParticipantMedications({}, cacheOptions),
      getMedicationDistributions({ upcoming_only: true }, cacheOptions),
      getFicheMedications(cacheOptions)
    ]);

    this.participants = participantsResponse?.data || participantsResponse?.participants || [];
    this.requirements = requirementsResponse?.data?.requirements || requirementsResponse?.requirements || [];
    this.participantMedications = assignmentsResponse?.data?.participant_medications
      || assignmentsResponse?.participant_medications
      || [];
    this.distributions = distributionsResponse?.data?.distributions || distributionsResponse?.distributions || [];
    this.ficheMedications = ficheMedicationsResponse?.data?.medications || ficheMedicationsResponse?.medications || [];

    // Filter data if participantId is specified (parent view)
    this.filterDataByParticipant();

    // Load reception data for dispensing view
    if (this.view === "dispensing") {
      try {
        const receptionsResponse = await getMedicationReceptions({}, cacheOptions);
        this.receptions = receptionsResponse?.data?.receptions || receptionsResponse?.receptions || [];
      } catch (error) {
        debugError("Failed to load medication receptions", error);
        this.receptions = [];
      }
    }
  }

  /**
   * Filter all data to show only the specified participant's medications
   */
  filterDataByParticipant() {
    if (!this.participantId) {
      return;
    }

    // Filter participants to only the selected one
    this.participants = this.participants.filter(p => p.id === this.participantId);

    // Filter participantMedications to only assignments for this participant
    this.participantMedications = this.participantMedications.filter(pm => pm.participant_id === this.participantId);

    // Get the requirement IDs for this participant
    const requirementIds = this.participantMedications.map(pm => pm.medication_requirement_id);

    // Filter requirements to only those assigned to this participant
    this.requirements = this.requirements.filter(req => requirementIds.includes(req.id));

    // Filter distributions to only this participant
    this.distributions = this.distributions.filter(dist => dist.participant_id === this.participantId);
  }

  registerOfflineListener() {
    if (this.offlineStatusHandler) {
      return;
    }

    this.offlineStatusHandler = (event) => this.handleOfflineStatusChange(event);
    window.addEventListener("offlineStatusChanged", this.offlineStatusHandler);
  }

  async handleOfflineStatusChange(event) {
    const isOffline = event?.detail?.isOffline;

    // Update offline banner visibility
    const banner = document.getElementById("medication-offline-banner");
    if (banner) {
      if (isOffline) {
        banner.style.display = "flex";
        setContent(banner, `<span style="font-size:1.2rem;">&#9888;</span><span>${escapeHTML(translate("medication_offline_banner"))}</span>`);
      } else {
        banner.style.display = "none";
      }
    }

    // If going offline, no refresh needed
    if (isOffline) {
      return;
    }

    // Coming back online: sync and refresh
    try {
      await this.invalidateCaches();
      await this.refreshData(true);
      this.render();
      this.attachEventListeners();
      if (this.enableAlerts) {
        this.renderAlertArea();
      }
      this.app.showMessage(translate("medication_reloaded_after_reconnect"), "success");
    } catch (error) {
      debugError("Error refreshing medication data after reconnect", error);
      this.app.showMessage(error.message || translate("error_loading_data"), "error");
    }
  }

  /**
   * Persist current distribution state to IndexedDB so optimistic updates
   * survive page navigation while offline.
   */
  async persistDistributionsCache() {
    try {
      const cachePayload = { success: true, data: { distributions: this.distributions } };
      await setCachedData('medication_distributions', cachePayload);
      debugLog('Persisted distributions cache with', this.distributions.length, 'entries');
    } catch (err) {
      debugError('Failed to persist distributions cache:', err);
    }
  }

  async invalidateCaches() {
    const keys = [
      "medication_requirements",
      "participant_medications",
      "medication_distributions",
      "medication_distributions?upcoming_only=true",
      "fiche_medications"
    ];

    await Promise.all(keys.map(async (key) => {
      try {
        await deleteCachedData(key);
      } catch (error) {
        debugError("Failed to clear medication cache", key, error);
      }
    }));
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

      /* Participant medication cards */
      .participant-med-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
      }

      .participant-med-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
        padding-bottom: 0.75rem;
        border-bottom: 2px solid #e5e7eb;
      }

      .participant-med-header h3 {
        margin: 0;
        font-size: 1.25rem;
        color: #0b3c5d;
      }

      .medication-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .medication-item {
        background: #fff;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 0.75rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .medication-info {
        flex: 1;
        min-width: 0;
      }

      .medication-info strong {
        display: block;
        font-size: 1.1rem;
        color: #111827;
        margin-bottom: 0.25rem;
      }

      .medication-details {
        font-size: 0.9rem;
        color: #6b7280;
        margin-bottom: 0.25rem;
      }

      .medication-schedule {
        font-size: 0.85rem;
        color: #0b3c5d;
        font-weight: 600;
      }

      .medication-notes {
        font-size: 0.85rem;
        color: #9ca3af;
        font-style: italic;
        margin-top: 0.25rem;
      }

      .medication-time-slots {
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #e5e7eb;
      }

      .medication-time-slots strong {
        display: block;
        font-size: 0.9rem;
        color: #0b3c5d;
        margin-bottom: 0.5rem;
      }

      .time-slots-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .time-badge {
        display: inline-flex;
        align-items: center;
        background: #0b3c5d;
        color: #fff;
        padding: 0.4rem 0.75rem;
        border-radius: 999px;
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .btn-give-med {
        white-space: nowrap;
        padding: 0.65rem 1rem;
        font-weight: 600;
        font-size: 0.95rem;
        min-width: 100px;
      }

      /* Modal styles */
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 1rem;
      }

      .modal-content {
        background: #fff;
        border-radius: 12px;
        padding: 1.5rem;
        max-width: 500px;
        width: 100%;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      }

      .modal-content h3 {
        margin-top: 0;
        margin-bottom: 1rem;
        color: #0b3c5d;
      }

      #quickGiveDetails {
        background: #f3f4f6;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
      }

      #quickGiveDetails strong {
        display: block;
        margin-bottom: 0.5rem;
        color: #0b3c5d;
      }

      #quickGiveDetails div {
        margin-bottom: 0.25rem;
        color: #4b5563;
      }

      @media (max-width: 640px) {
        .medication-item {
          flex-direction: column;
          align-items: stretch;
        }

        .btn-give-med {
          width: 100%;
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
      setContent(helper, this.renderScheduleFrequencyHelper());
    }
  }

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    if (this.offlineNoData) {
      setContent(container, `
        <a href="/dashboard" class="button button--ghost">← ${escapeHTML(translate("back"))}</a>
        <section class="page medication-page">
          <div class="card" style="text-align:center; padding:2rem;">
            <h2>${escapeHTML(translate("offline_indicator"))}</h2>
            <p>${escapeHTML(translate("offline_data_not_prepared"))}</p>
          </div>
        </section>
      `);
      return;
    }

    const today = getTodayISO();
    const now = new Date();
    const timeValue = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const requirementOptions = this.requirements
      .map((req) => {
        const syncingLabel = req.isOptimistic ? ` (${escapeHTML(translate("medication_pending_sync"))})` : "";
        const disabled = req.isOptimistic ? " disabled" : "";
        return `<option value="${req.id}"${disabled}>${escapeHTML(req.medication_name)}${syncingLabel}</option>`;
      })
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

    const pageTitle = this.view === "dispensing"
      ? translate("medication_dispensing_title")
      : translate("medication_planning_title");
    const pageDescription = this.view === "dispensing"
      ? translate("medication_dispensing_description")
      : translate("medication_planning_description");

    // Hide switch link for parents (they should only see planning view)
    const switchLink = this.participantId
      ? ''
      : this.view === "dispensing"
        ? `<a class="pill" href="/medication-planning">${escapeHTML(translate("medication_switch_to_planning"))}</a>`
        : `<a class="pill" href="/medication-dispensing">${escapeHTML(translate("medication_switch_to_dispensing"))}</a>`;

    // Back button goes to returnUrl (set by router based on role), or dashboard
    const backUrl = this.returnUrl || (this.participantId ? '/parent-dashboard' : '/dashboard');
    const participantName = this.participantId && this.participants.length > 0
      ? ` - ${escapeHTML(this.participants[0].first_name)} ${escapeHTML(this.participants[0].last_name)}`
      : '';

    setContent(container, `
      <a href="${backUrl}" class="button button--ghost">← ${translate("back")}</a>
      <section class="page medication-page">
        <div class="card">
          <h1>${escapeHTML(pageTitle)}${participantName}</h1>
          <p class="subtitle">${escapeHTML(pageDescription)}</p>
          ${this.view === "dispensing" ? `<div class="pill">${escapeHTML(translate("medication_management_alert_window_hint"))}</div>` : ""}
          ${switchLink}
        </div>

        ${this.view === "planning"
          ? this.renderPlanningSection({ medicationSuggestions, participantOptions })
          : this.renderDispensingSection({ today, timeValue, requirementOptions, participantOptions })}
      </section>
    `);
    if (this.view === "dispensing") {
      this.renderAlertArea();
      this.updateScheduleFrequencyHelper();
    }
  }

  renderPlanningSection({ medicationSuggestions, participantOptions }) {
    const suggestionList = medicationSuggestions
      ? `<datalist id="ficheMedicationsList">${medicationSuggestions}</datalist>`
      : "";

    // When participantId is set (parent view), hide the participant selector and auto-populate it
    const participantSelectorHtml = this.participantId
      ? `
        <input type="hidden" name="participant_id" value="${this.participantId}" />
        <div class="field-group" style="grid-column: 1 / -1;">
          <span>${escapeHTML(translate("participants"))}</span>
          <p style="padding: 0.5rem; background: #f3f4f6; border-radius: 8px; margin: 0;">
            ${escapeHTML(this.participants[0]?.first_name || '')} ${escapeHTML(this.participants[0]?.last_name || '')}
          </p>
        </div>
      `
      : `
        <label class="field-group" style="grid-column: 1 / -1;">
          <span>${escapeHTML(translate("medication_assign_participants"))}</span>
          <select name="participant_id" id="requirementParticipantSelect" required>
            <option value="">${escapeHTML(translate("select_option"))}</option>
            ${participantOptions}
          </select>
          <p class="help-text">${escapeHTML(translate("medication_requirement_single_participant_hint"))}</p>
        </label>
      `;

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
          <label class="field-group">
            <span>${escapeHTML(translate("medication_start_date_label"))}</span>
            <input type="date" name="start_date" />
            <p class="help-text">${escapeHTML(translate("medication_start_date_hint"))}</p>
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_end_date_label"))}</span>
            <input type="date" name="end_date" />
            <p class="help-text">${escapeHTML(translate("medication_end_date_hint"))}</p>
          </label>
          ${participantSelectorHtml}
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
    const { pendingCards, givenCards } = this.renderParticipantMedicationSplitCards();
    const offlineBanner = offlineManager.isOffline
      ? `<div class="offline-banner" id="medication-offline-banner"
              style="background:#fef3c7; color:#92400e; padding:0.75rem 1rem; border-radius:8px; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;">
           <span style="font-size:1.2rem;">&#9888;</span>
           <span>${escapeHTML(translate("medication_offline_banner"))}</span>
         </div>`
      : '<div id="medication-offline-banner" style="display:none;"></div>';

    return `
      ${offlineBanner}

      <div class="card">
        <h2>${escapeHTML(translate("medication_alerts_heading"))}</h2>
        <div id="medication-alerts"></div>
      </div>

      <div class="card">
        <h2>${escapeHTML(translate("medication_to_distribute"))}</h2>
        <p class="subtitle">${escapeHTML(translate("medication_tap_to_dispense"))}</p>
        <div id="participant-medication-cards-pending">
          ${pendingCards}
        </div>
      </div>

      <div class="card">
        <h2>${escapeHTML(translate("medication_given_today"))}</h2>
        <p class="subtitle">${escapeHTML(translate("medication_given_today_description"))}</p>
        <div id="participant-medication-cards-given">
          ${givenCards}
        </div>
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
            <tbody id="medication-upcoming-table-body">${this.renderUpcomingRows()}</tbody>
          </table>
        </div>
      </div>

      <!-- Quick Give Modal -->
      <div id="quickGiveModal" class="modal" style="display:none;">
        <div class="modal-content">
          <h3 id="quickGiveTitle">${escapeHTML(translate("medication_give_confirmation"))}</h3>
          <div id="quickGiveDetails"></div>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_witness_label"))}</span>
            <input type="text" id="quickGiveWitness" maxlength="150" value="${escapeHTML(this.getDefaultWitness())}" />
          </label>
          <label class="field-group">
            <span>${escapeHTML(translate("medication_optional_notes"))}</span>
            <textarea id="quickGiveNotes" rows="2" maxlength="500"></textarea>
          </label>
          <div style="display:flex; gap:0.5rem; margin-top:1rem;">
            <button class="btn secondary" id="quickGiveCancel">${escapeHTML(translate("cancel"))}</button>
            <button class="btn primary" id="quickGiveConfirm">${escapeHTML(translate("medication_confirm_given"))}</button>
          </div>
        </div>
      </div>
    `;
  }

  renderParticipantMedicationCards() {
    // Group medications by participant
    const participantMeds = new Map();

    this.participantMedications.forEach((assignment) => {
      const requirement = this.getRequirementById(assignment.medication_requirement_id);
      if (!requirement) return;

      const participantId = assignment.participant_id;
      if (!participantMeds.has(participantId)) {
        participantMeds.set(participantId, []);
      }

      participantMeds.get(participantId).push({
        requirement,
        assignment
      });
    });

    if (participantMeds.size === 0) {
      return `<p>${escapeHTML(translate("medication_no_participants_assigned"))}</p>`;
    }

    const cards = Array.from(participantMeds.entries()).map(([participantId, medications]) => {
      const participantName = this.getParticipantName(participantId);

      // Filter out medications not yet received (hide status = not_received or no reception record)
      const dispensableMeds = medications.filter((med) => {
        const reception = this.getReceptionForMedication(participantId, med.requirement.id);
        return reception && reception.status !== "not_received";
      });

      if (dispensableMeds.length === 0) {
        return '';
      }

      return `
        <div class="participant-med-card">
          <div class="participant-med-header">
            <h3>${escapeHTML(participantName)}</h3>
            <span class="pill">${dispensableMeds.length} ${escapeHTML(translate("medications"))}</span>
          </div>
          <div class="medication-list">
            ${dispensableMeds.map((med) => {
              const req = med.requirement;
              const reception = this.getReceptionForMedication(participantId, req.id);
              const doseInfo = req.default_dose_amount
                ? `${req.default_dose_amount}${req.default_dose_unit || ''}`
                : req.dosage_instructions || '';
              const route = req.route ? ` · ${req.route}` : '';
              const frequency = req.frequency_text || translate("medication_frequency_prn_text");

              // Get time slots for display
              const timeSlots = this.getTimeSlotsForDisplay(req);
              const timeSlotsHtml = timeSlots.length > 0
                ? `<div class="medication-time-slots">
                     <strong>⏰ ${escapeHTML(translate("medication_administration_times"))}:</strong>
                     <div class="time-slots-list">
                       ${timeSlots.map(slot => `<span class="time-badge">${escapeHTML(slot)}</span>`).join('')}
                     </div>
                   </div>`
                : '';

              // Show reception notes and partial status if applicable
              const receptionNotesHtml = reception?.reception_notes
                ? `<div class="medication-notes" style="color:#0b3c5d; background:#e0f2fe; padding:0.35rem 0.5rem; border-radius:6px; margin-top:0.4rem;">
                     📋 ${escapeHTML(reception.reception_notes)}
                   </div>`
                : '';
              const partialBadge = reception?.status === "partial"
                ? `<span style="font-size:0.8rem; color:#92400e; background:#fef3c7; padding:0.2rem 0.5rem; border-radius:999px; margin-left:0.5rem;">${escapeHTML(translate("med_reception_status_partial"))}</span>`
                : '';

              return `
                <div class="medication-item">
                  <div class="medication-info">
                    <strong>${escapeHTML(req.medication_name)}${partialBadge}</strong>
                    <div class="medication-details">
                      ${escapeHTML(doseInfo)}${escapeHTML(route)}
                    </div>
                    <div class="medication-schedule">
                      ${escapeHTML(frequency)}
                    </div>
                    ${timeSlotsHtml}
                    ${receptionNotesHtml}
                    ${req.general_notes ? `<div class="medication-notes">${escapeHTML(req.general_notes)}</div>` : ''}
                  </div>
                  <button
                    class="btn primary btn-give-med"
                    data-participant-id="${participantId}"
                    data-requirement-id="${req.id}"
                    data-medication-name="${escapeHTML(req.medication_name)}"
                    data-dose="${escapeHTML(doseInfo)}"
                    data-route="${escapeHTML(req.route || '')}"
                  >
                    ${escapeHTML(translate("medication_give_now"))}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    return cards || `<p>${escapeHTML(translate("med_reception_no_received"))}</p>`;
  }

  /**
   * Extract local date string (YYYY-MM-DD) from a date value, matching
   * the format used by getTodayISO() so timezone handling is consistent.
   * @param {string|Date} dateValue
   * @returns {string} e.g. "2026-02-12"
   */
  toLocalDateString(dateValue) {
    return new Date(dateValue).toLocaleDateString("en-CA");
  }

  /**
   * Extract local time string (HH:MM) from a date value.
   * @param {string|Date} dateValue
   * @returns {string} e.g. "14:30"
   */
  toLocalTimeString(dateValue) {
    const d = new Date(dateValue);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Get all distributions marked as 'given' for today.
   * @returns {Array} Distributions with status 'given' and scheduled_for today
   */
  getTodayGivenDistributions() {
    const today = getTodayISO();
    return this.distributions.filter((dist) => {
      if (dist.status !== 'given') return false;
      return this.toLocalDateString(dist.scheduled_for || dist.administered_at) === today;
    });
  }

  /**
   * Check if a specific medication requirement has already had all its scheduled doses
   * given today for a participant.
   * @param {number} participantId
   * @param {number} requirementId
   * @returns {{ allGiven: boolean, givenDoses: Array, pendingSlots: Array, isPRN: boolean }}
   */
  getDoseStatusForToday(participantId, requirementId) {
    const today = getTodayISO();
    const requirement = this.getRequirementById(requirementId);

    // Get all today's distributions for this participant + requirement
    const todayDistributions = this.distributions.filter((dist) => {
      if (dist.participant_id !== participantId || dist.medication_requirement_id !== requirementId) return false;
      return this.toLocalDateString(dist.scheduled_for || dist.administered_at) === today;
    });

    const givenDoses = todayDistributions.filter((d) => d.status === 'given');

    // Get expected time slots for this requirement
    const expectedSlots = requirement ? this.buildSlotsForRequirement(requirement, today, '08:00') : [];
    const isPRN = requirement?.frequency_preset_type === 'prn';

    // For PRN medications, they can always be given again
    if (isPRN) {
      return { allGiven: false, givenDoses, pendingSlots: [], isPRN: true };
    }

    // Determine which slots still need doses.
    // slot.iso is a local datetime (e.g. "2026-02-12T14:00:00") so extract
    // the local HH:MM via toLocalTimeString to keep timezone handling uniform.
    const givenTimes = new Set(givenDoses.map((d) =>
      this.toLocalTimeString(d.scheduled_for)
    ));

    const pendingSlots = expectedSlots.filter((slot) => {
      const slotTime = this.toLocalTimeString(slot.iso);
      return !givenTimes.has(slotTime);
    });

    return {
      allGiven: expectedSlots.length > 0 && pendingSlots.length === 0,
      givenDoses,
      pendingSlots,
      isPRN: false
    };
  }

  /**
   * Render split cards: pending medications (to distribute) and given medications (already given today).
   * @returns {{ pendingCards: string, givenCards: string }}
   */
  renderParticipantMedicationSplitCards() {
    // Group medications by participant
    const participantMeds = new Map();

    this.participantMedications.forEach((assignment) => {
      const requirement = this.getRequirementById(assignment.medication_requirement_id);
      if (!requirement) return;

      const participantId = assignment.participant_id;
      if (!participantMeds.has(participantId)) {
        participantMeds.set(participantId, []);
      }

      participantMeds.get(participantId).push({
        requirement,
        assignment
      });
    });

    if (participantMeds.size === 0) {
      return {
        pendingCards: `<p>${escapeHTML(translate("medication_no_participants_assigned"))}</p>`,
        givenCards: `<p>${escapeHTML(translate("medication_no_given_today"))}</p>`
      };
    }

    let pendingHtml = '';
    let givenHtml = '';

    Array.from(participantMeds.entries()).forEach(([participantId, medications]) => {
      const participantName = this.getParticipantName(participantId);

      // Filter out medications not yet received
      const dispensableMeds = medications.filter((med) => {
        const reception = this.getReceptionForMedication(participantId, med.requirement.id);
        return reception && reception.status !== "not_received";
      });

      if (dispensableMeds.length === 0) return;

      const pendingMeds = [];
      const givenMeds = [];

      dispensableMeds.forEach((med) => {
        const req = med.requirement;
        const doseStatus = this.getDoseStatusForToday(participantId, req.id);

        if (doseStatus.givenDoses.length > 0) {
          givenMeds.push({ ...med, givenDoses: doseStatus.givenDoses });
        }

        // Show in pending list if not all doses given or if PRN
        if (!doseStatus.allGiven) {
          pendingMeds.push({ ...med, doseStatus });
        }
      });

      // Render pending card for this participant
      if (pendingMeds.length > 0) {
        pendingHtml += this.renderMedicationCard(participantId, participantName, pendingMeds, 'pending');
      }

      // Render given card for this participant
      if (givenMeds.length > 0) {
        givenHtml += this.renderMedicationCard(participantId, participantName, givenMeds, 'given');
      }
    });

    return {
      pendingCards: pendingHtml || `<p>${escapeHTML(translate("medication_all_distributed_today"))}</p>`,
      givenCards: givenHtml || `<p>${escapeHTML(translate("medication_no_given_today"))}</p>`
    };
  }

  /**
   * Render a medication card for a participant (used in both pending and given lists).
   * @param {number} participantId
   * @param {string} participantName
   * @param {Array} medications
   * @param {'pending'|'given'} cardType
   * @returns {string}
   */
  renderMedicationCard(participantId, participantName, medications, cardType) {
    const isGiven = cardType === 'given';
    const borderColor = isGiven ? '#10b981' : '#e5e7eb';
    const headerBg = isGiven ? '#ecfdf5' : '#f9fafb';
    const statusBadgeColor = isGiven ? 'background:#d1fae5; color:#065f46;' : 'background:#e0f2fe; color:#0b3c5d;';
    const statusLabel = isGiven ? translate("medication_status_given") : translate("medication_status_pending");

    return `
      <div class="participant-med-card" style="border-color:${borderColor}; ${isGiven ? 'opacity:0.85;' : ''}">
        <div class="participant-med-header" style="background:${headerBg}; margin:-1rem -1rem 0.75rem -1rem; padding:1rem; border-radius:12px 12px 0 0;">
          <h3>${escapeHTML(participantName)}</h3>
          <span class="pill" style="${statusBadgeColor}">${medications.length} ${escapeHTML(statusLabel)}</span>
        </div>
        <div class="medication-list">
          ${medications.map((med) => {
            const req = med.requirement;
            const reception = this.getReceptionForMedication(participantId, req.id);
            const doseInfo = req.default_dose_amount
              ? `${req.default_dose_amount}${req.default_dose_unit || ''}`
              : req.dosage_instructions || '';
            const route = req.route ? ` · ${req.route}` : '';
            const frequency = req.frequency_text || translate("medication_frequency_prn_text");

            // Time slots display
            const timeSlots = this.getTimeSlotsForDisplay(req);
            const timeSlotsHtml = timeSlots.length > 0
              ? `<div class="medication-time-slots">
                   <strong>${escapeHTML(translate("medication_administration_times"))}:</strong>
                   <div class="time-slots-list">
                     ${timeSlots.map(slot => `<span class="time-badge">${escapeHTML(slot)}</span>`).join('')}
                   </div>
                 </div>`
              : '';

            // Reception notes
            const receptionNotesHtml = reception?.reception_notes
              ? `<div class="medication-notes" style="color:#0b3c5d; background:#e0f2fe; padding:0.35rem 0.5rem; border-radius:6px; margin-top:0.4rem;">
                   ${escapeHTML(reception.reception_notes)}
                 </div>`
              : '';
            const partialBadge = reception?.status === "partial"
              ? `<span style="font-size:0.8rem; color:#92400e; background:#fef3c7; padding:0.2rem 0.5rem; border-radius:999px; margin-left:0.5rem;">${escapeHTML(translate("med_reception_status_partial"))}</span>`
              : '';

            if (isGiven) {
              // Render given medication with administration details
              const givenDoses = med.givenDoses || [];
              const anyPending = givenDoses.some((d) => d.isOptimistic);
              const givenTimesHtml = givenDoses.map((d) => {
                const givenAt = d.administered_at ? new Date(d.administered_at) : new Date(d.scheduled_for);
                const timeStr = givenAt.toLocaleTimeString(this.app.lang || "en", { hour: "2-digit", minute: "2-digit" });
                const witnessStr = d.witness_name ? ` · ${escapeHTML(d.witness_name)}` : '';
                const pendingLabel = d.isOptimistic
                  ? ` <em style="font-size:0.7rem; opacity:0.8;">(${escapeHTML(translate("medication_pending_sync"))})</em>`
                  : '';
                return `<span class="pill" style="background:${d.isOptimistic ? '#fef3c7; color:#92400e' : '#d1fae5; color:#065f46'}; font-size:0.8rem;">
                  ${escapeHTML(translate("medication_given_at"))} ${escapeHTML(timeStr)}${witnessStr}${pendingLabel}
                </span>`;
              }).join('');

              const statusPill = anyPending
                ? `<span class="pill" style="background:#fef3c7; color:#92400e; font-weight:700; font-size:1rem; white-space:nowrap;">
                    ${escapeHTML(translate("medication_pending_sync"))}
                  </span>`
                : `<span class="pill" style="background:#d1fae5; color:#065f46; font-weight:700; font-size:1rem; white-space:nowrap;">
                    ${escapeHTML(translate("medication_status_given"))}
                  </span>`;

              return `
                <div class="medication-item" style="border-color:${anyPending ? '#f59e0b' : '#10b981'}; background:${anyPending ? '#fffbeb' : '#f0fdf4'};">
                  <div class="medication-info">
                    <strong>${escapeHTML(req.medication_name)}${partialBadge}</strong>
                    <div class="medication-details">
                      ${escapeHTML(doseInfo)}${escapeHTML(route)}
                    </div>
                    <div class="medication-schedule">
                      ${escapeHTML(frequency)}
                    </div>
                    ${timeSlotsHtml}
                    ${receptionNotesHtml}
                    <div style="margin-top:0.5rem; display:flex; flex-wrap:wrap; gap:0.35rem;">
                      ${givenTimesHtml}
                    </div>
                  </div>
                  ${statusPill}
                </div>
              `;
            }

            // Render pending medication with give button
            return `
              <div class="medication-item">
                <div class="medication-info">
                  <strong>${escapeHTML(req.medication_name)}${partialBadge}</strong>
                  <div class="medication-details">
                    ${escapeHTML(doseInfo)}${escapeHTML(route)}
                  </div>
                  <div class="medication-schedule">
                    ${escapeHTML(frequency)}
                  </div>
                  ${timeSlotsHtml}
                  ${receptionNotesHtml}
                  ${req.general_notes ? `<div class="medication-notes">${escapeHTML(req.general_notes)}</div>` : ''}
                </div>
                <button
                  class="btn primary btn-give-med"
                  data-participant-id="${participantId}"
                  data-requirement-id="${req.id}"
                  data-medication-name="${escapeHTML(req.medication_name)}"
                  data-dose="${escapeHTML(doseInfo)}"
                  data-route="${escapeHTML(req.route || '')}"
                >
                  ${escapeHTML(translate("medication_give_now"))}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  renderUpcomingRows() {
    if (!this.distributions.length) {
      return `<tr><td colspan="7">${escapeHTML(translate("medication_alerts_empty"))}</td></tr>`;
    }

    return this.distributions.map((dist) => {
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
    }).join("");
  }

  updateUpcomingTable() {
    const tableBody = document.getElementById("medication-upcoming-table-body");
    if (tableBody) {
      setContent(tableBody, this.renderUpcomingRows());
    }
  }

  /**
   * Re-render both the pending and given split card containers.
   */
  updateSplitCards() {
    const { pendingCards, givenCards } = this.renderParticipantMedicationSplitCards();
    const pendingContainer = document.getElementById("participant-medication-cards-pending");
    const givenContainer = document.getElementById("participant-medication-cards-given");
    if (pendingContainer) {
      setContent(pendingContainer, pendingCards);
    }
    if (givenContainer) {
      setContent(givenContainer, givenCards);
    }
  }

  renderRequirementTable() {
    if (!this.requirements.length) {
      return `<p>${escapeHTML(translate("medication_requirements_empty"))}</p>`;
    }

    const rows = this.requirements.map((req) => {
      const assigned = this.participantMedications.find((assignment) => assignment.medication_requirement_id === req.id);
      const participantName = assigned ? this.getParticipantName(assigned.participant_id) : translate("unknown");
      const nameLabel = `${req.medication_name}${req.isOptimistic ? ` (${translate("medication_pending_sync")})` : ""}`;
      const dateRange = req.start_date || req.end_date
        ? `${req.start_date || "—"} → ${req.end_date || "—"}`
        : "-";
      return `
        <tr>
          <td>${escapeHTML(nameLabel)}</td>
          <td>${escapeHTML(participantName)}</td>
          <td>${escapeHTML(req.frequency_text || translate("medication_frequency"))}</td>
          <td>${escapeHTML(dateRange)}</td>
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
              <th>${escapeHTML(translate("dates"))}</th>
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
      setContent(container, `<p>${escapeHTML(translate("medication_alerts_empty"))}</p>`);
      return;
    }

    setContent(container, alerts.map((alert) => {
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
    }).join(""));
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
    const alertContainer = document.getElementById("medication-alerts");
    const frequencyPresetSelect = document.getElementById("frequencyPreset");
    const giveMedButtons = document.querySelectorAll(".btn-give-med");
    const quickGiveModal = document.getElementById("quickGiveModal");
    const quickGiveCancel = document.getElementById("quickGiveCancel");
    const quickGiveConfirm = document.getElementById("quickGiveConfirm");

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

    frequencyPresetSelect?.addEventListener("change", (event) => {
      const container = document.getElementById("frequencyPresetFields");
      if (container) {
        setContent(container, this.getFrequencyPresetFieldsMarkup(event.target.value));
      }
    });

    // Handle quick give medication buttons
    giveMedButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        const btn = event.currentTarget;
        const participantId = Number(btn.dataset.participantId);
        const requirementId = Number(btn.dataset.requirementId);
        const medicationName = btn.dataset.medicationName;
        const dose = btn.dataset.dose;
        const route = btn.dataset.route;

        this.showQuickGiveModal(participantId, requirementId, medicationName, dose, route);
      });
    });

    // Handle modal actions
    quickGiveCancel?.addEventListener("click", () => {
      if (quickGiveModal) {
        quickGiveModal.style.display = "none";
      }
    });

    quickGiveConfirm?.addEventListener("click", () => {
      this.confirmQuickGive();
    });

    // Close modal on background click
    quickGiveModal?.addEventListener("click", (event) => {
      if (event.target === quickGiveModal) {
        quickGiveModal.style.display = "none";
      }
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

    const previousRequirements = JSON.parse(JSON.stringify(this.requirements));
    const previousAssignments = JSON.parse(JSON.stringify(this.participantMedications));
    const optimisticRequirement = {
      ...payload,
      id: `temp-${Date.now()}`,
      isOptimistic: true,
      created_at: new Date().toISOString()
    };
    const optimisticAssignment = {
      id: `assignment-${Date.now()}`,
      medication_requirement_id: optimisticRequirement.id,
      participant_id: participantId
    };

    this.requirements = [optimisticRequirement, ...this.requirements];
    this.participantMedications = [optimisticAssignment, ...this.participantMedications];
    this.render();
    this.attachEventListeners();
    this.app.showMessage(translate("medication_requirement_syncing"), "info");

    try {
      const response = await saveMedicationRequirement(payload);

      // Handle queued (offline) response
      if (response?.queued) {
        debugLog("Medication requirement queued for offline sync");
        this.app.showMessage(translate("medication_offline_dose_queued"), "info");
        return;
      }

      if (!response?.success) {
        throw new Error(response?.message || translate("error_saving"));
      }
      await this.invalidateCaches();
      await this.refreshData(true);
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate("medication_requirement_saved"), "success");
    } catch (error) {
      debugError("Error saving medication requirement", error);
      this.requirements = previousRequirements;
      this.participantMedications = previousAssignments;
      this.render();
      this.attachEventListeners();
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

    const previousDistributions = JSON.parse(JSON.stringify(this.distributions));
    const optimisticDistributions = payloads.map((payload, index) => ({
      id: `temp-dist-${Date.now()}-${index}`,
      medication_requirement_id: payload.medication_requirement_id,
      participant_id: participantId,
      scheduled_for: payload.scheduled_for,
      status: "scheduled",
      dose_notes: payload.dose_notes,
      general_notice: payload.general_notice,
      frequency_text: payload.frequency_text,
      frequency_times: payload.frequency_times,
      isOptimistic: true
    }));

    this.distributions = [...optimisticDistributions, ...this.distributions];
    this.renderAlertArea();
    this.updateUpcomingTable();
    this.updateSplitCards();
    this.app.showMessage(translate("medication_distribution_syncing"), "info");

    try {
      const responses = await Promise.all(payloads.map((payload) => recordMedicationDistribution(payload)));
      const anyQueued = responses.some((r) => r?.queued);

      if (anyQueued) {
        // Offline: persist optimistic state in cache
        await this.persistDistributionsCache();
        this.app.showMessage(translate("medication_offline_dose_queued"), "info");
        return;
      }

      const allSuccessful = responses.every((response) => response?.success !== false);
      if (!allSuccessful) {
        throw new Error(translate("error_saving"));
      }
      await this.invalidateCaches();
      await this.refreshData(true);
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate("medication_distribution_saved"), "success");
    } catch (error) {
      debugError("Error saving medication distribution", error);
      this.distributions = previousDistributions;
      this.renderAlertArea();
      this.updateUpcomingTable();
      this.updateSplitCards();
      this.app.showMessage(error.message || translate("error_saving"), "error");
    }
  }

  async handleMarkGiven(distributionIds, slotKey) {
    if (!distributionIds.length) {
      return;
    }

    const witnessInput = document.querySelector("input[name='witness_name']");
    const witness = witnessInput?.value?.trim() || this.getDefaultWitness();
    const administeredAt = new Date().toISOString();
    const updateKey = `mark-given-${slotKey}-${Date.now()}`;

    await this.optimisticManager.execute(updateKey, {
      optimisticFn: () => {
        const rollbackState = {
          distributions: JSON.parse(JSON.stringify(this.distributions))
        };

        // Optimistically mark all as given
        this.distributions = this.distributions.map((dist) => (
          distributionIds.includes(dist.id)
            ? { ...dist, status: "given", administered_at: administeredAt, witness_name: witness, isOptimistic: true }
            : dist
        ));
        this.renderAlertArea();
        this.updateUpcomingTable();
        this.updateSplitCards();
        this.attachEventListeners();
        this.app.showMessage(translate("medication_mark_given_syncing"), "info");

        return rollbackState;
      },

      apiFn: async () => {
        const results = await Promise.all(
          distributionIds.map((id) => markMedicationDistributionAsGiven(id, {
            status: "given",
            administered_at: administeredAt,
            witness_name: witness
          }))
        );

        // Check if any were queued for offline sync
        const anyQueued = results.some((r) => r?.queued);
        if (anyQueued) {
          await this.persistDistributionsCache();
          return { queued: true };
        }

        return results;
      },

      successFn: async (response) => {
        if (response?.queued) {
          this.app.showMessage(translate("medication_offline_dose_queued"), "info");
          return;
        }

        this.app.showMessage(translate("medication_mark_given_success"), "success");
        await this.invalidateCaches();
        await this.refreshData(true);
        this.renderAlertArea();
        this.updateUpcomingTable();
        this.updateSplitCards();
        this.attachEventListeners();
        this.prefillFromSlot(slotKey, this.getAggregatedAlerts().find((a) => a.slotKey === slotKey)?.primaryRequirementId || null);
      },

      rollbackFn: (rollbackState, err) => {
        this.distributions = rollbackState.distributions;
        this.renderAlertArea();
        this.updateUpcomingTable();
        this.updateSplitCards();
        this.attachEventListeners();

        const isDuplicate = err?.message?.includes('already been given');
        if (isDuplicate) {
          this.app.showMessage(translate("medication_dose_already_given"), "warning");
        } else {
          this.app.showMessage(err.message || translate("error_saving"), "error");
        }
      },

      onError: (err) => {
        debugError("Error marking medication as given", err);
      }
    });
  }

  startAlertTicker() {
    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }
    if (!this.enableAlerts) {
      return;
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

  getTimeSlotsForDisplay(requirement) {
    if (!requirement) return [];

    const config = this.getRequirementFrequencyConfig(requirement);

    // PRN medications have no scheduled times
    if (config.type === 'prn') {
      return [];
    }

    // For interval, compute times
    if (config.type === 'interval' && config.intervalHours && config.intervalStart) {
      const times = this.computeIntervalTimes(config.intervalStart, config.intervalHours);
      return times;
    }

    // For meal-based, extract times from slots
    if (config.type === 'meal' && config.slots && Object.keys(config.slots).length > 0) {
      return Object.entries(config.slots)
        .sort((a, b) => a[1].localeCompare(b[1])) // Sort by time
        .map(([slotName, time]) => {
          const label = translate(`medication_frequency_${slotName}`) || slotName;
          return `${time} (${label})`;
        });
    }

    // For time_of_day, use the times array
    if (config.type === 'time_of_day' && config.times?.length > 0) {
      return config.times.sort();
    }

    // Fallback: try to parse from times array if available
    if (config.times?.length > 0) {
      return config.times.sort();
    }

    return [];
  }

  /**
   * Find the most recent reception record for a given participant/requirement pair.
   * @param {number} participantId
   * @param {number} requirementId
   * @returns {Object|null}
   */
  getReceptionForMedication(participantId, requirementId) {
    return this.receptions.find(
      (r) => r.participant_id === participantId && r.medication_requirement_id === requirementId
    ) || null;
  }

  showQuickGiveModal(participantId, requirementId, medicationName, dose, route) {
    const modal = document.getElementById("quickGiveModal");
    const detailsDiv = document.getElementById("quickGiveDetails");
    const participantName = this.getParticipantName(participantId);

    if (!modal || !detailsDiv) return;

    // Store data for confirmation
    this.pendingGive = {
      participantId,
      requirementId,
      medicationName,
      dose,
      route
    };

    // Build details HTML
    let details = `<strong>${escapeHTML(participantName)}</strong>`;
    details += `<div><strong>${escapeHTML(translate("medication"))}:</strong> ${escapeHTML(medicationName)}</div>`;
    if (dose) {
      details += `<div><strong>${escapeHTML(translate("medication_dosage_label"))}:</strong> ${escapeHTML(dose)}</div>`;
    }
    if (route) {
      details += `<div><strong>${escapeHTML(translate("medication_route_label"))}:</strong> ${escapeHTML(route)}</div>`;
    }
    details += `<div><strong>${escapeHTML(translate("time"))}:</strong> ${new Date().toLocaleTimeString(this.app.lang || "en", { hour: "2-digit", minute: "2-digit" })}</div>`;

    setContent(detailsDiv, details);
    modal.style.display = "flex";

    // Focus witness field
    const witnessField = document.getElementById("quickGiveWitness");
    if (witnessField) {
      setTimeout(() => witnessField.focus(), 100);
    }
  }

  async confirmQuickGive() {
    if (!this.pendingGive) return;

    const witnessField = document.getElementById("quickGiveWitness");
    const notesField = document.getElementById("quickGiveNotes");
    const modal = document.getElementById("quickGiveModal");

    const witness = witnessField?.value?.trim() || this.getDefaultWitness();
    const notes = notesField?.value?.trim() || null;

    const { participantId, requirementId } = this.pendingGive;
    const requirement = this.getRequirementById(requirementId);

    // Create distribution record
    const now = new Date();
    const scheduled_for = now.toISOString();

    const payload = {
      medication_requirement_id: requirementId,
      participant_ids: [participantId],
      scheduled_for,
      dose_notes: notes,
      witness_name: witness,
      status: "given",
      administered_at: scheduled_for
    };

    const updateKey = `quick-give-${requirementId}-${participantId}-${Date.now()}`;

    // Close modal immediately for responsiveness
    if (modal) modal.style.display = "none";

    await this.optimisticManager.execute(updateKey, {
      optimisticFn: () => {
        // Save state for rollback
        const rollbackState = {
          distributions: JSON.parse(JSON.stringify(this.distributions)),
          pendingGive: this.pendingGive
        };

        // Create optimistic distribution entry
        const optimisticDist = {
          id: `temp-give-${Date.now()}`,
          organization_id: null,
          medication_requirement_id: requirementId,
          participant_id: participantId,
          scheduled_for,
          dose_amount: requirement?.default_dose_amount || null,
          dose_unit: requirement?.default_dose_unit || null,
          dose_notes: notes,
          status: "given",
          administered_at: scheduled_for,
          administered_by: null,
          witness_name: witness,
          isOptimistic: true
        };

        this.distributions = [optimisticDist, ...this.distributions];
        this.updateSplitCards();
        this.renderAlertArea();
        this.updateUpcomingTable();
        this.attachEventListeners();
        this.app.showMessage(translate("medication_mark_given_syncing"), "info");

        return rollbackState;
      },

      apiFn: async () => {
        const response = await recordMedicationDistribution(payload);

        // Handle queued (offline) response
        if (response?.queued) {
          debugLog("Quick give queued for offline sync");
          await this.persistDistributionsCache();
          return response;
        }

        if (!response?.success) {
          throw new Error(response?.message || translate("error_saving"));
        }

        // If we got a distribution ID back, mark it as given
        if (response.data?.id) {
          await markMedicationDistributionAsGiven(response.data.id, {
            status: "given",
            administered_at: scheduled_for,
            witness_name: witness
          });
        }

        return response;
      },

      successFn: async (response) => {
        // If queued for offline, keep optimistic state
        if (response?.queued) {
          this.app.showMessage(translate("medication_offline_dose_queued"), "info");
          return;
        }

        // Online success: refresh from server
        await this.invalidateCaches();
        await this.refreshData(true);
        this.updateSplitCards();
        this.renderAlertArea();
        this.updateUpcomingTable();
        this.attachEventListeners();
        this.app.showMessage(translate("medication_mark_given_success"), "success");
      },

      rollbackFn: (rollbackState, err) => {
        this.distributions = rollbackState.distributions;

        // Handle duplicate dose (409 Conflict)
        const isDuplicate = err?.message?.includes('already been given');
        if (isDuplicate) {
          this.app.showMessage(translate("medication_dose_already_given"), "warning");
          // Refresh to get actual state from server (if online)
          this.invalidateCaches().then(() => this.refreshData(true)).then(() => {
            this.updateSplitCards();
            this.renderAlertArea();
            this.attachEventListeners();
          }).catch(() => {});
        } else {
          this.updateSplitCards();
          this.renderAlertArea();
          this.updateUpcomingTable();
          this.attachEventListeners();
          this.app.showMessage(err.message || translate("error_saving"), "error");
          // Reopen modal on non-duplicate error
          if (modal) modal.style.display = "flex";
        }
      },

      onError: (err) => {
        debugError("Error giving medication", err);
      }
    });

    // Clear pending give
    this.pendingGive = null;

    // Clear notes field
    if (notesField) notesField.value = "";
  }
}
