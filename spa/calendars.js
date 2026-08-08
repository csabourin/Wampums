import { getCalendarsForFundraiser, getFundraiser, updateCalendarEntry, updateCalendarPayment } from './ajax-functions.js';
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { clearFundraiserRelatedCaches } from './indexedDB.js';
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { openPrintWindow, setPrintContent } from "./utils/PrintUtils.js";
import { formatDateShort } from "./utils/DateUtils.js";
import { formatCurrency } from "./utils/NumberUtils.js";
import {
	DEFAULT_CAMPAIGN_TYPE,
	campaignTypeCapabilities,
	resolveEntryAmount,
} from "./modules/fundraising/campaignModel.js";

export class Calendars {
	constructor(app) {
		this.app = app;
		this.calendars = [];
		this.fundraiser = null;
		this.campaign = null;
		this.fundraiserId = null;
		this.sortBy = 'name'; // 'name' or 'paid'
		this.updateTimeout = null;
		this.boundInputHandler = (event) => this.handleInput(event);
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
			if (response.success && response.data?.fundraiser) {
				this.fundraiser = response.data.fundraiser;
			}
		} catch (error) {
			debugError('Error fetching fundraiser:', error);
			this.app.showMessage('error_fetching_fundraiser', 'error');
		}
	}

	async fetchCalendars() {
		try {
			const response = await getCalendarsForFundraiser(this.fundraiserId);
			this.calendars = response.data?.fundraiser_entries || [];
			// The entries endpoint returns the campaign shape so the table can show
			// only the measures this campaign type actually records.
			this.campaign = response.data?.campaign || this.fundraiser || null;
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

		const startDate = formatDateShort(this.fundraiser.start_date, this.app.lang);
		const endDate = formatDateShort(this.fundraiser.end_date, this.app.lang);

		const content = `
			<div class="calendars-header">
				<div class="header-nav">
					<a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
					<a href="/fundraisers" class="button button--ghost">← ${translate("back_to_fundraisers")}</a>
				</div>
				<div class="fundraiser-header-info">
					<h1>${escapeHTML(this.fundraiser.name)}</h1>
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
				${this.getCapabilities().usesQuantity ? `<p><strong>${translate("total_quantity")}:</strong> ${this.getTotalQuantity()}</p>` : ''}
				${this.getCapabilities().usesHours ? `<p><strong>${translate("total_hours")}:</strong> ${this.getTotalHours()}</p>` : ''}
				<p><strong>${translate("total_raised")}:</strong> ${formatCurrency(this.getTotalAmount(), this.app.lang)}</p>
				<p><strong>${translate("total_collected")}:</strong> ${formatCurrency(this.getTotalPaid(), this.app.lang)}</p>
				<p><strong>${translate("participants_paid")}:</strong> ${this.getPaidCount()} / ${this.calendars.length}</p>
			</div>

			<button id="print-view-btn" class="secondary-btn">${translate('print_view')}</button>
		`;
		setContent(document.getElementById('app'), content);
	}

	/**
	 * Measures recorded by the current campaign type.
	 * @returns {{usesQuantity: boolean, usesHours: boolean, usesUnitPrice: boolean, usesDirectAmount: boolean}}
	 */
	getCapabilities() {
		return campaignTypeCapabilities(this.campaign?.campaign_type || DEFAULT_CAMPAIGN_TYPE);
	}

	/**
	 * Column definitions shared by the table head and its rows, so headers and
	 * cells cannot drift apart.
	 *
	 * @returns {Array<{key: string, label: string, numeric: boolean}>}
	 */
	getEntryColumns() {
		const capabilities = this.getCapabilities();
		const unitLabel = this.campaign?.unit_label
			? `${translate('quantity')} (${escapeHTML(this.campaign.unit_label)})`
			: translate('quantity');

		const columns = [
			{ key: 'name', label: translate('name'), numeric: false },
			{ key: 'group', label: translate('group'), numeric: false },
		];

		if (capabilities.usesQuantity) {
			columns.push({ key: 'quantity', label: unitLabel, numeric: true });
		}
		if (capabilities.usesHours) {
			columns.push({ key: 'hours', label: translate('hours_worked'), numeric: true });
		}
		if (capabilities.usesDirectAmount) {
			columns.push({ key: 'amount_raised', label: translate('amount_raised'), numeric: true });
		} else {
			columns.push({ key: 'computed_amount', label: translate('amount_raised'), numeric: true });
		}

		columns.push({ key: 'amount_paid', label: translate('amount_paid'), numeric: true });
		columns.push({ key: 'paid', label: translate('paid'), numeric: false });

		return columns;
	}

	renderCalendarsTable() {
		if (this.calendars.length === 0) {
			return `<p class="no-data">${translate("no_fundraiser_entries_data")}</p>`;
		}

		const columns = this.getEntryColumns();

		return `
			<div class="table-scroll">
				<table class="calendars-table data-table" role="table">
					<thead>
						<tr>
							${columns.map(column => `<th scope="col" class="${column.numeric ? 'text-right' : ''}">${column.label}</th>`).join('')}
						</tr>
					</thead>
					<tbody>
						${this.calendars.map(calendar => this.renderCalendarRow(calendar, columns)).join('')}
					</tbody>
				</table>
			</div>
		`;
	}

	/**
	 * Render one participant row using the shared column definitions.
	 *
	 * @param {Object} calendar - Fundraiser entry
	 * @param {Array<{key: string, label: string, numeric: boolean}>} columns - Column definitions
	 * @returns {string} HTML table row
	 */
	renderCalendarRow(calendar, columns = this.getEntryColumns()) {
		const participantName = `${calendar.first_name} ${calendar.last_name}`;
		const numberInput = (fieldKey, value, step, ariaLabel) => `
			<input
				type="number"
				class="entry-input entry-input--${fieldKey}"
				data-field="${fieldKey}"
				data-calendar-id="${calendar.id}"
				value="${value ?? ''}"
				min="0"
				step="${step}"
				aria-label="${ariaLabel} — ${escapeHTML(participantName)}">
		`;

		const cells = columns.map((column) => {
			switch (column.key) {
				case 'name':
					return `<td data-label="${column.label}">${escapeHTML(participantName)}</td>`;
				case 'group':
					return `<td data-label="${column.label}">${escapeHTML(calendar.group_name || translate('no_group'))}</td>`;
				case 'quantity':
					return `<td class="text-right" data-label="${column.label}">${numberInput('quantity', calendar.quantity ?? calendar.calendar_amount ?? 0, '1', column.label)}</td>`;
				case 'hours':
					return `<td class="text-right" data-label="${column.label}">${numberInput('hours', calendar.hours ?? 0, '0.25', column.label)}</td>`;
				case 'amount_raised':
					return `<td class="text-right" data-label="${column.label}">${numberInput('amount_raised', calendar.amount_raised ?? '', '0.01', column.label)}</td>`;
				case 'computed_amount':
					return `<td class="text-right amount" data-label="${column.label}">${formatCurrency(this.getEntryAmount(calendar), this.app.lang)}</td>`;
				case 'amount_paid':
					return `<td class="text-right" data-label="${column.label}">${numberInput('amount_paid', calendar.amount_paid ?? 0, '0.01', column.label)}</td>`;
				case 'paid':
					return `
						<td data-label="${column.label}">
							<input
								type="checkbox"
								class="paid-checkbox"
								data-calendar-id="${calendar.id}"
								${calendar.paid ? 'checked' : ''}
								aria-label="${translate('paid_status_for')} ${escapeHTML(participantName)}">
						</td>
					`;
				default:
					return `<td data-label="${column.label}"></td>`;
			}
		}).join('');

		return `<tr data-calendar-id="${calendar.id}">${cells}</tr>`;
	}

	/**
	 * Money raised by one entry, resolved the same way the API does.
	 *
	 * @param {Object} calendar - Fundraiser entry
	 * @returns {number} Money raised
	 */
	getEntryAmount(calendar) {
		if (calendar.entry_amount !== undefined && calendar.entry_amount !== null) {
			return parseFloat(calendar.entry_amount) || 0;
		}
		return resolveEntryAmount(calendar, this.campaign || {});
	}

	/**
	 * Total money raised across every entry.
	 * @returns {number} Money raised
	 */
	getTotalAmount() {
		return this.calendars.reduce((sum, calendar) => sum + this.getEntryAmount(calendar), 0);
	}

	/**
	 * Total number of units recorded across every entry.
	 * @returns {number} Unit count
	 */
	getTotalQuantity() {
		return this.calendars.reduce(
			(sum, calendar) => sum + (parseFloat(calendar.quantity ?? calendar.calendar_amount) || 0),
			0,
		);
	}

	/**
	 * Total hours recorded across every entry.
	 * @returns {number} Hours
	 */
	getTotalHours() {
		return this.calendars.reduce((sum, calendar) => sum + (parseFloat(calendar.hours) || 0), 0);
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
			btn.onclick = () => {
				this.sortBy = btn.dataset.sort;
				this.applySorting();
				this.updateTableOnly();
			};
		});

		document.removeEventListener('input', this.boundInputHandler);
		document.addEventListener('input', this.boundInputHandler);

		// Print button
		const printBtn = document.getElementById('print-view-btn');
		if (printBtn) {
			printBtn.onclick = () => this.showPrintView();
		}
	}

	async handleInput(event) {
		const target = event.target;
		const calendarId = target?.dataset?.calendarId;
		if (!calendarId) {
			return;
		}

		if (target.classList.contains('paid-checkbox')) {
			await this.updateCalendarPaid(calendarId, target.checked);
			return;
		}

		const field = target.dataset.field;
		if (!field) {
			return;
		}

		clearTimeout(this.updateTimeout);
		const rawValue = target.value;

		this.updateTimeout = setTimeout(async () => {
			if (field === 'amount_paid') {
				await this.updateCalendarAmountPaid(calendarId, rawValue);
				return;
			}
			await this.updateCalendarMeasure(calendarId, field, rawValue);
		}, 500); // Debounce 500ms
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

			// Bind controls created by the table re-render.
			this.initEventListeners();
	}

	/**
	 * Refresh only the totals block. Re-rendering the whole table while a cell is
	 * being edited would steal focus from the input the user is typing in.
	 *
	 * @returns {void}
	 */
	updateSummaryOnly() {
		const summary = document.querySelector('.calendars-summary');
		if (!summary) {
			return;
		}

		const capabilities = this.getCapabilities();
		setContent(summary, `
			<p><strong>${translate("total_participants")}:</strong> ${this.calendars.length}</p>
			${capabilities.usesQuantity ? `<p><strong>${translate("total_quantity")}:</strong> ${this.getTotalQuantity()}</p>` : ''}
			${capabilities.usesHours ? `<p><strong>${translate("total_hours")}:</strong> ${this.getTotalHours()}</p>` : ''}
			<p><strong>${translate("total_raised")}:</strong> ${formatCurrency(this.getTotalAmount(), this.app.lang)}</p>
			<p><strong>${translate("total_collected")}:</strong> ${formatCurrency(this.getTotalPaid(), this.app.lang)}</p>
			<p><strong>${translate("participants_paid")}:</strong> ${this.getPaidCount()} / ${this.calendars.length}</p>
		`);
	}

	/**
	 * Persist one measure of a fundraiser entry (units, hours or money raised).
	 *
	 * @param {string|number} calendarId - Entry identifier
	 * @param {'quantity'|'hours'|'amount_raised'} field - Measure being edited
	 * @param {string} rawValue - Raw input value; an empty string clears the measure
	 * @returns {Promise<void>}
	 */
	async updateCalendarMeasure(calendarId, field, rawValue) {
		const value = rawValue === '' ? null : Number(rawValue);
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			this.app.showMessage('error_updating_fundraiser_entry_amount', 'error');
			return;
		}

		try {
			const payload = { [field]: value };
			// Keep the legacy integer column aligned with the unit count so reports
			// written against pre-migration data stay correct.
			if (field === 'quantity') {
				payload.amount = value === null ? null : Math.round(value);
			}

			const response = await updateCalendarEntry(calendarId, payload);

			if (!response?.success) {
				this.app.showMessage('error_updating_fundraiser_entry_amount', 'error');
				return;
			}

			const calendar = this.calendars.find(c => String(c.id) === String(calendarId));
			if (calendar) {
				calendar[field] = value;
				if (field === 'quantity') {
					calendar.calendar_amount = value === null ? null : Math.round(value);
				}
				if (response.data?.entry_amount !== undefined) {
					calendar.entry_amount = response.data.entry_amount;
				} else {
					delete calendar.entry_amount;
				}
			}

			// Invalidate fundraisers cache so totals are updated
			await clearFundraiserRelatedCaches(this.fundraiserId);
			this.app.showMessage('fundraiser_entry_amount_updated', 'success');
			this.updateSummaryOnly();
		} catch (error) {
			debugError('Error updating fundraiser entry measure:', error);
			this.app.showMessage('error_updating_fundraiser_entry_amount', 'error');
		}
	}

	async updateCalendarAmountPaid(calendarId, amountPaid) {
		try {
			const response = await updateCalendarPayment(calendarId, parseFloat(amountPaid) || 0);

			if (response.success) {
				// Update local data
				const calendar = this.calendars.find(c => String(c.id) === String(calendarId));
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
				this.updateSummaryOnly();
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
				const calendar = this.calendars.find(c => String(c.id) === String(calendarId));
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
		const printCapabilities = this.getCapabilities();
			const startDate = formatDateShort(this.fundraiser.start_date, this.app.lang);
			const endDate = formatDateShort(this.fundraiser.end_date, this.app.lang);

			const printWindow = openPrintWindow();
			if (!printWindow) {
				this.app.showMessage(translate("popup_blocked"), "error");
				return;
			}
			setPrintContent(printWindow, `
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
					<h1>${escapeHTML(this.fundraiser.name)}</h1>
					<div class="fundraiser-info">${startDate} - ${endDate}</div>
					<table class="print-table">
						<thead>
							<tr>
								<th scope="col">${translate("name_column")}</th>
								<th scope="col">${translate("group")}</th>
								${printCapabilities.usesQuantity ? `<th scope="col">${translate("quantity_column")}</th>` : ''}
								${printCapabilities.usesHours ? `<th scope="col">${translate("hours_worked")}</th>` : ''}
								<th scope="col">${translate("amount_raised")}</th>
								<th scope="col">${translate("amount_paid_column")}</th>
								<th scope="col">${translate("paid_column")}</th>
							</tr>
						</thead>
						<tbody>
							${this.calendars.map(calendar => `
								<tr>
									<td>${escapeHTML(`${calendar.first_name} ${calendar.last_name}`)}</td>
									<td>${escapeHTML(calendar.group_name || translate("no_group"))}</td>
									${printCapabilities.usesQuantity ? `<td><div class="amount-box">${calendar.quantity ?? calendar.calendar_amount ?? ''}</div></td>` : ''}
									${printCapabilities.usesHours ? `<td><div class="amount-box">${calendar.hours ?? ''}</div></td>` : ''}
									<td><div class="amount-paid-box">${formatCurrency(this.getEntryAmount(calendar), this.app.lang)}</div></td>
									<td><div class="amount-paid-box">${formatCurrency(calendar.amount_paid || 0, this.app.lang)}</div></td>
									<td><div class="paid-box">${calendar.paid ? '✓' : ''}</div></td>
								</tr>
							`).join('')}
							<tr class="total-row">
								<td colspan="2">${translate("total")}</td>
								${printCapabilities.usesQuantity ? `<td>${this.getTotalQuantity()}</td>` : ''}
								${printCapabilities.usesHours ? `<td>${this.getTotalHours()}</td>` : ''}
								<td>${formatCurrency(totalAmount, this.app.lang)}</td>
								<td>${formatCurrency(totalAmountPaid, this.app.lang)}</td>
								<td></td>
							</tr>
						</tbody>
					</table>
				</body>
			</html>
			`, `${this.fundraiser.name} - ${translate("fundraiser_sales_title")}`);
		printWindow.document.close();
			printWindow.print();
		}

	destroy() {
		clearTimeout(this.updateTimeout);
		document.removeEventListener('input', this.boundInputHandler);
	}
}
