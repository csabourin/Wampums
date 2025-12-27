import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import {
        getActivitesRencontre,
        getAnimateurs,
        getRecentHonors,
        saveReunionPreparation,
        getReunionDates,
        getReunionPreparation
} from "./ajax-functions.js";
import { saveReminder, getReminder } from "./api/api-endpoints.js";
import { deleteCachedData } from "./indexedDB.js";
import { ActivityManager } from "./modules/ActivityManager.js";
import { FormManager } from "./modules/FormManager.js";
import { DateManager } from "./modules/DateManager.js";
import { PrintManager } from "./modules/PrintManager.js";
import { getActiveSectionConfig, getHonorLabel } from "./utils/meetingSections.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class PreparationReunions {
        constructor(app) {
                this.app = app;
                this.activities = [];
                this.animateurs = [];
                this.recentHonors = [];
                this.organizationSettings = {};
                this.currentMeetingData = null;
                this.meetingSections = {};
                this.sectionConfig = null;
                this.sectionKey = null;

                // Initialize managers (will be set up after data is fetched)
                this.activityManager = null;
                this.formManager = null;
                this.dateManager = null;
                this.printManager = null;
        }

        async init() {
                try {
                        // Fetch all required data
                        await this.fetchData();

                        // Initialize managers after data is loaded
                        this.activityManager = new ActivityManager(this.app, this.animateurs, this.activities, this.sectionConfig);
                        this.dateManager = new DateManager(this.organizationSettings);
                        this.formManager = new FormManager(this.app, this.organizationSettings, this.animateurs, this.recentHonors, this.activityManager, this.sectionConfig);
                        this.printManager = new PrintManager(this.activityManager, this.sectionConfig);

                        // Fetch available dates and reminder
                        await this.fetchAvailableDates();
                        const reminder = await this.fetchReminder();
                        this.formManager.setReminder(reminder);

                        // Determine current meeting BEFORE rendering
                        const currentMeeting = await this.determineCurrentMeeting();
                        this.currentMeetingData = currentMeeting;
                        // Set the current date in dateManager to match the meeting we're displaying
                        this.dateManager.setCurrentDate(currentMeeting.date);

                        // Render the page now that we have the meeting data
                        this.render();
                        await this.formManager.populateForm(currentMeeting, currentMeeting.date);

                        // Populate reminder form after DOM is rendered
                        this.formManager.populateReminderForm();

                        // Attach event listeners
                        this.attachEventListeners();
                } catch (error) {
                        debugError("Error initializing preparation reunions:", error);
                        this.renderError();
                        this.app.showMessage(translate("error_loading_preparation_reunions"), "error");
                }
        }

        async fetchData() {
                // Use app's waitForOrganizationSettings to avoid race condition
                const appSettings = await this.app.waitForOrganizationSettings();

                // Load data with individual error handling to prevent total failure
                const [activitiesResponse, animateursResponse, honorsResponse] = await Promise.all([
                        getActivitesRencontre().catch(error => {
                                debugError("Error loading activities:", error);
                                return { data: [] };
                        }),
                        getAnimateurs().catch(error => {
                                debugError("Error loading animateurs:", error);
                                return { animateurs: [] };
                        }),
                        getRecentHonors().catch(error => {
                                debugError("Error loading recent honors:", error);
                                return { data: [] };
                        })
                ]);

                // Handle both array response and object response with data property
                this.activities = Array.isArray(activitiesResponse) ? activitiesResponse : (activitiesResponse?.data || []);
                this.animateurs = Array.isArray(animateursResponse) ? animateursResponse : (animateursResponse?.animateurs || []);
                this.recentHonors = Array.isArray(honorsResponse) ? honorsResponse : (honorsResponse?.data || []);

                // Use app's organization settings to avoid race condition
                this.organizationSettings = appSettings || {};

                const meetingSectionSource = activitiesResponse?.meetingSections || this.organizationSettings.meeting_sections;
                this.updateSectionConfig(meetingSectionSource);
        }

        async fetchAvailableDates(forceRefresh = false) {
                const response = await getReunionDates(forceRefresh);
                // Handle both array response and object response with dates property
                const dates = Array.isArray(response) ? response : (response?.dates || []);
                this.dateManager.setAvailableDates(dates);
        }

        /**
         * Merge meeting section configuration from API or settings with defaults
         * and propagate it to dependent managers.
         * @param {object} meetingSections - Section-level meeting configuration
         */
        updateSectionConfig(meetingSections) {
                const { sectionConfig, sectionKey, mergedConfig } = getActiveSectionConfig(
                        meetingSections || this.meetingSections,
                        this.organizationSettings
                );

                this.meetingSections = mergedConfig;
                this.sectionConfig = sectionConfig;
                this.sectionKey = sectionKey;

                if (this.activityManager) {
                        this.activityManager.setSectionConfig(sectionConfig);
                }
                if (this.formManager) {
                        this.formManager.setSectionConfig(sectionConfig);
                }
                if (this.printManager?.setSectionConfig) {
                        this.printManager.setSectionConfig(sectionConfig);
                }
        }

        async fetchReminder() {
                try {
                        const data = await getReminder();
                        return data.success ? data.reminder : null;
                } catch (error) {
                        debugError("Error fetching reminder:", error);
                        return null;
                }
        }

        async fetchMeetingData(date) {
                try {
                        const response = await getReunionPreparation(date);
                        if (response.success && response.preparation) {
                                if (!response.preparation.youth_of_honor && response.preparation.louveteau_dhonneur) {
                                        response.preparation.youth_of_honor = response.preparation.louveteau_dhonneur;
                                }
                                if (response.meetingSections) {
                                        this.updateSectionConfig(response.meetingSections);
                                }
                                // Parse the activities JSON string
                                if (typeof response.preparation.activities === 'string') {
                                        response.preparation.activities = JSON.parse(response.preparation.activities);
                                }
                                if (typeof response.preparation.youth_of_honor === 'string') {
                                        response.preparation.youth_of_honor = [response.preparation.youth_of_honor];
                                }
                                return response.preparation;
                        }
                        return null;
                } catch (error) {
                        debugError("Error fetching meeting data:", error);
                        return null;
                }
        }

        async determineCurrentMeeting() {
                const meetingDate = this.dateManager.getNextMeetingDate();
                const plannedMeeting = await this.fetchMeetingData(meetingDate);

                if (!plannedMeeting) {
                        // Populate default values if no data is found
                        const selectedActivities = this.activityManager.initializePlaceholderActivities();
                        this.activityManager.setSelectedActivities(selectedActivities);

                        // Set the default animateur_responsable (if available)
                        const defaultAnimateur = this.animateurs.find(a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable);
                        return {
                                animateur_responsable: defaultAnimateur?.id || '',
                                date: meetingDate,
                                youth_of_honor: this.recentHonors.map(h => `${h.first_name} ${h.last_name}`),
                                endroit: this.organizationSettings.organization_info?.endroit || '',
                                activities: selectedActivities,
                                notes: ''
                        };
                }
                return plannedMeeting;
        }

        async loadMeeting(date) {
                this.dateManager.setCurrentDate(date);
                try {
                        const meetingData = await this.fetchMeetingData(date);
                        if (meetingData) {
                                this.currentMeetingData = meetingData;
                        } else {
                                this.currentMeetingData = this.createNewMeeting(date);
                        }
                        await this.formManager.populateForm(this.currentMeetingData, this.dateManager.getCurrentDate());
                } catch (error) {
                        debugError("Error loading meeting data:", error);
                        this.app.showMessage(translate("error_loading_meeting_data"), "error");
                }
        }

        createNewMeeting(date = null) {
                const newDate = date || this.dateManager.createNewMeetingDate();
                const selectedActivities = this.activityManager.initializePlaceholderActivities();
                this.activityManager.setSelectedActivities(selectedActivities);

                return {
                        date: newDate,
                        animateur_responsable: '',
                        youth_of_honor: [],
                        endroit: this.organizationSettings.organization_info?.endroit || '',
                        activities: selectedActivities,
                        notes: ''
                };
        }

        async createAndLoadNewMeeting() {
                const newMeetingData = this.createNewMeeting();
                this.currentMeetingData = newMeetingData;
                this.render();
                await this.formManager.populateForm(newMeetingData, this.dateManager.getCurrentDate());
                this.formManager.populateReminderForm();
                this.attachEventListeners();
        }

        /**
         * Format date string to yyyy-MM-dd format for HTML date inputs
         */
        formatDateForInput(dateString) {
                if (!dateString) return '';
                // If it's already in yyyy-MM-dd format, return as is
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                        return dateString;
                }
                // Extract date part from ISO string (e.g., "2025-12-02T00:00:00.000Z" -> "2025-12-02")
                return dateString.split('T')[0];
        }

        render() {
                const rawNextMeetingDate = this.currentMeetingData?.date || this.dateManager.getNextMeetingDate();
                const nextMeetingDate = this.formatDateForInput(rawNextMeetingDate);
                const defaultAnimateur = this.animateurs.find(a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable);
                const availableDates = this.dateManager.getAvailableDates();
                const honorLabel = getHonorLabel(this.sectionConfig, translate);

                if (this.activityManager) {
                        this.activityManager.setSectionConfig(this.sectionConfig);
                }
                if (this.formManager) {
                        this.formManager.setSectionConfig(this.sectionConfig);
                }
                if (this.printManager?.setSectionConfig) {
                        this.printManager.setSectionConfig(this.sectionConfig);
                }

                const content = `
                        <div class="preparation-reunions">
                                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                                <h1>${translate("preparation_reunions")}</h1>

                                <div class="date-navigation">
                                        <select id="date-select">
                                        <option value="">${translate("select_date")}</option>
                                                ${availableDates.map(date =>
                                                        `<option value="${date}" ${date === this.formatDateForInput(this.currentMeetingData?.date) ? 'selected' : ''}>${this.dateManager.formatDate(date, this.app.lang)}</option>`
                                                ).join('')}
                                        </select>
                                </div>
                                <p><button id="new-meeting">${translate("new_meeting")}</button></p>

                                <form id="reunion-form">
                                        <div class="form-row">
                                                <div class="form-group">
                                                        <label for="animateur-responsable">${translate("animateur_responsable")}:</label>
                                                        <select id="animateur-responsable" required>
                                                                <option value="">${translate("select_animateur")}</option>
                                                                ${this.animateurs.map(a => `<option value="${a.id}" ${a.id === (defaultAnimateur?.id || '') ? 'selected' : ''}>${escapeHTML(a.full_name)}</option>`).join('')}
                                                        </select>
                                                </div>
                                                <div class="form-group">
                                                        <label for="date">${translate("date")}:</label>
                                                        <input type="date" id="date" value="${nextMeetingDate}" required>
                                                </div>
                                        </div>
                                        <div class="form-row">
                                                <div class="form-group">
                                                        <label for="youth-of-honor">${honorLabel}:</label>
                                                        <ul id="youth-of-honor" class="honor-list" contenteditable="true">
                                                                ${this.recentHonors.map(h => `<li>${escapeHTML(`${h.first_name} ${h.last_name}`)}</li>`).join('')}
                                                        </ul>
                                                </div>
                                                <div class="form-group">
                                                        <label for="endroit">${translate("endroit")}:</label>
                                                        <input type="text" id="endroit" value="${escapeHTML(this.organizationSettings.organization_info?.endroit || '')}" required>
                                                </div>
                                        </div>
                                        <table id="activities-table">
                                                <thead>
                                                        <tr>
                                                                <th>${translate("heure_et_duree")}</th>
                                                                <th>${translate("activite_responsable_materiel")}</th>
                                                        </tr>
                                                </thead>
                                                <tbody>
                                                        <!-- Activities will be populated here -->
                                                </tbody>
                                        </table>
                                        <div class="form-group">
                                                <label for="notes">${translate("notes")}:</label>
                                                <textarea id="notes" rows="4"></textarea>
                                        </div>
                                        <div class="form-actions">
                                                <button type="submit">${translate("save")}</button>
                                                <button type="button" id="print-button">${translate("print")}</button>
                                                <button type="button" id="toggle-quick-edit">${translate("toggle_quick_edit_mode")}</button>
                                        </div>
                                </form>

                                <h2>${translate("set_reminder")}</h2>
                                <form id="reminder-form">
                                        <div class="form-group">
                                                <label for="reminder-text">${translate("reminder_text")}:</label>
                                                <textarea id="reminder-text" rows="3"></textarea>
                                        </div>
                                        <div class="form-group">
                                                <label for="reminder-date">${translate("reminder_date")}:</label>
                                                <input type="date" id="reminder-date" required>
                                        </div>
                                        <div class="form-group">
                                                <label for="recurring-reminder">
                                                        <input type="checkbox" id="recurring-reminder">
                                                        ${translate("recurring_reminder")}
                                                </label>
                                        </div>
                                        <button type="submit">${translate("save_reminder")}</button>
                                </form>

                                <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
                        </div>
                        <div id="description-modal" class="modal hidden">
                                <div class="modal-content">
                                        <span class="close">&times;</span>
                                        <p id="description-text"></p>
                                </div>
                        </div>
                `;

                setContent(document.getElementById("app"), content);
                this.activityManager.renderActivitiesTable();
        }

        renderError() {
                const content = `
                        <div class="preparation-reunions">
                                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                                <h1>${translate("preparation_reunions")}</h1>
                                <div class="error-message">
                                        <p>${translate("error_loading_preparation_reunions")}</p>
                                        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
                                </div>
                        </div>
                `;
                setContent(document.getElementById("app"), content);
        }

        attachEventListeners() {
                this.preventEnterKeyDefault();

                // Reminder form
                document.getElementById('reminder-form').addEventListener('submit', (e) => this.handleReminderSubmit(e));

                // Activity changes
                document.querySelector('#activities-table').addEventListener('change', (e) => {
                        if (e.target.classList.contains('activity-select')) {
                                this.activityManager.updateActivityDetails(e.target);
                                e.target.setAttribute('data-default', 'false');
                                e.target.closest('.activity-row').setAttribute('data-default', 'false');
                        } else if (e.target.classList.contains('activity-responsable')) {
                                if (e.target.value === 'other') {
                                        this.activityManager.switchResponsableToInput(e.target);
                                } else {
                                        e.target.setAttribute('data-default', 'false');
                                        e.target.closest('.activity-row').setAttribute('data-default', 'false');
                                }
                        }
                });

                // Activity input changes
                document.querySelector('#activities-table').addEventListener('input', (e) => {
                        if (e.target.classList.contains('activity-time') ||
                                e.target.classList.contains('activity-duration') ||
                                e.target.classList.contains('activity-materiel')) {
                                e.target.setAttribute('data-default', 'false');
                                e.target.closest('.activity-row').setAttribute('data-default', 'false');
                        }
                });

                // Description modal
                document.querySelector('#activities-table').addEventListener('click', (e) => {
                        if (e.target.classList.contains('description-btn')) {
                                e.preventDefault();
                                e.stopPropagation();
                                const description = e.target.getAttribute('data-description');
                                this.showDescriptionModal(description);
                        } else if (e.target.classList.contains('edit-activity-btn')) {
                                this.activityManager.toggleActivityEdit(e.target.closest('.activity-row'));
                        } else if (e.target.matches('.add-row-btn')) {
                                this.activityManager.addActivityRow(e.target.dataset.position);
                        } else if (e.target.matches('.delete-row-btn')) {
                                this.activityManager.deleteActivityRow(e.target.dataset.position);
                        }
                });

                document.querySelector('.modal .close').addEventListener('click', () => {
                        this.hideDescriptionModal();
                });

                window.addEventListener('click', (e) => {
                        if (e.target.classList.contains('modal')) {
                                this.hideDescriptionModal();
                        }
                });

                // Quick edit toggle
                document.getElementById('toggle-quick-edit').addEventListener('click', () => this.toggleQuickEditMode());

                // Form submission
                document.getElementById('reunion-form').addEventListener('submit', (e) => this.handleSubmit(e));

                // Print button
                document.getElementById('print-button').addEventListener('click', () => this.printManager.printPreparation());

                // New meeting button
                document.getElementById('new-meeting').addEventListener('click', () => this.createAndLoadNewMeeting());

                // Date navigation
                document.getElementById('date-select').addEventListener('change', (e) => {
                        this.loadMeeting(e.target.value);
                });
        }

        preventEnterKeyDefault() {
                const inputs = document.querySelectorAll('form, .activity-time, .activity-duration, .activity-select, .activity-responsable, .activity-materiel');
                inputs.forEach(input => {
                        input.addEventListener('keydown', (e) => {
                                if (e.keyCode === 13) {
                                        e.preventDefault();
                                }
                        });
                });
        }

        async handleReminderSubmit(e) {
                e.preventDefault();
                e.stopPropagation();

                const reminderData = this.formManager.getReminderData();

                try {
                        await saveReminder(reminderData);
                        this.app.showMessage(translate("reminder_saved_successfully"), "success");
                } catch (error) {
                        this.app.showMessage(translate("error_saving_reminder"), "error");
                }
        }

        async handleSubmit(e) {
                e.preventDefault();
                e.stopPropagation();

                let formData;
                try {
                        formData = this.formManager.extractFormData();
                } catch (error) {
                        debugError("Validation error saving reunion preparation:", error);
                        return false;
                }

                try {
                        await saveReunionPreparation(formData);
                        // Clear the reunion_dates cache so upcoming_meeting page gets fresh data
                        await deleteCachedData('reunion_dates');
                        this.app.showMessage(translate("reunion_preparation_saved"), "success");
                        // Force refresh to get fresh dates from server
                        await this.fetchAvailableDates(true);
                } catch (error) {
                        debugError("Error saving reunion preparation:", error);
                        this.app.showMessage(translate("error_saving_reunion_preparation"), "error");
                }

                return false;
        }

        toggleQuickEditMode() {
                const rows = document.querySelectorAll('.activity-row');
                rows.forEach(row => {
                        row.classList.toggle('compact-view');
                        row.querySelector('.add-row-btn').classList.toggle('hidden');
                        row.querySelector('.delete-row-btn').classList.toggle('hidden');
                });
        }

        showDescriptionModal(description) {
                document.getElementById('description-text').textContent = description;
                document.getElementById('description-modal').style.display = 'block';
        }

        hideDescriptionModal() {
                document.getElementById('description-modal').style.display = 'none';
        }
}
