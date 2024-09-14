import { getParticipantsWithUsers, getParentUsers, deleteParticipant, associateUser } from './ajax-functions.js';
import { translate } from './app.js';

export class ManageUsersParticipants {
    constructor(app) {
        this.app = app;
        this.participants = [];
        this.parentUsers = [];
    }

    async init() {
        if (this.app.userRole !== 'animation' && this.app.userRole !== 'admin') {
            this.app.router.navigate('/');
            return;
        }

        try {
            await this.fetchData();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing manage users participants:', error);
            this.renderError();
        }
    }

    async fetchData() {
        try {
            [this.participants, this.parentUsers] = await Promise.all([
                getParticipantsWithUsers(),
                getParentUsers()
            ]);
        } catch (error) {
            console.error('Error fetching manage users participants data:', error);
            throw error;
        }
    }

    render() {
        const content = `
        <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
            <h1>${translate('manage_users_participants')}</h1>
            <div id="message"></div>
            <table>
                <thead>
                    <tr>
                        <th>${translate('name')}</th>
                        <th>${translate('associated_users')}</th>
                        <th>${translate('actions')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.renderParticipantRows()}
                </tbody>
            </table>
            <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderParticipantRows() {
        return this.participants.map(participant => `
            <tr>
                <td>${participant.first_name} ${participant.last_name}</td>
                <td>${participant.associated_users}</td>
                <td>
                    <button class="delete-participant" data-participant-id="${participant.id}">
                        ${translate('delete')}
                    </button>
                    <select class="user-select" data-participant-id="${participant.id}">
                        <option value="">${translate('select_parent')}</option>
                        ${this.renderParentUserOptions()}
                    </select>
                    <button class="associate-user" data-participant-id="${participant.id}">
                        ${translate('associate_user')}
                    </button>
                </td>
            </tr>
        `).join('');
    }

    renderParentUserOptions() {
        return this.parentUsers.map(user => `
            <option value="${user.id}">${user.full_name}</option>
        `).join('');
    }

    attachEventListeners() {
        document.querySelectorAll('.delete-participant').forEach(button => {
            button.addEventListener('click', (event) => this.handleDeleteParticipant(event));
        });

        document.querySelectorAll('.associate-user').forEach(button => {
            button.addEventListener('click', (event) => this.handleAssociateUser(event));
        });
    }

    async handleDeleteParticipant(event) {
        const participantId = event.target.getAttribute('data-participant-id');
        if (confirm(translate('confirm_delete_participant'))) {
            try {
                const result = await deleteParticipant(participantId);
                this.showMessage(result.message);
                if (result.status === 'success') {
                    await this.fetchData();
                    this.render();
                    this.attachEventListeners();
                }
            } catch (error) {
                console.error('Error:', error);
                this.showMessage(translate('error_deleting_participant'));
            }
        }
    }

    async handleAssociateUser(event) {
        const participantId = event.target.getAttribute('data-participant-id');
        const userId = event.target.previousElementSibling.value;
        if (userId) {
            try {
                const result = await associateUser(participantId, userId);
                this.showMessage(result.message);
                if (result.status === 'success') {
                    await this.fetchData();
                    this.render();
                    this.attachEventListeners();
                }
            } catch (error) {
                console.error('Error:', error);
                this.showMessage(translate('error_associating_user'));
            }
        } else {
            this.showMessage(translate('please_select_parent'));
        }
    }

    showMessage(message) {
        const messageElement = document.getElementById('message');
        messageElement.textContent = message;
        messageElement.style.display = 'block';
        setTimeout(() => {
            messageElement.style.display = 'none';
        }, 3000);
    }

    renderError() {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_manage_users_participants')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}