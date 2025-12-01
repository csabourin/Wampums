// reports.js
import { translate } from "./app.js";
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
	getParticipantAgeReport,
	getFormStructure,
	getFormSubmissions,
	getFormTypes
} from "./ajax-functions.js";

export class Reports {
	constructor(app) {
		this.app = app;
	}

	async init() {
		if (this.app.userRole !== "animation" && this.app.userRole !== "admin") {
			this.app.router.navigate("/");
			return;
		}

		this.render();
		await this.loadFormTypes(); // Load form types after rendering the page
		this.attachEventListeners();
	}

	render() {
		const content = `
			<h1>${translate("reports")}</h1>
			<div class="reports-menu">
			 <button class="report-btn" data-report="health">${translate("health_report")}</button>
				<button class="report-btn" data-report="allergies">${translate("allergies_report")}</button>
				<button class="report-btn" data-report="medication">${translate("medication_report")}</button>
				<button class="report-btn" data-report="vaccines">${translate("vaccine_report")}</button>
				<button class="report-btn" data-report="leave-alone">${translate("leave_alone_report")}</button>
				<button class="report-btn" data-report="media-authorization">${translate("media_authorization_report")}</button> <button class="report-btn" data-report="participant-age">${translate("participant_age_report")}</button>
				<button class="report-btn" data-report="missing-documents">${translate("missing_documents_report")}</button>
				<button class="report-btn" data-report="attendance">${translate("attendance_report")}</button>
				<button class="report-btn" data-report="honors">${translate("honors_report")}</button>
				<button class="report-btn" data-report="points">${translate("points_report")}</button>
			</div>
			<div id="form-type-container">
					<h3>${translate("select_form_type")}</h3>
					<select id="form-type-select">
						<option value="">${translate("select_form_type")}</option>
							<!-- Form types will be dynamically loaded here -->
					</select>
			</div>
			<div id="report-content"></div>
			<button id="print-report" style="display: none;">${translate("print_report")}</button>
			<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
		`;
		document.getElementById("app").innerHTML = content;
	}

	attachEventListeners() {
		document.querySelectorAll('.report-btn').forEach(button => {
			button.addEventListener('click', (e) => this.loadReport(e.target.dataset.report));
		});

		document.getElementById('print-report').addEventListener('click', () => this.printReport());
	}

	async loadFormTypes() {
		try {
			const response = await getFormTypes(); // Fetch form types

			console.log("Fetched form types:", response);  // Check if data is correctly fetched

			const selectElement = document.getElementById("form-type-select");

			if (!response || !response.data || response.data.length === 0) {
				selectElement.innerHTML = `<option value="">${translate('no_form_types_available')}</option>`;
				return;
			}

			response.data.forEach(formType => {
				const option = document.createElement("option");
				option.value = formType;
				option.textContent = formType; // You may use a translated or user-friendly name here
				selectElement.appendChild(option);
			});

			// Add event listener to handle report loading when form type is selected
			selectElement.addEventListener('change', async () => {
				const selectedFormType = selectElement.value;
				if (selectedFormType) {
					await this.loadReport('missing-fields', selectedFormType);
				}
			});
		} catch (error) {
			console.error("Error loading form types:", error);
			document.getElementById("form-type-container").innerHTML = `<p>${translate("error_loading_form_types")}</p>`;
		}
	}



	async loadReport(reportType,formType=null) {
		try {
			let reportData;
			let reportContent;

			switch (reportType) {
					case 'health':
					reportContent = await this.fetchAndRenderHealthReport(); // Now we get the report content
					break;
				case 'missing-fields':
				reportContent = await this.fetchAndRenderMissingFieldsReport(formType); // Pass the form type
				break;
				case 'allergies':
					reportData = await getAllergiesReport();
					reportContent = this.renderAllergiesReport(reportData.data);
					break;
				case 'medication':
					reportData = await getMedicationReport();
					reportContent = this.renderMedicationReport(reportData.data);
					break;
				case 'vaccines':
					reportData = await getVaccineReport();
					reportContent = this.renderVaccineReport(reportData.data);
					break;
				case 'leave-alone':
					reportData = await getLeaveAloneReport();
					reportContent = this.renderLeaveAloneReport(reportData.data);
					break;
				case 'media-authorization':
					reportData = await getMediaAuthorizationReport();
					reportContent = this.renderMediaAuthorizationReport(reportData.data);
					break;
				case 'missing-documents':
					reportData = await getMissingDocumentsReport();
					reportContent = this.renderMissingDocumentsReport(reportData.data);
					break;
				case 'attendance':
				reportData = await getAttendanceReport();
				console.log("Received attendance report data:", reportData); // Add this line for debugging
				if (!reportData) {
					throw new Error('No data received from getAttendanceReport');
				}
				reportContent = this.renderAttendanceReport(reportData);
				break;
				case 'honors':
					reportData = await getHonorsReport();
					reportContent = this.renderHonorsReport(reportData.data);
					break;
case 'participant-age':
					reportData = await getParticipantAgeReport(); // Fetch the report data
					reportContent = this.renderParticipantAgeReport(reportData.participants);
					break;
				case 'points':
					reportData = await getPointsReport();
					reportContent = this.renderPointsReport(reportData.data);
					break;
				default:
					reportContent = '<p>Invalid report type</p>';
			}

			document.getElementById('report-content').innerHTML = reportContent;
			document.getElementById('print-report').style.display = 'block';
		} catch (error) {
			console.error(`Error loading ${reportType} report:`, error);
			document.getElementById('report-content').innerHTML = `
				<p class="error-message">${translate("error_loading_report")}: ${error.message}</p>
			`;
			document.getElementById('print-report').style.display = 'none';
		}
	}

	async fetchAndRenderHealthReport() {
		try {
			// Fetch the health report data
			const reportData = await getHealthReport(); // Assuming getHealthReport is defined in ajax-functions.js

			if (!reportData.success) {
				throw new Error(reportData.error || 'Failed to fetch health report');
			}

			// Filter out participants with all empty fields
			const filteredParticipants = reportData.data.filter(participant => {
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
			const sortedParticipants = filteredParticipants.sort((a, b) => a.last_name.localeCompare(b.last_name));

			// Render the report and return the content
			const reportContent = this.renderHealthReport(sortedParticipants);
			return reportContent; // Return the generated reportContent

		} catch (error) {
			console.error("Error fetching and rendering health report:", error);
			return `<p class="error-message">${translate("error_loading_report")}: ${error.message}</p>`;
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

			participants.forEach(participant => {
					const epipen = participant.epipen === "1" || participant.epipen === "true" || participant.epipen === true ? "<strong> EPIPEN </strong>" : "";
					const leaveAlone = participant.leave_alone === "1" || participant.leave_alone === "true" || participant.leave_alone === true ? "🗸" : "";
					const mediaConsent = participant.media_consent === "1" || participant.media_consent === "true" || participant.media_consent === true ? "" : "🚫"; // Show 🚫 if no media consent

					// Health information fields, only showing the ones that are not empty
					let healthInfo = '';
					if (participant.health_issues) healthInfo += `<strong>${translate('health_issues')}:</strong> ${participant.health_issues}<br>`;
					if (participant.allergies) healthInfo += `<strong>${translate('allergies')}:</strong> ${participant.allergies} ${epipen}<br>`;
					if (participant.injuries) healthInfo += `<strong>${translate('injuries')}:</strong> ${participant.injuries}<br>`;

					// Show swimming level, but life jacket note only for "ne_sait_pas_nager"
					if (participant.swimming_level === "ne_sait_pas_nager") {
							healthInfo += `<strong>${translate('swimming_level')}:</strong> ${translate("doit_porter_vfi")}<br>`;
					} else if (participant.swimming_level === "eau_peu_profonde") {
							healthInfo += `<strong>${translate('swimming_level')}:</strong> ${translate("eau_peu_profonde")}<br>`;
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
							throw new Error('Form type is required');
					}

					const response = await getFormSubmissions(null, formType); // Fetch submissions for all participants for the selected form type

					if (!response || !response.data) {
							throw new Error('No form submissions found');
					}

					const formStructure = await getFormStructure(); // Get all form structures
					if (!formStructure || !formStructure.data) {
							throw new Error('No form structure found');
					}

					const missingFieldsReport = this.generateMissingFieldsReport(response.data, formStructure.data, formType);

					return missingFieldsReport;
			} catch (error) {
					console.error('Error fetching or rendering missing fields report:', error);
					return `<p>${translate('error_loading_report')}: ${error.message}</p>`;
			}
	}


generateMissingFieldsReport(submissions, formStructures, formType) {
    let reportContent = '<h2>' + translate('missing_fields_report') + '</h2>';
    reportContent += '<table><thead><tr><th>' + translate('name') + '</th><th>' + translate('missing_fields') + '</th></tr></thead><tbody>';

    submissions.forEach(submission => {
        const formTypeData = formStructures[formType]; // Get the form type data

        // Extract the actual form structure (which contains the fields array)
        const formStructure = formTypeData?.form_structure;

        if (!formStructure || !formStructure.fields) {
            console.error('Invalid form structure for form type:', formType);
            return; // Skip this submission if form structure is invalid
        }

        // Get the participant's first and last name (assuming they're available in the submission_data)
        const firstName = submission.first_name || '-';
        const lastName = submission.last_name || '-';

        // Get missing fields
        const missingFields = this.getMissingFields(submission.submission_data, formStructure).map(field => translate(field));

        if (missingFields.length > 0) {
            reportContent += `<tr><td>${firstName} ${lastName}</td><td>${missingFields.join(', ')}</td></tr>`;
        }
    });

    reportContent += '</tbody></table>';
    return reportContent;
}


	getMissingFields(submissionData, formStructure) {
			const missingFields = [];

			formStructure.fields.forEach(field => {
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

		formStructure.fields.forEach(field => {
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
			return `<p>${translate('no_data_available')} for allergies report.</p>`;
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
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.allergies}</td>
							<td>${item.epipen ? translate("yes") : translate("no")}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderMedicationReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate('no_data_available')} for medication report.</p>`;
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
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.medication}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderVaccineReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return `<p>${translate('no_data_available')} report.</p>`;
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
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.vaccines_up_to_date ? translate("yes") : translate("no")}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderParticipantAgeReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return '<p>No data available for participants age report.</p>';
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
					${data.map(item => `
						<tr>
							<td>${item.first_name} ${item.last_name}</td>
							<td>${item.date_naissance ? new Date(item.date_naissance).toLocaleDateString() : translate("unknown")}</td>
							<td>${item.age !== null ? item.age : translate("unknown")}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}


	renderLeaveAloneReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return '<p>No data available for leave alone report.</p>';
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
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.can_leave_alone ? translate("yes") : translate("no")}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderMediaAuthorizationReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return '<p>No data available for media authorization report.</p>';
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
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.media_authorized ? translate("yes") : translate("no")}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderMissingDocumentsReport(reportData) {
		if ( !Array.isArray(reportData) || reportData.length === 0) {
			return '<p>No data available for missing documents report.</p>';
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
					${reportData.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name || translate("no_group")}</td>
							<td>${this.formatMissingDocuments(item.missing_documents)}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	formatMissingDocuments(missingDocs) {
		if (Array.isArray(missingDocs)) {
			return missingDocs.join(', ');
		} else if (typeof missingDocs === 'object' && missingDocs !== null) {
			return Object.values(missingDocs).join(', ');
		} else {
			return translate("no_missing_documents");
		}
	}

	// renderAttendanceReport(data) {
	// 	console.log("Rendering attendance report with data:", data); // Add this line for debugging

	// 	if (!data || typeof data !== 'object') {
	// 		console.error("Invalid data received in renderAttendanceReport:", data);
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
			if (!data || typeof data !== 'object') {
					return '<p>Error: Invalid data received for attendance report.</p>';
			}

			if (!data.success || !Array.isArray(data.attendance_data) || data.attendance_data.length === 0) {
					return '<p>No data available for attendance report.</p>';
			}

			// Define color codes for the attendance statuses
			const statusColors = {
					'P': '#FFFFFF',  // No color for Present
					'A': '#FF0000',  // Red for Absent
					'M': '#00BFFF',  // Blue for Motivated (excused)
					'R': '#FFFF00'   // Yellow for Late
			};

			// Normalize status mappings
			const normalizeStatus = (status) => {
					switch (status) {
							case 'present':
									return 'P'; // Present
							case 'absent':
									return 'A'; // Absent
							case 'excused':
							case 'motivated':
									return 'M'; // Motivated
							case 'late':
									return 'R'; // Late
							default:
									return '';  // Unknown status
					}
			};

			// Get unique dates from attendance data
			let uniqueDates = new Set();
			data.attendance_data.forEach(item => {
					let attendanceArray;
					try {
							// Parse the attendance JSON string into an array
							attendanceArray = JSON.parse(item.attendance);
					} catch (e) {
							console.error(`Failed to parse attendance for ${item.first_name} ${item.last_name}:`, item.attendance);
							return;
					}

					if (Array.isArray(attendanceArray)) {
							attendanceArray.forEach(attendance => {
									if (attendance.date) {
											uniqueDates.add(attendance.date);
									}
							});
					} else {
							console.error(`Invalid attendance data for ${item.first_name} ${item.last_name}:`, item.attendance);
					}
			});
			uniqueDates = Array.from(uniqueDates).sort(); // Convert Set to Array and sort the dates

			// Create the header
			let header = `
					<h2>${translate("attendance_report")}</h2>
					<p>${translate("report_period")}: ${data.start_date} to ${data.end_date}</p>
					<p>${translate("total_days")}: ${data.total_days}</p>
					<table class="attendance-table">
							<thead>
									<tr>
											<th>${translate("name")}</th>
											<th>${translate("group")}</th>
											${uniqueDates.map(date => `<th>${date}</th>`).join('')} <!-- Display date as string -->
									</tr>
							</thead>
							<tbody>
			`;

			// Iterate through the attendance data
			let rows = data.attendance_data.map(item => {
					let attendanceMap = {};
					let attendanceArray;

					try {
							// Parse the attendance JSON string into an array
							attendanceArray = JSON.parse(item.attendance);
					} catch (e) {
							console.error(`Failed to parse attendance for ${item.first_name} ${item.last_name}:`, item.attendance);
							return '';
					}

					if (Array.isArray(attendanceArray)) {
							attendanceArray.forEach(attendance => {
									if (attendance.date) {
											attendanceMap[attendance.date] = normalizeStatus(attendance.status);
									}
							});
					}

					// Create a row for each participant
					return `
							<tr>
									<td>${item.first_name} ${item.last_name}</td>
									<td>${item.group_name || translate("no_group")}</td>
									${uniqueDates.map(date => `
											<td style="background-color: ${statusColors[attendanceMap[date]] || '#FFFFFF'};">
													${attendanceMap[date] || ''}
											</td>
									`).join('')}
							</tr>
					`;
			}).join('');

			// Close the table and return the result
			let footer = `
							</tbody>
					</table>
			`;

			return header + rows + footer;
	}




	renderHonorsReport(data) {
		if (!Array.isArray(data) || data.length === 0) {
			return '<p>No data available for honors report.</p>';
		}

		return `
			<h2>${translate("honors_report")}</h2>
			<table>
				<thead>
					<tr>
						<th>${translate("name")}</th>
						<th>${translate("group")}</th>
						<th>${translate("honors_count")}</th>
					</tr>
				</thead>
				<tbody>
					${data.map(item => `
						<tr>
							<td>${item.name}</td>
							<td>${item.group_name}</td>
							<td>${item.honors_count}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	renderPointsReport(data) {
		if (typeof data !== 'object' || Object.keys(data).length === 0) {
			return `<p>${translate('no_data_available')} for points report.</p>`;
		}

		return `
			<h2>${translate("points_report")}</h2>
			${Object.entries(data).map(([group, participants]) => `
				<h3>${group}</h3>
				<table>
					<thead>
						<tr>
							<th>${translate("name")}</th>
							<th>${translate("points")}</th>
						</tr>
					</thead>
					<tbody>
						${participants.map(participant => `
							<tr>
								<td>${participant.name}</td>
								<td>${participant.points}</td>
							</tr>
						`).join('')}
					</tbody>
				</table>
			`).join('')}
		`;
	}

	printReport() {
		const printWindow = window.open('', '_blank');
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
					${document.getElementById('report-content').innerHTML}
				</body>
			</html>
		`);
		printWindow.document.close();
		printWindow.print();
	}
}