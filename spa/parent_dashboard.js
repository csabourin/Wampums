import { fetchParticipants } from './ajax-functions.js';
import { translate } from './app.js';

export class ParentDashboard {
    constructor(app) {
        this.app = app;
        this.participants = [];
         console.log('ParentDashboard constructor, app:', this.app); // Debug log
    }

    async init() {
        try {
             console.log('ParentDashboard init, app:', this.app);
            await this.fetchParticipants();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing parent dashboard:', error);
            this.app.renderError(translate('error_loading_parent_dashboard'));
        }
    }

    async fetchParticipants() {
        this.participants = await fetchParticipants();
    }

    async fetchUserFullName() {
        // If userFullName is not set, fetch it from the server
        if (!this.app.userFullName) {
            try {
                const response = await fetch('/api.php?action=get_user_full_name');
                const data = await response.json();
                if (data.success) {
                    this.app.userFullName = data.fullName;
                } else {
                    console.error('Failed to fetch user full name:', data.message);
                }
            } catch (error) {
                console.error('Error fetching user full name:', error);
            }
        }
    }

    render() {
        const content = `
            <div class="parent-dashboard">
                <h1>${translate('bienvenue')} ${this.app.userFullName}</h1>
                <h2>6e A St-Paul d'Aylmer</h2>
                <nav>
                    <ul class="dashboard-menu">
                        <li><a href="/formulaire_inscription" class="dashboard-button">${translate('ajouter_participant')}</a></li>
                        ${this.renderParticipantsList()}
                        <li><a href="/logout" class="dashboard-button logout-button">${translate('deconnexion')}</a></li>
                    </ul>
                </nav>
            </div>
            <style>
                .parent-dashboard {
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                h1, h2 {
                    text-align: center;
                }
                .dashboard-menu {
                    list-style-type: none;
                    padding: 0;
                }
                .dashboard-menu li {
                    margin-bottom: 10px;
                }
                .dashboard-button {
                    display: block;
                    width: 100%;
                    padding: 10px;
                    background-color: var(--primary-color);
                    color: white;
                    text-align: center;
                    text-decoration: none;
                    border-radius: 5px;
                }
                .logout-button {
                    background-color: #dc3545;
                }
                .participant-item {
                    background-color: #f8f9fa;
                    border: 1px solid #dee2e6;
                    border-radius: 5px;
                    padding: 10px;
                    margin-bottom: 10px;
                }
                .participant-name {
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .participant-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                }
                .participant-actions a {
                    flex: 1;
                    padding: 5px;
                    text-align: center;
                    background-color: #28a745;
                    color: white;
                    text-decoration: none;
                    border-radius: 3px;
                    font-size: 0.9em;
                }
                @media (max-width: 480px) {
                    .parent-dashboard {
                        padding: 10px;
                    }
                    .participant-actions {
                        flex-direction: column;
                    }
                    .participant-actions a {
                        margin-bottom: 5px;
                    }
                }
            </style>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderParticipantsList() {
        if (!Array.isArray(this.participants) || this.participants.length === 0) {
            return `<li>${translate('no_participants')}</li>`;
        }

        return this.participants.map(participant => `
            <li class="participant-item">
                <div class="participant-name">${participant.first_name} ${participant.last_name}</div>
                <div class="participant-actions">
                    <a href="/formulaire_inscription/${participant.id}">${translate('modifier')}</a>
                    <a href="/fiche_sante/${participant.id}">
                        ${participant.has_fiche_sante ? '✅' : '❌'}
                        ${translate('fiche_sante')}
                    </a>
                    <a href="/acceptation_risque/${participant.id}">
                        ${participant.has_acceptation_risque ? '✅' : '❌'}
                        ${translate('acceptation_risque')}
                    </a>
                    <a href="#/badge_form/${participant.id}">${translate('badge_progress')}</a>
                </div>
            </li>
        `).join('');
    }

    attachEventListeners() {
        // Add any specific event listeners for the parent dashboard here
    }


    renderError() {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_parent_dashboard')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}