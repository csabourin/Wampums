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
			this.mailingList = await getMailingList();
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
		const groupedByChildren = {};

		// Group emails by participants (children)
		this.mailingList.emails_by_role['parent'].forEach((parent) => {
			if (parent.participants) {
				const children = parent.participants.split(", ");
				children.forEach((child) => {
					if (!groupedByChildren[child]) {
						groupedByChildren[child] = [];
					}
					groupedByChildren[child].push(parent.email);
				});
			} else {
				// If no participants, put parent in an "Unknown" group
				if (!groupedByChildren["Unknown"]) {
					groupedByChildren["Unknown"] = [];
				}
				groupedByChildren["Unknown"].push(parent.email);
			}
		});

		// Sort participants (children) by last name
		const sortedChildren = Object.keys(groupedByChildren).sort((a, b) => {
			const lastNameA = a.split(" ").slice(-1)[0].toLowerCase();
			const lastNameB = b.split(" ").slice(-1)[0].toLowerCase();
			return lastNameA.localeCompare(lastNameB);
		});

		// Render parent group (grouped by children)
		html += `<div class="group">
							<div class="group-header">${translate('parents')}</div>
							<div class="group-content compact">`;

		sortedChildren.forEach((child) => {
			html += `
				<div class="child-group">
					<strong>${child}:</strong>
					${groupedByChildren[child].map(email => `<span class="email-item">${email}</span>`).join(", ")}
				</div>
			`;
		});

		html += `</div>
						 <button class="copy-role-emails" data-role="parent">${translate('copy_emails_for')} ${translate('parents')}</button>
						 </div>`;

		// Render other groups (e.g., animation and admin)
		Object.entries(this.mailingList.emails_by_role).forEach(([role, emails]) => {
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
		const emails = this.mailingList.emails_by_role[role];

		let emailString;
		if (role === 'parent') {
			// Only copy the emails for the parent group
			emailString = emails.map((entry) => entry.email).join(", ");
		} else {
			// For other groups, copy the emails directly
			emailString = emails.join(", ");
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
