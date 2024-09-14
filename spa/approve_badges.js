import { getPendingBadges, updateBadgeStatus } from './ajax-functions.js';
import { translate } from './app.js';

export class ApproveBadges {
    constructor(app) {
        this.app = app;
        this.pendingBadges = [];
    }

    async init() {
        if (this.app.userRole === 'parent') {
            this.app.router.navigate('/dashboard');
            return;
        }

        try {
            await this.fetchPendingBadges();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing approve badges:', error);
            this.renderError();
        }
    }

    async fetchPendingBadges() {
        try {
            this.pendingBadges = await getPendingBadges();
            if (!Array.isArray(this.pendingBadges)) {
                console.error('Pending badges is not an array:', this.pendingBadges);
                this.pendingBadges = [];
            }
        } catch (error) {
            console.error('Error fetching pending badges:', error);
            this.pendingBadges = [];
        }
    }

    render() {
        const content = `
            <h1>${translate('approve_badges')}</h1>
            <div id="message"></div>
            ${this.renderPendingBadges()}
            <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderPendingBadges() {
        if (this.pendingBadges.length === 0) {
            return `<p>${translate('no_pending_badges')}</p>`;
        }

        return this.pendingBadges.map(badge => `
            <div class="badge-request">
                <h2>${badge.first_name} ${badge.last_name}</h2>
                <p>${translate('territoire')}: ${badge.territoire_chasse}</p>
                <p>${translate('stars')}: ${badge.etoiles}</p>
                <p>${translate('objectif')}: ${badge.objectif}</p>
                <p>${translate('description')}: ${badge.description}</p>
                <p>${translate('date')}: ${badge.date_obtention}</p>
                <button class="approve-btn" data-badge-id="${badge.id}" data-action="approved">${translate('approve')}</button>
                <button class="reject-btn" data-badge-id="${badge.id}" data-action="rejected">${translate('reject')}</button>
            </div>
        `).join('');
    }

    attachEventListeners() {
        document.querySelectorAll('.approve-btn, .reject-btn').forEach(button => {
            button.addEventListener('click', (e) => this.handleBadgeAction(e));
        });
    }

    async handleBadgeAction(e) {
        const badgeId = e.target.dataset.badgeId;
        const action = e.target.dataset.action;

        try {
            const result = await updateBadgeStatus(badgeId, action);
            if (result.success) {
                this.showMessage(translate('badge_status_updated'));
                await this.fetchPendingBadges();
                this.render();
                this.attachEventListeners();
            } else {
                throw new Error(result.message || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Error updating badge status:', error);
            this.showMessage(translate('error_updating_badge_status'), 'error');
        }
    }

    showMessage(message, type = 'success') {
        const messageElement = document.getElementById('message');
        messageElement.textContent = message;
        messageElement.className = type;
        setTimeout(() => {
            messageElement.textContent = '';
            messageElement.className = '';
        }, 3000);
    }

    renderError() {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_approve_badges')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}