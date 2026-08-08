// reports.js
import { translate } from "./app.js";
import { sanitizeHTML } from "./utils/SecurityUtils.js";
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
import { openPrintWindow, setPrintContent } from "./utils/PrintUtils.js";
import { formatDateShort, isoToDateString } from "./utils/DateUtils.js";
import { canViewReports, isParent } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { exportToCSV } from "./utils/ExportUtils.js";
import { CONFIG } from "./config.js";
import { lockBodyScroll, unlockBodyScroll } from "./utils/ScrollLockUtils.js";

const REPORT_CURRENCY = "CAD";

/** Owner key for the report modal's body scroll lock. */
const REPORT_MODAL_SCROLL_LOCK = "reports:report-modal";

export class Reports {
	constructor(app) {
		this.app = app;
		this.participantList = [];
		this.selectedParticipantId = null;
		this.participantProgressCache = new Map();
		this.isStaff = true; // Default to true, will be updated from API
	}

	/**
	 * Called by the router before navigating away.
	 *
	 * Reports render inside a modal that locks body scrolling. Leaving the page
	 * by any route other than the modal's own close button (SPA navigation, a
	 * report that redirects to a full page) must still release that lock,
	 * otherwise the destination page cannot be scrolled.
	 */
	destroy() {
		if (this.escKeyHandler) {
			document.removeEventListener("keydown", this.escKeyHandler);
			this.escKeyHandler = null;
		}
		this.closeReportModal();
	}

	async init() {
		if (!canViewReports()) {
			this.app.router.navigate("/");
			return;
		}

		// Check if user has parent role - parents are restricted even if they have other permissions
		const userIsParent = isParent();
		this.isStaff = !userIsParent; // Staff = NOT a parent

		// Check for URL parameter to auto-open participant progress report
		const urlParams = new URLSearchParams(window.location.search);
		const participantId = urlParams.get('participantId');

		// Parents can ONLY access this page with a participantId parameter
		// They should not see the reports dashboard
		if (userIsParent && !participantId) {
			debugLog('Parent attempting to access Reports page without participantId, redirecting to parent dashboard');
			this.app.router.navigate("/parent-dashboard");
			return;
		}

		// If parent with participantId, skip rendering the reports dashboard
		// and go straight to the participant progress report
		if (userIsParent && participantId) {
			debugLog('Parent accessing specific participant progress report:', participantId);
			this.selectedParticipantId = participantId;
			// Render a minimal container for the report content
			const container = document.getElementById("app");
			setContent(container, `
				<a href="/parent-dashboard" class="button button--ghost">← ${translate("back")}</a>
				<div id="report-content"></div>
			`);
			await this.loadReport('participant-progress');
			return;
		}

		// Staff users get the full reports dashboard
		this.render();
		await this.loadFormTypes(); // Load form types after rendering the page
		this.attachEventListeners();

		// If staff clicked with participantId, auto-open that report
		if (participantId) {
			this.selectedParticipantId = participantId;
			await this.loadReport('participant-progress');
		}
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
                                                        ${CONFIG.FEATURES.EXPORT_REPORTS ? `
                                                        <button id="export-report" class="button button--secondary" type="button" style="margin-left: 0.5rem;">
                                                                <span class="button-icon">⬇️</span>
                                                                ${translate("export_csv")}
                                                        </button>
                                                        ` : ''}
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

		// ESC key to close modal (keep a reference so destroy() can remove it)
		if (this.escKeyHandler) {
			document.removeEventListener("keydown", this.escKeyHandler);
		}
		this.escKeyHandler = (e) => {
			if (e.key === "Escape") {
				const modal = document.getElementById("report-modal");
				if (modal && !modal.classList.contains("hidden")) {
					this.closeReportModal();
				}
			}
		};
		document.addEventListener("keydown", this.escKeyHandler);

		document
			.getElementById("print-report")
			?.addEventListener("click", () => this.printReport());

		document
			.getElementById("export-report")
			?.addEventListener("click", () => this.exportCurrentReport());
	}

	openReportModal(title) {
		const modal = document.getElementById("report-modal");
		const modalTitle = document.getElementById("report-modal-title");

		if (!modal || !modalTitle) {
			debugWarn("Report modal elements missing");
			return;
		}

		// Remember the trigger so focus can be returned when the modal closes.
		this.modalReturnFocus = document.activeElement;

		modalTitle.textContent = title;
		modal.classList.remove("hidden");
		modal.setAttribute("aria-hidden", "false");
		lockBodyScroll(REPORT_MODAL_SCROLL_LOCK);

		const closeButton = modal.querySelector(".modal-close, #close-report-modal");
		(closeButton || modal).focus?.();
	}

	closeReportModal() {
		// The lock is released even when the modal element is already gone (the
		// SPA container may have been re-rendered underneath us).
		unlockBodyScroll(REPORT_MODAL_SCROLL_LOCK);

		const modal = document.getElementById("report-modal");
		if (modal) {
			modal.classList.add("hidden");
			modal.setAttribute("aria-hidden", "true");
		}

		// Never leave focus inside a hidden or removed subtree.
		if (this.modalReturnFocus?.isConnected) {
			this.modalReturnFocus.focus();
		} else if (document.activeElement && modal?.contains(document.activeElement)) {
			document.activeElement.blur();
		}
		this.modalReturnFocus = null;
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


			// The seniority report is a full page rather than a modal panel, so
			// leave before a modal (and its body scroll lock) is ever created.
			if (reportType === "time-since-registration") {
				this.closeReportModal();
				this.app.router.navigate("/time-since-registration");
				return;
			}

			// Open modal with report title
			this.openReportModal(reportTitles[reportType] || translate("report"));

			this.currentReportType = reportType;
			this.currentReportData = null; // Reset previous data

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
					this.currentReportData = reportData.data;
					reportContent = this.renderAllergiesReport(reportData.data);
					break;
				case "medication":
					reportData = await getMedicationReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderMedicationReport(reportData.data);
					break;
				case "vaccines":
					reportData = await getVaccineReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderVaccineReport(reportData.data);
					break;
				case "leave-alone":
					reportData = await getLeaveAloneReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderLeaveAloneReport(reportData.data);
					break;
				case "media-authorization":
					reportData = await getMediaAuthorizationReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderMediaAuthorizationReport(reportData.data);
					break;
				case "missing-documents":
					reportData = await getMissingDocumentsReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderMissingDocumentsReport(reportData.data);
					break;
				case "attendance":
					reportData = await getAttendanceReport();
					debugLog("Received attendance report data:", reportData); // Add this line for debugging
					if (!reportData) {
						throw new Error("No data received from getAttendanceReport");
					}
					this.currentReportData = reportData; // Attendance report structure might be different
					reportContent = this.renderAttendanceReport(reportData);
					break;
				case "honors":
					reportData = await getHonorsReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderHonorsReport(reportData.data);
					break;
				case "participant-age":
					reportData = await getParticipantAgeReport();
					// The endpoint answers with the standard { success, data } envelope.
					// Reading `reportData.participants` always yielded undefined, which
					// rendered the report as "no data available" even with participants.
					this.currentReportData = reportData?.data || [];
					reportContent = this.renderParticipantAgeReport(this.currentReportData);
					break;
				case "points":
					reportData = await getPointsReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderPointsReport(reportData.data);
					break;
				case "financial":
					reportData = await getFinanceReport();
					this.currentReportData = reportData.data;
					reportContent = this.renderFinancialReport(reportData.data);
					break;
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

	/**
	 * Fetch and render the complete health record report.
	 *
	 * The previous version read field names the API never returned
	 * (`health_issues`, `injuries`, `leave_alone`, `media_consent`,
	 * `swimming_level`), so all that survived was the allergy line and the report
	 * amounted to a worse allergy list. It now reads the fields the fiche_sante
	 * form actually stores, plus the participant's emergency contacts.
	 *
	 * @returns {Promise<string>} HTML report
	 */
	async fetchAndRenderHealthReport() {
		try {
			const reportData = await getHealthReport();

			if (!reportData?.success) {
				throw new Error(reportData?.message || reportData?.error || "Failed to fetch health report");
			}

			const participants = Array.isArray(reportData.data) ? reportData.data : [];

			// Keep every participant who has a health form on file, even a sparse
			// one: "form submitted but empty" is itself information a leader needs.
			const withRecords = participants.filter((participant) => (
				participant.has_health_form || this.hasAnyHealthData(participant)
			));

			const sortedParticipants = withRecords.sort((a, b) => (
				(a.last_name || "").localeCompare(b.last_name || "")
			));

			this.currentReportData = sortedParticipants;

			return this.renderHealthReport(sortedParticipants);
		} catch (error) {
			debugError("Error fetching and rendering health report:", error);
			return `<p class="error-message">${translate("error_loading_report")}: ${escapeHTML(error.message)}</p>`;
		}
	}

	/**
	 * @param {Object} participant - Health report row
	 * @returns {boolean} True when the record carries at least one answer
	 */
	hasAnyHealthData(participant) {
		return Boolean(
			participant.allergies ||
			participant.epipen ||
			participant.medications ||
			participant.probleme_sante ||
			participant.limitations ||
			participant.blessures_operations ||
			participant.niveau_natation ||
			participant.nom_medecin ||
			(participant.emergency_contacts || []).length > 0,
		);
	}

	/**
	 * Render the complete health record report as one card per participant.
	 *
	 * A card layout is used rather than a wide table because a health record has
	 * far more fields than fit legibly in columns on a phone.
	 *
	 * @param {Array<Object>} participants - Health report rows
	 * @returns {string} HTML report
	 */
	renderHealthReport(participants) {
		if (!Array.isArray(participants) || participants.length === 0) {
			return `<p class="no-data">${translate("no_health_records")}</p>`;
		}

		const yesNo = (value) => (value ? translate("yes") : translate("no"));

		return `
			<h2>${translate("health_report_title")}</h2>
			<p class="report-meta">${translate("participants")}: ${participants.length}</p>
			<div class="health-records">
				${participants.map((participant) => `
					<article class="health-record">
						<header class="health-record__header">
							<h3>${escapeHTML(`${participant.first_name || ""} ${participant.last_name || ""}`.trim())}</h3>
							<span class="health-record__group">${escapeHTML(participant.group_name || translate("no_group"))}</span>
							${participant.epipen ? `<span class="badge-epipen">${translate("epipen")}</span>` : ""}
						</header>
						<dl class="health-record__fields">
							${this.renderHealthField(translate("birthdate"), participant.date_naissance ? formatDateShort(participant.date_naissance, this.app.lang) : null)}
							${this.renderHealthField(translate("allergies"), participant.allergies)}
							${this.renderHealthField(translate("medication"), participant.medications)}
							${this.renderHealthField(translate("health_issues"), participant.probleme_sante)}
							${this.renderHealthField(translate("limitations"), participant.limitations)}
							${this.renderHealthField(translate("injuries"), participant.blessures_operations)}
							${this.renderHealthField(translate("swimming_level"), participant.niveau_natation ? translate(participant.niveau_natation) : null)}
							${this.renderHealthField(translate("doit_porter_vfi"), participant.doit_porter_vfi ? translate("yes") : null)}
							${this.renderHealthField(translate("vaccines_up_to_date"), yesNo(participant.vaccins_a_jour))}
							${this.renderHealthField(translate("nom_medecin_label"), participant.nom_medecin)}
							${this.renderHealthField(translate("health_form_on_file"), yesNo(participant.has_health_form))}
						</dl>
						${this.renderEmergencyContacts(participant.emergency_contacts)}
					</article>
				`).join("")}
			</div>
		`;
	}

	/**
	 * Render one definition-list entry, omitting fields with no value so the card
	 * shows what is known rather than a wall of blanks.
	 *
	 * @param {string} label - Field label
	 * @param {string|null|undefined} value - Field value
	 * @returns {string} HTML fragment
	 */
	renderHealthField(label, value) {
		if (value === null || value === undefined || value === "") {
			return "";
		}
		return `
			<div class="health-record__field">
				<dt>${escapeHTML(label)}</dt>
				<dd>${escapeHTML(String(value))}</dd>
			</div>
		`;
	}

	/**
	 * Render a participant's emergency contacts.
	 *
	 * @param {Array<Object>} contacts - Emergency contacts
	 * @returns {string} HTML fragment
	 */
	renderEmergencyContacts(contacts) {
		if (!Array.isArray(contacts) || contacts.length === 0) {
			return `<p class="health-record__no-contacts">${translate("no_emergency_contacts")}</p>`;
		}

		return `
			<div class="health-record__contacts">
				<h4>${translate("emergency_contacts")}</h4>
				<ul>
					${contacts.map((contact) => {
						const phones = [contact.phone_mobile, contact.phone_home, contact.phone_work]
							.filter(Boolean)
							.map((phone) => escapeHTML(phone))
							.join(" / ");
						return `
							<li>
								<strong>${escapeHTML(contact.name || "")}</strong>
								${contact.relationship ? `<span class="contact-relationship">(${escapeHTML(contact.relationship)})</span>` : ""}
								${phones ? `<span class="contact-phone">${phones}</span>` : ""}
								${contact.email ? `<span class="contact-email">${escapeHTML(contact.email)}</span>` : ""}
							</li>
						`;
					}).join("")}
				</ul>
			</div>
		`;
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

			// Store data for export - we need to calculate missing fields per submission
			this.currentReportData = response.data.map(submission => {
				const formTypeData = formStructure.data[formType];
				const structure = formTypeData?.form_structure;
				const missing = structure ? this.getMissingFields(submission.submission_data, structure) : [];
				return {
					...submission,
					missing_fields: missing.join(', ')
				};
			}).filter(item => item.missing_fields); // Only keep items with missing fields

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


	exportCurrentReport() {
		if (!this.currentReportData) {
			this.app.showMessage(translate("no_data_to_export"), "warning");
			return;
		}

		const dateStr = formatDateShort(new Date()).replace(/\//g, '-');
		const filename = `${this.currentReportType}_report_${dateStr}`;
		let columns = [];
		let data = this.currentReportData;

		switch (this.currentReportType) {
			case "health":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "allergies", label: translate("allergies") },
					{ key: "epipen", label: translate("epipen"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") },
					{ key: "medications", label: translate("medication") },
					{ key: "probleme_sante", label: translate("health_issues") },
					{ key: "limitations", label: translate("limitations") },
					{ key: "blessures_operations", label: translate("injuries") },
					{ key: "niveau_natation", label: translate("swimming_level") },
					{ key: "doit_porter_vfi", label: translate("doit_porter_vfi"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") },
					{ key: "vaccins_a_jour", label: translate("vaccines_up_to_date"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") },
					{ key: "nom_medecin", label: translate("nom_medecin_label") },
					{
						key: "emergency_contacts",
						label: translate("emergency_contacts"),
						format: (contacts) => (Array.isArray(contacts) ? contacts : [])
							.map((contact) => [
								contact.name,
								contact.relationship,
								contact.phone_mobile || contact.phone_home || contact.phone_work,
							].filter(Boolean).join(" "))
							.join(" | "),
					}
				];
				break;
			case "allergies":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "allergies", label: translate("allergies") },
					{ key: "allergy_severity", label: translate("allergy_severity") },
					{ key: "allergy_reaction", label: translate("allergy_reaction") },
					{ key: "allergy_action", label: translate("allergy_action") },
					{ key: "epipen", label: translate("epipen"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") },
					{ key: "emergency_medication", label: translate("emergency_medication") },
					{ key: "notes", label: translate("notes") }
				];
				break;
			case "medication":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "medication", label: translate("medication") }
				];
				break;
			case "vaccines":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "vaccines_up_to_date", label: translate("vaccines_up_to_date"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") }
				];
				break;
			case "leave-alone":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "leave_alone", label: translate("leave_alone"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") }
				];
				break;
			case "media-authorization":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "media_consent", label: translate("media_consent"), format: (v) => (v === '1' || v === true || v === 'true') ? translate("yes") : translate("no") }
				];
				break;
			case "attendance":
				// Attendance is special - dynamic columns based on dates
				// data is { data: [...participants] } - we stored 'reportData' which contains .data
				// Wait, we stored `this.currentReportData = reportData;` where reportData has .data array

				const attendanceData = data.data || [];
				if (!attendanceData.length) {
					this.app.showMessage(translate("no_data_to_export"), "warning");
					return;
				}

				data = attendanceData; // Override data to be the array of participants

				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "total_days", label: translate("total_days") },
					{ key: "days_absent", label: translate("days_absent") },
					{ key: "days_late", label: translate("days_late") }
				];

				// Extract unique dates
				const uniqueDates = new Set();
				data.forEach(p => {
					(p.attendance || []).forEach(a => {
						if (a.date) uniqueDates.add(isoToDateString(a.date));
					});
				});

				Array.from(uniqueDates).sort().forEach(date => {
					columns.push({
						key: `date_${date}`,
						label: formatDateShort(date),
						format: (_, row) => {
							const att = (row.attendance || []).find(a => isoToDateString(a.date) === date);
							return att ? (translate(att.status) || att.status) : '';
						}
					});
				});
				break;
			case "missing-fields":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "missing_fields", label: translate("missing_fields") }
				];
				break;
			case "financial":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "total_billed", label: translate("total_billed"), format: v => Number(v || 0).toFixed(2) },
					{ key: "total_paid", label: translate("total_paid"), format: v => Number(v || 0).toFixed(2) },
					{ key: "total_outstanding", label: translate("outstanding_balance"), format: v => Number(v || 0).toFixed(2) }
				];
				break;
			case "participant-age":
				columns = [
					{ key: "first_name", label: translate("first_name") },
					{ key: "last_name", label: translate("last_name") },
					{ key: "group_name", label: translate("group") },
					{ key: "date_naissance", label: translate("birthdate"), format: v => v ? formatDateShort(v) : '' },
					{ key: "age", label: translate("age") }
				];
				break;
			default:
				// Fallback for types not explicitly handled or generic types
				// check if data is array of objects
				if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
					// Try to auto-detect columns from first item
					Object.keys(data[0]).forEach(key => {
						if (typeof data[0][key] !== 'object' && typeof data[0][key] !== 'function') {
							columns.push({ key, label: translate(key) || key });
						}
					});
				} else {
					this.app.showMessage(translate("export_not_supported_for_type"), "warning");
					return;
				}
		}

		exportToCSV(data, columns, filename);
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

	/**
	 * Allergy report.
	 *
	 * Answers a single question for a leader on site: who is allergic, to what,
	 * how serious is it, and what do I do. Unrelated medical data (swimming
	 * level, vaccination status, general conditions) belongs to the health record
	 * report and is deliberately left out.
	 *
	 * @param {Array<Object>} data - Allergy rows from the API
	 * @returns {string} HTML report
	 */
	renderAllergiesReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p class="no-data">${translate("no_allergies_recorded")}</p>`;
		}

		const epipenCount = data.filter((item) => item.epipen === true).length;
		const cell = (value) => escapeHTML(value || "—");

		return `
			<h2>${translate("allergies_report")}</h2>
			<p class="report-meta">
				${translate("participants")}: ${data.length} — ${translate("epipen")}: ${epipenCount}
			</p>
			<div class="table-scroll">
				<table class="data-table">
					<caption class="visually-hidden">${translate("allergies_report")}</caption>
					<thead>
						<tr>
							<th scope="col">${translate("name")}</th>
							<th scope="col">${translate("group")}</th>
							<th scope="col">${translate("allergies")}</th>
							<th scope="col">${translate("allergy_severity")}</th>
							<th scope="col">${translate("allergy_reaction")}</th>
							<th scope="col">${translate("allergy_action")}</th>
							<th scope="col">${translate("emergency_medication")}</th>
							<th scope="col">${translate("notes")}</th>
						</tr>
					</thead>
					<tbody>
						${data.map((item) => `
							<tr>
								<th scope="row">${escapeHTML(`${item.first_name || ""} ${item.last_name || ""}`.trim())}</th>
								<td>${escapeHTML(item.group_name || translate("no_group"))}</td>
								<td>${cell(item.allergies)}</td>
								<td>${cell(item.allergy_severity)}</td>
								<td>${cell(item.allergy_reaction)}</td>
								<td>${cell(item.allergy_action)}</td>
								<td>
									${item.epipen ? `<strong class="badge-epipen">${translate("epipen")}</strong>` : ""}
									${cell(item.emergency_medication)}
								</td>
								<td>${cell(item.notes || item.limitations)}</td>
							</tr>
						`).join("")}
					</tbody>
				</table>
			</div>
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

	/**
	 * Render the participant age report.
	 *
	 * Participants without a birth date are kept in the table with an explicit
	 * "unknown" age rather than being silently dropped, so the roster count in
	 * the report matches the roster the user sees elsewhere.
	 *
	 * @param {Array<Object>} data - Participant age rows from the API
	 * @returns {string} HTML report
	 */
	renderParticipantAgeReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p class="no-data">${translate("no_data_available")}</p>`;
		}

		const withBirthdate = data.filter((item) => Boolean(item.date_naissance));

		return `
			<h2>${translate("participant_age_report")}</h2>
			<p class="report-meta">${translate("participants")}: ${data.length} — ${translate("birthdate")}: ${withBirthdate.length}</p>
			<div class="table-scroll">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">${translate("name")}</th>
							<th scope="col">${translate("group")}</th>
							<th scope="col">${translate("birthdate")}</th>
							<th scope="col" class="text-right">${translate("age")}</th>
						</tr>
					</thead>
					<tbody>
						${data.map((item) => {
							const hasAge = item.age !== null && item.age !== undefined && item.age !== '';
							return `
								<tr>
									<td>${escapeHTML(`${item.first_name || ''} ${item.last_name || ''}`.trim())}</td>
									<td>${escapeHTML(item.group_name || translate("no_group"))}</td>
									<td>${item.date_naissance ? formatDateShort(item.date_naissance, this.app.lang) : translate("unknown")}</td>
									<td class="text-right">${hasAge ? Number(item.age) : translate("unknown")}</td>
								</tr>
							`;
						}).join("")}
					</tbody>
				</table>
			</div>
		`;
	}

	renderLeaveAloneReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate("no_data_available")}</p>`;
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
			return `<p>${translate("no_data_available")}</p>`;
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
			return `<p>${translate("no_data_available")}</p>`;
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

		renderAttendanceReport(data) {
			if (!data || typeof data !== "object") {
				return `<p>${translate("error_loading_report")}</p>`;
		}

		// Fix: Access data.data instead of data.attendance_data
		const attendanceData = data.data || [];

		if (
			!data.success ||
			!Array.isArray(attendanceData) ||
			attendanceData.length === 0
		) {
			return `<p>${translate("no_data_available")}</p>`;
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
			return `<p>${translate("no_data_available")}</p>`;
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
                                                <p class="timeline-date">${formatDateShort(event.date, this.app.lang)}</p>
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

		// Show participant selector only for staff, hide for parents
		const participantSelector = this.isStaff
			? `<div class="form-field">
					<label for="participant-progress-select">${translate("select_participant")}</label>
					<select id="participant-progress-select">
						<option value="">${translate("select_participant_placeholder")}</option>
						${selectOptions}
					</select>
				</div>`
			: ''; // Parents don't see the picker

		return `
                        <div class="participant-progress">
                                ${offlineNotice}
                                ${participantSelector}
                                ${progressData
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

	formatPercent(numerator, denominator) {
		if (!denominator || denominator <= 0) {
			return new Intl.NumberFormat(this.app.lang || "en", {
				style: "percent",
				maximumFractionDigits: 0,
			}).format(0);
		}
		const ratio = Math.max(0, Number(numerator) || 0) / denominator;
		return new Intl.NumberFormat(this.app.lang || "en", {
			style: "percent",
			maximumFractionDigits: 0,
		}).format(ratio);
	}

	renderFinancialReport(data) {
		const totals = data?.totals || {};
		const definitions = data?.definitions || [];
		const participants = data?.participants || [];
		const paymentMethods = data?.payment_methods || [];
		const paymentMethodsTotal = paymentMethods.reduce(
			(acc, item) => acc + (Number(item.total_paid) || 0),
			0,
		);

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

		const paymentMethodRows = paymentMethods
			.map((methodRow) => {
				const methodKey = methodRow.method || "unknown";
				const methodLabel = translate(methodKey) || translate("unknown");
				return `
                        <div class="finance-list__row">
                                <div>
                                        <p class="finance-meta">${methodLabel}</p>
                                </div>
                                <div class="finance-row-values">
                                        <span>${this.formatCurrency(methodRow.total_paid)}</span>
                                        <span>${this.formatPercent(methodRow.total_paid, paymentMethodsTotal)}</span>
                                </div>
                        </div>
                `;
			})
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
                                                <h3>${translate("by_payment_method")}</h3>
                                                ${paymentMethodRows || `<p class="finance-helper">${translate("no_payments")}</p>`}
                                        </section>
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
				// Note: isStaff is already set in init() from canViewParticipants() permission check
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
			this.currentReportData = progressData;
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
		const printWindow = openPrintWindow();
		if (!printWindow) {
			this.app.showMessage(translate("popup_blocked"), "error");
			return;
		}
		const reportContent = document.getElementById("report-content");
		const reportMarkup = reportContent ? reportContent.outerHTML : '';
		const safeReportContent = reportMarkup ? sanitizeHTML(reportMarkup) : '';
		setPrintContent(printWindow, `
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
					${safeReportContent}
				</body>
			</html>
		`, translate("report"));
		printWindow.document.close();
		printWindow.print();
	}
}
