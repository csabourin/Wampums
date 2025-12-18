import {
  getCurrentOrganizationId,
  fetchParticipants,
  getOrganizationFormFormats,
  getOrganizationSettings,
  getParticipantStatement,
  linkUserParticipants
} from "./ajax-functions.js";
import { getPermissionSlips, signPermissionSlip } from "./api/api-endpoints.js";
import { getActivities } from "./api/api-activities.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { hexStringToUint8Array, base64UrlEncode } from './functions.js';
import { CONFIG } from './config.js';
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ParentDashboard {
  constructor(app) {
                this.app = app;
                this.participants = [];
                this.formStructures = {};
                this.participantStatements = new Map();
                this.permissionSlips = new Map();
                this.permissionSlipHandlerBound = false;
        }

        async init() {
                let hasErrors = false;

                try {
                        await this.fetchParticipants();
                } catch (error) {
                        debugError("Error fetching participants:", error);
                        hasErrors = true;
                        // Continue with empty participants
                }

                try {
                        await this.fetchFormFormats();
                } catch (error) {
                        debugError("Error fetching form formats:", error);
                        hasErrors = true;
                        // Continue with empty form formats
                }

                try {
                        await this.fetchParticipantStatements();
                } catch (error) {
                        debugError("Error fetching participant statements:", error);
                        hasErrors = true;
                        // Continue with empty statements
                }

                try {
                        await this.fetchPermissionSlips();
                } catch (error) {
                        debugError("Error fetching permission slips:", error);
                        hasErrors = true;
                }

                // Always render the page, even with partial data
                try {
                        this.render();
                        this.attachEventListeners();
                        this.checkAndShowLinkParticipantsDialog();

                        if (hasErrors) {
                                this.app.showMessage(translate("error_loading_data"), "warning");
                        }
                } catch (error) {
                        debugError("Error rendering parent dashboard:", error);
                        this.app.renderError(translate("error_loading_parent_dashboard"));
                }
        }

        checkAndShowLinkParticipantsDialog() {
                        const guardianParticipants = JSON.parse(localStorage.getItem("guardianParticipants"));
                        if (guardianParticipants && guardianParticipants.length > 0) {
                                        this.showLinkParticipantsDialog(guardianParticipants);
                                        localStorage.removeItem("guardianParticipants"); // Clear after showing
                        }
        }

        showLinkParticipantsDialog(guardianParticipants) {
                        const dialogContent = `
                                        <h2>${translate("link_existing_participants")}</h2>
                                        <p>${translate("existing_participants_found")}</p>
                                        <form id="link-participants-form">
                                                        ${guardianParticipants.map(participant => `
                                                                        <label>
                                                                                        <input type="checkbox" name="link_participants" value="${participant.participant_id}">
                                                                                        ${participant.first_name} ${participant.last_name}
                                                                        </label>
                                                        `).join('')}
                                                        <button type="submit">${translate("link_selected_participants")}</button>                                                       <button id="cancel" type="button">${translate("cancel")}</button>
                                        </form>
                        `;

                        const dialog = document.createElement('div');
                        dialog.innerHTML = dialogContent;
                        dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border: 1px solid black; z-index: 1000;';
                        document.body.appendChild(dialog);

                document.querySelector('#cancel').addEventListener('click', () => {
                                dialog.remove();
                });

                        document.getElementById('link-participants-form').addEventListener('submit', async (e) => {
                                        e.preventDefault();
                                        const formData = new FormData(e.target);
                                        const selectedParticipants = formData.getAll('link_participants');

                                        try {
                                                        const result = await linkUserParticipants({ participant_ids: selectedParticipants });
                                                        if (result.success) {
                                                                        this.app.showMessage(translate("participants_linked_successfully"));
                                                                        await this.fetchParticipants(); // Refresh the participants list
                                                                        this.render(); // Re-render the dashboard
                                                        } else {
                                                                        this.app.showMessage(translate("error_linking_participants"), "error");
                                                        }
                                        } catch (error) {
                                                        debugError("Error linking participants:", error);
                                                        this.app.showMessage(translate("error_linking_participants"), "error");
                                        }

                                        document.body.removeChild(dialog);
                        });
        }

        async fetchParticipants() {
                        try {
                                        const response = await fetchParticipants(getCurrentOrganizationId());

                                        // Use a Map to store unique participants
                                        const uniqueParticipants = new Map();

                                        // Validate response is an array before processing
                                        if (Array.isArray(response)) {
                                                response.forEach(participant => {
                                                                // If this participant isn't in our Map yet, add them
                                                                if (!uniqueParticipants.has(participant.id)) {
                                                                                uniqueParticipants.set(participant.id, participant);
                                                                }
                                                });
                                        }

                                        // Convert the Map values back to an array
                                        this.participants = Array.from(uniqueParticipants.values());

                                        debugLog("Fetched participants:", this.participants);
                        } catch (error) {
                                        debugError("Error fetching participants:", error);
                                        this.participants = [];
                                        throw error;
                        }
        }

        async fetchParticipantStatements() {
                if (!Array.isArray(this.participants) || this.participants.length === 0) {
                        return;
                }

                await Promise.all(
                        this.participants.map(async (participant) => this.loadSingleStatement(participant.id))
                );
        }

        async loadSingleStatement(participantId) {
                try {
                        const response = await getParticipantStatement(participantId);
                        const payload = response?.data || response;
                        const statementData = payload?.data || payload;

                        if (statementData?.participant?.id) {
                                this.participantStatements.set(statementData.participant.id, statementData);
                                return statementData;
                        }
                } catch (error) {
                        debugWarn("Unable to load participant statement", error);
                }

                return null;
        }

        async fetchPermissionSlips() {
                if (!Array.isArray(this.participants) || this.participants.length === 0) {
                        return;
                }

                await Promise.all(
                        this.participants.map(async (participant) => this.loadPermissionSlips(participant.id))
                );
        }

        async loadPermissionSlips(participantId) {
                try {
                        const response = await getPermissionSlips({ participant_id: participantId });
                        const slips = response?.data?.permission_slips || response?.permission_slips || [];
                        this.permissionSlips.set(participantId, slips);
                        return slips;
                } catch (error) {
                        debugError("Error loading permission slips", error);
                        this.permissionSlips.set(participantId, []);
                        return [];
                }
        }

        async fetchFormFormats() {
                try {
                        const response = await getOrganizationFormFormats();
                        if (response && typeof response === 'object') {
                                this.formFormats = response;
                        } else {
                                debugError("Invalid form formats response:", response);
                        }
                } catch (error) {
                        debugError("Error fetching form formats:", error);
                        this.formFormats = {};
                        throw error;
                }
        }

        async fetchOrganizationInfo() {
                try {
                        // Fetch all organization settings
                        const response = await getOrganizationSettings();

                        // Check if the response is successful and contains settings
                        if (response && response.success && response.settings) {
                                // Get the organization_info setting
                                const organizationInfo = response.settings.organization_info;

                                // If the setting exists, extract the name, otherwise set a default
                                if (organizationInfo && organizationInfo.name) {
                                        this.organizationName = organizationInfo.name;
                                } else {
                                        this.organizationName = translate("organization_name_default");
                                }
                        } else {
                                debugError("Invalid organization info response:", response);
                        }
                } catch (error) {
                        debugError("Error fetching organization info:", error);
                }
        }

        async fetchUserFullName() {
                // If userFullName is not set, fetch it from the server
                if (!this.app.userFullName) {
                        try {
                                const response = await fetch("/api/auth/verify-session", {
                                        method: 'POST',
                                        headers: {
                                                'Authorization': `Bearer ${localStorage.getItem('token')}`
                                        }
                                });
                                const data = await response.json();
                                if (data.success) {
                                        this.app.userFullName = data.user.fullName;
                                } else {
                                        debugError("Failed to fetch user full name:", data.message);
                                }
                        } catch (error) {
                                debugError("Error fetching user full name:", error);
                        }
                }
        }

        render() {
                 const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";
                const notificationButton = this.shouldShowNotificationButton()
                        ? `<button id="enableNotifications" class="dashboard-button dashboard-button--secondary">
                                                ${translate("enable_notifications")}
                                        </button>`
                        : ''; // Only render the button if needed

                const installButton = `<button id="installPwaButton" class="hidden dashboard-button dashboard-button--secondary">
                                                ${translate("install_app")}
                                        </button>`; // Initially hidden

                // Check if the user role is admin or animation
                const backLink = this.app.userRole === "admin" || this.app.userRole === "animation"
                        ? `<a href="/dashboard" class="back-link">${translate("back_to_dashboard")}</a>`
                        : ``;

                // Dynamically replace the title with the organization name
                const userName = this.app.userFullName || localStorage.getItem('userFullName') || '';
                const content = `
                        <div class="parent-dashboard">
                                <header class="parent-dashboard__header">
                                        <h1 class="parent-dashboard__title">${translate("bienvenue")}${userName ? ' ' + userName : ''}</h1>
                                        <p class="parent-dashboard__subtitle">${organizationName}</p>
                                        ${backLink}
                                </header>

                                <section class="parent-dashboard__actions">
                                        <h2 class="visually-hidden">${translate("main_actions")}</h2>
                                        <div class="parent-dashboard__actions-grid">
                                                <a href="/formulaire-inscription" class="dashboard-button dashboard-button--primary">
                                                        ${translate("ajouter_participant")}
                                                </a>
                                                <a href="/parent-finance" class="dashboard-button dashboard-button--primary">
                                                        ${translate("my_finances")}
                                                </a>
                                                <a href="/account-info" class="dashboard-button dashboard-button--secondary">
                                                        ${translate("account_settings")}
                                                </a>
                                        </div>
                                        ${this.renderCarpoolButton()}
                                </section>

                                <section class="parent-dashboard__participants">
                                        <h2 class="visually-hidden">${translate("participants_list")}</h2>
                                        ${this.renderParticipantsList()}
                                </section>

                                <footer class="parent-dashboard__footer">
                                        <div class="parent-dashboard__footer-actions">
                                                ${notificationButton}
                                                ${installButton}
                                        </div>
                                        <a href="/logout" class="dashboard-button dashboard-button--logout">
                                                ${translate("deconnexion")}
                                        </a>
                                </footer>
                        </div>
                `;
                document.getElementById("app").innerHTML = content;
                this.bindStatementHandlers();
                this.bindPermissionSlipHandlers();
        }

        renderCarpoolButton() {
                // Show a carpooling link for parents to coordinate rides
                return `
                        <div class="parent-dashboard__carpool-section" style="margin-top: 1.5rem;">
                                <a href="#" id="view-carpool-activities" class="dashboard-button dashboard-button--secondary" style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <rect x="1" y="3" width="15" height="13"></rect>
                                                <path d="M16 8h2"></path>
                                                <circle cx="18.5" cy="15.5" r="2.5"></circle>
                                                <circle cx="5.5" cy="15.5" r="2.5"></circle>
                                        </svg>
                                        ${translate("carpool_coordination")}
                                </a>
                        </div>
                `;
        }

        formatCurrency(amount = 0) {
                const numericValue = Number.parseFloat(amount);
                if (!Number.isFinite(numericValue)) {
                        return this.formatCurrency(0);
                }

                const locale = this.app?.language || CONFIG.DEFAULT_LANG || 'en';
                const currency = CONFIG.DEFAULT_CURRENCY || 'USD';

                return new Intl.NumberFormat(locale, {
                        style: 'currency',
                        currency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                }).format(numericValue);
        }

        renderStatementLink(participant) {
                const statement = this.participantStatements.get(participant.id);
                const outstanding = statement?.totals?.total_outstanding ?? 0;

                if (!statement || outstanding <= 0) {
                        return '';
                }

                return `
                        <button type="button" class="participant-card__statement" data-participant-id="${participant.id}">
                                <span class="participant-card__statement-label">${translate("view_statement")}</span>
                                <span class="participant-card__statement-amount">
                                        ${translate("amount_due")}: ${this.formatCurrency(outstanding)}
                                </span>
                        </button>
                `;
        }


        // Check notification permission and decide whether to show the button
        shouldShowNotificationButton() {
                if ('Notification' in window) {
                return Notification.permission === "default" || Notification.permission === "denied";
                } return false;
        }

        renderParticipantsList() {
                if (!Array.isArray(this.participants) || this.participants.length === 0) {
                        return `<p class="parent-dashboard__empty">${translate("no_participants")}</p>`;
                }

                return this.participants.map(participant => {
                        const participantName = escapeHTML(`${participant.first_name} ${participant.last_name}`);
                        const statementLink = this.renderStatementLink(participant);

                        return `
                        <article class="participant-card">
                                <header class="participant-card__header">
                                        <h3 class="participant-card__name">${participantName}</h3>
                                        <a href="/formulaire-inscription/${participant.id}" class="participant-card__edit-btn">
                                                ${translate("modifier")}
                                        </a>
                                </header>
                                <div class="participant-card__forms">
                                        ${this.renderFormButtons(participant)}
                                </div>
                                ${statementLink ? `<div class="participant-card__section">${statementLink}</div>` : ''}
                                ${this.renderPermissionSlipSection(participant)}
                        </article>
                `;
                }).join("");
        }

renderFormButtons(participant) {
    debugLog("Forms type: ", this.formFormats);

    return Object.keys(this.formFormats)
        .filter(formType => {
            // Exclude 'participant_registration' and 'parent_guardian' for all users
            if (formType === 'participant_registration' || formType === 'parent_guardian') {
                return false; // Hide these forms
            }
            return true; // Show all other forms
        })
        .map(formType => {
            const formLabel = translate(formType);
            const isCompleted = participant[`has_${formType}`] === 1 || participant[`has_${formType}`] === true;
            const statusClass = isCompleted ? "form-btn--completed" : "form-btn--incomplete";
            const statusIcon = isCompleted ? "✅" : "❌";

            return `
                <a href="/dynamic-form/${formType}/${participant.id}" class="form-btn ${statusClass}">
                    <span class="form-btn__icon">${statusIcon}</span>
                    <span class="form-btn__label">${formLabel}</span>
                </a>
            `;
        })
                        .join("") + `
                                <a href="/badge-form/${participant.id}" class="form-btn form-btn--badge">
                                        <span class="form-btn__icon">🏅</span>
                                        <span class="form-btn__label">${translate('manage_badge_progress')}</span>
                                </a>
                        `;
}

        renderPermissionSlipSection(participant) {
                return `
                        <div class="participant-card__section">
                                <div class="participant-card__section-header">
                                        <h4>${translate("permission_slip_section_title")}</h4>
                                        <p class="muted-text">${translate("permission_slip_parent_hint")}</p>
                                </div>
                                <div class="permission-slip-section" data-permission-slips-for="${participant.id}">
                                        ${this.renderPermissionSlipItems(participant.id)}
                                </div>
                        </div>
                `;
        }

        renderPermissionSlipItems(participantId) {
                const slips = this.permissionSlips.get(participantId) || [];

                if (!Array.isArray(slips) || slips.length === 0) {
                        return `<p class="muted-text">${translate("no_permission_slips")}</p>`;
                }

                return `
                        <ul class="permission-slip-list">
                                ${slips.map((slip) => {
                                        const statusLabel = escapeHTML(this.getPermissionSlipStatusLabel(slip.status));
                                        const meetingLabel = escapeHTML(this.formatDateSafe(slip.meeting_date));
                                        const signedDate = slip.signed_at ? escapeHTML(this.formatDateSafe(slip.signed_at)) : '';
                                        const signer = slip.signed_by ? escapeHTML(slip.signed_by) : '';
                                        const canSign = slip.status === 'pending';

                                        const signedMeta = signedDate || signer
                                                ? `<p class="muted-text">${[signedDate ? `${translate("permission_slip_signed_at")}: ${signedDate}` : '', signer ? `${translate("permission_slip_signer")}: ${signer}` : ''].filter(Boolean).join(' · ')}</p>`
                                                : '';

                                        const actionArea = canSign
                                                ? `<button type="button" class="dashboard-button dashboard-button--secondary permission-slip-sign-btn" data-slip-id="${slip.id}" data-participant-id="${participantId}">${translate("permission_slip_sign")}</button>`
                                                : `<span class="badge badge-success">${statusLabel}</span>`;

                                        return `
                                                <li class="permission-slip-item">
                                                        <div>
                                                                <p class="permission-slip-meeting">${translate("meeting_date_label")}: ${meetingLabel}</p>
                                                                <p class="permission-slip-status">${translate("status")}: ${statusLabel}</p>
                                                                ${signedMeta}
                                                        </div>
                                                        <div class="permission-slip-actions">${actionArea}</div>
                                                </li>
                                        `;
                                }).join("")}
                        </ul>
                `;
        }

        refreshPermissionSlipSection(participantId) {
                const container = document.querySelector(`[data-permission-slips-for="${participantId}"]`);
                if (!container) {
                        return;
                }

                container.innerHTML = this.renderPermissionSlipItems(participantId);
        }

        getPermissionSlipStatusLabel(status) {
                if (!status) {
                        return translate("unknown") || "-";
                }

                const localized = translate(`permission_slip_status_${status}`);
                return localized === `permission_slip_status_${status}` ? status : localized;
        }

        formatDateSafe(dateString) {
                if (!dateString) {
                        return translate("meeting_date_label");
                }

                const parsed = new Date(dateString);
                if (Number.isNaN(parsed.getTime())) {
                        return translate("meeting_date_label");
                }

                const locale = this.app?.currentLanguage || this.app?.language || CONFIG.DEFAULT_LANG || 'en';
                return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(parsed);
        }




        attachEventListeners() {
                const notificationButton = document.getElementById('enableNotifications');
                if (notificationButton) {
                        notificationButton.addEventListener('click', async () => {
                                await this.requestNotificationPermission();
                        });
                }

                // Carpool activities button
                const carpoolButton = document.getElementById('view-carpool-activities');
                if (carpoolButton) {
                        carpoolButton.addEventListener('click', async (e) => {
                                e.preventDefault();
                                await this.showCarpoolActivitiesModal();
                        });
                }

                // Install PWA button logic
                const installButton = document.getElementById('installPwaButton');
                let deferredPrompt;

                window.addEventListener('beforeinstallprompt', (e) => {
                        debugLog('beforeinstallprompt event fired');
                        // Prevent the default prompt
                        e.preventDefault();
                        deferredPrompt = e;

                        // Show the install button
                        installButton.style.display = 'block';

                        // Add click event to the install button
                        installButton.addEventListener('click', async () => {
                                if (deferredPrompt) {
                                        // Show the install prompt
                                        deferredPrompt.prompt();

                                        // Check the user's response
                                        const choiceResult = await deferredPrompt.userChoice;
                                        if (choiceResult.outcome === 'accepted') {
                                                debugLog('User accepted the install prompt');
                                        } else {
                                                debugLog('User dismissed the install prompt');
                                        }

                                        // Clear the deferredPrompt so it can’t be reused
                                        deferredPrompt = null;

                                        // Hide the install button after interaction
                                        installButton.style.display = 'none';
                                }
                        });
                });

                window.addEventListener('appinstalled', () => {
                        debugLog('App has been installed');
                });
        }

        bindStatementHandlers() {
                const statementButtons = document.querySelectorAll('.participant-card__statement');

                statementButtons.forEach((button) => {
                        button.addEventListener('click', async (event) => {
                                const participantId = event.currentTarget?.dataset?.participantId;
                                await this.showStatementModal(participantId);
                        });
                });
        }

        bindPermissionSlipHandlers() {
                if (this.permissionSlipHandlerBound) {
                        return;
                }

                const appContainer = document.getElementById('app');
                if (!appContainer) {
                        return;
                }

                appContainer.addEventListener('click', async (event) => {
                        const button = event.target.closest('.permission-slip-sign-btn');
                        if (!button) {
                                return;
                        }

                        const slipId = Number.parseInt(button.dataset?.slipId, 10);
                        const participantId = Number.parseInt(button.dataset?.participantId, 10);

                        if (!slipId || !participantId) {
                                return;
                        }

                        const signerName = window.prompt(translate("permission_slip_signer"))?.trim();
                        if (!signerName) {
                                return;
                        }

                        try {
                                await signPermissionSlip(slipId, { signed_by: signerName, signature_hash: `signed-${Date.now()}` });
                                this.app.showMessage(translate("permission_slip_signed"), "success");
                                await this.loadPermissionSlips(participantId);
                                this.refreshPermissionSlipSection(participantId);
                        } catch (error) {
                                debugError("Error signing permission slip", error);
                                this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
                        }
                });

                this.permissionSlipHandlerBound = true;
        }

        async showStatementModal(participantId) {
                if (!participantId) return;

                const numericId = Number.parseInt(participantId, 10);
                const existingStatement = this.participantStatements.get(numericId) || await this.loadSingleStatement(numericId);

                if (!existingStatement) {
                        this.app.showMessage(translate("statement_unavailable"), "error");
                        return;
                }

                const totals = existingStatement.totals || { total_billed: 0, total_paid: 0, total_outstanding: 0 };
                const feeLines = Array.isArray(existingStatement.fees) && existingStatement.fees.length > 0
                        ? existingStatement.fees.map((fee) => {
                                const yearRange = fee.year_start && fee.year_end
                                        ? `${fee.year_start} – ${fee.year_end}`
                                        : translate("membership_period");
                                const safeStatus = escapeHTML(fee.status || translate("status"));

                                return `
                                        <div class="statement-line">
                                                <div>
                                                        <p class="muted-text">${translate("membership_period")}: ${escapeHTML(yearRange)}</p>
                                                        <p>${translate("status")}: ${safeStatus}</p>
                                                </div>
                                                <div class="statement-amounts">
                                                        <span>${translate("total_billed")}: ${this.formatCurrency(fee.total_amount)}</span>
                                                        <span>${translate("payments_to_date")}: ${this.formatCurrency(fee.total_paid)}</span>
                                                        <span class="${fee.outstanding > 0 ? 'text-warning' : 'text-success'}">${translate("amount_due")}: ${this.formatCurrency(fee.outstanding)}</span>
                                                </div>
                                        </div>
                                `;
                        }).join("")
                        : `<p class="muted-text">${translate("no_financial_activity")}</p>`;

                const participantName = escapeHTML(`${existingStatement.participant.first_name} ${existingStatement.participant.last_name}`);

                const modal = document.createElement('div');
                modal.className = 'modal-screen';
                modal.innerHTML = `
                        <div class="modal">
                                <div class="modal__header">
                                        <div>
                                                <p class="muted-text">${translate("membership_statement_title")}</p>
                                                <h3>${participantName}</h3>
                                        </div>
                                        <button type="button" class="ghost-button" id="close-statement-modal">${translate("close")}</button>
                                </div>
                                <div class="statement-summary">
                                        <div>
                                                <span>${translate("total_billed")}</span>
                                                <strong>${this.formatCurrency(totals.total_billed)}</strong>
                                        </div>
                                        <div>
                                                <span>${translate("payments_to_date")}</span>
                                                <strong>${this.formatCurrency(totals.total_paid)}</strong>
                                        </div>
                                        <div>
                                                <span>${translate("amount_due")}</span>
                                                <strong>${this.formatCurrency(totals.total_outstanding)}</strong>
                                        </div>
                                </div>
                                <div class="statement-lines">${feeLines}</div>
                        </div>
                `;

                document.body.appendChild(modal);

                const closeButton = modal.querySelector('#close-statement-modal');
                if (closeButton) {
                        closeButton.addEventListener('click', () => modal.remove());
                }

                modal.addEventListener('click', (event) => {
                        if (event.target === modal) {
                                modal.remove();
                        }
                });
        }

        async showCarpoolActivitiesModal() {
                try {
                        const activities = await getActivities();
                        const now = new Date();
                        const upcomingActivities = activities.filter(a => new Date(a.activity_date) >= now);

                        if (upcomingActivities.length === 0) {
                                this.app.showMessage(translate('no_upcoming_activities'), 'info');
                                return;
                        }

                        const modal = document.createElement('div');
                        modal.className = 'modal-screen';
                        modal.innerHTML = `
                                <div class="modal">
                                        <div class="modal__header">
                                                <h3>${translate('carpool_coordination')}</h3>
                                                <button type="button" class="ghost-button" id="close-carpool-modal">${translate('close')}</button>
                                        </div>
                                        <div style="padding: 1.5rem;">
                                                <p style="margin-bottom: 1rem; color: #666;">${translate('select_activity_for_carpool')}</p>
                                                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                                                        ${upcomingActivities.map(activity => `
                                                                <a href="/carpool/${activity.id}" class="activity-link" style="padding: 1rem; border: 2px solid #e0e0e0; border-radius: 8px; text-decoration: none; color: inherit; display: block; transition: all 0.2s;">
                                                                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                                                                                <div style="flex: 1;">
                                                                                        <h4 style="margin: 0 0 0.5rem 0; color: #333;">${escapeHTML(activity.name)}</h4>
                                                                                        <p style="margin: 0; font-size: 0.9rem; color: #666;">
                                                                                                ${new Date(activity.activity_date).toLocaleDateString()} - ${activity.departure_time_going}
                                                                                        </p>
                                                                                        <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: #999;">
                                                                                                ${escapeHTML(activity.meeting_location_going)}
                                                                                        </p>
                                                                                </div>
                                                                                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; font-size: 0.85rem;">
                                                                                        <span style="background: #667eea; color: white; padding: 0.25rem 0.75rem; border-radius: 20px;">
                                                                                                ${activity.carpool_offer_count || 0} ${translate('vehicles')}
                                                                                        </span>
                                                                                        <span style="color: #666;">
                                                                                                ${activity.assigned_participant_count || 0} ${translate('assigned')}
                                                                                        </span>
                                                                                </div>
                                                                        </div>
                                                                </a>
                                                        `).join('')}
                                                </div>
                                        </div>
                                </div>
                        `;

                        document.body.appendChild(modal);

                        const closeButton = modal.querySelector('#close-carpool-modal');
                        if (closeButton) {
                                closeButton.addEventListener('click', () => modal.remove());
                        }

                        modal.addEventListener('click', (event) => {
                                if (event.target === modal) {
                                        modal.remove();
                                }
                        });

                        // Add hover effect to activity links
                        const activityLinks = modal.querySelectorAll('.activity-link');
                        activityLinks.forEach(link => {
                                link.addEventListener('mouseenter', (e) => {
                                        e.target.style.borderColor = '#667eea';
                                        e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                                });
                                link.addEventListener('mouseleave', (e) => {
                                        e.target.style.borderColor = '#e0e0e0';
                                        e.target.style.boxShadow = 'none';
                                });
                        });

                } catch (error) {
                        debugError('Error loading carpool activities:', error);
                        this.app.showMessage(translate('error_loading_activities'), 'error');
                }
        }



  async requestNotificationPermission() {
                if ('Notification' in window) {
                        // Proceed with Notification logic
                        if (Notification.permission === 'granted') {
                                registerPushSubscription();
                        } else if (Notification.permission === 'default') {
                                Notification.requestPermission().then((permission) => {
                                        if (permission === 'granted') {
                                                registerPushSubscription();
                                        }
                                });
                        }
                } else {
                        debugError('This browser does not support notifications.');
                }

  }

                renderError() {
                        const errorMessage = `
                                <h1>${translate("error")}</h1>
                                <p>${translate("error_loading_parent_dashboard")}</p>
                        `;
                        document.getElementById("app").innerHTML = errorMessage;
                }
        }
