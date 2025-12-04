import { getCalendars, updateCalendar, updateCalendarPaid, updateCalendarAmountPaid } from './ajax-functions.js';
import { translate } from "./app.js";

export class Calendars {
	constructor(app) {
		this.app = app;
		this.calendars = [];
	}

	async init() {
		await this.fetchCalendars();
		this.render();
		this.initEventListeners();
	}

	async fetchCalendars() {
		try {
			const response = await getCalendars();
			this.calendars = response.calendars || [];
			this.calendars.sort((a, b) => a.first_name.localeCompare(b.first_name));
		} catch (error) {
			console.error('Error fetching calendars:', error);
			this.app.showMessage('error_fetching_calendars', 'error');
		}
	}

	render() {
		const content = `
			<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
			<h1>${this.app.translate('calendar_sales')}</h1>
			<div id="calendars-table-container">
				${this.renderCalendarsTable()}
			</div>
			<button id="print-view-btn">${this.app.translate('print_view')}</button>
			<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
		`;
		document.getElementById('app').innerHTML = content;
	}

	renderCalendarsTable() {
		return `
			<table class="calendars-table">
				<thead>
					<tr>
						<th>${this.app.translate('name')}</th>
						<th>${this.app.translate('amount')}</th>
						<th>${this.app.translate('amount_paid')}</th>
						<th>${this.app.translate('paid')}</th>
					</tr>
				</thead>
				<tbody>
					${this.calendars.map(calendar => `
						<tr>
							<td>${calendar.first_name} ${calendar.last_name}</td>
							<td>
								<input type="number" class="amount-input" data-participant-id="${calendar.participant_id}" value="${calendar.calendar_amount}" min="0">
							</td>
							<td>
								<input type="number" step="0.01" class="amount-paid-input" data-participant-id="${calendar.participant_id}" value="${calendar.amount_paid}" min="0">
							</td>
							<td>
								<input type="checkbox" class="paid-checkbox" data-participant-id="${calendar.participant_id}" ${calendar.paid ? 'checked' : ''}>
							</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
	}

	initEventListeners() {
		document.addEventListener('input', async (event) => {
			if (event.target.classList.contains('amount-input')) {
				const participantId = event.target.dataset.participantId;
				const amount = event.target.value;
				const amountPaid = document.querySelector(`.amount-paid-input[data-participant-id="${participantId}"]`).value;
				await this.updateCalendarAmount(participantId, amount, amountPaid);
			} else if (event.target.classList.contains('amount-paid-input')) {
				const participantId = event.target.dataset.participantId;
				const amountPaid = event.target.value;
				await this.updateCalendarAmountPaid(participantId, amountPaid);
			} else if (event.target.classList.contains('paid-checkbox')) {
				const participantId = event.target.dataset.participantId;
				const paid = event.target.checked;
				await this.updateCalendarPaid(participantId, paid);
			}
		});

		document.getElementById('print-view-btn').addEventListener('click', () => {
			this.showPrintView();
		});
	}

	async updateCalendarAmount(participantId, amount, amountPaid) {
		try {
			await updateCalendar(participantId, amount, amountPaid);
			this.app.showMessage('calendar_amount_updated', 'success');
		} catch (error) {
			console.error('Error updating calendar amount:', error);
			this.app.showMessage('error_updating_calendar_amount', 'error');
		}
	}

	async updateCalendarAmountPaid(participantId, amountPaid) {
		try {
			await updateCalendarAmountPaid(participantId, amountPaid);
			this.app.showMessage('calendar_amount_paid_updated', 'success');
		} catch (error) {
			console.error('Error updating calendar amount paid:', error);
			this.app.showMessage('error_updating_calendar_amount_paid', 'error');
		}
	}

	async updateCalendarPaid(participantId, paid) {
		try {
			await updateCalendarPaid(participantId, paid);
			this.app.showMessage('calendar_paid_status_updated', 'success');
		} catch (error) {
			console.error('Error updating calendar paid status:', error);
			this.app.showMessage('error_updating_calendar_paid_status', 'error');
		}
	}

	showPrintView() {
		const totalAmount = this.calendars.reduce((sum, calendar) => sum + parseFloat(calendar.calendar_amount || 0), 0);
		const totalAmountPaid = this.calendars.reduce((sum, calendar) => sum + parseFloat(calendar.amount_paid || 0), 0);

		const printWindow = window.open('', '_blank');
		printWindow.document.write(`
			<html>
				<head>
					<title>${translate("calendar_sales_title")}</title>
					<style>
						@page {
							size: letter;
							margin: 0.5in;
						}
						body {
							font-family: Arial, sans-serif;
							font-size: 12pt;
						}
						h1 {
							text-align: center;
							margin-bottom: 20px;
						}
						.print-table {
							width: 100%;
							border-collapse: collapse;
						}
						.print-table th, .print-table td {
							border: 1px solid black;
							padding: 5px;
							text-align: left;
						}
						.print-table th {
							background-color: #f2f2f2;
						}
						.amount-box, .amount-paid-box {
							width: 50px;
							height: 25px;
							border: 1px solid black;
							display: inline-block;
							text-align: center;
							line-height: 30px;
							font-size: 16px;
						}
						.paid-box {
							width: 30px;
							height: 25px;
							border: 1px solid black;
							display: inline-block;
							text-align: center;
							line-height: 25px;
							font-size: 16px;
						}
						.total-row {
							font-weight: bold;
						}
					</style>
				</head>
				<body>
					<h1>${translate("calendar_sales_title")}</h1>
					<table class="print-table">
						<thead>
							<tr>
								<th>${translate("name_column")}</th>
								<th>${translate("quantity_column")}</th>
								<th>${translate("amount_paid_column")}</th>
								<th>${translate("paid_column")}</th>
							</tr>
						</thead>
						<tbody>
							${this.calendars.map(calendar => `
								<tr>
									<td>${calendar.first_name} ${calendar.last_name}</td>
									<td><div class="amount-box">${calendar.calendar_amount || ''}</div></td>
									<td><div class="amount-paid-box">${calendar.amount_paid || '0.00'}</div></td>
									<td><div class="paid-box">${calendar.paid ? '✓' : ''}</div></td>
								</tr>
							`).join('')}
							<tr class="total-row">
								<td>${translate("total")}</td>
								<td>${totalAmount.toFixed(2)}</td>
								<td>${totalAmountPaid.toFixed(2)}</td>
								<td></td>
							</tr>
						</tbody>
					</table>
				</body>
			</html>
		`);
		printWindow.document.close();
		printWindow.print();
	}

}