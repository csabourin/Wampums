import { debugLog, debugError, debugWarn } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { isoToDateString } from "./utils/DateUtils.js";
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
import { aiGenerateText } from "./modules/AI.js";
import { setButtonLoading } from "./utils/SkeletonUtils.js";

/**
 * PreparationReunions - Main controller for meeting preparation page
 * Manages loading, editing, and saving meeting plans with activity templates
 * 
 * Features:
 * - Load next meeting by default with proper date assignment
 * - Load previous meetings as templates (activities only, no notes)
 * - AI-powered meeting plan generation (activities with responsible/material)
 * - Risk analysis for safety planning
 * - Reminders and meeting notes
 * - Mobile-optimized UI
 */

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
                this.previousMeetings = []; // Cache for template meetings
                this.isLoadingTemplate = false; // Flag to track if loading a template

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

                        // Load the default next meeting
                        const nextMeeting = await this.loadNextMeeting();
                        this.currentMeetingData = nextMeeting;
                        this.isLoadingTemplate = false;

                        // Render the page
                        this.render();
                        await this.formManager.populateForm(nextMeeting, nextMeeting.date);
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
                        // Normalize date to YYYY-MM-DD format to avoid timezone issues
                        const normalizedDate = isoToDateString(date);
                        debugLog("Fetching meeting data for date:", normalizedDate);
                        
                        const response = await getReunionPreparation(normalizedDate);
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
                                // Normalize the date in the preparation object
                                response.preparation.date = isoToDateString(response.preparation.date);
                                return response.preparation;
                        }
                        return null;
                } catch (error) {
                        debugError("Error fetching meeting data:", error);
                        return null;
                }
        }

        /**
         * Load the next scheduled meeting or create a new one
         * This is the default meeting when the page loads
         */
        async loadNextMeeting() {
                const meetingDate = this.dateManager.getNextMeetingDate();
                const plannedMeeting = await this.fetchMeetingData(meetingDate);

                if (plannedMeeting) {
                        return plannedMeeting;
                }

                // Create default meeting for next date
                const selectedActivities = this.activityManager.initializePlaceholderActivities();
                this.activityManager.setSelectedActivities(selectedActivities);

                const defaultAnimateur = this.animateurs.find(
                        a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable
                );

                return {
                        animateur_responsable: defaultAnimateur?.id || '',
                        date: meetingDate,
                        youth_of_honor: this.recentHonors.map(h => `${h.first_name} ${h.last_name}`),
                        endroit: this.organizationSettings.organization_info?.endroit || '',
                        activities: selectedActivities,
                        notes: ''
                };
        }

        /**
         * Load a previous meeting as a template
         * Populates activities but NOT notes to avoid AI-generated content
         */
        async loadMeetingAsTemplate(date) {
                this.dateManager.setCurrentDate(date);
                this.isLoadingTemplate = true;

                try {
                        const templateMeeting = await this.fetchMeetingData(date);
                        if (!templateMeeting) {
                                this.app.showMessage(translate("meeting_not_found"), "warning");
                                return;
                        }

                        // Create a new meeting based on template but with next available date
                        const nextDate = this.dateManager.getNextMeetingDate();
                        const newMeeting = {
                                animateur_responsable: templateMeeting.animateur_responsable || '',
                                date: nextDate,
                                youth_of_honor: [], // Don't copy honors
                                endroit: templateMeeting.endroit || this.organizationSettings.organization_info?.endroit || '',
                                activities: templateMeeting.activities || [],
                                notes: '' // Important: Don't copy notes when using as template
                        };

                        this.currentMeetingData = newMeeting;
                        this.dateManager.setCurrentDate(nextDate);
                        await this.formManager.populateForm(newMeeting, nextDate);
                        this.app.showMessage(translate("template_loaded_successfully"), "success");
                } catch (error) {
                        debugError("Error loading meeting as template:", error);
                        this.app.showMessage(translate("error_loading_meeting_template"), "error");
                } finally {
                        this.isLoadingTemplate = false;
                }
        }

        /**
         * Determine current meeting (deprecated in favor of explicit loadNextMeeting)
         * Kept for backward compatibility
         */
        async determineCurrentMeeting() {
                return this.loadNextMeeting();
        }

        async loadMeeting(date) {
                this.dateManager.setCurrentDate(date);
                this.isLoadingTemplate = true;

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
                } finally {
                        this.isLoadingTemplate = false;
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
                                <a href="/dashboard" class="button button--ghost button--sm">← ${translate("back")}</a>
                                <h1>${translate("preparation_reunions")}</h1>

                                <div class="meeting-controls">
                                        <div class="date-navigation">
                                                <label for="date-select" class="sr-only">${translate("select_date")}</label>
                                                <select id="date-select" aria-label="${translate("select_date")}">
                                                        <option value="">${translate("select_date")}</option>
                                                        ${availableDates.map(date =>
                        `<option value="${date}" ${date === this.formatDateForInput(this.currentMeetingData?.date) ? 'selected' : ''}>${this.dateManager.formatDate(date, this.app.lang)}</option>`
                ).join('')}
                                                </select>
                        </div>
                        <div class="meeting-actions">
                                                <button id="new-meeting" class="button button--secondary" title="${translate("new_meeting")}">${translate("new_meeting")}</button>
                                                <button id="magic-generate-btn" class="button button--secondary" title="${translate("magic_generate_plan")}">✨ ${translate("magic_generate_plan")}</button>
                                                <button id="analyze-risks-btn" class="button button--secondary" title="${translate("analyze_risks")}">🛡️ ${translate("analyze_risks")}</button>
                                        </div>
                                </div>

                                <form id="reunion-form" class="form-layout">
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
                                        <div id="activities-container" class="activities-grid">
                                                <div class="activities-grid__header">
                                                        <div class="activities-grid__header-cell">${translate("heure_et_duree")}</div>
                                                        <div class="activities-grid__header-cell">${translate("activite_responsable_materiel")}</div>
                                                </div>
                                                <div id="activities-list" class="activities-grid__body">
                                                </div>
                                        </div>
                                        <div class="form-group">
                                                <label for="notes">${translate("notes")}:</label>
                                                <textarea id="notes" rows="4" placeholder="${translate("meeting_notes_placeholder") || 'Notes for this meeting...'}"></textarea>
                                        </div>
                                        <div class="form-actions form-actions--mobile">
                                                <button type="submit" class="button button--primary">${translate("save")}</button>
                                                <button type="button" id="print-button" class="button button--secondary">${translate("print")}</button>
                                                <button type="button" id="toggle-quick-edit" class="button button--ghost">${translate("toggle_quick_edit_mode")}</button>
                                        </div>
                                </form>

                                <h2>${translate("set_reminder")}</h2>
                                <form id="reminder-form" class="form-layout">
                                        <div class="form-group">
                                                <label for="reminder-text">${translate("reminder_text")}:</label>
                                                <textarea id="reminder-text" rows="3" placeholder="${translate("reminder_placeholder") || 'Reminder text...'}"></textarea>
                                        </div>
                                        <div class="form-row">
                                                <div class="form-group">
                                                        <label for="reminder-date">${translate("reminder_date")}:</label>
                                                        <input type="date" id="reminder-date" required>
                                                </div>
                                                <div class="form-group form-group--checkbox">
                                                        <label for="recurring-reminder" class="label--checkbox">
                                                                <input type="checkbox" id="recurring-reminder">
                                                                <span>${translate("recurring_reminder")}</span>
                                                        </label>
                                                </div>
                                        </div>
                                        <button type="submit" class="button button--primary">${translate("save_reminder")}</button>
                                </form>

                                <p class="footer-nav"><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
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
                document.getElementById('activities-container').addEventListener('change', (e) => {
                        const row = e.target.closest('.activity-row');
                        if (!row) return;

                        if (e.target.classList.contains('activity-select')) {
                                this.activityManager.updateActivityDetails(e.target);
                                e.target.setAttribute('data-default', 'false');
                                row.setAttribute('data-default', 'false');
                        } else if (e.target.classList.contains('activity-responsable')) {
                                if (e.target.value === 'other') {
                                        this.activityManager.switchResponsableToInput(e.target);
                                } else {
                                        e.target.setAttribute('data-default', 'false');
                                        row.setAttribute('data-default', 'false');
                                }
                        }
                });

                // Activity input changes
                document.getElementById('activities-container').addEventListener('input', (e) => {
                        const row = e.target.closest('.activity-row');
                        if (!row) return;

                        if (e.target.classList.contains('activity-time') ||
                                e.target.classList.contains('activity-duration') ||
                                e.target.classList.contains('activity-materiel')) {
                                e.target.setAttribute('data-default', 'false');
                                row.setAttribute('data-default', 'false');
                        }
                });

                // Description modal and activity actions
                document.getElementById('activities-container').addEventListener('click', (e) => {
                        if (e.target.classList.contains('description-btn')) {
                                e.preventDefault();
                                e.stopPropagation();
                                const description = e.target.getAttribute('data-description');
                                this.showDescriptionModal(description);
                        } else if (e.target.classList.contains('edit-activity-btn')) {
                                this.activityManager.toggleActivityEdit(e.target.closest('.activity-row'));
                        } else if (e.target.classList.contains('add-row-btn')) {
                                this.activityManager.addActivityRow(e.target.dataset.position);
                        } else if (e.target.classList.contains('delete-row-btn')) {
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

                // Magic Generate Button
                const magicBtn = document.getElementById('magic-generate-btn');
                if (magicBtn) {
                        magicBtn.addEventListener('click', () => this.handleMagicGenerate());
                }

                // Analyze Risks Button
                const riskBtn = document.getElementById('analyze-risks-btn');
                if (riskBtn) {
                        riskBtn.addEventListener('click', () => this.handleRiskAnalysis());
                }
        }

        async handleRiskAnalysis() {
                const btn = document.getElementById('analyze-risks-btn');
                const activities = this.activityManager?.getSelectedActivities() || [];

                if (activities.length === 0) {
                        this.app.showMessage(translate("add_activities_first"), "warning");
                        return;
                }

                setButtonLoading(btn, true);
                try {
                        // Extract plain text descriptions
                        const activityDescriptions = activities.map(a =>
                                `${a.time} - ${a.description} (${a.endroit || ''})`
                        ).join('\n');

                        const response = await aiGenerateText("risk_suggest", {
                                activityTitle: "Meeting Activities",
                                activityDescription: activityDescriptions
                        });

                        const risks = response.data.risks || [];
                        const mitigation = response.data.mitigation || [];

                        let riskText = "\n\n--- SAFETY ANALYSIS ---\n";
                        riskText += "RISKS:\n" + risks.map(r => "- " + r).join("\n");
                        riskText += "\n\nMITIGATION:\n" + mitigation.map(m => "- " + m).join("\n");

                        const notesField = document.getElementById('notes');
                        if (notesField) {
                                notesField.value += riskText;
                                // Scroll to bottom
                                notesField.scrollTop = notesField.scrollHeight;
                        }

                        this.app.showMessage(translate("risk_analysis_complete"), "success");

                } catch (error) {
                        let msg = error.message;
                        if (error.error?.code === 'AI_BUDGET_EXCEEDED') msg = translate('ai_budget_exceeded');
                        this.app.showMessage(translate("error_analyzing_risks") + ": " + msg, "error");
                } finally {
                        setButtonLoading(btn, false);
                }
        }

        async handleMagicGenerate() {
                const btn = document.getElementById('magic-generate-btn');
                const dateVal = document.getElementById('date')?.value;

                if (!dateVal) {
                        this.app.showMessage(translate("please_select_date_first"), "warning");
                        return;
                }

                // Show modal for meeting focus input
                const modalHTML = `
                        <div class="modal-content">
                                <div class="modal-header">
                                        <h2>${translate("meeting_focus_prompt") || "Focus de la réunion"}</h2>
                                        <button type="button" class="modal-close" data-dismiss="modal" aria-label="${translate("close") || "Close"}">&times;</button>
                                </div>
                                <form id="ai-focus-form">
                                        <div class="form-group">
                                                <label for="meeting-focus">${translate("meeting_focus_label") || "Sur quoi voulez-vous vous concentrer dans cette réunion?"}</label>
                                                <textarea id="meeting-focus" name="focus" rows="4" placeholder="${translate("meeting_focus_placeholder") || "Ex: Loup d'honneur pour Romain et Alexandre, jeu de Loik, technique habillement..."}" required></textarea>
                                                <small>${translate("meeting_focus_hint") || "Décrivez les activités spéciales, honneurs à remettre, techniques à enseigner, etc."}</small>
                                        </div>
                                        <div class="modal-actions">
                                                <button type="button" class="button button--secondary" data-dismiss="modal">${translate("cancel") || "Annuler"}</button>
                                                <button type="submit" class="button button--primary">${translate("generate") || "Générer"}</button>
                                        </div>
                                </form>
                        </div>
                `;

                // Create and show modal
                const modalId = 'ai-focus-modal';
                const existingModal = document.getElementById(modalId);
                if (existingModal) existingModal.remove();

                const modalDiv = document.createElement('div');
                modalDiv.id = modalId;
                modalDiv.className = 'modal';
                modalDiv.innerHTML = modalHTML;
                document.body.appendChild(modalDiv);

                // Show modal by adding show class after a brief delay for CSS transition
                requestAnimationFrame(() => {
                        modalDiv.classList.add('show');
                        modalDiv.setAttribute('aria-hidden', 'false');
                });

                // Focus the textarea for better UX
                const focusTextarea = document.getElementById('meeting-focus');
                if (focusTextarea) {
                        focusTextarea.focus();
                }

                // Handle form submission
                const form = document.getElementById('ai-focus-form');
                const closeModal = () => {
                        modalDiv.remove();
                };

                // Close on cancel, close button, or backdrop click
                modalDiv.querySelectorAll('[data-dismiss="modal"]').forEach(el => {
                        el.addEventListener('click', closeModal);
                });
                modalDiv.addEventListener('click', (e) => {
                        if (e.target === modalDiv) closeModal();
                });

                // Close on Escape key
                const handleEscape = (e) => {
                        if (e.key === 'Escape') {
                                closeModal();
                                document.removeEventListener('keydown', handleEscape);
                        }
                };
                document.addEventListener('keydown', handleEscape);

                form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const focus = document.getElementById('meeting-focus').value.trim();

                        if (!focus) return;

                        closeModal();
                        setButtonLoading(btn, true);

                        try {
                                // Get activity templates from section config
                                const templates = this.sectionConfig?.activityTemplates || [];

                                // Get only the most recent honor (not all of them)
                                const mostRecentHonor = this.recentHonors && this.recentHonors.length > 0
                                        ? this.recentHonors[0]
                                        : null;

                                const payload = {
                                        date: dateVal,
                                        section: this.sectionConfig?.name || "Scouts",
                                        duration: "2 hours",
                                        focus: focus,
                                        activityTemplates: templates.map(t => ({
                                                time: t.time,
                                                duration: t.duration,
                                                activity: translate(t.activityKey) || t.activityKey,
                                                type: translate(t.typeKey) || t.typeKey
                                        })),
                                        recentHonor: mostRecentHonor ? {
                                                name: mostRecentHonor.participant_name,
                                                honor: mostRecentHonor.honor_name,
                                                date: mostRecentHonor.date_awarded
                                        } : null
                                };

                                const response = await aiGenerateText("meeting_plan", payload);
                                debugLog("AI Response:", response);

                                // Extract the plan data from nested response structure
                                const plan = response.data?.data || response.data;
                                debugLog("Plan data:", plan);

                                // Populate Activities ONLY - do NOT fill notes when using template
                                if (Array.isArray(plan.timeline)) {
                                        debugLog("Timeline activities:", plan.timeline);

                                        const newActivities = plan.timeline.map((item, index) => {
                                                // Handle materiel - could be string, array, or from materials field
                                                let materiel = '';
                                                if (item.materiel) {
                                                        materiel = Array.isArray(item.materiel) ? item.materiel.join(', ') : item.materiel;
                                                } else if (item.materials) {
                                                        materiel = Array.isArray(item.materials) ? item.materials.join(', ') : item.materials;
                                                }

                                                return {
                                                        id: `ai-generated-${index}`,
                                                        position: index,
                                                        time: item.time || '',
                                                        duration: item.duration || '00:00',
                                                        activity: item.activity || '',
                                                        activityKey: null,
                                                        typeKey: null,
                                                        responsable: item.responsable || '', // Include if mentioned by AI
                                                        materiel: materiel, // Include if mentioned by AI
                                                        isDefault: false
                                                };
                                        });

                                        debugLog("Mapped activities:", newActivities);

                                        // Update ActivityManager with new activities
                                        this.activityManager.setSelectedActivities(newActivities);
                                        this.activityManager.renderActivitiesTable();
                                        debugLog("Activities rendered");
                                } else {
                                        debugWarn("No timeline array in response");
                                }

                                this.app.showMessage(translate("plan_generated_success"), "success");

                        } catch (error) {
                                let msg = error.message;
                                if (error.error?.code === 'AI_BUDGET_EXCEEDED') {
                                        msg = translate('ai_budget_exceeded');
                                } else if (error.error?.code === 'OPENAI_QUOTA_EXCEEDED') {
                                        msg = "OpenAI API quota exceeded. Please add credits to your OpenAI account at platform.openai.com/account/billing";
                                }
                                this.app.showMessage(translate("error_generating_plan") + ": " + msg, "error");
                                debugError("Magic Generate failed", error);
                        } finally {
                                setButtonLoading(btn, false);
                        }
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
                        debugLog("=== SAVING MEETING ===");
                        debugLog("1. Extracted form data:", formData);
                        debugLog("   - animateur_responsable:", formData.animateur_responsable);
                        debugLog("   - date (before normalize):", formData.date);
                        debugLog("   - youth_of_honor:", formData.youth_of_honor);
                        debugLog("   - endroit:", formData.endroit);
                        debugLog("   - notes:", formData.notes);
                        debugLog("   - activities (raw):", formData.activities);

                        // Normalize date to YYYY-MM-DD format to avoid timezone issues
                        formData.date = isoToDateString(formData.date);
                        debugLog("2. After date normalization:", formData.date);

                        // Ensure activities are properly serialized as JSON array
                        if (formData.activities && typeof formData.activities !== 'string') {
                                debugLog("3. Serializing activities...");
                                debugLog("   - Activities array length:", formData.activities.length);
                                formData.activities.forEach((act, idx) => {
                                        debugLog(`   - Activity ${idx}:`, {
                                                time: act.time,
                                                duration: act.duration,
                                                activity: act.activity,
                                                responsable: act.responsable,
                                                materiel: act.materiel,
                                                isDefault: act.isDefault
                                        });
                                });
                                formData.activities = JSON.stringify(formData.activities);
                                debugLog("   - Serialized to string");
                        }

                        debugLog("4. Final form data to save:", {
                                organization_id: formData.organization_id,
                                animateur_responsable: formData.animateur_responsable,
                                date: formData.date,
                                endroit: formData.endroit,
                                youth_of_honor: formData.youth_of_honor,
                                notes: formData.notes.substring(0, 100) + (formData.notes.length > 100 ? '...' : ''),
                                activitiesLength: JSON.parse(formData.activities).length
                        });
                } catch (error) {
                        debugError("Validation error saving reunion preparation:", error);
                        return false;
                }

                try {
                        const response = await saveReunionPreparation(formData);
                        debugLog("5. Save response:", response);
                        
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
