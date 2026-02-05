import { translate } from "../app.js";
import { getSectionActivityTemplates } from "../utils/meetingSections.js";
import { setContent } from "../utils/DOMUtils.js";
import { debugLog, debugWarn } from "../utils/DebugUtils.js";
import { AchievementModal } from "./AchievementModal.js";

/**
 * ActivityManager - Handles all activity-related operations
 * for the Preparation Reunions page
 */
export class ActivityManager {
        constructor(
                app,
                animateurs,
                activities,
                sectionConfig,
                badgeTemplates = [],
                participants = [],
        ) {
                this.app = app;
                this.animateurs = animateurs;
                this.activities = activities;
                this.selectedActivities = [];
                this.sectionConfig = sectionConfig;
                this.badgeTemplates = badgeTemplates;
                this.participants = participants;
                this.meetingLengthMinutes = 120; // Default: 2 hours
                this.durationOverride = null; // Optional override for special meetings
                this.achievementModal = null; // Will hold the AchievementModal instance
        }

        /**
         * Update section configuration after initialization
         * @param {object} sectionConfig - Active section configuration
         */
        setSectionConfig(sectionConfig) {
                this.sectionConfig = sectionConfig;
        }

        /**
         * Set meeting length and optional duration override
         * @param {number} lengthMinutes - Planned meeting duration in minutes (e.g., 120 for 2 hours)
         * @param {number|null} durationOverride - Optional override for special meetings
         */
        setMeetingLength(lengthMinutes, durationOverride = null) {
                this.meetingLengthMinutes = lengthMinutes || 120;
                this.durationOverride = durationOverride;
        }

        /**
         * Calculate actual meeting duration based on activities
         * @param {Array} activities - Activities to analyze
         * @returns {number} Total duration in minutes
         */
        calculateMeetingDuration(activities) {
                if (!Array.isArray(activities) || activities.length === 0) {
                        return 0;
                }

                // Get start time from first activity and end time from last
                const times = activities
                        .filter((a) => a.time && a.duration)
                        .map((a) => {
                                const [hours, minutes] = (a.time || "")
                                        .split(":")
                                        .map(Number);
                                const [durHours, durMinutes] = (
                                        a.duration || "00:00"
                                )
                                        .split(":")
                                        .map(Number);
                                const startMinutes =
                                        (hours || 0) * 60 + (minutes || 0);
                                const duration =
                                        (durHours || 0) * 60 +
                                        (durMinutes || 0);
                                return { start: startMinutes, duration };
                        });

                if (times.length === 0) {
                        return 0;
                }

                // Total duration = last activity end time - first activity start time
                const firstStart = Math.min(...times.map((t) => t.start));
                const lastEnd = Math.max(
                        ...times.map((t) => t.start + t.duration),
                );
                return Math.max(0, lastEnd - firstStart);
        }

        /**
         * Initialize placeholder activities with default values
         * Only includes templates if actual meeting duration < planned duration
         * @param {Array} existingActivities - Current activities (if any)
         * @returns {Array} Placeholder activities
         */
        initializePlaceholderActivities(existingActivities = null) {
                // Determine the planned duration (use override if special meeting, otherwise use default)
                const plannedDuration =
                        this.durationOverride || this.meetingLengthMinutes;

                // Calculate actual duration if we have existing activities
                let actualDuration = 0;
                if (
                        existingActivities &&
                        Array.isArray(existingActivities) &&
                        existingActivities.length > 0
                ) {
                        actualDuration =
                                this.calculateMeetingDuration(
                                        existingActivities,
                                );
                }

                // Only add template placeholders if actual duration < planned duration
                // This prevents re-adding templates when the user has already filled the time
                if (actualDuration >= plannedDuration) {
                        return existingActivities || [];
                }

                // Create templates for remaining time
                const templates = getSectionActivityTemplates(
                        this.sectionConfig,
                );

                const placeholders = templates.map((template, index) => {
                        const activityKey = template.activityKey;
                        const typeKey = template.typeKey;
                        return {
                                position: template.position ?? index,
                                time: template.time || "",
                                duration: template.duration || "00:00",
                                activityKey,
                                typeKey,
                                activity:
                                        template.activity ||
                                        (activityKey
                                                ? translate(activityKey)
                                                : translate(
                                                          "default_activity_name",
                                                  )),
                                type:
                                        template.type ||
                                        (typeKey
                                                ? translate(typeKey)
                                                : translate(
                                                          "activity_type_preparation",
                                                  )),
                        };
                });

                const defaultActivities = placeholders.map((ph, index) => {
                        const matchingActivity =
                                this.activities.find(
                                        (a) => a.type === ph.type,
                                ) || {};
                        return {
                                ...matchingActivity,
                                ...ph,
                                id: `default-${index}`,
                                responsable: "",
                                materiel: "",
                                isDefault: true,
                                position: index,
                        };
                });

                // If there are existing activities, merge them
                if (
                        existingActivities &&
                        Array.isArray(existingActivities) &&
                        existingActivities.length > 0
                ) {
                        // Mark existing non-default activities and append templates
                        const nonDefaultActivities = existingActivities.filter(
                                (a) => !a.isDefault,
                        );
                        return [...nonDefaultActivities, ...defaultActivities];
                }

                return defaultActivities;
        }

        /**
         * Render the activities table
         */
        renderActivitiesTable() {
                // Simply render the current selectedActivities array
                // No merging with defaults - defaults should only be used when initializing
                const activitiesToRender = this.selectedActivities.map(
                        (activity, index) => ({
                                ...activity,
                                position: index,
                        }),
                );

                const activitiesHtml = activitiesToRender
                        .map((activity, index) => {
                                return this.renderActivityRow(activity, index);
                        })
                        .join("");

                // Get the activities list container
                const container = document.getElementById("activities-list");

                if (container) {
                        setContent(container, activitiesHtml);
                }

                this.addDurationListeners();
                this.addAchievementListeners();
        }

        /**
         * Render a single activity row using div-based grid layout
         */
        renderActivityRow(a, index) {
                const safeDuration =
                        typeof a.duration === "string" &&
                        a.duration.includes(":")
                                ? a.duration
                                : "00:00";

                const isCustomActivity = !this.activities.some(
                        (activity) => activity.activity === a.activity,
                );
                const activityName =
                        a.activity ||
                        (a.activityKey
                                ? translate(a.activityKey)
                                : translate("default_activity_name"));
                const time = a.time || "18:30";
                const duration = safeDuration || "00:00";
                const materiel = a.materiel || "";

                debugLog(`[renderActivityRow ${index}] Rendering:`, {
                        activityName,
                        time,
                        duration,
                        responsable: a.responsable,
                        materiel,
                        isDefault: a.isDefault,
                });

                const responsableExists =
                        !a.responsable ||
                        this.animateurs.some(
                                (animateur) =>
                                        animateur.full_name === a.responsable,
                        );
                const responsableField = responsableExists
                        ? `
                        <select class="activity-responsable" data-default="${a.isDefault}">
                                <option value="">${translate("select_animateur")}</option>
                                ${this.animateurs
                                        .map(
                                                (animateur) => `
                                        <option value="${animateur.full_name}" ${animateur.full_name === a.responsable ? "selected" : ""}>${animateur.full_name}</option>
                                `,
                                        )
                                        .join("")}
                                <option value="other">${translate("other")}</option>
                        </select>
                `
                        : `
                        <input type="text" value="${a.responsable}" class="responsable-input" data-default="${a.isDefault}">
                `;

                const hasAchievement = !!a.badge_template_id;
                const starType = a.star_type || "proie";
                const participantIds = a.participant_ids || [];

                const userLanguage = this.app.lang || "fr"; // Default to French if language not set
                const badgeOptions = this.badgeTemplates
                        .map(
                                (t) =>
                                        `<option value="${t.id}" ${parseInt(t.id) === parseInt(a.badge_template_id) ? "selected" : ""}>${t.name}</option>`,
                        )
                        .join("");

                const participantOptions = this.participants
                        .sort((p1, p2) =>
                                p1.first_name.localeCompare(p2.first_name),
                        )
                        .map(
                                (p) =>
                                        `<option value="${p.id}" ${participantIds.includes(String(p.id)) || participantIds.includes(p.id) ? "selected" : ""}>${p.first_name} ${p.last_name}</option>`,
                        )
                        .join("");

                return `
                        <div class="activity-row-container" data-position="${a.position || index}">
                                <div class="activity-row" data-id="${a.id || index}" data-position="${a.position || index}" data-default="${a.isDefault}">
                                        <div class="activity-row__time">
                                                <input type="time" value="${time}" class="activity-time">
                                                <input type="text" value="${duration}" class="activity-duration" placeholder="00:00">
                                        </div>
                                        <div class="activity-row__activity">
                                                <select class="activity-select" data-default="${a.isDefault}">
                                                        ${isCustomActivity ? `<option value="${activityName}" selected>${activityName}</option>` : ""}
                                                        <option value="">${translate("select_activity")}</option>
                                                        ${this.activities.map((act) => `<option data-id="${act.id}" value="${act.activity}" ${act.activity === a.activity ? "selected" : ""}>${act.activity}</option>`).join("")}
                                                </select>
                                                <button type="button" class="edit-activity-btn" title="${translate("edit")}">✎</button>
                                        </div>
                                        <div class="activity-row__responsable">
                                                ${responsableField}
                                        </div>
                                        <div class="activity-row__materiel">
                                                <input type="text" value="${materiel}" class="activity-materiel" placeholder="${translate("materiel")}" data-default="${a.isDefault}">
                                        </div>
                                        <div class="activity-row__actions">
                                                <button type="button" class="toggle-achievement-btn ${hasAchievement ? "active" : ""}" title="${translate("badge_add_star") || "Achievement"}" data-activity-index="${index}">★</button>
                                                <button type="button" class="add-row-btn hidden" data-position="${index}">+ ${translate("Add")}</button>
                                                <button type="button" class="delete-row-btn hidden" data-position="${index}">- ${translate("Delete")}</button>
                                        </div>
                                </div>
                                <!-- Achievement summary display -->
                                <div class="achievement-summary ${hasAchievement ? "" : "hidden"}" 
                                     data-badge-id="${a.badge_template_id || ""}" 
                                     data-type="${starType}" 
                                     data-participants="${participantIds.join(",")}">
                                        ${this.renderAchievementSummary(a.badge_template_id, starType, participantIds)}
                                </div>
                        </div>
                `;
        }

        /**
         * Update activity details when an activity is selected
         */
        updateActivityDetails(selectElement) {
                const selectedOption =
                        selectElement.options[selectElement.selectedIndex];
                const activityId = selectedOption?.getAttribute("data-id");
                const activity = this.activities.find(
                        (a) => a.id == activityId,
                );

                const row = selectElement.closest(".activity-row");
                if (!row) return;

                if (activity) {
                        const durationInput =
                                row.querySelector(".activity-duration");
                        let descriptionButton =
                                row.querySelector(".description-btn");

                        const totalMinutes = activity.estimated_time_max || 0;
                        durationInput.value =
                                this.formatMinutesToHHMM(totalMinutes);

                        // Handle description button
                        if (activity.description) {
                                if (!descriptionButton) {
                                        descriptionButton =
                                                document.createElement(
                                                        "button",
                                                );
                                        descriptionButton.classList.add(
                                                "description-btn",
                                        );
                                        descriptionButton.textContent = "?";
                                        descriptionButton.setAttribute(
                                                "data-description",
                                                activity.description,
                                        );
                                        selectElement.insertAdjacentElement(
                                                "afterend",
                                                descriptionButton,
                                        );
                                } else {
                                        descriptionButton.setAttribute(
                                                "data-description",
                                                activity.description,
                                        );
                                        descriptionButton.style.display =
                                                "inline";
                                }
                        } else if (descriptionButton) {
                                descriptionButton.style.display = "none";
                        }
                }

                row.setAttribute("data-default", "false");
                selectElement.setAttribute("data-default", "false");
        }

        /**
         * Add a new activity row at the specified position
         */
        addActivityRow(position) {
                // Sync from DOM first to preserve any unsaved changes
                this.selectedActivities = this.getSelectedActivitiesFromDOM();

                const newActivity = {
                        position: parseInt(position) + 1,
                        time: "",
                        duration: "",
                        activity: "",
                        responsable: "",
                        materiel: "",
                        isDefault: false,
                };

                this.selectedActivities.splice(
                        newActivity.position,
                        0,
                        newActivity,
                );
                this.recalculatePositions();
                this.renderActivitiesTable();
        }

        /**
         * Delete an activity row at the specified position
         */
        deleteActivityRow(position) {
                // Sync from DOM first to preserve any unsaved changes
                this.selectedActivities = this.getSelectedActivitiesFromDOM();

                this.selectedActivities.splice(position, 1);
                this.recalculatePositions();
                this.renderActivitiesTable();
        }

        /**
         * Recalculate positions after adding/deleting rows
         */
        recalculatePositions() {
                this.selectedActivities.forEach((activity, index) => {
                        activity.position = index;
                });
        }

        /**
         * Toggle activity edit mode (switch from select to input)
         */
        toggleActivityEdit(row) {
                const container = row.querySelector(".activity-row__activity");
                const select = container?.querySelector(".activity-select");
                if (select) {
                        const input = document.createElement("input");
                        input.type = "text";
                        input.className = "activity-input";
                        input.value = select.options[select.selectedIndex].text;
                        input.setAttribute("data-default", "false");
                        container.replaceChild(input, select);
                        row.setAttribute("data-default", "false");
                }
        }

        /**
         * Switch responsable from select to input
         */
        switchResponsableToInput(select) {
                const container = select.closest(".activity-row__responsable");
                if (!container) return;

                const input = document.createElement("input");
                input.type = "text";
                input.className = "responsable-input";
                input.setAttribute("data-default", "false");
                input.placeholder = translate("enter_responsable_name");
                container.replaceChild(input, select);
                input.focus();
                container
                        .closest(".activity-row")
                        .setAttribute("data-default", "false");
        }

        /**
         * Format minutes to HH:MM
         */
        formatMinutesToHHMM(minutes) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        }

        /**
         * Parse time string (HH:MM)
         */
        parseTime(timeString) {
                const [hours, minutes] = timeString.split(":").map(Number);
                return { hours, minutes };
        }

        /**
         * Format time back into HH:MM
         */
        formatTime(hours, minutes) {
                return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        }

        /**
         * Add duration to a start time
         */
        addDurationToTime(startTime, duration) {
                const timeParts = this.parseTime(startTime);
                const durationParts = this.parseTime(duration);

                let totalMinutes = timeParts.minutes + durationParts.minutes;
                let totalHours =
                        timeParts.hours +
                        durationParts.hours +
                        Math.floor(totalMinutes / 60);

                totalMinutes = totalMinutes % 60;
                totalHours = totalHours % 24;

                return this.formatTime(totalHours, totalMinutes);
        }

        /**
         * Update times for following rows based on the duration of the current row
         */
        updateFollowingTimes(rowIndex) {
                const rows = document.querySelectorAll(".activity-row");

                for (let i = rowIndex; i < rows.length - 1; i++) {
                        const currentRow = rows[i];
                        const nextRow = rows[i + 1];

                        const currentEndTime = this.addDurationToTime(
                                currentRow.querySelector(".activity-time")
                                        .value,
                                currentRow.querySelector(".activity-duration")
                                        .value,
                        );

                        const nextTimeInput =
                                nextRow.querySelector(".activity-time");
                        nextTimeInput.value = currentEndTime;
                }
        }

        /**
         * Add event listeners for duration changes
         */
        addDurationListeners(newRow = null) {
                const rows = newRow
                        ? [newRow]
                        : document.querySelectorAll(".activity-row");

                rows.forEach((row) => {
                        const durationInput =
                                row.querySelector(".activity-duration");
                        const timeInput = row.querySelector(".activity-time");

                        durationInput.addEventListener("input", (event) => {
                                let inputValue = event.target.value;
                                let minutes = 0;

                                if (inputValue.includes(":")) {
                                        const [hours, mins] = inputValue
                                                .split(":")
                                                .map(Number);
                                        minutes = hours * 60 + mins;
                                } else {
                                        minutes = parseInt(inputValue, 10);
                                }

                                if (!isNaN(minutes)) {
                                        event.target.value =
                                                this.formatMinutesToHHMM(
                                                        minutes,
                                                );
                                        const rowIndex = Array.from(
                                                document.querySelectorAll(
                                                        ".activity-row",
                                                ),
                                        ).indexOf(row);
                                        this.updateFollowingTimes(rowIndex);
                                }
                        });

                        timeInput.addEventListener("input", (event) => {
                                const rowIndex = Array.from(
                                        document.querySelectorAll(
                                                ".activity-row",
                                        ),
                                ).indexOf(row);
                                this.updateFollowingTimes(rowIndex);
                        });
                });
        }

        /**
         * Add listeners for achievement UI interactions
         */
        addAchievementListeners() {
                const containers = document.querySelectorAll(
                        ".activity-row-container",
                );

                containers.forEach((container) => {
                        const toggleBtn = container.querySelector(
                                ".toggle-achievement-btn",
                        );
                        const activityIndex = toggleBtn?.dataset.activityIndex;

                        // Open Modal on Click
                        if (toggleBtn) {
                                // Remove existing listener to avoid duplicates if called multiple times
                                const newBtn = toggleBtn.cloneNode(true);
                                toggleBtn.parentNode.replaceChild(
                                        newBtn,
                                        toggleBtn,
                                );

                                newBtn.addEventListener("click", () => {
                                        this.openAchievementModal(
                                                parseInt(activityIndex, 10),
                                                container,
                                        );
                                });
                        }
                });
        }

        /**
         * Render achievement summary for display under activity row
         * @param {string|number} badgeId - Selected badge template ID
         * @param {string} starType - 'proie' or 'battue'
         * @param {Array} participantIds - Array of selected participant IDs
         * @returns {string} HTML string for the summary
         */
        renderAchievementSummary(badgeId, starType, participantIds = []) {
                const badge = this.badgeTemplates.find(
                        (t) => String(t.id) === String(badgeId),
                );
                const badgeName = badge
                        ? translate(badge.translation_key) || badge.name
                        : translate("no_badge_selected") || "No badge selected";
                const badgeImage = badge?.image || badge?.image_url || "";

                const typeLabel =
                        starType === "battue"
                                ? translate("badge_type_battue") || "Battue"
                                : translate("badge_type_proie") || "Proie";

                let participantNames = "";
                if (starType !== "battue" && participantIds.length > 0) {
                        const names = participantIds
                                .map((id) => {
                                        const p = this.participants.find(
                                                (p) =>
                                                        String(p.id) ===
                                                        String(id),
                                        );
                                        return p
                                                ? `${p.first_name} ${p.last_name}`
                                                : "";
                                })
                                .filter(Boolean);
                        participantNames = names.join(", ");
                }

                return `
                        <div class="achievement-summary__content">
                                ${badgeImage ? `<img src="/assets/images/${badgeImage}" alt="${badgeName}" class="achievement-summary__image" />` : ""}
                                <div class="achievement-summary__details">
                                        <span class="achievement-summary__badge">${badgeName}</span>
                                        <span class="achievement-summary__type">(${typeLabel})</span>
                                        ${participantNames ? `<span class="achievement-summary__participants">→ ${participantNames}</span>` : ""}
                                </div>
                        </div>
                `;
        }

        /**
         * Open achievement modal for a specific activity
         * @param {number} activityIndex - Index of the activity row
         * @param {HTMLElement} container - The activity row container element
         */
        openAchievementModal(activityIndex, container) {
                // Get current values from summary panel data attributes
                const summaryPanel = container.querySelector(
                        ".achievement-summary",
                );

                const existingData = {
                        badge_template_id:
                                summaryPanel?.dataset.badgeId || null,
                        star_type: summaryPanel?.dataset.type || "proie",
                        participant_ids: summaryPanel?.dataset.participants
                                ? summaryPanel.dataset.participants
                                          .split(",")
                                          .filter(Boolean)
                                : [],
                        activityIndex,
                };

                debugLog("Opening achievement modal with data:", existingData);
                debugLog("Badge templates available:", this.badgeTemplates);
                debugLog("Participants available:", this.participants);

                // Create and open the modal
                this.achievementModal = new AchievementModal(
                        this.badgeTemplates,
                        this.participants,
                        (data) => this.handleAchievementSave(data, container),
                );

                this.achievementModal.open(existingData);
        }

        /**
         * Handle save from achievement modal
         * @param {Object} data - Modal save data
         * @param {HTMLElement} container - The activity row container element
         */
        handleAchievementSave(data, container) {
                debugLog("Achievement modal save data:", data);

                // Update summary panel data attributes and content
                const summaryPanel = container.querySelector(
                        ".achievement-summary",
                );
                const toggleBtn = container.querySelector(
                        ".toggle-achievement-btn",
                );

                if (summaryPanel) {
                        summaryPanel.dataset.badgeId =
                                data.badge_template_id || "";
                        summaryPanel.dataset.type = data.star_type || "proie";
                        summaryPanel.dataset.participants = (
                                data.participant_ids || []
                        ).join(",");

                        // Update visual content
                        summaryPanel.innerHTML = this.renderAchievementSummary(
                                data.badge_template_id,
                                data.star_type,
                                data.participant_ids,
                        );

                        // Show/hide based on whether a badge is selected
                        if (data.badge_template_id) {
                                summaryPanel.classList.remove("hidden");
                        } else {
                                summaryPanel.classList.add("hidden");
                        }
                }

                // Update star button appearance
                if (toggleBtn) {
                        if (data.badge_template_id) {
                                toggleBtn.classList.add("active");
                        } else {
                                toggleBtn.classList.remove("active");
                        }
                }
        }

        /**
         * Get all activities from the DOM for saving
         * Returns all activities, reading their current state from the DOM
         */
        getSelectedActivitiesFromDOM() {
                debugLog("=== GET ACTIVITIES FROM DOM ===");

                const activitiesContainer =
                        document.getElementById("activities-list");
                if (!activitiesContainer) {
                        debugWarn("No activities container found");
                        return [];
                }

                const rows = Array.from(
                        activitiesContainer.querySelectorAll(".activity-row"),
                );
                debugLog("Found activity rows:", rows.length);

                // Get ALL activities from DOM
                const activities = rows.map((row, rowIndex) => {
                        const dataId = row.getAttribute("data-id");
                        const position = parseInt(
                                row.getAttribute("data-position"),
                                10,
                        );
                        const dataDefault = row.getAttribute("data-default");
                        // Use position to get the activity from selectedActivities array
                        const activity =
                                this.selectedActivities[position] || {};

                        const responsableInput =
                                row.querySelector(".responsable-input");
                        const responsableSelect = row.querySelector(
                                ".activity-responsable",
                        );
                        const responsable = responsableInput
                                ? responsableInput.value
                                : responsableSelect
                                  ? responsableSelect.value
                                  : "";

                        const activityInput =
                                row.querySelector(".activity-input");
                        const activitySelect =
                                row.querySelector(".activity-select");
                        const activityValue =
                                activityInput?.value || activitySelect?.value;

                        const timeValue =
                                row.querySelector(".activity-time").value;
                        const durationValue =
                                row.querySelector(".activity-duration").value;
                        const materielValue =
                                row.querySelector(".activity-materiel").value;

                        // Achievement Data - read from summary panel data attributes
                        const container = row.closest(
                                ".activity-row-container",
                        );
                        const summaryPanel = container?.querySelector(
                                ".achievement-summary",
                        );

                        const badgeTemplateId =
                                summaryPanel?.dataset.badgeId || null;
                        const starType = summaryPanel?.dataset.type || "proie";
                        const participantIds = summaryPanel?.dataset
                                .participants
                                ? summaryPanel.dataset.participants
                                          .split(",")
                                          .filter(Boolean)
                                : [];

                        const result = {
                                ...activity,
                                position: position,
                                id: dataId,
                                time: timeValue,
                                duration: durationValue,
                                activity: activityValue,
                                responsable: responsable,
                                materiel: materielValue,
                                badge_template_id: badgeTemplateId,
                                star_type: starType,
                                participant_ids: participantIds,
                                processed: activity.processed || false,
                                // Mark as non-default if it was modified or is AI-generated
                                isDefault:
                                        dataDefault === "true" &&
                                        !dataId?.startsWith("ai-generated"),
                        };

                        debugLog(`  Activity ${rowIndex}:`, {
                                time: timeValue,
                                duration: durationValue,
                                activity: activityValue,
                                responsable: responsable,
                                materiel: materielValue,
                                isDefault: result.isDefault,
                        });

                        return result;
                });

                debugLog("Total activities extracted:", activities.length);
                return activities;
        }

        /**
         * Set selected activities
         */
        setSelectedActivities(activities) {
                this.selectedActivities = activities;
        }

        /**
         * Get selected activities
         */
        getSelectedActivities() {
                return this.selectedActivities;
        }
}
