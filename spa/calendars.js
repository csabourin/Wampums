import { getCalendarsForFundraiser, getFundraiser, updateCalendarEntry, updateCalendarPayment } from './ajax-functions.js';
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { clearFundraiserRelatedCaches } from './indexedDB.js';
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class Calendars {
	constructor(app) {
		this.app = app;
		this.calendars = [];
		this.fundraiser = null;
		this.fundraiserId = null;
		this.sortBy = 'name'; // 'name' or 'paid'
	}

	async init(fundraiserId) {
		if (!fundraiserId) {
			debugError('No fundraiser ID provided');
			this.app.showMessage('error_no_fundraiser_id', 'error');
			return;
		}

		this.fundraiserId = fundraiserId;
		await this.fetchFundraiser();
		await this.fetchCalendars();
		this.render();
		this.initEventListeners();
	}

	async fetchFundraiser() {
		try {
			const response = await getFundraiser(this.fundraiserId);
			if (response.success && response.fundraiser) {
				this.fundraiser = response.fundraiser;
			}
		} catch (error) {
			debugError('Error fetching fundraiser:', error);
			this.app.showMessage('error_fetching_fundraiser', 'error');
		}
	}

	async fetchCalendars() {
		try {
			const response = await getCalendarsForFundraiser(this.fundraiserId);
			this.calendars = response.fundraiser_entries || [];
			this.applySorting();
		} catch (error) {
			debugError('Error fetching fundraiser entries:', error);
			this.app.showMessage('error_fetching_fundraiser_entries', 'error');
		}
	}

	applySorting() {
		if (this.sortBy === 'name') {
			this.calendars.sort((a, b) => a.first_name.localeCompare(b.first_name));
		} else if (this.sortBy === 'paid') {
			// Sort by paid status (unpaid first), then by name
			this.calendars.sort((a, b) => {
				if (a.paid === b.paid) {
					return a.first_name.localeCompare(b.first_name);
				}
				return a.paid ? 1 : -1;
			});
		}
	}

	render() {
		if (!this.fundraiser) {
			return;
		}

		const startDate = new Date(this.fundraiser.start_date).toLocaleDateString();
		const endDate = new Date(this.fundraiser.end_date).toLocaleDateString();

		const content = `
			<div class="calendars-header">
				<div class="header-nav">
					<a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
					<a href="/fundraisers" class="button button--ghost">← ${translate("back_to_fundraisers")}</a>
				</div>
				<div class="fundraiser-header-info">
					<h1>${this.fundraiser.name}</h1>
					<p class="fundraiser-dates">${startDate} - ${endDate}</p>
				</div>
			</div>

			<div class="calendars-controls">
				<div class="sort-toggle" role="group" aria-label="${translate("sort_options")}">
					<button
						class="sort-btn ${this.sortBy === 'name' ? 'active' : ''}"
						data-sort="name"
						aria-pressed="${this.sortBy === 'name'}"
						title="${translate("sort_by_name")}">
						👤 ${translate("name")}
					</button>
					<button
						class="sort-btn ${this.sortBy === 'paid' ? 'active' : ''}"
						data-sort="paid"
						aria-pressed="${this.sortBy === 'paid'}"
						title="${translate("sort_by_paid_status")}">
						💰 ${translate("paid_status")}
					</button>
				</div>
			</div>

			<div id="calendars-table-container" class="calendars-table-container">
				${this.renderCalendarsTable()}
			</div>

			<div class="calendars-summary">
				<p><strong>${translate("total_participants")}:</strong> ${this.calendars.length}</p>
				<p><strong>${translate("total_sold")}:</strong> ${this.getTotalAmount()}</p>
				<p><strong>${translate("total_collected")}:</strong> $${this.getTotalPaid().toFixed(2)}</p>
				<p><strong>${translate("participants_paid")}:</strong> ${this.getPaidCount()} / ${this.calendars.length}</p>
			</div>

			<button id="print-view-btn" class="secondary-btn">${translate('print_view')}</button>
		`;
		setContent(document.getElementById('app'), content);
	}

	renderCalendarsTable() {
		if (this.calendars.length === 0) {
			return `<p class="no-data">${translate("no_fundraiser_entries_data")}</p>`;
		}

		return `
			<table class="calendars-table" role="table">
				<thead>
					<tr>
						<th scope="col">${translate('name')}</th>
						<th scope="col">${translate('group')}</th>
						<th scope="col">${translate('amount')}</th>
						<th scope="col">${translate('amount_paid')}</th>
						<th scope="col">${translate('paid')}</th>
					</tr>
				</thead>
				<tbody>
					${this.calendars.map(calendar => this.renderCalendarRow(calendar)).join('')}
				</tbody>
			</table>
		`;
	}

        renderCalendarRow(calendar) {
                return `
                        <tr data-calendar-id="${calendar.id}">
                                <td data-label="${translate('name')}">${calendar.first_name} ${calendar.last_name}</td>
                                <td data-label="${translate('group')}">${calendar.group_name || translate('no_group')}</td>
                                <td data-label="${translate('amount')}">
                                        <input
                                                type="number"
                                                class="amount-input"
                                                data-calendar-id="${calendar.id}"
                                                value="${calendar.calendar_amount || 0}"
						min="0"
                                                aria-label="${translate('amount_for')} ${calendar.first_name} ${calendar.last_name}">
                                </td>
                                <td data-label="${translate('amount_paid')}">
                                        <input
                                                type="number"
                                                step="0.01"
                                                class="amount-paid-input"
                                                data-calendar-id="${calendar.id}"
						value="${calendar.amount_paid || 0}"
						min="0"
                                                aria-label="${translate('amount_paid_for')} ${calendar.first_name} ${calendar.last_name}">
                                </td>
                                <td data-label="${translate('paid')}">
                                        <input
                                                type="checkbox"
                                                class="paid-checkbox"
                                                data-calendar-id="${calendar.id}"
						${calendar.paid ? 'checked' : ''}
						aria-label="${translate('paid_status_for')} ${calendar.first_name} ${calendar.last_name}">
				</td>
			</tr>
		`;
	}

	getTotalAmount() {
		return this.calendars.reduce((sum, calendar) => sum + (parseInt(calendar.calendar_amount) || 0), 0);
	}

	getTotalPaid() {
		return this.calendars.reduce((sum, calendar) => sum + (parseFloat(calendar.amount_paid) || 0), 0);
	}

	getPaidCount() {
		return this.calendars.filter(calendar => calendar.paid).length;
	}

	initEventListeners() {
		// Sort button clicks
		document.querySelectorAll('.sort-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this.sortBy = btn.dataset.sort;
				this.applySorting();
				this.updateTableOnly();
			});
		});

		// Input changes with debouncing
		let updateTimeout;

		document.addEventListener('input', async (event) => {
			clearTimeout(updateTimeout);

			if (event.target.classList.contains('amount-input')) {
				const calendarId = event.target.dataset.calendarId;
				const amount = event.target.value;

				updateTimeout = setTimeout(async () => {
					await this.updateCalendarAmount(calendarId, amount);
				}, 500); // Debounce 500ms

			} else if (event.target.classList.contains('amount-paid-input')) {
				const calendarId = event.target.dataset.calendarId;
				const amountPaid = event.target.value;

				updateTimeout = setTimeout(async () => {
					await this.updateCalendarAmountPaid(calendarId, amountPaid);
				}, 500); // Debounce 500ms

			} else if (event.target.classList.contains('paid-checkbox')) {
				const calendarId = event.target.dataset.calendarId;
				const paid = event.target.checked;
				await this.updateCalendarPaid(calendarId, paid);
			}
		});

		// Print button
		const printBtn = document.getElementById('print-view-btn');
		if (printBtn) {
			printBtn.addEventListener('click', () => {
				this.showPrintView();
			});
		}
	}

	updateTableOnly() {
		const container = document.getElementById('calendars-table-container');
		if (container) {
			setContent(container, this.renderCalendarsTable());
		}

		// Update sort button states
		document.querySelectorAll('.sort-btn').forEach(btn => {
			if (btn.dataset.sort === this.sortBy) {
				btn.classList.add('active');
				btn.setAttribute('aria-pressed', 'true');
			} else {
				btn.classList.remove('active');
				btn.setAttribute('aria-pressed', 'false');
			}
		});

		// Re-attach input listeners
		this.initEventListeners();
	}

	async updateCalendarAmount(calendarId, amount) {
		try {
			const response = await updateCalendarEntry(calendarId, {
				amount: parseInt(amount) || 0
			});

			if (response.success) {
				// Update local data
				const calendar = this.calendars.find(c => c.id == calendarId);
				if (calendar) {
					calendar.calendar_amount = parseInt(amount) || 0;
				}
				// Invalidate fundraisers cache so totals are updated
                                await clearFundraiserRelatedCaches(this.fundraiserId);
				this.app.showMessage('fundraiser_entry_amount_updated', 'success');
			}
		} catch (error) {
			debugError('Error updating fundraiser entry amount:', error);
			this.app.showMessage('error_updating_fundraiser_entry_amount', 'error');
		}
	}

	async updateCalendarAmountPaid(calendarId, amountPaid) {
		try {
			const response = await updateCalendarPayment(calendarId, parseFloat(amountPaid) || 0);

			if (response.success) {
				// Update local data
				const calendar = this.calendars.find(c => c.id == calendarId);
				if (calendar) {
					calendar.amount_paid = parseFloat(amountPaid) || 0;
					// Update paid status based on server response
					if (response.data && response.data.paid !== undefined) {
						calendar.paid = response.data.paid;
					}
				}
				// Invalidate fundraisers cache so totals are updated
                                await clearFundraiserRelatedCaches(this.fundraiserId);
				this.app.showMessage('fundraiser_entry_amount_paid_updated', 'success');
				this.updateTableOnly();
			}
		} catch (error) {
			debugError('Error updating fundraiser entry amount paid:', error);
			this.app.showMessage('error_updating_fundraiser_entry_amount_paid', 'error');
		}
	}

	async updateCalendarPaid(calendarId, paid) {
		try {
			const response = await updateCalendarEntry(calendarId, { paid });

			if (response.success) {
				// Update local data
				const calendar = this.calendars.find(c => c.id == calendarId);
				if (calendar) {
					calendar.paid = paid;
				}
				// Invalidate fundraisers cache so totals are updated
                                await clearFundraiserRelatedCaches(this.fundraiserId);
				this.app.showMessage('fundraiser_entry_paid_status_updated', 'success');
			}
		} catch (error) {
			debugError('Error updating fundraiser entry paid status:', error);
			this.app.showMessage('error_updating_fundraiser_entry_paid_status', 'error');
		}
	}

	showPrintView() {
		const totalAmount = this.getTotalAmount();
		const totalAmountPaid = this.getTotalPaid();
		const startDate = new Date(this.fundraiser.start_date).toLocaleDateString();
		const endDate = new Date(this.fundraiser.end_date).toLocaleDateString();

		const printWindow = window.open('', '_blank');
		printWindow.document.write(`
			<html>
				<head>
					<title>${this.fundraiser.name} - ${translate("fundraiser_sales_title")}</title>
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
							margin-bottom: 10px;
						}
						.fundraiser-info {
							text-align: center;
							margin-bottom: 20px;
							font-size: 11pt;
							color: #666;
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
					<h1>${this.fundraiser.name}</h1>
					<div class="fundraiser-info">${startDate} - ${endDate}</div>
					<table class="print-table">
						<thead>
							<tr>
								<th>${translate("name_column")}</th>
								<th>${translate("group")}</th>
								<th>${translate("quantity_column")}</th>
								<th>${translate("amount_paid_column")}</th>
								<th>${translate("paid_column")}</th>
							</tr>
						</thead>
						<tbody>
							${this.calendars.map(calendar => `
								<tr>
									<td>${calendar.first_name} ${calendar.last_name}</td>
									<td>${calendar.group_name || translate("no_group")}</td>
									<td><div class="amount-box">${calendar.calendar_amount || ''}</div></td>
									<td><div class="amount-paid-box">${calendar.amount_paid || '0.00'}</div></td>
									<td><div class="paid-box">${calendar.paid ? '✓' : ''}</div></td>
								</tr>
							`).join('')}
							<tr class="total-row">
								<td colspan="2">${translate("total")}</td>
								<td>${totalAmount}</td>
								<td>$${totalAmountPaid.toFixed(2)}</td>
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
