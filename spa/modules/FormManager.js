import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { setContent } from "../utils/DOMUtils.js";

/**
 * FormManager - Handles form population, validation, and data extraction
 * for the Preparation Reunions page
 */
export class FormManager {
        constructor(app, organizationSettings, animateurs, recentHonors, activityManager, sectionConfig) {
                this.app = app;
                this.organizationSettings = organizationSettings;
                this.animateurs = animateurs;
                this.recentHonors = recentHonors;
                this.activityManager = activityManager;
                this.sectionConfig = sectionConfig;
                this.reminder = null;
        }

        /**
         * Update section-specific configuration (honor requirements, templates, etc.)
         * @param {object} sectionConfig - Active section configuration
         */
        setSectionConfig(sectionConfig) {
                this.sectionConfig = sectionConfig;
        }

        /**
         * Convert ISO date string to yyyy-MM-dd format for HTML date inputs
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

        /**
         * Populate form with meeting data
         */
        async populateForm(meetingData, currentDate) {
                if (!meetingData) {
                        this.resetForm(currentDate);
                        return;
                }

                document.getElementById("animateur-responsable").value = meetingData.animateur_responsable || '';
                document.getElementById("date").value = this.formatDateForInput(meetingData.date || currentDate);

                // Handle Louveteau d'honneur
                const honorList = document.getElementById("youth-of-honor");
                const honorData = meetingData.youth_of_honor ?? meetingData.louveteau_dhonneur;
                if (Array.isArray(honorData)) {
                        setContent(honorList, honorData.map(honor => `<li>${escapeHTML(honor)}</li>`).join(''));
                } else if (typeof honorData === 'string') {
                        setContent(honorList, `<li>${escapeHTML(honorData)}</li>`);
                } else {
                        setContent(honorList, this.recentHonors.map(h => `<li>${escapeHTML(`${h.first_name} ${h.last_name}`)}</li>`).join(''));
                }

                document.getElementById("endroit").value = meetingData.endroit || this.organizationSettings.organization_info?.endroit || '';

                // Prepopulate the notes and fetch reminders
                const notes = meetingData.notes || '';
                if (this.reminder) {
                        const currentDate = new Date();
                        const reminderDate = new Date(this.reminder.reminder_date);
                        if (this.reminder.is_recurring || reminderDate >= currentDate) {
                                const reminderText = `\n\n${translate("reminder_text")}: ${this.reminder.reminder_text}`;
                                document.getElementById('notes').value = notes + reminderText;
                        } else {
                                document.getElementById('notes').value = notes;
                        }
                } else {
                        document.getElementById('notes').value = notes;
                }

                // Combine default and saved activities
                const defaultActivities = this.activityManager.initializePlaceholderActivities();
                const loadedActivities = meetingData.activities || [];
                const totalActivities = Math.max(defaultActivities.length, loadedActivities.length);

                const selectedActivities = [];

                for (let i = 0; i < totalActivities; i++) {
                        const defaultActivity = defaultActivities[i] || {};
                        const savedActivity = loadedActivities[i] || {};

                        selectedActivities.push({
                                ...defaultActivity,
                                ...savedActivity,
                                position: i,
                                isDefault: savedActivity.isDefault === undefined ? true : savedActivity.isDefault
                        });
                }

                this.activityManager.setSelectedActivities(selectedActivities);
                this.activityManager.renderActivitiesTable();
        }

        /**
         * Reset form to default values
         */
        resetForm(currentDate) {
                document.getElementById("animateur-responsable").value = '';
                document.getElementById("date").value = this.formatDateForInput(currentDate);
                setContent(document.getElementById("youth-of-honor"), '');
                document.getElementById("endroit").value = this.organizationSettings.organization_info?.endroit || '';
                document.getElementById("notes").value = '';

                const selectedActivities = this.activityManager.initializePlaceholderActivities().map(activity => ({...activity, isDefault: true}));
                this.activityManager.setSelectedActivities(selectedActivities);
                this.activityManager.renderActivitiesTable();
        }

        /**
         * Extract form data for submission
         */
        extractFormData() {
                const updatedActivities = this.activityManager.getSelectedActivitiesFromDOM();
                const honorValues = Array.from(document.getElementById('youth-of-honor').querySelectorAll('li'))
                        .map(li => li.textContent.trim())
                        .filter(Boolean);

                if (this.sectionConfig?.honorField?.required && honorValues.length === 0) {
                        this.app.showMessage(translate("meeting_section_honor_required"), "error");
                        throw new Error("Honoree required for this section");
                }

                return {
                        organization_id: this.app.organizationId,
                        animateur_responsable: document.getElementById('animateur-responsable').value,
                        date: document.getElementById('date').value,
                        youth_of_honor: honorValues,
                        endroit: document.getElementById('endroit').value,
                        activities: updatedActivities,
                        notes: document.getElementById('notes').value,
                };
        }

        /**
         * Set reminder data
         */
        setReminder(reminder) {
                this.reminder = reminder;
        }

        /**
         * Populate reminder form (to be called after DOM is rendered)
         */
        populateReminderForm() {
                if (this.reminder) {
                        const reminderTextEl = document.getElementById('reminder-text');
                        const reminderDateEl = document.getElementById('reminder-date');
                        const recurringReminderEl = document.getElementById('recurring-reminder');

                        if (reminderTextEl) reminderTextEl.value = this.reminder.reminder_text || '';
                        if (reminderDateEl) reminderDateEl.value = this.formatDateForInput(this.reminder.reminder_date || '');
                        if (recurringReminderEl) recurringReminderEl.checked = this.reminder.is_recurring || false;
                }
        }

        /**
         * Get reminder data from form
         */
        getReminderData() {
                return {
                        reminder_text: document.getElementById('reminder-text').value,
                        reminder_date: document.getElementById('reminder-date').value,
                        is_recurring: document.getElementById('recurring-reminder').checked,
                        organization_id: this.app.organizationId
                };
        }
}
