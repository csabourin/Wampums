import { getMailingList, getAnnouncements, createAnnouncement, getGroups } from "./ajax-functions.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { escapeHTML, sanitizeHTML } from "./utils/SecurityUtils.js";
import { CONFIG } from "./config.js";
import { canSendCommunications } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

export class MailingList {
  constructor(app) {
                this.app = app;
                this.mailingList = {};
                this.announcements = [];
                this.groups = [];
                this.templates = [];
                this.isSubmitting = false;
        }

        async init() {
                if (!canSendCommunications()) {
                        this.app.router.navigate("/");
                        return;
                }

                try {
                        await this.fetchData();
                        this.render();
                        this.attachEventListeners();
                } catch (error) {
                        debugError("Error initializing mailing list:", error);
                        this.renderError();
                }
        }

        async fetchData() {
                const [mailingResponse, groupsResponse, announcementResponse] = await Promise.all([
                        getMailingList(),
                        getGroups(),
                        getAnnouncements(),
                ]);

                if (!mailingResponse?.success || !mailingResponse.emails_by_role) {
                        throw new Error(mailingResponse?.message || "Invalid mailing list response");
                }

                this.mailingList = mailingResponse;
                this.groups = groupsResponse?.data || groupsResponse?.groups || [];
                this.announcements = announcementResponse?.data || [];
                this.templates = announcementResponse?.templates || [];
        }

        render() {
                const content = `
                        <h1>${translate("mailing_list")}</h1>
                        <div class="announcement-composer card">
                                ${this.renderAnnouncementComposer()}
                        </div>
                        <div class="announcement-history card">
                                ${this.renderAnnouncementHistory()}
                        </div>
                        <div id="mailing-list">
                                ${this.renderMailingList()}
                        </div>
                        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
                `;
                setContent(document.getElementById("app"), content);
        }

        renderAnnouncementComposer() {
                const roles = [
                        { key: "parent", label: translate("parents") },
                        { key: "leader", label: translate("leader") },
                        { key: "unitadmin", label: translate("unitadmin") || translate("admin") },
                        { key: "district", label: translate("district") || translate("admin") },
                        { key: "finance", label: translate("finance") },
                        { key: "equipment", label: translate("equipment") || translate("inventory") },
                        { key: "administration", label: translate("administration") || translate("reports") },
                        { key: "demoparent", label: translate("demoparent") || translate("parent") },
                        { key: "demoadmin", label: translate("demoadmin") || translate("admin") },
                ];

                const templateOptions = this.templates?.length
                        ? `
                                <label class="input-group">
                                        <span>${translate("use_template")}</span>
                                        <select id="announcement-template">
                                                <option value="">${translate("choose_template")}</option>
                                                ${this.templates
                                                        .map(
                                                                (template, index) => `
                                                                        <option value="${index}">${escapeHTML(
                                                                                template.title || template.key || translate("template")
                                                                        )}</option>
                                                                `
                                                        )
                                                        .join("")}
                                        </select>
                                </label>
                        `
                        : "";

                return `
                        <h2>${translate("compose_announcement")}</h2>
                        <p class="text-muted">${translate("announcement_roles_help")}</p>
                        <div id="announcement-feedback" class="status-message"></div>
                        <form id="announcement-form">
                                ${templateOptions}
                                <label class="input-group">
                                        <span>${translate("announcement_subject")}</span>
                                        <input type="text" id="announcement-subject" name="announcement-subject" maxlength="255" required />
                                </label>
                                <label class="input-group">
                                        <span>${translate("announcement_message")}</span>
                                        <textarea id="announcement-message" name="announcement-message" rows="5" required></textarea>
                                </label>
                                <div class="input-group roles">
                                        <span>${translate("recipient_roles")}</span>
                                        <div class="role-options">
                                                ${roles
                                                        .map(
                                                                (role) => `
                                                                        <label>
                                                                                <input type="checkbox" name="recipient-role" value="${role.key}" checked />
                                                                                ${role.label}
                                                                        </label>
                                                                `
                                                        )
                                                        .join("")}
                                        </div>
                                </div>
                                ${this.renderGroupFilters()}
                                <label class="input-group">
                                        <span>${translate("schedule_send_time")}</span>
                                        <input type="datetime-local" id="announcement-scheduled-at" name="announcement-scheduled-at" />
                                </label>
                                <div class="form-actions">
                                        <button type="submit" id="send-announcement" class="primary" ${this.isSubmitting ? "disabled" : ""}>${translate(
                                                "send_now"
                                        )}</button>
                                        <button type="button" id="save-announcement-draft" ${this.isSubmitting ? "disabled" : ""}>${translate(
                                                "save_draft"
                                        )}</button>
                                </div>
                        </form>
                `;
        }

        renderGroupFilters() {
                if (!Array.isArray(this.groups) || !this.groups.length) {
                        return "";
                }

                return `
                        <div class="input-group">
                                <span>${translate("select_groups")}</span>
                                <div class="group-options">
                                        ${this.groups
                                                .map(
                                                        (group) => `
                                                                <label>
                                                                        <input type="checkbox" name="recipient-group" value="${group.id}" />
                                                                        ${escapeHTML(group.name)}
                                                                </label>
                                                        `
                                                )
                                                .join("")}
                                </div>
                        </div>
                `;
        }

        renderAnnouncementHistory() {
                if (!this.announcements?.length) {
                        return `<p>${translate("no_announcements")}</p>`;
                }

                return `
                        <h2>${translate("announcement_history")}</h2>
                        <div class="announcement-list">
                                ${this.announcements
                                        .map((announcement) => {
                                                const statusLabel = translate(announcement.status) || announcement.status;
                                                const scheduled = announcement.scheduled_at
                                                        ? `${translate("scheduled_for")}: ${this.formatDateTime(announcement.scheduled_at)}`
                                                        : "";
                                                const sent = announcement.sent_at
                                                        ? `${translate("sent_at")}: ${this.formatDateTime(announcement.sent_at)}`
                                                        : "";
                                                const groups = Array.isArray(announcement.recipient_groups)
                                                        ? announcement.recipient_groups
                                                                        .map((id) => this.groups.find((group) => group.id === id)?.name)
                                                                        .filter(Boolean)
                                                        : [];
                                                const logs = Array.isArray(announcement.logs) ? announcement.logs : [];
                                                const deliverySummary = this.getDeliverySummary(logs);
                                                const pushFailureLabel = translate("push_failed").replace(
                                                        "{count}",
                                                        deliverySummary.push.failed
                                                );

                                                return `
                                                        <div class="announcement-item">
                                                                <div class="announcement-meta">
                                                                        <div class="announcement-title">${escapeHTML(announcement.subject)}</div>
                                                                        <div class="announcement-status">${statusLabel}</div>
                                                                </div>
                                                                <div class="announcement-details">
                                                                        <div>${translate("recipient_roles")}: ${
                                                                                announcement.recipient_roles
                                                                                        ?.map((role) => translate(role) || role)
                                                                                        .join(", ") || translate("no_data_available")
                                                                        }</div>
                                                                        ${groups.length
                                                                                ? `<div>${translate("select_groups")}: ${groups
                                                                                                .map((group) => escapeHTML(group))
                                                                                                .join(", ")}</div>`
                                                                                : ""}
                                                                        ${scheduled ? `<div>${scheduled}</div>` : ""}
                                                                        ${sent ? `<div>${sent}</div>` : ""}
                                                                </div>
                                                                <div class="announcement-logs">
                                                                        <strong>${translate("delivery_status_summary")}:</strong>
                                                                        <span class="badge success">${translate("emails")}: ${deliverySummary.email.sent}</span>
                                                                        <span class="badge warning">${translate("failed")}: ${deliverySummary.email.failed}</span>
                                                                        <span class="badge info">${translate("push_notifications")}: ${deliverySummary.push.sent}</span>
                                                                        ${deliverySummary.push.failed
                                                                                ? `<span class="badge warning">${pushFailureLabel}</span>`
                                                                                : ""}
                                                                </div>
                                                                ${logs.length
                                                                        ? `<details>
                                                                                        <summary>${translate("delivery_logs")}</summary>
                                                                                        <ul>
                                                                                                ${logs
                                                                                                        .slice(0, 5)
                                                                                                        .map((log) => `
                                                                                                                <li>
                                                                                                                        ${escapeHTML(log.channel)} - ${escapeHTML(log.status)}
                                                                                                                        ${log.recipient_email ? `(${escapeHTML(log.recipient_email)})` : ""}
                                                                                                                        ${log.error_message ? `: ${escapeHTML(log.error_message)}` : ""}
                                                                                                                </li>
                                                                                                        `)
                                                                                                        .join("")}
                                                                                        </ul>
                                                                                </details>`
                                                                        : ""}
                                                        </div>
                                                `;
                                        })
                                        .join("")}
                        </div>
                `;
        }

        renderMailingList() {
                let html = "";
                const emailsByRole = this.mailingList?.emails_by_role || {};
                const parentEmails = Array.isArray(emailsByRole.parent) ? emailsByRole.parent : [];

                if (!Object.keys(emailsByRole).length) {
                        return `<p>${translate("no_data_available")}</p>`;
                }

                // Group parent emails by their children to avoid duplicate rows when siblings share guardians
                const families = parentEmails.reduce((acc, parent) => {
                        const key = parent.participants || translate("unknown_child");
                        if (!acc[key]) {
                                acc[key] = new Set();
                        }
                        if (parent.email) {
                                acc[key].add(parent.email);
                        }
                        return acc;
                }, {});

                const sortedFamilies = Object.keys(families).sort((a, b) => {
                        const lastNameA = a.split(" ").slice(-1)[0].toLowerCase();
                        const lastNameB = b.split(" ").slice(-1)[0].toLowerCase();
                        return lastNameA.localeCompare(lastNameB);
                });

                html += `<div class="group">
                                                        <div class="group-header">${translate('parents')}</div>
                                                        <div class="group-content compact">`;

                sortedFamilies.forEach((family) => {
                        const emailList = Array.from(families[family]);
                        const familyLabel = family.includes(', ')
                                ? family.replace(', ', ` ${translate('and')} `)
                                : family;

                        html += `
                                <div class="child-group">
                                        <strong>${escapeHTML(familyLabel)}:</strong>
                                        ${emailList.map((email) => `<span class="email-item">${escapeHTML(email)}</span>`).join(", ")}
                                </div>
                        `;
                });

                html += `</div>
                                                 <button class="copy-role-emails" data-role="parent">${translate('copy_emails_for')} ${translate('parents')}</button>
                                                 </div>`;

                // Render other groups (e.g., leaders, administrators, finance)
                Object.entries(emailsByRole).forEach(([role, emails]) => {
                        if (role !== 'parent') {
                                html += `
                                        <div class="group">
                                                <div class="group-header">${translate(role)}</div>
                                                <div class="group-content compact">
                                                        ${this.renderEmails(emails)}
                                                </div>
                                                <button class="copy-role-emails" data-role="${role}">${translate(
                                                        "copy_emails_for"
                                                )} ${translate(role)}</button>
                                        </div>
                                `;
                        }
                });

                return html;
        }

        renderEmails(data) {
                if (!Array.isArray(data)) {
                        data = [data];
                }

                return data
                        .map((item, index) => {
                                let emailHtml = "";
                                let participantsHtml = "";

                                if (typeof item === 'object' && item !== null) {
                                        emailHtml = `<span>${escapeHTML(item.email || '---')}</span>`;
                                        if (item.participants) {
                                                participantsHtml = `<span class="participants">  (${escapeHTML(item.participants)})</span>`;
                                        }
                                } else if (typeof item === 'string') {
                                        emailHtml = `<span>${escapeHTML(item.trim())}</span>`;
                                } else {
                                        debugError(`Unexpected data type for item ${index}:`, typeof item);
                                        emailHtml = `<span>${translate('no_data_available')}</span>`;
                                }

                                return `
                                                <div class="email">
                                                                ${emailHtml}
                                                                ${participantsHtml}
                                                </div>
                                `;
                        })
                        .join('');
        }

        attachEventListeners() {
                document.querySelectorAll(".copy-role-emails").forEach((button) => {
                        button.addEventListener("click", (e) => this.copyRoleEmailsToClipboard(e.target.dataset.role));
                });

                const announcementForm = document.getElementById("announcement-form");
                if (announcementForm) {
                        announcementForm.addEventListener("submit", (event) => {
                                event.preventDefault();
                                this.handleAnnouncementSubmit(false);
                        });
                }

                const draftButton = document.getElementById("save-announcement-draft");
                if (draftButton) {
                        draftButton.addEventListener("click", (event) => {
                                event.preventDefault();
                                this.handleAnnouncementSubmit(true);
                        });
                }

                const templateSelect = document.getElementById("announcement-template");
                if (templateSelect) {
                        templateSelect.addEventListener("change", (event) => this.applyTemplate(event.target.value));
                }
        }

        async handleAnnouncementSubmit(saveAsDraft = false) {
                if (this.isSubmitting) return;

                const subject = document.getElementById("announcement-subject")?.value?.trim();
                const message = document.getElementById("announcement-message")?.value?.trim();
                const scheduledAt = document.getElementById("announcement-scheduled-at")?.value;
                const roleCheckboxes = Array.from(document.querySelectorAll('input[name="recipient-role"]:checked'));
                const groupCheckboxes = Array.from(document.querySelectorAll('input[name="recipient-group"]:checked'));

                const recipientRoles = roleCheckboxes.map((input) => input.value);
                const recipientGroupIds = groupCheckboxes.map((input) => Number(input.value));

                if (!subject || !message) {
                        this.showFeedback(translate("error_loading_mailing_list"), "error");
                        return;
                }

                this.isSubmitting = true;
                this.toggleFormDisabled(true);
                this.showFeedback(translate("announcement_sending"), "info");

                try {
                        const response = await createAnnouncement({
                                subject,
                                message: sanitizeHTML(message, { stripAll: true }),
                                recipient_roles: recipientRoles,
                                recipient_group_ids: recipientGroupIds,
                                scheduled_at: scheduledAt || null,
                                save_as_draft: saveAsDraft,
                                send_now: !saveAsDraft,
                        });

                        if (!response?.success) {
                                throw new Error(response?.message || "Failed to send announcement");
                        }

                        this.announcements = [response.data, ...this.announcements];
                        this.render();
                        this.attachEventListeners();
                        this.showFeedback(
                                saveAsDraft ? translate("announcement_saved") : translate("announcement_sent"),
                                "success"
                        );
                        this.clearForm();
                } catch (error) {
                        debugError("Error sending announcement:", error);
                        this.showFeedback(error.message || translate("announcement_send_failed"), "error");
                } finally {
                        this.isSubmitting = false;
                        this.toggleFormDisabled(false);
                }
        }

        applyTemplate(index) {
                if (!this.templates?.length || index === "") {
                        return;
                }

                const template = this.templates[Number(index)];
                if (!template) {
                        return;
                }

                const subjectField = document.getElementById("announcement-subject");
                const messageField = document.getElementById("announcement-message");

                if (subjectField) subjectField.value = template.subject || "";
                if (messageField) messageField.value = template.body || "";
        }

        toggleFormDisabled(disabled) {
                const form = document.getElementById("announcement-form");
                if (!form) return;

                Array.from(form.elements).forEach((element) => {
                        element.disabled = disabled;
                });
        }

        clearForm() {
                const form = document.getElementById("announcement-form");
                if (!form) return;
                form.reset();
        }

        showFeedback(message, type = "info") {
                const feedbackEl = document.getElementById("announcement-feedback");
                if (!feedbackEl) return;
                feedbackEl.textContent = message;
                feedbackEl.className = `status-message ${type}`;
        }

        getDeliverySummary(logs) {
                const summary = {
                        email: { sent: 0, failed: 0 },
                        push: { sent: 0, failed: 0 },
                };

                logs.forEach((log) => {
                        if (log.channel === "email") {
                                if (log.status === "sent") summary.email.sent += 1;
                                if (log.status === "failed") summary.email.failed += 1;
                        }
                        if (log.channel === "push") {
                                if (log.status === "sent") summary.push.sent += 1;
                                if (log.status === "failed") summary.push.failed += 1;
                        }
                });

                return summary;
        }

        formatDateTime(dateString) {
                if (!dateString) return "";
                try {
                        const lang = this.app?.lang || this.app?.language || localStorage.getItem('lang') || localStorage.getItem('language') || CONFIG.DEFAULT_LANG;
                        const locale = lang === 'en' ? 'en-CA' : lang === 'uk' ? 'uk-UA' : 'fr-CA';
                        return new Date(dateString).toLocaleString(locale);
                } catch (error) {
                        debugLog("Unable to format date", error);
                        return dateString;
                }
        }

        copyRoleEmailsToClipboard(role) {
                const emailsByRole = this.mailingList?.emails_by_role || {};
                const emails = emailsByRole[role] || [];

                let emailString;
                if (role === 'parent') {
                        const uniqueParentEmails = [...new Set(emails.map((entry) => entry.email))];
                        emailString = uniqueParentEmails.join(", ");
                } else {
                        const uniqueRoleEmails = [...new Set(emails)];
                        emailString = uniqueRoleEmails.join(", ");
                }

                if (!emailString) {
                        alert(translate("no_data_available"));
                        return;
                }

                navigator.clipboard
                        .writeText(emailString)
                        .then(() => {
                                alert(`${translate("emails_copied_to_clipboard_for")} ${translate(role)}`);
                        })
                        .catch((error) => {
                                debugError("Failed to copy emails:", error);
                        });
        }

        renderError() {
                const errorMessage = `
                                                <h1>${translate("error")}</h1>
                                                <p>${translate("error_loading_mailing_list")}</p>
                                `;
                setContent(document.getElementById("app"), errorMessage);
        }
}
