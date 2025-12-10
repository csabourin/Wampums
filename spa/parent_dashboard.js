import {
  getCurrentOrganizationId,
  fetchParticipants,
  getOrganizationFormFormats,
  getOrganizationSettings,
  getParticipantStatement,
  linkUserParticipants
} from "./ajax-functions.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { urlBase64ToUint8Array, hexStringToUint8Array, base64UrlEncode } from './functions.js';
import { CONFIG } from './config.js';
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ParentDashboard {
        constructor(app) {
                this.app = app;
                this.participants = [];
                this.formStructures = {};
                this.participantStatements = new Map();
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

                const installButton = `<button id="installPwaButton" style="display: none;" class="dashboard-button dashboard-button--secondary">
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
                                        </div>
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




        attachEventListeners() {
                const notificationButton = document.getElementById('enableNotifications');
                if (notificationButton) {
                        notificationButton.addEventListener('click', async () => {
                                await this.requestNotificationPermission();
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

         async registerPushSubscription() {
                        if ('serviceWorker' in navigator && 'PushManager' in window) {
                                try {
                                        const registration = await navigator.serviceWorker.ready;
                                        const applicationServerKey = urlBase64ToUint8Array(CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY);
                                        const subscription = await registration.pushManager.subscribe({
                                                userVisibleOnly: true,
                                                applicationServerKey: applicationServerKey,
                                        });

                                        debugLog('Push subscription:', subscription);

                                        // Send subscription to your server to save it
                                        await fetch('/save-subscription', {
                                                method: 'POST',
                                                headers: {
                                                        'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify(subscription),
                                        });
                                } catch (error) {
                                        debugError('Error registering for push notifications:', error);
                                }
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