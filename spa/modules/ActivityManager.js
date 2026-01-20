import { translate } from "../app.js";
import { getSectionActivityTemplates } from "../utils/meetingSections.js";
import { setContent } from "../utils/DOMUtils.js";

/**
 * ActivityManager - Handles all activity-related operations
 * for the Preparation Reunions page
 */
export class ActivityManager {
        constructor(app, animateurs, activities, sectionConfig) {
                this.app = app;
                this.animateurs = animateurs;
                this.activities = activities;
                this.selectedActivities = [];
                this.sectionConfig = sectionConfig;
        }

        /**
         * Update section configuration after initialization
         * @param {object} sectionConfig - Active section configuration
         */
        setSectionConfig(sectionConfig) {
                this.sectionConfig = sectionConfig;
        }

        /**
         * Initialize placeholder activities with default values
         */
        initializePlaceholderActivities() {
                const templates = getSectionActivityTemplates(this.sectionConfig);

                const placeholders = templates.map((template, index) => {
                        const activityKey = template.activityKey;
                        const typeKey = template.typeKey;
                        return {
                                position: template.position ?? index,
                                time: template.time || "",
                                duration: template.duration || "00:00",
                                activityKey,
                                typeKey,
                                activity: template.activity || (activityKey ? translate(activityKey) : translate("default_activity_name")),
                                type: template.type || (typeKey ? translate(typeKey) : translate("activity_type_preparation"))
                        };
                });

                return placeholders.map((ph, index) => {
                        const matchingActivity = this.activities.find(a => a.type === ph.type) || {};
                        return {
                                ...matchingActivity,
                                ...ph,
                                id: `default-${index}`,
                                responsable: "",
                                materiel: "",
                                isDefault: true,
                                position: index
                        };
                });
        }

        /**
         * Render the activities table
         */
        renderActivitiesTable() {
                const defaultActivities = this.initializePlaceholderActivities();
                const totalActivities = Math.max(this.selectedActivities.length, defaultActivities.length);

                const activitiesToRender = [];
                for (let i = 0; i < totalActivities; i++) {
                        const savedActivity = this.selectedActivities[i] || {};
                        const defaultActivity = defaultActivities[i] || {};

                        const activity = {
                                ...defaultActivity,
                                ...savedActivity,
                                position: i,
                                isDefault: savedActivity.isDefault === undefined ? true : savedActivity.isDefault
                        };

                        activitiesToRender.push(activity);
                }

                const activitiesHtml = activitiesToRender.map((activity, index) => {
                        return this.renderActivityRow(activity, index);
                }).join('');

                // Get the activities list container
                const container = document.getElementById('activities-list');

                if (container) {
                        setContent(container, activitiesHtml);
                }

                this.addDurationListeners();
        }

        /**
         * Render a single activity row using div-based grid layout
         */
        renderActivityRow(a, index) {
                const safeDuration = typeof a.duration === 'string' && a.duration.includes(':')
                        ? a.duration
                        : '00:00';

                const isCustomActivity = !this.activities.some(activity => activity.activity === a.activity);
                const activityName = a.activity || (a.activityKey ? translate(a.activityKey) : translate("default_activity_name"));
                const time = a.time || '18:30';
                const duration = safeDuration || '00:00';
                const materiel = a.materiel || '';

                console.log(`[renderActivityRow ${index}] Rendering:`, {
                        activityName,
                        time,
                        duration,
                        responsable: a.responsable,
                        materiel,
                        isDefault: a.isDefault
                });

                const responsableExists = !a.responsable || this.animateurs.some(animateur => animateur.full_name === a.responsable);
                const responsableField = responsableExists ? `
                        <select class="activity-responsable" data-default="${a.isDefault}">
                                <option value="">${translate("select_animateur")}</option>
                                ${this.animateurs.map(animateur => `
                                        <option value="${animateur.full_name}" ${animateur.full_name === a.responsable ? 'selected' : ''}>${animateur.full_name}</option>
                                `).join('')}
                                <option value="other">${translate("other")}</option>
                        </select>
                ` : `
                        <input type="text" value="${a.responsable}" class="responsable-input" data-default="${a.isDefault}">
                `;

                return `
                        <div class="activity-row" data-id="${a.id || index}" data-position="${a.position || index}" data-default="${a.isDefault}">
                                <div class="activity-row__time">
                                        <input type="time" value="${time}" class="activity-time">
                                        <input type="text" value="${duration}" class="activity-duration" placeholder="00:00">
                                </div>
                                <div class="activity-row__details">
                                        <div class="activity-row__activity">
                                                <select class="activity-select" data-default="${a.isDefault}">
                                                        ${isCustomActivity ? `<option value="${activityName}" selected>${activityName}</option>` : ''}
                                                        <option value="">${translate("select_activity")}</option>
                                                        ${this.activities.map(act => `<option data-id="${act.id}" value="${act.activity}" ${act.activity === a.activity ? 'selected' : ''}>${act.activity}</option>`).join('')}
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
                                                <button type="button" class="add-row-btn hidden" data-position="${index}">+ ${translate("Add")}</button>
                                                <button type="button" class="delete-row-btn hidden" data-position="${index}">- ${translate("Delete")}</button>
                                        </div>
                                </div>
                        </div>
                `;
        }

        /**
         * Update activity details when an activity is selected
         */
        updateActivityDetails(selectElement) {
                const selectedOption = selectElement.options[selectElement.selectedIndex];
                const activityId = selectedOption?.getAttribute('data-id');
                const activity = this.activities.find(a => a.id == activityId);

                const row = selectElement.closest('.activity-row');
                if (!row) return;

                if (activity) {
                        const durationInput = row.querySelector('.activity-duration');
                        let descriptionButton = row.querySelector('.description-btn');

                        const totalMinutes = activity.estimated_time_max || 0;
                        durationInput.value = this.formatMinutesToHHMM(totalMinutes);

                        // Handle description button
                        if (activity.description) {
                                if (!descriptionButton) {
                                        descriptionButton = document.createElement('button');
                                        descriptionButton.classList.add('description-btn');
                                        descriptionButton.textContent = '?';
                                        descriptionButton.setAttribute('data-description', activity.description);
                                        selectElement.insertAdjacentElement('afterend', descriptionButton);
                                } else {
                                        descriptionButton.setAttribute('data-description', activity.description);
                                        descriptionButton.style.display = 'inline';
                                }
                        } else if (descriptionButton) {
                                descriptionButton.style.display = 'none';
                        }
                }

                row.setAttribute('data-default', 'false');
                selectElement.setAttribute('data-default', 'false');
        }

        /**
         * Add a new activity row at the specified position
         */
        addActivityRow(position) {
                const newActivity = {
                        position: parseInt(position) + 1,
                        time: "",
                        duration: "",
                        activity: "",
                        responsable: "",
                        materiel: "",
                        isDefault: false,
                };

                this.selectedActivities.splice(newActivity.position, 0, newActivity);
                this.recalculatePositions();
                this.renderActivitiesTable();
        }

        /**
         * Delete an activity row at the specified position
         */
        deleteActivityRow(position) {
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
                const container = row.querySelector('.activity-row__activity');
                const select = container?.querySelector('.activity-select');
                if (select) {
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'activity-input';
                        input.value = select.options[select.selectedIndex].text;
                        input.setAttribute('data-default', 'false');
                        container.replaceChild(input, select);
                        row.setAttribute('data-default', 'false');
                }
        }

        /**
         * Switch responsable from select to input
         */
        switchResponsableToInput(select) {
                const container = select.closest('.activity-row__responsable');
                if (!container) return;

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'responsable-input';
                input.setAttribute('data-default', 'false');
                input.placeholder = translate("enter_responsable_name");
                container.replaceChild(input, select);
                input.focus();
                container.closest('.activity-row').setAttribute('data-default', 'false');
        }

        /**
         * Format minutes to HH:MM
         */
        formatMinutesToHHMM(minutes) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        }

        /**
         * Parse time string (HH:MM)
         */
        parseTime(timeString) {
                const [hours, minutes] = timeString.split(':').map(Number);
                return { hours, minutes };
        }

        /**
         * Format time back into HH:MM
         */
        formatTime(hours, minutes) {
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        /**
         * Add duration to a start time
         */
        addDurationToTime(startTime, duration) {
                const timeParts = this.parseTime(startTime);
                const durationParts = this.parseTime(duration);

                let totalMinutes = timeParts.minutes + durationParts.minutes;
                let totalHours = timeParts.hours + durationParts.hours + Math.floor(totalMinutes / 60);

                totalMinutes = totalMinutes % 60;
                totalHours = totalHours % 24;

                return this.formatTime(totalHours, totalMinutes);
        }

        /**
         * Update times for following rows based on the duration of the current row
         */
        updateFollowingTimes(rowIndex) {
                const rows = document.querySelectorAll('.activity-row');

                for (let i = rowIndex; i < rows.length - 1; i++) {
                        const currentRow = rows[i];
                        const nextRow = rows[i + 1];

                        const currentEndTime = this.addDurationToTime(
                                currentRow.querySelector('.activity-time').value,
                                currentRow.querySelector('.activity-duration').value
                        );

                        const nextTimeInput = nextRow.querySelector('.activity-time');
                        nextTimeInput.value = currentEndTime;
                }
        }

        /**
         * Add event listeners for duration changes
         */
        addDurationListeners(newRow = null) {
                const rows = newRow ? [newRow] : document.querySelectorAll('.activity-row');

                rows.forEach(row => {
                        const durationInput = row.querySelector('.activity-duration');
                        const timeInput = row.querySelector('.activity-time');

                        durationInput.addEventListener('input', (event) => {
                                let inputValue = event.target.value;
                                let minutes = 0;

                                if (inputValue.includes(':')) {
                                        const [hours, mins] = inputValue.split(':').map(Number);
                                        minutes = hours * 60 + mins;
                                } else {
                                        minutes = parseInt(inputValue, 10);
                                }

                                if (!isNaN(minutes)) {
                                        event.target.value = this.formatMinutesToHHMM(minutes);
                                        const rowIndex = Array.from(document.querySelectorAll('.activity-row')).indexOf(row);
                                        this.updateFollowingTimes(rowIndex);
                                }
                        });

                        timeInput.addEventListener('input', (event) => {
                                const rowIndex = Array.from(document.querySelectorAll('.activity-row')).indexOf(row);
                                this.updateFollowingTimes(rowIndex);
                        });
                });
        }

        /**
         * Get all activities from the DOM for saving
         * Returns all activities, reading their current state from the DOM
         */
        getSelectedActivitiesFromDOM() {
                console.log("=== GET ACTIVITIES FROM DOM ===");
                
                const activitiesContainer = document.getElementById('activities-list');
                if (!activitiesContainer) {
                        console.warn("No activities container found");
                        return [];
                }

                const rows = Array.from(activitiesContainer.querySelectorAll('.activity-row'));
                console.log("Found activity rows:", rows.length);

                // Get ALL activities from DOM
                const activities = rows.map((row, rowIndex) => {
                        const dataId = row.getAttribute('data-id');
                        const position = parseInt(row.getAttribute('data-position'), 10);
                        const dataDefault = row.getAttribute('data-default');
                        // Use position to get the activity from selectedActivities array
                        const activity = this.selectedActivities[position] || {};

                        const responsableInput = row.querySelector('.responsable-input');
                        const responsableSelect = row.querySelector('.activity-responsable');
                        const responsable = responsableInput ? responsableInput.value : responsableSelect ? responsableSelect.value : '';

                        const activityInput = row.querySelector('.activity-input');
                        const activitySelect = row.querySelector('.activity-select');
                        const activityValue = activityInput?.value || activitySelect?.value;

                        const timeValue = row.querySelector('.activity-time').value;
                        const durationValue = row.querySelector('.activity-duration').value;
                        const materielValue = row.querySelector('.activity-materiel').value;

                        const result = {
                                ...activity,
                                position: position,
                                id: dataId,
                                time: timeValue,
                                duration: durationValue,
                                activity: activityValue,
                                responsable: responsable,
                                materiel: materielValue,
                                // Mark as non-default if it was modified or is AI-generated
                                isDefault: dataDefault === 'true' && !dataId?.startsWith('ai-generated')
                        };

                        console.log(`  Activity ${rowIndex}:`, {
                                time: timeValue,
                                duration: durationValue,
                                activity: activityValue,
                                responsable: responsable,
                                materiel: materielValue,
                                isDefault: result.isDefault
                        });

                        return result;
                });

                console.log("Total activities extracted:", activities.length);
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
