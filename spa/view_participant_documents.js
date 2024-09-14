import { getParticipantsWithDocuments } from './ajax-functions.js';
import { translate } from './app.js';

export class ViewParticipantDocuments {
    constructor(app) {
        this.app = app;
        this.participants = [];
    }

    async init() {
        if (this.app.userRole !== 'animation' && this.app.userRole !== 'admin') {
            this.app.router.navigate('/');
            return;
        }

        try {
            await this.fetchData();
            this.render();
        } catch (error) {
            console.error('Error initializing view participant documents:', error);
            this.renderError(error.message);
        }
    }

    async fetchData() {
        try {
            const data = await getParticipantsWithDocuments();
            console.log('Data received in component:', data); // Log the data received by the component

            if (data && Array.isArray(data)) {
                this.participants = data;
            } else if (data && Array.isArray(data.participants)) {
                this.participants = data.participants;
            } else {
                throw new Error('Unexpected data format received from API');
            }
        } catch (error) {
            console.error('Error fetching participant documents data:', error);
            throw error;
        }
    }

    render() {
        const content = `
            <h1>${translate('view_participant_documents')}</h1>
            <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
            <div class="participant-documents">
                ${this.renderParticipantCards()}
            </div>
            <style>
                .participant-documents {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .participant-card {
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 1rem;
                    background-color: #f9f9f9;
                }
                .participant-name {
                    font-weight: bold;
                    font-size: 1.1em;
                    margin-bottom: 0.5rem;
                }
                .document-link {
                    display: block;
                    margin: 0.5rem 0;
                }
                .document-link a {
                    color: #0066cc;
                    text-decoration: none;
                }
                .document-link a:hover {
                    text-decoration: underline;
                }
                @media (min-width: 768px) {
                    .participant-documents {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                        gap: 1rem;
                    }
                }
            </style>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderParticipantCards() {
        return this.participants.map(participant => `
            <div class="participant-card">
                <div class="participant-name">${participant.first_name} ${participant.last_name}</div>
                <div class="document-link">
                    ${this.renderDocumentLink('fiche_sante', participant, translate('fiche_sante'))}
                </div>
                <div class="document-link">
                    ${this.renderDocumentLink('acceptation_risque', participant, translate('acceptation_risque'))}
                </div>
                <div class="document-link">
                    ${this.renderDocumentLink('inscription', participant, translate('inscription'))}
                </div>
            </div>
        `).join('');
    }

    renderDocumentLink(type, participant, label) {
        const hasDocument = participant[`has_${type}`];
        if (hasDocument) {
            return `<a href="#" class="view-document" data-type="${type}" data-id="${participant.id}">${label}</a>`;
        } else {
            return `<span class="no-document">${label}: ❌</span>`;
        }
    }

    attachEventListeners() {
        document.querySelectorAll('.view-document').forEach(link => {
            link.addEventListener('click', (e) => this.handleViewDocument(e));
        });
    }

    handleViewDocument(e) {
        e.preventDefault();
        const type = e.target.dataset.type;
        const id = e.target.dataset.id;
        // Here you would typically open a modal or navigate to a new page to show the document
        console.log(`Viewing ${type} document for participant ${id}`);
        // For example:
        // this.app.router.navigate(`/view_document/${type}/${id}`);
    }

    renderError(message) {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${message || translate('error_loading_participant_documents')}</p>
            <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}