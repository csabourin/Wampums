import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { setContent } from "../utils/DOMUtils.js";
import { formatHonorText } from "../utils/HonorUtils.js";
import { debugLog } from "../utils/DebugUtils.js";

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
         * Update the recent honors list used for default population.
         * @param {Array<string|object>} honors - Honors list.
         */
        setRecentHonors(honors) {
                this.recentHonors = Array.isArray(honors) ? honors : [];
        }

        /**
         * Format honor text for display.
         * @param {string|object} honor - Honor string or honor record.
         * @returns {string} Display-ready honor text.
         */
        formatHonorText(honor) {
                return formatHonorText(honor);
        }

        /**
         * Build plain text list for honors (one per line).
         * @param {Array<string|object>} honors - Honors list.
         * @returns {string} Plain text, one honor per line.
         */
        getHonorListItems(honors = []) {
                return (honors || [])
                        .map(honor => this.formatHonorText(honor))
                        .filter(Boolean)
                        .join('\n');
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
                debugLog("=== POPULATE FORM ===");
                debugLog("1. Meeting data received:", meetingData);
                
                if (!meetingData) {
                        debugLog("No meeting data, resetting form");
                        this.resetForm(currentDate);
                        return;
                }

                document.getElementById("animateur-responsable").value = meetingData.animateur_responsable || '';
                document.getElementById("date").value = this.formatDateForInput(meetingData.date || currentDate);

                // Handle Louveteau d'honneur
                const honorTextarea = document.getElementById("youth-of-honor");
                const honorData = meetingData.youth_of_honor ?? meetingData.louveteau_dhonneur;
                if (Array.isArray(honorData)) {
                        const honorsText = honorData.length > 0
                                ? this.getHonorListItems(honorData)
                                : this.getHonorListItems(this.recentHonors);
                        honorTextarea.value = honorsText;
                } else if (typeof honorData === 'string') {
                        honorTextarea.value = this.getHonorListItems([honorData]);
                } else {
                        honorTextarea.value = this.getHonorListItems(this.recentHonors);
                }

                document.getElementById("endroit").value = meetingData.endroit || this.organizationSettings.organization_info?.endroit || '';

                // Set duration override if available (for special meetings)
                const durationOverrideField = document.getElementById("duration-override");
                if (durationOverrideField) {
                        durationOverrideField.value = meetingData.duration_override || '';
                        // Update ActivityManager with the override
                        if (meetingData.duration_override) {
                                this.activityManager.setMeetingLength(
                                        this.activityManager.meetingLengthMinutes,
                                        meetingData.duration_override
                                );
                        }
                }

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
                debugLog("2. Processing activities...");
                
                const loadedActivities = meetingData.activities || [];
                debugLog("   - Loaded activities count:", loadedActivities.length);
                debugLog("   - Loaded activities data:", loadedActivities);
                
                // Initialize placeholder activities considering existing activities
                const defaultActivities = this.activityManager.initializePlaceholderActivities(loadedActivities);
                debugLog("   - Default activities count:", defaultActivities.length);
                
                const totalActivities = Math.max(defaultActivities.length, loadedActivities.length);
                debugLog("   - Total activities to render:", totalActivities);

                const selectedActivities = [];

                for (let i = 0; i < totalActivities; i++) {
                        const defaultActivity = defaultActivities[i] || {};
                        const savedActivity = loadedActivities[i] || {};

                        const merged = {
                                ...defaultActivity,
                                ...savedActivity,
                                position: i,
                                isDefault: savedActivity.isDefault === undefined ? true : savedActivity.isDefault
                        };

                        debugLog(`   - Activity ${i} merged:`, {
                                time: merged.time,
                                activity: merged.activity,
                                responsable: merged.responsable,
                                materiel: merged.materiel,
                                isDefault: merged.isDefault
                        });

                        selectedActivities.push(merged);
                }

                debugLog("3. Setting selected activities and rendering...");
                this.activityManager.setSelectedActivities(selectedActivities);
                this.activityManager.renderActivitiesTable();
                debugLog("   - Form population complete");
        }

        /**
         * Reset form to default values
         */
        resetForm(currentDate) {
                document.getElementById("animateur-responsable").value = '';
                document.getElementById("date").value = this.formatDateForInput(currentDate);
                document.getElementById("youth-of-honor").value = '';
                document.getElementById("endroit").value = this.organizationSettings.organization_info?.endroit || '';
                document.getElementById("notes").value = '';

                const selectedActivities = this.activityManager.initializePlaceholderActivities(null).map(activity => ({...activity, isDefault: true}));
                this.activityManager.setSelectedActivities(selectedActivities);
                this.activityManager.renderActivitiesTable();
        }

        /**
         * Extract form data for submission
         */
        extractFormData() {
                debugLog("=== EXTRACT FORM DATA ===");
                
                const updatedActivities = this.activityManager.getSelectedActivitiesFromDOM();
                debugLog("1. Updated activities from DOM:", updatedActivities);
                
                const honorValues = document.getElementById('youth-of-honor').value
                        .split('\n')
                        .map(line => line.trim())
                        .filter(Boolean);
                debugLog("2. Honor values extracted:", honorValues);

                if (this.sectionConfig?.honorField?.required && honorValues.length === 0) {
                        this.app.showMessage(translate("meeting_section_honor_required"), "error");
                        throw new Error("Honoree required for this section");
                }

                const animateurValue = document.getElementById('animateur-responsable').value;
                const dateValue = document.getElementById('date').value;
                const endraitValue = document.getElementById('endroit').value;
                const notesValue = document.getElementById('notes').value;
                
                // Extract duration override if provided
                const durationOverrideField = document.getElementById('duration-override');
                const durationOverride = durationOverrideField?.value ? parseInt(durationOverrideField.value, 10) : null;
                
                debugLog("3. Form field values:");
                debugLog("   - animateur-responsable:", animateurValue);
                debugLog("   - date:", dateValue);
                debugLog("   - endroit:", endraitValue);
                debugLog("   - notes length:", notesValue.length);
                debugLog("   - duration-override:", durationOverride);

                const formData = {
                        organization_id: this.app.organizationId,
                        animateur_responsable: animateurValue,
                        date: dateValue,
                        youth_of_honor: honorValues,
                        endroit: endraitValue,
                        activities: updatedActivities,
                        notes: notesValue,
                };

                // Only include duration_override if it's set
                if (durationOverride) {
                        formData.duration_override = durationOverride;
                }

                return formData;
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
