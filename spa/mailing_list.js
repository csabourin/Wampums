import { getMailingList } from "./ajax-functions.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";

export class MailingList {
	constructor(app) {
		this.app = app;
		this.mailingList = {};
	}

        async init() {
                if (this.app.userRole !== "admin" && this.app.userRole !== "animation") {
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
                try {
                        const response = await getMailingList();

                        if (!response?.success || !response.emails_by_role) {
                                throw new Error(response?.message || "Invalid mailing list response");
                        }

                        this.mailingList = response;
                } catch (error) {
                        debugError("Error fetching mailing list:", error);
                        throw error;
                }
        }

	render() {
		const content = `
						<h1>${translate("mailing_list")}</h1>
						<div id="mailing-list">
								${this.renderMailingList()}
						</div>
						<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
				`;
		document.getElementById("app").innerHTML = content;
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
                                        <strong>${familyLabel}:</strong>
                                        ${emailList.map(email => `<span class="email-item">${email}</span>`).join(", ")}
                                </div>
                        `;
                });

                html += `</div>
                                                 <button class="copy-role-emails" data-role="parent">${translate('copy_emails_for')} ${translate('parents')}</button>
                                                 </div>`;

                // Render other groups (e.g., animation and admin)
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
                        debugLog('Data received:', JSON.stringify(data, null, 2));

                        if (!Array.isArray(data)) {
                                        debugError('Data is not an array. Converting to array.');
                                        data = [data];
                        }

			return data.map((item, index) => {
					debugLog(`Processing item ${index}:`, JSON.stringify(item, null, 2));

					let emailHtml = '';
					let participantsHtml = '';

					if (typeof item === 'object' && item !== null) {
							emailHtml = `<span>${item.email || '---'}</span>`;
							if (item.participants) {
									participantsHtml = `<span class="participants">  (${item.participants})</span>`;
							}
					} else if (typeof item === 'string') {
							emailHtml = `<span>${item.trim()}</span>`;
					} else {
							debugError(`Unexpected data type for item ${index}:`, typeof item);
							emailHtml = `<span>Données invalides</span>`;
					}

					return `
							<div class="email">
									${emailHtml}
									${participantsHtml}
							</div>
					`;
			}).join('');
	}



	attachEventListeners() {
		// Add click listener for each copy button
		document.querySelectorAll(".copy-role-emails").forEach((button) => {
			button.addEventListener("click", (e) =>
				this.copyRoleEmailsToClipboard(e.target.dataset.role)
			);
		});
	}

        copyRoleEmailsToClipboard(role) {
                const emailsByRole = this.mailingList?.emails_by_role || {};
                const emails = emailsByRole[role] || [];

                let emailString;
                if (role === 'parent') {
                        // Only copy the emails for the parent group and deduplicate them
                        const uniqueParentEmails = [...new Set(emails.map((entry) => entry.email))];
                        emailString = uniqueParentEmails.join(", ");
                } else {
                        // For other groups, copy the emails directly
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
		document.getElementById("app").innerHTML = errorMessage;
	}
}
