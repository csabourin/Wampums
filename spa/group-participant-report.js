import { getParticipants, getGroups } from "./ajax-functions.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { normalizeParticipantList } from "./utils/ParticipantRoleUtils.js";

export class PrintableGroupParticipantReport {
		constructor(app) {
				this.app = app;
				this.participants = [];
				this.groups = [];
		}

		async init() {
				try {
						await this.fetchData();
				} catch (error) {
						debugError("Error loading report data:", error);
						// Continue rendering even if some data failed to load
						this.app.showMessage(translate("error_loading_data"), "warning");
				}

				// Always render the page, even with partial data
				try {
						this.render();
						this.attachEventListeners();
				} catch (error) {
						debugError("Error rendering report:", error);
						this.renderError();
				}
		}

		async fetchData() {
				// Load data with individual error handling to prevent total failure
				const [participantsResponse, groupsResponse] = await Promise.all([
						getParticipants().catch(error => {
								debugError("Error loading participants:", error);
								return { data: [] };
						}),
						getGroups().catch(error => {
								debugError("Error loading groups:", error);
								return { data: [] };
						})
				]);

				// Support both new format (data) and old format (participants/groups)
				this.participants = normalizeParticipantList(
          participantsResponse.data || participantsResponse.participants || []
        );
				this.groups = groupsResponse.data || groupsResponse.groups || [];

				// Sort groups alphabetically
				if (Array.isArray(this.groups)) {
						this.groups.sort((a, b) => a.name.localeCompare(b.name));
				}
		}

		render() {
				const content = `
						<div class="report-container">
								<a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
								<h1>${translate("den_list_report")}</h1>
								<div id="report-content">
										${this.renderTable()}
								</div>
								<button id="print-report">${translate("print_report")}</button>
								<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
						</div>
				`;
				document.getElementById("app").innerHTML = content;

				const style = `
						<style>
								@media print {
										body * { visibility: hidden; }
										.report-container, .report-container * { visibility: visible; }
										.report-container { position: absolute; left: 0; top: 0; }
										#print-report, a { display: none; }
								}
								.report-container { font-family: Arial, sans-serif; font-size: 13px; }
								table { width: 8.25in; border-collapse: collapse; }
								th, td { border: 1px solid #ddd; padding: 4px; text-align: left; }
								th { background-color: #f2f2f2; font-weight: bold; }
								tr:nth-child(even) { background-color: #f9f9f9; }
								h1 { font-size: 18px; margin-bottom: 10px; }
								h2 { font-size: 16px; margin: 10px 0 5px; }
						</style>
				`;
				document.head.insertAdjacentHTML('beforeend', style);
		}

		renderTable() {
				return `
						<table>
								<thead>
										<tr>
												<th>${translate("Tannière")}</th>
												<th>${translate("")}</th>
												<th>${translate("")}</th>
										</tr>
								</thead>
								<tbody>
										${this.renderTableRows()}
								</tbody>
						</table>
				`;
		}

		renderTableRows() {
				return this.groups.map(group => {
						const groupParticipants = this.participants.filter(p => p.group_id === group.id);
						groupParticipants.sort((a, b) => {
								if (a.first_leader) return -1;
								if (b.first_leader) return 1;
								if (a.second_leader) return 1;
								if (b.second_leader) return -1;
								return a.first_name.localeCompare(b.first_name);
						});

						return groupParticipants.map((participant, index) => `
								<tr>
										${index === 0 ? `<td rowspan="${groupParticipants.length}">${group.name}</td>` : ''}
										<td>${participant.first_name} ${participant.last_name}</td>
										<td>
												${participant.first_leader ? `<strong>${translate("leader")}</strong>` : 
													participant.second_leader ? `<strong>${translate("second_leader")}</strong>` : ""}
										</td>
								</tr>
						`).join('');
				}).join('');
		}

		attachEventListeners() {
				document.getElementById("print-report").addEventListener("click", () => window.print());
		}

		renderError() {
				const errorMessage = `
						<h1>${translate("error")}</h1>
						<p>${translate("error_loading_group_participant_report")}</p>
						<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
				`;
				document.getElementById("app").innerHTML = errorMessage;
		}
}
