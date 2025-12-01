import { translate } from "./app.js";
import {
        getActivitesRencontre,
        getAnimateurs,
        getRecentHonors,
        saveReunionPreparation,
        getReunionDates,
        getReunionPreparation,
        fetchFromApi
} from "./ajax-functions.js";
import { ActivityManager } from "./modules/ActivityManager.js";
import { FormManager } from "./modules/FormManager.js";
import { DateManager } from "./modules/DateManager.js";
import { PrintManager } from "./modules/PrintManager.js";

export class PreparationReunions {
        constructor(app) {
                this.app = app;
                this.activities = [];
                this.animateurs = [];
                this.recentHonors = [];
                this.organizationSettings = {};
                this.currentMeetingData = null;

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
                        this.activityManager = new ActivityManager(this.app, this.animateurs, this.activities);
                        this.dateManager = new DateManager(this.organizationSettings);
                        this.formManager = new FormManager(this.app, this.organizationSettings, this.animateurs, this.recentHonors, this.activityManager);
                        this.printManager = new PrintManager(this.activityManager);

                        // Fetch available dates and reminder
                        await this.fetchAvailableDates();
                        const reminder = await this.fetchReminder();
                        this.formManager.setReminder(reminder);

                        // Render the page
                        this.render();

                        // Determine current meeting and populate form
                        const currentMeeting = await this.determineCurrentMeeting();
                        this.currentMeetingData = currentMeeting;
                        await this.formManager.populateForm(currentMeeting, this.dateManager.getCurrentDate());

                        // Populate reminder form after DOM is rendered
                        this.formManager.populateReminderForm();

                        // Attach event listeners
                        this.attachEventListeners();
                } catch (error) {
                        console.error("Error initializing preparation reunions:", error);
                        this.app.showMessage(translate("error_loading_preparation_reunions"), "error");
                }
        }

        async fetchData() {
                // Use app's waitForOrganizationSettings to avoid race condition
                const appSettings = await this.app.waitForOrganizationSettings();

                const [activitiesResponse, animateursResponse, honorsResponse] = await Promise.all([
                        getActivitesRencontre(),
                        getAnimateurs(),
                        getRecentHonors()
                ]);

                // Handle both array response and object response with data property
                this.activities = Array.isArray(activitiesResponse) ? activitiesResponse : (activitiesResponse?.data || []);
                this.animateurs = Array.isArray(animateursResponse) ? animateursResponse : (animateursResponse?.animateurs || []);
                this.recentHonors = Array.isArray(honorsResponse) ? honorsResponse : (honorsResponse?.data || []);

                // Use app's organization settings to avoid race condition
                this.organizationSettings = appSettings || {};
        }

        async fetchAvailableDates() {
                const response = await getReunionDates();
                // Handle both array response and object response with dates property
                const dates = Array.isArray(response) ? response : (response?.dates || []);
                this.dateManager.setAvailableDates(dates);
        }

        async fetchReminder() {
                try {
                        const data = await fetchFromApi(`get_reminder`);
                        return data.success ? data.reminder : null;
                } catch (error) {
                        console.error("Error fetching reminder:", error);
                        return null;
                }
        }

        async fetchMeetingData(date) {
                try {
                        const response = await getReunionPreparation(date);
                        if (response.success && response.preparation) {
                                // Parse the activities JSON string
                                if (typeof response.preparation.activities === 'string') {
                                        response.preparation.activities = JSON.parse(response.preparation.activities);
                                }
                                return response.preparation;
                        }
                        return null;
                } catch (error) {
                        console.error("Error fetching meeting data:", error);
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
                                louveteau_dhonneur: this.recentHonors.map(h => `${h.first_name} ${h.last_name}`).join(', '),
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
                        console.error("Error loading meeting data:", error);
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
                        louveteau_dhonneur: '',
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

        render() {
                const nextMeetingDate = this.currentMeetingData?.date || this.dateManager.getNextMeetingDate();
                const defaultAnimateur = this.animateurs.find(a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable);
                const availableDates = this.dateManager.getAvailableDates();

                const content = `
                        <div class="preparation-reunions">
                                <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
                                <h1>${translate("preparation_reunions")}</h1>

                                <div class="date-navigation">
                                        <select id="date-select">
                                        <option value="">${translate("select_date")}</option>
                                                ${availableDates.map(date =>
                                                        `<option value="${date}" ${date === this.currentMeetingData?.date ? 'selected' : ''}>${this.dateManager.formatDate(date, this.app.lang)}</option>`
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
                                                                ${this.animateurs.map(a => `<option value="${a.id}" ${a.id === (defaultAnimateur?.id || '') ? 'selected' : ''}>${a.full_name}</option>`).join('')}
                                                        </select>
                                                </div>
                                                <div class="form-group">
                                                        <label for="date">${translate("date")}:</label>
                                                        <input type="date" id="date" value="${nextMeetingDate}" required>
                                                </div>
                                        </div>
                                        <div class="form-row">
                                                <div class="form-group">
                                                        <label for="louveteau-dhonneur">${translate("louveteau_dhonneur")}:</label>
                                                        <ul id="louveteau-dhonneur" class="louveteau-list" contenteditable="true">
                                                                ${this.recentHonors.map(h => `<li>${h.first_name} ${h.last_name}</li>`).join('')}
                                                        </ul>
                                                </div>
                                                <div class="form-group">
                                                        <label for="endroit">${translate("endroit")}:</label>
                                                        <input type="text" id="endroit" value="${this.organizationSettings.organization_info?.endroit || ''}" required>
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

                document.getElementById("app").innerHTML = content;
                this.activityManager.renderActivitiesTable();
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
                        await fetchFromApi('save_reminder', 'POST', reminderData);
                        this.app.showMessage(translate("reminder_saved_successfully"), "success");
                } catch (error) {
                        this.app.showMessage(translate("error_saving_reminder"), "error");
                }
        }

        async handleSubmit(e) {
                e.preventDefault();
                e.stopPropagation();

                const formData = this.formManager.extractFormData();

                try {
                        await saveReunionPreparation(formData);
                        this.app.showMessage(translate("reunion_preparation_saved"), "success");
                        await this.fetchAvailableDates();
                } catch (error) {
                        console.error("Error saving reunion preparation:", error);
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
