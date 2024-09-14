import { getParticipants, getGroups } from './ajax-functions.js';
import { translate } from './app.js';
import { ManagePoints } from './manage_points.js';
import { ParentDashboard } from './parent_dashboard.js';
import { Login } from './login.js';

export class Dashboard {
    constructor() {
        this.groups = [];
        this.participants = [];
        this.managePoints = new ManagePoints(this);
    }

    async init() {
        console.log('Dashboard init started');
        try {
            await this.fetchData();
            this.render();
            this.attachEventListeners();
            console.log('Dashboard init completed');
        } catch (error) {
            console.error('Error initializing dashboard:', error);
            this.renderError();
        }
    }

    async fetchData() {
        console.log('Fetching dashboard data');
        try {
            [this.participants, this.groups] = await Promise.all([
                getParticipants(),
                getGroups()
            ]);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            throw error;
        }
    }

    render() {
        console.log('Rendering dashboard');
        const content = `
            <h1>${translate('dashboard_title')}</h1>
            <div class="manage-items">
                 <a href="/managePoints">${translate('manage_points')}</a>
                <a href="/manage_honors">${translate('manage_honors')}</a>
                <a href="/attendance">${translate('attendance')}</a>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img width="335" style="max-width:100%;height:auto" src="./images/6eASt-Paul.png" alt="6e A St-Paul d'Aylmer">
            </div>
            <div class="manage-items">
                <a href="/manage_participants">${translate('manage_names')}</a>
                <a href="/manage_groups">${translate('manage_groups')}</a>
                <a href="/view_participant_documents">${translate('view_participant_documents')}</a>
                <a href="/approve_badges">${translate('approve_badges')}</a>
                <a href="/parent_dashboard">${translate('vue_parents')}</a>
                <a href="/parent_contact_list">${translate('parent_contact_list')}</a>
                <a href="/manage_users_participants">${translate('manage_participants')}</a>
            </div>
            <div id="points-list">
                ${this.renderPointsList()}
            </div>
             <p><a href="/logout" id="logout-link">${translate('logout')}</a></p>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderPointsList() {
        console.log('Rendering points list');
        if (this.groups.length === 0) {
            return `<p>${translate('no_groups')}</p>`;
        }

        return this.groups.map(group => `
            <div class="group-header" data-group-id="${group.id}" data-type="group" data-points="${group.total_points}">
                ${group.name} - 
                <span id="group-points-${group.id}">${group.total_points} ${translate('points')}</span>
            </div>
            <div class="group-content">
                ${this.renderParticipantsForGroup(group.id)}
            </div>
        `).join('');
    }

    renderParticipantsForGroup(groupId) {
        const groupParticipants = this.participants.filter(p => p.group_id == groupId);
        if (groupParticipants.length === 0) {
            return `<p>${translate('no_participants_in_group')}</p>`;
        }

        return groupParticipants.map(participant => `
            <div class="list-item" data-name-id="${participant.id}" data-type="individual" 
                 data-group-id="${participant.group_id}" data-points="${participant.total_points}"
                 data-name="${participant.first_name}">
                <span>${participant.first_name} ${participant.last_name}</span>
                <span id="name-points-${participant.id}">${participant.total_points} ${translate('points')}</span>
            </div>
        `).join('');
    }

    attachEventListeners() {
        console.log('Attaching event listeners');
        document.querySelectorAll('.list-item, .group-header').forEach(item => {
            item.addEventListener('click', () => this.handleItemClick(item));
        });

        // Add logout event listener
        document.getElementById('logout-link').addEventListener('click', (e) => {
            e.preventDefault();
            Login.logout();
        });
    }

    handleItemClick(item) {
        console.log('Item clicked:', item);
        document.querySelectorAll('.list-item.selected, .group-header.selected').forEach(selectedItem => {
            selectedItem.classList.remove('selected');
        });
        item.classList.add('selected');
    }

    renderError() {
        console.log('Rendering dashboard error');
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_dashboard')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}