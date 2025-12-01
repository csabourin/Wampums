import { translate } from "../app.js";

/**
 * FormManager - Handles form population, validation, and data extraction
 * for the Preparation Reunions page
 */
export class FormManager {
        constructor(app, organizationSettings, animateurs, recentHonors, activityManager) {
                this.app = app;
                this.organizationSettings = organizationSettings;
                this.animateurs = animateurs;
                this.recentHonors = recentHonors;
                this.activityManager = activityManager;
                this.reminder = null;
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
                document.getElementById("date").value = meetingData.date || currentDate;

                // Handle Louveteau d'honneur
                const louveteauxDHonneur = document.getElementById("louveteau-dhonneur");
                if (Array.isArray(meetingData.louveteau_dhonneur)) {
                        louveteauxDHonneur.innerHTML = meetingData.louveteau_dhonneur.map(honor => `<li>${honor}</li>`).join('');
                } else if (typeof meetingData.louveteau_dhonneur === 'string') {
                        louveteauxDHonneur.innerHTML = `<li>${meetingData.louveteau_dhonneur}</li>`;
                } else {
                        louveteauxDHonneur.innerHTML = this.recentHonors.map(h => `<li>${h.first_name} ${h.last_name}</li>`).join('');
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
                document.getElementById("date").value = currentDate;
                document.getElementById("louveteau-dhonneur").innerHTML = '';
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

                return {
                        organization_id: this.app.organizationId,
                        animateur_responsable: document.getElementById('animateur-responsable').value,
                        date: document.getElementById('date').value,
                        louveteau_dhonneur: Array.from(document.getElementById('louveteau-dhonneur').querySelectorAll('li')).map(li => li.textContent),
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
                if (reminder) {
                        document.getElementById('reminder-text').value = reminder.reminder_text;
                        document.getElementById('reminder-date').value = reminder.reminder_date;
                        document.getElementById('recurring-reminder').checked = reminder.is_recurring;
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
