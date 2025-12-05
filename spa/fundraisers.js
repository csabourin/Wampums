import { getFundraisers, createFundraiser, updateFundraiser, archiveFundraiser } from './ajax-functions.js';
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { translate } from "./app.js";

export class Fundraisers {
	constructor(app) {
		this.app = app;
		this.fundraisers = [];
		this.archivedFundraisers = [];
		this.showArchived = false;
		this.editingFundraiser = null;
	}

	async init() {
		await this.fetchFundraisers();
		this.render();
		this.initEventListeners();
	}

	async fetchFundraisers() {
		try {
			const response = await getFundraisers(true); // Get all including archived
			if (response.success && response.fundraisers) {
				this.fundraisers = response.fundraisers.filter(f => !f.archived);
				this.archivedFundraisers = response.fundraisers.filter(f => f.archived);

				// Sort by start_date descending (most recent first)
				this.fundraisers.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
				this.archivedFundraisers.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
			}
		} catch (error) {
			debugError('Error fetching fundraisers:', error);
			this.app.showMessage('error_fetching_fundraisers', 'error');
		}
	}

	render() {
		const content = `
			<div class="fundraisers-header">
				<a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}" title="${translate("back_to_dashboard")}">🏠</a>
				<h1>${translate("fundraisers")}</h1>
			</div>

			${this.renderAddButton()}

			<div class="fundraisers-container">
				${this.renderFundraisers()}
				${this.renderArchivedSection()}
			</div>

			${this.renderModal()}
		`;
		document.getElementById('app').innerHTML = content;
	}

	renderAddButton() {
		if (this.app.userRole === 'admin' || this.app.userRole === 'animation') {
			return `
				<button id="add-fundraiser-btn" class="primary-btn" aria-label="${translate("add_fundraiser")}">
					${translate("add_fundraiser")}
				</button>
			`;
		}
		return '';
	}

	renderFundraisers() {
		if (this.fundraisers.length === 0) {
			return `<p class="no-data">${translate("no_fundraisers")}</p>`;
		}

		return `
			<div class="fundraisers-list" role="list">
				${this.fundraisers.map(fundraiser => this.renderFundraiserCard(fundraiser)).join('')}
			</div>
		`;
	}

	renderFundraiserCard(fundraiser) {
		const startDate = new Date(fundraiser.start_date).toLocaleDateString();
		const endDate = new Date(fundraiser.end_date).toLocaleDateString();
		const isActive = new Date() >= new Date(fundraiser.start_date) && new Date() <= new Date(fundraiser.end_date);
		const statusBadge = isActive ?
			`<span class="status-badge active" aria-label="${translate("active")}">${translate("active")}</span>` :
			`<span class="status-badge inactive" aria-label="${translate("inactive")}">${translate("inactive")}</span>`;

		const canEdit = this.app.userRole === 'admin' || this.app.userRole === 'animation';

		return `
			<article class="fundraiser-card" role="listitem">
				<div class="fundraiser-card-header">
					<h2>${fundraiser.name}</h2>
					${statusBadge}
				</div>
				<div class="fundraiser-card-body">
					<div class="fundraiser-info">
						<p><strong>${translate("start_date")}:</strong> ${startDate}</p>
						<p><strong>${translate("end_date")}:</strong> ${endDate}</p>
						<p><strong>${translate("participants")}:</strong> ${fundraiser.participant_count}</p>
						<p><strong>${translate("total_sold")}:</strong> ${fundraiser.total_amount || 0}</p>
						<p><strong>${translate("total_collected")}:</strong> $${parseFloat(fundraiser.total_paid || 0).toFixed(2)}</p>
						${fundraiser.objective ? `<p><strong>${translate("objective")}:</strong> $${parseFloat(fundraiser.objective).toFixed(2)}</p>` : ''}
					</div>
				</div>
				<div class="fundraiser-card-footer">
					<a href="/calendars/${fundraiser.id}" class="btn-link" aria-label="${translate("view_calendars_for")} ${fundraiser.name}">
						${translate("view_calendars")}
					</a>
					${canEdit ? `
						<button class="btn-secondary edit-fundraiser-btn" data-id="${fundraiser.id}" aria-label="${translate("edit")} ${fundraiser.name}">
							${translate("edit")}
						</button>
						<button class="btn-danger archive-fundraiser-btn" data-id="${fundraiser.id}" aria-label="${translate("archive")} ${fundraiser.name}">
							${translate("archive")}
						</button>
					` : ''}
				</div>
			</article>
		`;
	}

	renderArchivedSection() {
		if (this.archivedFundraisers.length === 0) {
			return '';
		}

		return `
			<div class="archived-section">
				<button id="toggle-archived-btn" class="toggle-btn" aria-expanded="${this.showArchived}" aria-controls="archived-fundraisers-list">
					${translate("show_archived_fundraisers")} (${this.archivedFundraisers.length})
				</button>
				<div id="archived-fundraisers-list" class="fundraisers-list ${this.showArchived ? '' : 'hidden'}" role="list">
					${this.archivedFundraisers.map(fundraiser => this.renderArchivedFundraiserCard(fundraiser)).join('')}
				</div>
			</div>
		`;
	}

	renderArchivedFundraiserCard(fundraiser) {
		const startDate = new Date(fundraiser.start_date).toLocaleDateString();
		const endDate = new Date(fundraiser.end_date).toLocaleDateString();
		const canEdit = this.app.userRole === 'admin' || this.app.userRole === 'animation';

		return `
			<article class="fundraiser-card archived" role="listitem">
				<div class="fundraiser-card-header">
					<h2>${fundraiser.name}</h2>
					<span class="status-badge archived" aria-label="${translate("archived")}">${translate("archived")}</span>
				</div>
				<div class="fundraiser-card-body">
					<div class="fundraiser-info">
						<p><strong>${translate("start_date")}:</strong> ${startDate}</p>
						<p><strong>${translate("end_date")}:</strong> ${endDate}</p>
						<p><strong>${translate("participants")}:</strong> ${fundraiser.participant_count}</p>
						<p><strong>${translate("total_sold")}:</strong> ${fundraiser.total_amount || 0}</p>
						<p><strong>${translate("total_collected")}:</strong> $${parseFloat(fundraiser.total_paid || 0).toFixed(2)}</p>
					</div>
				</div>
				<div class="fundraiser-card-footer">
					<a href="/calendars/${fundraiser.id}" class="btn-link" aria-label="${translate("view_calendars_for")} ${fundraiser.name}">
						${translate("view_calendars")}
					</a>
					${canEdit ? `
						<button class="btn-secondary unarchive-fundraiser-btn" data-id="${fundraiser.id}" aria-label="${translate("unarchive")} ${fundraiser.name}">
							${translate("unarchive")}
						</button>
					` : ''}
				</div>
			</article>
		`;
	}

	renderModal() {
		return `
			<div id="fundraiser-modal" class="modal" role="dialog" aria-labelledby="modal-title" aria-hidden="true">
				<div class="modal-content">
					<div class="modal-header">
						<h2 id="modal-title">${translate("add_fundraiser")}</h2>
						<button class="modal-close" aria-label="${translate("close")}">&times;</button>
					</div>
					<form id="fundraiser-form" class="modal-body">
						<div class="form-group">
							<label for="fundraiser-name">${translate("name")}*</label>
							<input type="text" id="fundraiser-name" name="name" required aria-required="true">
						</div>
						<div class="form-group">
							<label for="fundraiser-start-date">${translate("start_date")}*</label>
							<input type="date" id="fundraiser-start-date" name="start_date" required aria-required="true">
						</div>
						<div class="form-group">
							<label for="fundraiser-end-date">${translate("end_date")}*</label>
							<input type="date" id="fundraiser-end-date" name="end_date" required aria-required="true">
						</div>
						<div class="form-group">
							<label for="fundraiser-objective">${translate("objective")} ($)</label>
							<input type="number" id="fundraiser-objective" name="objective" min="0" step="0.01">
						</div>
						<div class="modal-footer">
							<button type="button" class="btn-secondary modal-cancel">${translate("cancel")}</button>
							<button type="submit" class="primary-btn">${translate("save")}</button>
						</div>
					</form>
				</div>
			</div>
		`;
	}

	initEventListeners() {
		const addBtn = document.getElementById('add-fundraiser-btn');
		if (addBtn) {
			addBtn.addEventListener('click', () => this.showModal());
		}

		const toggleArchivedBtn = document.getElementById('toggle-archived-btn');
		if (toggleArchivedBtn) {
			toggleArchivedBtn.addEventListener('click', () => this.toggleArchived());
		}

		// Edit fundraiser buttons
		document.querySelectorAll('.edit-fundraiser-btn').forEach(btn => {
			btn.addEventListener('click', (e) => {
				const fundraiserId = parseInt(e.target.dataset.id);
				const fundraiser = this.fundraisers.find(f => f.id === fundraiserId);
				if (fundraiser) {
					this.showModal(fundraiser);
				}
			});
		});

		// Archive fundraiser buttons
		document.querySelectorAll('.archive-fundraiser-btn').forEach(btn => {
			btn.addEventListener('click', async (e) => {
				const fundraiserId = parseInt(e.target.dataset.id);
				if (confirm(translate("confirm_archive_fundraiser"))) {
					await this.archiveFundraiser(fundraiserId);
				}
			});
		});

		// Unarchive fundraiser buttons
		document.querySelectorAll('.unarchive-fundraiser-btn').forEach(btn => {
			btn.addEventListener('click', async (e) => {
				const fundraiserId = parseInt(e.target.dataset.id);
				await this.unarchiveFundraiser(fundraiserId);
			});
		});

		// Modal events
		const modal = document.getElementById('fundraiser-modal');
		const closeBtn = modal.querySelector('.modal-close');
		const cancelBtn = modal.querySelector('.modal-cancel');
		const form = document.getElementById('fundraiser-form');

		closeBtn.addEventListener('click', () => this.hideModal());
		cancelBtn.addEventListener('click', () => this.hideModal());

		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				this.hideModal();
			}
		});

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			await this.saveFundraiser();
		});
	}

	showModal(fundraiser = null) {
		const modal = document.getElementById('fundraiser-modal');
		const title = document.getElementById('modal-title');
		const form = document.getElementById('fundraiser-form');

		this.editingFundraiser = fundraiser;

		if (fundraiser) {
			title.textContent = translate("edit_fundraiser");
			form.name.value = fundraiser.name;
			form.start_date.value = fundraiser.start_date;
			form.end_date.value = fundraiser.end_date;
			form.objective.value = fundraiser.objective || '';
		} else {
			title.textContent = translate("add_fundraiser");
			form.reset();
		}

		modal.classList.add('show');
		modal.setAttribute('aria-hidden', 'false');
	}

	hideModal() {
		const modal = document.getElementById('fundraiser-modal');
		modal.classList.remove('show');
		modal.setAttribute('aria-hidden', 'true');
		this.editingFundraiser = null;
	}

	async saveFundraiser() {
		const form = document.getElementById('fundraiser-form');
		const data = {
			name: form.name.value,
			start_date: form.start_date.value,
			end_date: form.end_date.value,
			objective: form.objective.value ? parseFloat(form.objective.value) : null
		};

		try {
			let response;
			if (this.editingFundraiser) {
				response = await updateFundraiser(this.editingFundraiser.id, data);
			} else {
				response = await createFundraiser(data);
			}

			if (response.success) {
				this.app.showMessage(
					this.editingFundraiser ? 'fundraiser_updated' : 'fundraiser_created',
					'success'
				);
				this.hideModal();
				await this.fetchFundraisers();
				this.render();
				this.initEventListeners();
			} else {
				this.app.showMessage('error_saving_fundraiser', 'error');
			}
		} catch (error) {
			debugError('Error saving fundraiser:', error);
			this.app.showMessage('error_saving_fundraiser', 'error');
		}
	}

	async archiveFundraiser(fundraiserId) {
		try {
			const response = await archiveFundraiser(fundraiserId, true);
			if (response.success) {
				this.app.showMessage('fundraiser_archived', 'success');
				await this.fetchFundraisers();
				this.render();
				this.initEventListeners();
			} else {
				this.app.showMessage('error_archiving_fundraiser', 'error');
			}
		} catch (error) {
			debugError('Error archiving fundraiser:', error);
			this.app.showMessage('error_archiving_fundraiser', 'error');
		}
	}

	async unarchiveFundraiser(fundraiserId) {
		try {
			const response = await archiveFundraiser(fundraiserId, false);
			if (response.success) {
				this.app.showMessage('fundraiser_unarchived', 'success');
				await this.fetchFundraisers();
				this.render();
				this.initEventListeners();
			} else {
				this.app.showMessage('error_unarchiving_fundraiser', 'error');
			}
		} catch (error) {
			debugError('Error unarchiving fundraiser:', error);
			this.app.showMessage('error_unarchiving_fundraiser', 'error');
		}
	}

	toggleArchived() {
		this.showArchived = !this.showArchived;
		const list = document.getElementById('archived-fundraisers-list');
		const btn = document.getElementById('toggle-archived-btn');

		if (this.showArchived) {
			list.classList.remove('hidden');
			btn.setAttribute('aria-expanded', 'true');
			btn.textContent = `${translate("hide_archived_fundraisers")} (${this.archivedFundraisers.length})`;
		} else {
			list.classList.add('hidden');
			btn.setAttribute('aria-expanded', 'false');
			btn.textContent = `${translate("show_archived_fundraisers")} (${this.archivedFundraisers.length})`;
		}
	}
}
