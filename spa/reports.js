// reports.js
import { translate } from "./app.js";
import {
	debugLog,
	debugError,
	debugWarn,
	debugInfo,
} from "./utils/DebugUtils.js";
import {
	getHealthReport,
	getAllergiesReport,
	getMedicationReport,
	getVaccineReport,
	getLeaveAloneReport,
	getMediaAuthorizationReport,
	getMissingDocumentsReport,
	getAttendanceReport,
	getHonorsReport,
	getPointsReport,
	getParticipantProgressReport,
	getParticipantAgeReport,
	getFormStructure,
	getFormSubmissions,
	getFormTypes,
	getFinanceReport,
} from "./ajax-functions.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDateShort, isoToDateString } from "./utils/DateUtils.js";
import { canViewReports } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

const REPORT_CURRENCY = "CAD";

export class Reports {
  constructor(app) {
		this.app = app;
		this.participantList = [];
		this.selectedParticipantId = null;
		this.participantProgressCache = new Map();
	}

	async init() {
		if (!canViewReports()) {
			this.app.router.navigate("/");
			return;
		}

		this.render();
		await this.loadFormTypes(); // Load form types after rendering the page
		this.attachEventListeners();
	}

	render() {
		const content = `
                        <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                        <section class="reports-header">
                                <p class="reports-kicker">${translate("reports")}</p>
                                <h1>${translate("reports_title")}</h1>
                                <p class="reports-subtitle">${translate("reports_intro")}</p>
                        </section>

                        <!-- Health & Medical Section -->
                        <section class="report-category">
                                <h2 class="report-category-title">${translate("health_medical_category")}</h2>
                                <div class="reports-menu-grid" role="menu" aria-label="${translate("health_medical_category")}">
                                        <button class="report-btn" data-report="health" type="button">
                                                <span class="report-btn-icon">🏥</span>
                                                <span class="report-btn-label">${translate("health_report_title")}</span>
                                                <span class="report-btn-desc">${translate("health_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="allergies" type="button">
                                                <span class="report-btn-icon">⚠️</span>
                                                <span class="report-btn-label">${translate("allergies_report_title")}</span>
                                                <span class="report-btn-desc">${translate("allergies_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="medication" type="button">
                                                <span class="report-btn-icon">💊</span>
                                                <span class="report-btn-label">${translate("medication_report_title")}</span>
                                                <span class="report-btn-desc">${translate("medication_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="vaccines" type="button">
                                                <span class="report-btn-icon">💉</span>
                                                <span class="report-btn-label">${translate("vaccine_report_title")}</span>
                                                <span class="report-btn-desc">${translate("vaccine_report_desc")}</span>
                                        </button>
                                </div>
                        </section>

                        <!-- Permissions & Documents Section -->
                        <section class="report-category">
                                <h2 class="report-category-title">${translate("permissions_documents_category")}</h2>
                                <div class="reports-menu-grid" role="menu" aria-label="${translate("permissions_documents_category")}">
                                        <button class="report-btn" data-report="leave-alone" type="button">
                                                <span class="report-btn-icon">🚶</span>
                                                <span class="report-btn-label">${translate("leave_alone_report_title")}</span>
                                                <span class="report-btn-desc">${translate("leave_alone_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="media-authorization" type="button">
                                                <span class="report-btn-icon">📸</span>
                                                <span class="report-btn-label">${translate("media_authorization_report_title")}</span>
                                                <span class="report-btn-desc">${translate("media_authorization_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="missing-documents" type="button">
                                                <span class="report-btn-icon">📋</span>
                                                <span class="report-btn-label">${translate("missing_documents_report_title")}</span>
                                                <span class="report-btn-desc">${translate("missing_documents_report_desc")}</span>
                                        </button>
                                </div>
                        </section>

                        <!-- Attendance & Participation Section -->
                        <section class="report-category">
                                <h2 class="report-category-title">${translate("attendance_participation_category")}</h2>
                                <div class="reports-menu-grid" role="menu" aria-label="${translate("attendance_participation_category")}">
                                        <button class="report-btn" data-report="attendance" type="button">
                                                <span class="report-btn-icon">✓</span>
                                                <span class="report-btn-label">${translate("attendance_report_title")}</span>
                                                <span class="report-btn-desc">${translate("attendance_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="participant-age" type="button">
                                                <span class="report-btn-icon">🎂</span>
                                                <span class="report-btn-label">${translate("participant_age_report_title")}</span>
                                                <span class="report-btn-desc">${translate("participant_age_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="time-since-registration" type="button">
                                                <span class="report-btn-icon">📅</span>
                                                <span class="report-btn-label">${translate("time_since_registration_report_title")}</span>
                                                <span class="report-btn-desc">${translate("time_since_registration_report_desc")}</span>
                                        </button>
                                </div>
                        </section>

                        <!-- Progression & Recognition Section -->
                        <section class="report-category">
                                <h2 class="report-category-title">${translate("progression_recognition_category")}</h2>
                                <div class="reports-menu-grid" role="menu" aria-label="${translate("progression_recognition_category")}">
                                        <button class="report-btn report-btn--featured" data-report="participant-progress" type="button">
                                                <span class="report-btn-icon">📊</span>
                                                <span class="report-btn-label">${translate("participant_progress_report_title")}</span>
                                                <span class="report-btn-desc">${translate("participant_progress_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="honors" type="button">
                                                <span class="report-btn-icon">🏆</span>
                                                <span class="report-btn-label">${translate("honors_report_title")}</span>
                                                <span class="report-btn-desc">${translate("honors_report_desc")}</span>
                                        </button>
                                        <button class="report-btn" data-report="points" type="button">
                                                <span class="report-btn-icon">⭐</span>
                                                <span class="report-btn-label">${translate("points_report_title")}</span>
                                                <span class="report-btn-desc">${translate("points_report_desc")}</span>
                                        </button>
                                </div>
                        </section>

                        <!-- Financial Section -->
                        <section class="report-category">
                                <h2 class="report-category-title">${translate("financial_category")}</h2>
                                <div class="reports-menu-grid" role="menu" aria-label="${translate("financial_category")}">
                                        <button class="report-btn" data-report="financial" type="button">
                                                <span class="report-btn-icon">💰</span>
                                                <span class="report-btn-label">${translate("financial_report_title")}</span>
                                                <span class="report-btn-desc">${translate("financial_report_desc")}</span>
                                        </button>
                                </div>
                        </section>

                        <!-- Advanced Reports Section -->
                        <section class="report-category report-category--advanced">
                                <details class="report-advanced-toggle">
                                        <summary class="report-advanced-summary">
                                                <h2 class="report-category-title">${translate("advanced_reports_category")}</h2>
                                                <span class="report-advanced-icon">▼</span>
                                        </summary>
                                        <div class="report-advanced-content">
                                                <p class="report-advanced-desc">${translate("advanced_reports_desc")}</p>
                                                <div class="form-field">
                                                        <label for="form-type-select">${translate("missing_fields_form_selector_label")}</label>
                                                        <select id="form-type-select" class="form-control">
                                                                <option value="">${translate("select_form_type")}</option>
                                                        </select>
                                                        <small class="form-help">${translate("missing_fields_form_selector_help")}</small>
                                                </div>
                                        </div>
                                </details>
                        </section>

                        <!-- Report Modal -->
                        <div id="report-modal" class="report-modal hidden" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
                                <div class="report-modal-overlay" id="report-modal-overlay"></div>
                                <div class="report-modal-container">
                                        <div class="report-modal-header">
                                                <h2 id="report-modal-title" class="report-modal-title"></h2>
                                                <div class="report-modal-actions">
                                                        <button id="print-report" class="button button--secondary" type="button">
                                                                <span class="button-icon">🖨️</span>
                                                                ${translate("print_report")}
                                                        </button>
                                                        <button id="close-report-modal" class="button button--ghost close" type="button" aria-label="${translate("close")}">
                                                                <span class="button-icon">✕</span>
                                                        </button>
                                                </div>
                                        </div>
                                        <div class="report-modal-content" id="report-content" aria-live="polite"></div>
                                </div>
                        </div>
                `;
		setContent(document.getElementById("app"), content);
	}

	attachEventListeners() {
		document.querySelectorAll(".report-btn").forEach((button) => {
			button.addEventListener("click", (e) => {
				const reportType = e.target.closest(".report-btn").dataset.report;
				this.loadReport(reportType);
			});
		});

		// Modal close handlers
		const closeModalBtn = document.getElementById("close-report-modal");
		const modalOverlay = document.getElementById("report-modal-overlay");

		closeModalBtn?.addEventListener("click", () => this.closeReportModal());
		modalOverlay?.addEventListener("click", () => this.closeReportModal());

		// ESC key to close modal
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				const modal = document.getElementById("report-modal");
				if (modal && !modal.classList.contains("hidden")) {
					this.closeReportModal();
				}
			}
		});

		document
			.getElementById("print-report")
			?.addEventListener("click", () => this.printReport());
	}

	openReportModal(title) {
		const modal = document.getElementById("report-modal");
		const modalTitle = document.getElementById("report-modal-title");

		if (!modal || !modalTitle) {
			debugWarn("Report modal elements missing");
			return;
		}

		modalTitle.textContent = title;
		modal.classList.remove("hidden");
		modal.setAttribute("aria-hidden", "false");
		document.body.style.overflow = "hidden"; // Prevent background scrolling
	}

	closeReportModal() {
		const modal = document.getElementById("report-modal");
		if (!modal) {
			return;
		}

		modal.classList.add("hidden");
		modal.setAttribute("aria-hidden", "true");
		document.body.style.overflow = ""; // Restore scrolling
	}

	async loadFormTypes() {
		try {
			const response = await getFormTypes(); // Fetch form types

			debugLog("Fetched form types:", response); // Check if data is correctly fetched

			const selectElement = document.getElementById("form-type-select");

			if (!response || !response.data || response.data.length === 0) {
				setContent(selectElement, `<option value="">${translate("no_form_types_available")}</option>`);
				return;
			}

			response.data.forEach((formType) => {
				const option = document.createElement("option");
				option.value = formType;
				option.textContent = formType; // You may use a translated or user-friendly name here
				selectElement.appendChild(option);
			});

			// Add event listener to handle report loading when form type is selected
			selectElement.addEventListener("change", async () => {
				const selectedFormType = selectElement.value;
				if (selectedFormType) {
					await this.loadReport("missing-fields", selectedFormType);
				}
			});
		} catch (error) {
			debugError("Error loading form types:", error);
			setContent(document.getElementById("form-type-container"), `<p>${translate("error_loading_form_types")}</p>`);
		}
	}

	async loadReport(reportType, formType = null) {
		try {
			// Get report title for modal
			const reportTitles = {
				health: translate("health_report_title"),
				allergies: translate("allergies_report_title"),
				medication: translate("medication_report_title"),
				vaccines: translate("vaccine_report_title"),
				"leave-alone": translate("leave_alone_report_title"),
				"media-authorization": translate("media_authorization_report_title"),
				"missing-documents": translate("missing_documents_report_title"),
				attendance: translate("attendance_report_title"),
				"participant-age": translate("participant_age_report_title"),
				honors: translate("honors_report_title"),
				points: translate("points_report_title"),
				financial: translate("financial_report_title"),
				"participant-progress": translate("participant_progress_report_title"),
				"missing-fields": translate("missing_fields_report"),
			};

			// Open modal with report title
			this.openReportModal(reportTitles[reportType] || translate("report"));

			let reportData;
			let reportContent;

			switch (reportType) {
				case "health":
					reportContent = await this.fetchAndRenderHealthReport(); // Now we get the report content
					break;
				case "missing-fields":
					reportContent =
						await this.fetchAndRenderMissingFieldsReport(formType); // Pass the form type
					break;
				case "allergies":
					reportData = await getAllergiesReport();
					reportContent = this.renderAllergiesReport(reportData.data);
					break;
				case "medication":
					reportData = await getMedicationReport();
					reportContent = this.renderMedicationReport(reportData.data);
					break;
				case "vaccines":
					reportData = await getVaccineReport();
					reportContent = this.renderVaccineReport(reportData.data);
					break;
				case "leave-alone":
					reportData = await getLeaveAloneReport();
					reportContent = this.renderLeaveAloneReport(reportData.data);
					break;
				case "media-authorization":
					reportData = await getMediaAuthorizationReport();
					reportContent = this.renderMediaAuthorizationReport(reportData.data);
					break;
				case "missing-documents":
					reportData = await getMissingDocumentsReport();
					reportContent = this.renderMissingDocumentsReport(reportData.data);
					break;
				case "attendance":
					reportData = await getAttendanceReport();
					debugLog("Received attendance report data:", reportData); // Add this line for debugging
					if (!reportData) {
						throw new Error("No data received from getAttendanceReport");
					}
					reportContent = this.renderAttendanceReport(reportData);
					break;
				case "honors":
					reportData = await getHonorsReport();
					reportContent = this.renderHonorsReport(reportData.data);
					break;
				case "participant-age":
					reportData = await getParticipantAgeReport(); // Fetch the report data
					reportContent = this.renderParticipantAgeReport(
						reportData.participants,
					);
					break;
				case "points":
					reportData = await getPointsReport();
					reportContent = this.renderPointsReport(reportData.data);
					break;
				case "financial":
					reportData = await getFinanceReport();
					reportContent = this.renderFinancialReport(reportData.data);
					break;
				case "time-since-registration":
					// Navigate to the dedicated time since registration page
					this.app.router.navigate("/time-since-registration");
					return; // Exit early since we're navigating away
				case "participant-progress":
					reportContent = await this.fetchAndRenderParticipantProgress();
					break;
				default:
					reportContent = "<p>Invalid report type</p>";
			}

			setContent(document.getElementById("report-content"), reportContent);
			if (reportType === "participant-progress") {
				this.attachParticipantProgressListeners();
			}
		} catch (error) {
			debugError(`Error loading ${reportType} report:`, error);
			setContent(document.getElementById("report-content"), `
				<p class="error-message">${translate("error_loading_report")}: ${escapeHTML(error.message)}</p>
			`);
		}
	}

	async fetchAndRenderHealthReport() {
		try {
			// Fetch the health report data
			const reportData = await getHealthReport(); // Assuming getHealthReport is defined in ajax-functions.js

			if (!reportData.success) {
				throw new Error(reportData.error || "Failed to fetch health report");
			}

			// Filter out participants with all empty fields
			const filteredParticipants = reportData.data.filter((participant) => {
				return !(
					!participant.epipen &&
					!participant.allergies &&
					!participant.health_issues &&
					!participant.injuries &&
					!participant.swimming_level &&
					!participant.leave_alone &&
					!participant.media_consent
				);
			});

			// Sort participants by last name
			const sortedParticipants = filteredParticipants.sort((a, b) =>
				a.last_name.localeCompare(b.last_name),
			);

			// Render the report and return the content
			const reportContent = this.renderHealthReport(sortedParticipants);
			return reportContent; // Return the generated reportContent
		} catch (error) {
			debugError("Error fetching and rendering health report:", error);
			return `<p class="error-message">${translate("error_loading_report")}: ${escapeHTML(error.message)}</p>`;
		}
	}

	renderHealthReport(participants) {
		let tableContent = `
					<table class="health-report-table">
							<thead>
									<tr>
											<th>${translate("name")}</th>
											<th>${translate("leave_alone")}</th>
											<th>${translate("media_consent")}</th>
											<th>${translate("health_information")}</th>
									</tr>
							</thead>
							<tbody>
			`;

		participants.forEach((participant) => {
			const epipen =
				participant.epipen === "1" ||
				participant.epipen === "true" ||
				participant.epipen === true
					? "<strong> EPIPEN </strong>"
					: "";
			const leaveAlone =
				participant.leave_alone === "1" ||
				participant.leave_alone === "true" ||
				participant.leave_alone === true
					? "🗸"
					: "";
			const mediaConsent =
				participant.media_consent === "1" ||
				participant.media_consent === "true" ||
				participant.media_consent === true
					? ""
					: "🚫"; // Show 🚫 if no media consent

			// Health information fields, only showing the ones that are not empty
			let healthInfo = "";
			if (participant.health_issues)
				healthInfo += `<strong>${translate("health_issues")}:</strong> ${participant.health_issues}<br>`;
			if (participant.allergies)
				healthInfo += `<strong>${translate("allergies")}:</strong> ${participant.allergies} ${epipen}<br>`;
			if (participant.injuries)
				healthInfo += `<strong>${translate("injuries")}:</strong> ${participant.injuries}<br>`;

			// Show swimming level, but life jacket note only for "ne_sait_pas_nager"
			if (participant.swimming_level === "ne_sait_pas_nager") {
				healthInfo += `<strong>${translate("swimming_level")}:</strong> ${translate("doit_porter_vfi")}<br>`;
			} else if (participant.swimming_level === "eau_peu_profonde") {
				healthInfo += `<strong>${translate("swimming_level")}:</strong> ${translate("eau_peu_profonde")}<br>`;
			}

			// Only display rows where there's at least one relevant piece of info
			if (leaveAlone || mediaConsent || healthInfo) {
				tableContent += `
									<tr>
											<td><strong>${participant.first_name} ${participant.last_name}</strong></td>
											<td>${leaveAlone}</td>
											<td>${mediaConsent}</td>
											<td>${healthInfo || ""}</td>
									</tr>
							`;
			}
		});

		tableContent += `
							</tbody>
					</table>
			`;

		return tableContent;
	}

	async fetchAndRenderMissingFieldsReport(formType) {
		try {
			if (!formType) {
				throw new Error("Form type is required");
			}

			// Parallelize independent API calls for better performance
			const [response, formStructure] = await Promise.all([
				getFormSubmissions(null, formType), // Fetch submissions for all participants for the selected form type
				getFormStructure() // Get all form structures
			]);

			if (!response || !response.data) {
				throw new Error("No form submissions found");
			}

			if (!formStructure || !formStructure.data) {
				throw new Error("No form structure found");
			}

			const missingFieldsReport = this.generateMissingFieldsReport(
				response.data,
				formStructure.data,
				formType,
			);

			return missingFieldsReport;
		} catch (error) {
			debugError("Error fetching or rendering missing fields report:", error);
			return `<p>${translate("error_loading_report")}: ${escapeHTML(error.message)}</p>`;
		}
	}

	generateMissingFieldsReport(submissions, formStructures, formType) {
		let reportContent = "<h2>" + translate("missing_fields_report") + "</h2>";
		reportContent +=
			"<table><thead><tr><th>" +
			translate("name") +
			"</th><th>" +
			translate("missing_fields") +
			"</th></tr></thead><tbody>";

		submissions.forEach((submission) => {
			const formTypeData = formStructures[formType]; // Get the form type data

			// Extract the actual form structure (which contains the fields array)
			const formStructure = formTypeData?.form_structure;

			if (!formStructure || !formStructure.fields) {
				debugError("Invalid form structure for form type:", formType);
				return; // Skip this submission if form structure is invalid
			}

			// Get the participant's first and last name (assuming they're available in the submission_data)
			const firstName = submission.first_name || "-";
			const lastName = submission.last_name || "-";

			// Get missing fields
			const missingFields = this.getMissingFields(
				submission.submission_data,
				formStructure,
			).map((field) => translate(field));

			if (missingFields.length > 0) {
				reportContent += `<tr><td>${firstName} ${lastName}</td><td>${missingFields.join(", ")}</td></tr>`;
			}
		});

		reportContent += "</tbody></table>";
		return reportContent;
	}

	getMissingFields(submissionData, formStructure) {
		const missingFields = [];

		formStructure.fields.forEach((field) => {
			// Check if the field is required and missing in the submission data
			if (field.required && !submissionData[field.name]) {
				// If the field has a dependency, only add it if the dependency condition is met
				if (field.dependsOn) {
					const dependencyField = submissionData[field.dependsOn.field];
					if (dependencyField === field.dependsOn.value) {
						missingFields.push(field.name);
					}
				} else {
					// If no dependency, simply add it as missing
					missingFields.push(field.name);
				}
			}
		});

		return missingFields;
	}

	checkRequiredFields(formStructure, submissionData) {
		const missingFields = [];

		formStructure.fields.forEach((field) => {
			const fieldName = field.name;
			const required = field.required;

			// Check if field depends on another field
			if (field.dependsOn) {
				const dependsOnField = field.dependsOn.field;
				const dependsOnValue = field.dependsOn.value;
				// If the condition is not met, the field is not required
				if (submissionData[dependsOnField] !== dependsOnValue) {
					return;
				}
			}

			// Check if required field is missing in submission
			if (required && !submissionData[fieldName]) {
				missingFields.push(fieldName);
			}
		});

		return missingFields;
	}

	renderAllergiesReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate("no_data_available")} for allergies report.</p>`;
		}

		return `
			<h2>${translate("allergies_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("allergies")}</th>
						<th>${translate("epipen")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${item.allergies || "-"}</td>
							<td>${item.epipen === "on" || item.epipen === "true" || item.epipen === true ? translate("yes") : translate("no")}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderMedicationReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate("no_data_available")} for medication report.</p>`;
		}

		return `
			<h2>${translate("medication_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("medication")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${item.medication || "-"}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderVaccineReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate("no_data_available")} report.</p>`;
		}

		return `
			<h2>${translate("vaccine_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("vaccines_up_to_date")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${item.vaccines_up_to_date === "on" || item.vaccines_up_to_date === "true" || item.vaccines_up_to_date === true ? translate("yes") : translate("no")}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderParticipantAgeReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return "<p>No data available for participants age report.</p>";
		}

		return `
			<h2>${translate("participant_age_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("birthdate")}</th>
						<th>${translate("age")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.date_naissance ? new Date(item.date_naissance).toLocaleDateString() : translate("unknown")}</td>
							<td>${item.age !== null ? item.age : translate("unknown")}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderLeaveAloneReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return "<p>No data available for leave alone report.</p>";
		}

		return `
			<h2>${translate("leave_alone_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("can_leave_alone")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${item.can_leave_alone === "on" || item.can_leave_alone === "true" || item.can_leave_alone === true ? translate("yes") : translate("no")}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderMediaAuthorizationReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return "<p>No data available for media authorization report.</p>";
		}

		return `
			<h2>${translate("media_authorization_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("media_authorized")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${item.media_authorized === "on" || item.media_authorized === "true" || item.media_authorized === true ? translate("yes") : translate("no")}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderMissingDocumentsReport(reportData) {
		if (!Array.isArray(reportData) || reportData.length === 0) {
			return "<p>No data available for missing documents report.</p>";
		}

		return `
			<h2>${translate("missing_documents_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("missing_documents")}</th>
					</tr>
				</thead>
				<tbody>
					${reportData
						.map(
							(item) => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${this.formatMissingDocuments(item.missing_documents)}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	formatMissingDocuments(missingDocs) {
		if (Array.isArray(missingDocs)) {
			return missingDocs.join(", ");
		} else if (typeof missingDocs === "object" && missingDocs !== null) {
			return Object.values(missingDocs).join(", ");
		} else {
			return translate("no_missing_documents");
		}
	}

	// renderAttendanceReport(data) {
	// 	debugLog("Rendering attendance report with data:", data); // Add this line for debugging

	// 	if (!data || typeof data !== 'object') {
	// 		debugError("Invalid data received in renderAttendanceReport:", data);
	// 		return '<p>Error: Invalid data received for attendance report.</p>';
	// 	}

	// 	if (!data.success || !Array.isArray(data.attendance_data) || data.attendance_data.length === 0) {
	// 		return '<p>No data available for attendance report.</p>';
	// 	}

	// 	return `
	// 		<h2>${translate("attendance_report")}</h2>
	// 		<p>${translate("report_period")}: ${data.start_date} to ${data.end_date}</p>
	// 		<p>${translate("total_days")}: ${data.total_days}</p>
	// 		<table>
	// 			<thead>
	// 				<tr>
	// 					<th>${translate("name")}</th>
	// 					<th>${translate("group")}</th>
	// 					<th>${translate("total_days")}</th>
	// 					<th>${translate("days_absent")}</th>
	// 					<th>${translate("days_late")}</th>
	// 				</tr>
	// 			</thead>
	// 			<tbody>
	// 				${data.attendance_data.map(item => `
	// 					<tr>
	// 						<td>${item.first_name} ${item.last_name}</td>
	// 						<td>${item.group_name || translate("no_group")}</td>
	// 						<td>${item.total_days}</td>
	// 						<td>${item.days_absent}</td>
	// 						<td>${item.days_late}</td>
	// 					</tr>
	// 				`).join('')}
	// 			</tbody>
	// 		</table>
	// 	`;
	// }
	renderAttendanceReport(data) {
		if (!data || typeof data !== "object") {
			return "<p>Error: Invalid data received for attendance report.</p>";
		}

		// Fix: Access data.data instead of data.attendance_data
		const attendanceData = data.data || [];

		if (
			!data.success ||
			!Array.isArray(attendanceData) ||
			attendanceData.length === 0
		) {
			return "<p>No data available for attendance report.</p>";
		}

		// Define color codes for the attendance statuses
		const statusColors = {
			P: "#FFFFFF", // No color for Present
			A: "#FF0000", // Red for Absent
			M: "#00BFFF", // Blue for Motivated (excused)
			R: "#FFFF00", // Yellow for Late
		};

		// Normalize status mappings
		const normalizeStatus = (status) => {
			switch (status) {
				case "present":
					return "P"; // Present
				case "absent":
					return "A"; // Absent
				case "excused":
				case "motivated":
					return "M"; // Motivated
				case "late":
					return "R"; // Late
				default:
					return ""; // Unknown status
			}
		};

		// Get unique dates from attendance data
		let uniqueDates = new Set();
		attendanceData.forEach((item) => {
			// Fix: attendance is already an array, not a JSON string
			const attendanceArray = item.attendance || [];

			if (Array.isArray(attendanceArray)) {
				attendanceArray.forEach((attendance) => {
					if (attendance.date) {
						uniqueDates.add(isoToDateString(attendance.date));
					}
				});
			} else {
				debugError(
					`Invalid attendance data for ${item.first_name} ${item.last_name}:`,
					item.attendance,
				);
			}
		});
		uniqueDates = Array.from(uniqueDates).sort(); // Convert Set to Array and sort the dates

		// Create the header
		let header = `
					<h2>${translate("attendance_report")}</h2>
					<table class="attendance-table">
							<thead>
									<tr>
											<th>${translate("name")}</th>
											<th>${translate("group")}</th>
											${uniqueDates.map((date) => `<th>${formatDateShort(date, this.app.lang || 'en')}</th>`).join("")}
									</tr>
							</thead>
							<tbody>
			`;

		// Iterate through the attendance data
		let rows = attendanceData
			.map((item) => {
				let attendanceMap = {};
				// Fix: attendance is already an array, not a JSON string
				const attendanceArray = item.attendance || [];

				if (Array.isArray(attendanceArray)) {
					attendanceArray.forEach((attendance) => {
						if (attendance.date) {
							attendanceMap[isoToDateString(attendance.date)] = normalizeStatus(
								attendance.status,
							);
						}
					});
				}

				// Create a row for each participant
				return `
							<tr>
									<td>${item.first_name} ${item.last_name}</td>
									<td>${item.group_name || translate("no_group")}</td>
									${uniqueDates
										.map(
											(date) => `
											<td style="background-color: ${statusColors[attendanceMap[date]] || "#FFFFFF"};">
													${attendanceMap[date] || ""}
											</td>
									`,
										)
										.join("")}
							</tr>
					`;
			})
			.join("");

		// Close the table and return the result
		let footer = `
							</tbody>
					</table>
			`;

		return header + rows + footer;
	}

	renderHonorsReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return "<p>No data available for honors report.</p>";
		}

		return `
			<h2>${translate("honors_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("honor_name")}</th>
						<th>${translate("category")}</th>
						<th>${translate("count")}</th>
						<th>${translate("recipients")}</th>
					</tr>
				</thead>
				<tbody>
					${data
						.map(
							(item) => `
						<tr>
							<td>${item.honor_name}</td>
							<td>${item.category || "-"}</td>
							<td>${item.count}</td>
							<td>${Array.isArray(item.recipients) ? item.recipients.join(", ") : item.recipients}</td>
						</tr>
					`,
						)
						.join("")}
				</tbody>
			</table>
		`;
	}

	renderPointsReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate("no_data_available")} for points report.</p>`;
		}

		// Group participants by group name
		const groupedData = {};
		data.forEach((participant) => {
			const groupName = participant.group_name || translate("no_group");
			if (!groupedData[groupName]) {
				groupedData[groupName] = [];
			}
			groupedData[groupName].push(participant);
		});

		return `
			<h2>${translate("points_report")}</h2>
			${Object.entries(groupedData)
				.map(
					([group, participants]) => `
				<h3>${group}</h3>
				<table>
					<thead>
						<tr>
							<th>${translate("name")}</th>
							<th>${translate("points")}</th>
							<th>${translate("honors_count")}</th>
						</tr>
					</thead>
					<tbody>
						${participants
							.map(
								(participant) => `
							<tr>
								<td>${participant.first_name} ${participant.last_name}</td>
								<td>${participant.total_points}</td>
								<td>${participant.honors_count}</td>
							</tr>
						`,
							)
							.join("")}
					</tbody>
				</table>
			`,
				)
				.join("")}
		`;
	}

	cacheParticipantProgress(participantId, progress) {
		try {
			const payload = { progress, timestamp: Date.now() };
			localStorage.setItem(
				`participant-progress-${participantId}`,
				JSON.stringify(payload),
			);
			this.participantProgressCache.set(participantId, payload);
		} catch (error) {
			debugWarn("Unable to cache participant progress", error);
		}
	}

	getCachedParticipantProgress(participantId) {
		if (this.participantProgressCache.has(participantId)) {
			return this.participantProgressCache.get(participantId);
		}
		try {
			const raw = localStorage.getItem(`participant-progress-${participantId}`);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			this.participantProgressCache.set(participantId, parsed);
			return parsed;
		} catch (error) {
			debugWarn("Unable to read cached participant progress", error);
			return null;
		}
	}

	buildPointsGraph(pointEvents = []) {
		if (!pointEvents.length) {
			return {
				svg: `<div class="chart-placeholder">${translate("no_points_data")}</div>`,
				min: 0,
				max: 0,
			};
		}

		const values = pointEvents.map((event) => event.cumulative);
		const min = Math.min(...values, 0);
		const max = Math.max(...values, 0);
		const range = Math.max(max - min, 1);
		const height = 180;
		const width = Math.max(pointEvents.length - 1, 1) * 80;

		const path = pointEvents
			.map((event, index) => {
				const x = (index / Math.max(pointEvents.length - 1, 1)) * width;
				const y = height - ((event.cumulative - min) / range) * height;
				return `${index === 0 ? "M" : "L"}${x},${y}`;
			})
			.join(" ");

		const last = pointEvents[pointEvents.length - 1];

		const svg = `
                        <svg class="points-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${translate("points_over_time")}">
                                <defs>
                                        <linearGradient id="pointsGradient" x1="0" x2="0" y1="0" y2="1">
                                                <stop offset="0%" stop-color="var(--color-primary-light)" stop-opacity="0.32" />
                                                <stop offset="100%" stop-color="var(--color-primary-light)" stop-opacity="0.05" />
                                        </linearGradient>
                                </defs>
                                <path d="${path}" fill="none" stroke="var(--color-primary)" stroke-width="3" vector-effect="non-scaling-stroke" />
                                <path d="${path} L ${width} ${height} L 0 ${height} Z" fill="url(#pointsGradient)" opacity="0.45" />
                                <circle cx="${width}" cy="${height - ((last.cumulative - min) / range) * height}" r="5" fill="var(--color-primary-dark)" />
                        </svg>
                `;

		return { svg, min, max };
	}

	renderParticipantProgressReport(progressData, isOffline = false) {
		const selectOptions = this.participantList
			.map((participant) => {
				const label = `${participant.first_name} ${participant.last_name}${participant.group_name ? ` · ${participant.group_name}` : ""}`;
				const selected =
					participant.id === Number(this.selectedParticipantId)
						? "selected"
						: "";
				return `<option value="${participant.id}" ${selected}>${label}</option>`;
			})
			.join("");

		const summary = progressData
			? `
                        <div class="progress-summary">
                                <div class="summary-tile">
                                        <p class="summary-label">${translate("total_points")}</p>
                                        <p class="summary-value">${progressData.totals.points}</p>
                                </div>
                                <div class="summary-tile">
                                        <p class="summary-label">${translate("honors_count")}</p>
                                        <p class="summary-value">${progressData.totals.honors}</p>
                                </div>
                                <div class="summary-tile">
                                        <p class="summary-label">${translate("badge_stars")}</p>
                                        <p class="summary-value">${progressData.totals.badges}</p>
                                </div>
                        </div>
                `
			: "";

		const timelineEvents = progressData
			? [
					...(progressData.attendance || []).map((item) => ({
						type: "attendance",
						date: item.date,
						status: item.status,
					})),
					...(progressData.honors || []).map((item) => ({
						type: "honor",
						date: item.date,
						reason: item.reason,
					})),
					...(progressData.badges || []).map((item) => ({
						type: "badge",
						date: item.date,
						badgeName: translate(item.translation_key) || item.badge_name || item.territoire_chasse,
						level: item.etoiles,
						section: item.badge_section,
					})),
				].sort((a, b) => new Date(a.date) - new Date(b.date))
			: [];

		const timeline = timelineEvents.length
			? timelineEvents
					.map((event) => {
						let title = "";
						let meta = "";
						if (event.type === "attendance") {
							title = translate(event.status) || translate("attendance");
							meta = translate("attendance_status");
						} else if (event.type === "honor") {
							title = translate("honor_awarded");
							meta = event.reason || translate("no_reason_provided");
						} else {
							title = translate("badge_star") || translate("badge");
							const levelLabel = translate("badge_level_label") || translate("badge_star_label") || translate("stars_count");
							meta = `${event.badgeName || ""} · ${levelLabel} ${event.level || 0}${event.section ? ` · ${event.section}` : ""}`;
						}

						return `
                                <article class="timeline-item timeline-item--${event.type}">
                                        <div class="timeline-dot" aria-hidden="true"></div>
                                        <div class="timeline-content">
                                                <p class="timeline-date">${new Date(event.date).toLocaleDateString()}</p>
                                                <p class="timeline-title">${title}</p>
                                                <p class="timeline-meta">${meta}</p>
                                        </div>
                                </article>
                        `;
					})
					.join("")
			: `<p class="muted">${translate("participant_progress_empty")}</p>`;

		const pointsGraph = progressData
			? this.buildPointsGraph(progressData.pointEvents || [])
			: {
					svg: `<div class="chart-placeholder">${translate("no_points_data")}</div>`,
					min: 0,
					max: 0,
				};

		const attendanceChips = progressData
			? Object.entries(progressData.totals.attendance || {})
					.map(
						([status, count]) => `
                        <span class="chip">${translate(status) || status}: ${count}</span>
                `,
					)
					.join("")
			: "";

		const offlineNotice = isOffline
			? `<div class="offline-notice" role="status">${translate("using_cached_report")}</div>`
			: "";

		return `
                        <div class="participant-progress">
                                ${offlineNotice}
                                <div class="form-field">
                                        <label for="participant-progress-select">${translate("select_participant")}</label>
                                        <select id="participant-progress-select">
                                                <option value="">${translate("select_participant_placeholder")}</option>
                                                ${selectOptions}
                                        </select>
                                </div>
                                ${
																	progressData
																		? `
                                        <div class="report-card">
                                                <header class="report-card__header">
                                                        <div>
                                                                <p class="eyebrow">${progressData.participant.group_name || translate("no_group")}</p>
                                                                <h2>${progressData.participant.first_name} ${progressData.participant.last_name}</h2>
                                                        </div>
                                                        <div class="chip chip--primary">${translate("participant_progress")}</div>
                                                </header>
                                                ${summary}
                                                <div class="report-card__grid">
                                                        <div>
                                                                <h3>${translate("points_over_time")}</h3>
                                                                ${pointsGraph.svg}
                                                                <p class="muted">${translate("points_range")}: ${pointsGraph.min} – ${pointsGraph.max}</p>
                                                        </div>
                                                        <div>
                                                                <h3>${translate("attendance_overview")}</h3>
                                                                <div class="chip-row">${attendanceChips || translate("no_attendance_data")}</div>
                                                        </div>
                                                </div>
                                                <div>
                                                        <h3>${translate("timeline_title")}</h3>
                                                        <div class="timeline">${timeline}</div>
                                                </div>
                                        </div>
                                `
																		: `<p class="muted">${translate("select_participant_prompt")}</p>`
																}
                        </div>
                `;
	}

	formatCurrency(amount) {
		return new Intl.NumberFormat(this.app.lang || "en", {
			style: "currency",
			currency: REPORT_CURRENCY,
			maximumFractionDigits: 2,
		}).format(Number(amount) || 0);
	}

	renderFinancialReport(data) {
		const totals = data?.totals || {};
		const definitions = data?.definitions || [];
		const participants = data?.participants || [];

		const definitionRows = definitions
			.map(
				(row) => `
                        <div class="finance-list__row">
                                <div>
                                        <p class="finance-meta">${formatDateShort(row.year_start)} → ${formatDateShort(row.year_end)}</p>
                                </div>
                                <div class="finance-row-values">
                                        <span>${this.formatCurrency(row.total_billed)}</span>
                                        <span>${this.formatCurrency(row.total_paid)}</span>
                                        <span class="finance-stat__value--alert">${this.formatCurrency(row.total_outstanding)}</span>
                                </div>
                        </div>
                `,
			)
			.join("");

		const participantRows = participants
			.map(
				(p) => `
                        <div class="finance-list__row">
                                <div>
                                        <p class="finance-meta">${escapeHTML(p.first_name || "")} ${escapeHTML(p.last_name || "")}</p>
                                </div>
                                <div class="finance-row-values">
                                        <span>${this.formatCurrency(p.total_billed)}</span>
                                        <span>${this.formatCurrency(p.total_paid)}</span>
                                        <span class="finance-stat__value--alert">${this.formatCurrency(p.total_outstanding)}</span>
                                </div>
                        </div>
                `,
			)
			.join("");

		return `
                        <div class="report-surface financial-report">
                                <div class="finance-stats">
                                        <div>
                                                <p class="finance-stat__label">${translate("total_billed")}</p>
                                                <p class="finance-stat__value">${this.formatCurrency(totals.total_billed)}</p>
                                        </div>
                                        <div>
                                                <p class="finance-stat__label">${translate("total_paid")}</p>
                                                <p class="finance-stat__value">${this.formatCurrency(totals.total_paid)}</p>
                                        </div>
                                        <div>
                                                <p class="finance-stat__label">${translate("outstanding_balance")}</p>
                                                <p class="finance-stat__value finance-stat__value--alert">${this.formatCurrency(totals.total_outstanding)}</p>
                                        </div>
                                </div>
                                <div class="finance-grid">
                                        <section class="finance-card">
                                                <h3>${translate("by_year")}</h3>
                                                ${definitionRows || `<p class="finance-helper">${translate("no_definitions")}</p>`}
                                        </section>
                                        <section class="finance-card">
                                                <h3>${translate("by_participant")}</h3>
                                                ${participantRows || `<p class="finance-helper">${translate("no_participant_fees")}</p>`}
                                        </section>
                                </div>
                        </div>
                `;
	}

	attachParticipantProgressListeners() {
		const select = document.getElementById("participant-progress-select");
		if (select) {
			select.addEventListener("change", async (event) => {
				this.selectedParticipantId = event.target.value || null;
				const content = await this.fetchAndRenderParticipantProgress();
				setContent(document.getElementById("report-content"), content);
				this.attachParticipantProgressListeners();
			});
		}
	}

	async fetchAndRenderParticipantProgress() {
		try {
			const response = await getParticipantProgressReport(
				this.selectedParticipantId,
			);
			if (response?.data?.participants) {
				this.participantList = response.data.participants;
				if (!this.selectedParticipantId && this.participantList.length) {
					this.selectedParticipantId = this.participantList[0].id;
					return await this.fetchAndRenderParticipantProgress();
				}
			}

			if (response?.data?.progress && this.selectedParticipantId) {
				this.cacheParticipantProgress(
					this.selectedParticipantId,
					response.data.progress,
				);
			}

			const progressData = response?.data?.progress || null;
			const markup = this.renderParticipantProgressReport(progressData);
			return markup;
		} catch (error) {
			debugError("Error loading participant progress", error);
			if (this.selectedParticipantId) {
				const cached = this.getCachedParticipantProgress(
					this.selectedParticipantId,
				);
				if (cached?.progress) {
					return this.renderParticipantProgressReport(cached.progress, true);
				}
			}
			return `<p class="error-message">${translate("error_loading_report")}: ${escapeHTML(error.message)}</p>`;
		}
	}

	printReport() {
		const printWindow = window.open("", "_blank");
		printWindow.document.write(`
			<html>
				<head>
					<title>${translate("report")}</title>
					<style>
						body { font-family: Arial, sans-serif; }
						table { border-collapse: collapse; width: 100%; }
						th, td { border: 1px solid black; padding: 8px; text-align: left; }
						th { background-color: #f2f2f2; }
					</style>
				</head>
				<body>
					${document.getElementById("report-content").innerHTML}
				</body>
			</html>
		`);
		printWindow.document.close();
		printWindow.print();
	}
}
