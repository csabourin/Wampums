import { translate } from "../app.js";
import { getSectionActivityTemplates } from "../utils/meetingSections.js";

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

                document.querySelector('#activities-table tbody').innerHTML = activitiesHtml;
                this.addDurationListeners();
        }

        /**
         * Render a single activity row
         */
        renderActivityRow(a, index) {
                const safeDuration = typeof a.duration === 'string' && a.duration.includes(':')
                        ? a.duration
                        : '00:00';

                const isCustomActivity = !this.activities.some(activity => activity.activity === a.activity);
                const activityName = a.activity || (a.activityKey ? translate(a.activityKey) : translate("default_activity_name"));
                const time = a.time || '18:30';
                const duration = safeDuration || '00:00';
                const responsable = a.responsable || translate("default_responsable");
                const materiel = a.materiel || '';

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
                        <input type="text" value="${a.responsable}" class="responsable-input" data-default="${a.isDefault}" contenteditable="true">
                `;

                return `
                        <tr class="activity-row" data-id="${a.id || index}" data-position="${a.position || index}" data-default="${a.isDefault}">
                                <td><div class="activity-time-container">
                                        <input type="time" value="${time}" class="activity-time">
                                        <input type="text" value="${duration}" class="activity-duration">
                                        </div>
                                </td>
                                <td>
                                <div class="activity-container">
                                        <select class="activity-select" data-default="${a.isDefault}">
                                                ${isCustomActivity ? `<option>${activityName}</option>` : ''}
                                                <option value="">${translate("select_activity")}</option>
                                                ${this.activities.map(act => `<option data-id="${act.id}" value="${act.activity}" ${act.activity === a.activity ? 'selected' : ''}>${act.activity}</option>`).join('')}
                                        </select>
                                        <button type="button" class="edit-activity-btn" title="${translate("edit")}">✎</button>
                                </div>
                                <div>
                                <div class="responsable-container">
                                        ${responsableField}
                                </div>
                                <input type="text" value="${materiel}" class="activity-materiel" placeholder="${translate("materiel")}" data-default="${a.isDefault}">
                                        </div>
                                        <div class="actions">
                                                <button class="add-row-btn hidden" data-position="${index}">+ ${translate("Add")}</button>
                                                <button class="delete-row-btn hidden" data-position="${index}">- ${translate("Delete")}</button>
                                        </div>
                                </td>
                        </tr>
                `;
        }

        /**
         * Update activity details when an activity is selected
         */
        updateActivityDetails(selectElement) {
                const selectedOption = selectElement.options[selectElement.selectedIndex];
                const activityId = selectedOption.getAttribute('data-id');
                const activity = this.activities.find(a => a.id == activityId);

                if (activity) {
                        const row = selectElement.closest('.activity-row');
                        const durationInput = row.querySelector('.activity-duration');
                        const materielInput = row.querySelector('.activity-materiel');
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

                        row.setAttribute('data-default', 'false');
                        selectElement.setAttribute('data-default', 'false');
                }
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
                const container = row.querySelector('.activity-container');
                const select = container.querySelector('.activity-select');
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
                const container = select.closest('.responsable-container');
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
         * Get selected activities from the DOM
         */
        getSelectedActivitiesFromDOM() {
                const activitiesContainer = document.querySelector('#activities-table');

                return Array.from(activitiesContainer.querySelectorAll('.activity-row'))
                        .filter(row => row.getAttribute('data-default') === 'false')
                        .map((row) => {
                                const index = row.getAttribute('data-id').split('-')[1];
                                const activity = this.selectedActivities[index];

                                const responsableInput = row.querySelector('.responsable-input');
                                const responsableSelect = row.querySelector('.activity-responsable');
                                const responsable = responsableInput ? responsableInput.value : responsableSelect ? responsableSelect.value : '';

                                return {
                                        ...activity,
                                        position: parseInt(row.getAttribute('data-position'), 10),
                                        id: row.getAttribute('data-id'),
                                        time: row.querySelector('.activity-time').value,
                                        duration: row.querySelector('.activity-duration').value,
                                        activity: row.querySelector('.activity-input')?.value || row.querySelector('.activity-select')?.value,
                                        responsable: responsable,
                                        materiel: row.querySelector('.activity-materiel').value,
                                        isDefault: false
                                };
                        });
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
