// reports.js
import { translate } from "./app.js";
import {
	getAllergiesReport,
	getMedicationReport,
	getVaccineReport,
	getLeaveAloneReport,
	getMediaAuthorizationReport,
	getMissingDocumentsReport,
	getAttendanceReport,
	getHonorsReport,
	getPointsReport,
	getParticipantAgeReport
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
		this.attachEventListeners();
	}

	render() {
		const content = `
			<h1>${translate("reports")}</h1>
			<div class="reports-menu">
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

	async loadReport(reportType) {
		try {
			let reportData;
			let reportContent;

			switch (reportType) {
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