import { getHonors, awardHonor, getAvailableDates } from './ajax-functions.js';
import { translate } from './app.js';

export class ManageHonors {
    constructor(app) {
        this.app = app;
        this.currentDate = new Date().toISOString().split('T')[0];
        this.honorsData = { groups: [], names: [] };
        this.availableDates = [];
    }

    async init() {
        try {
            await this.fetchAvailableDates();
            await this.fetchData();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing manage honors:', error);
            this.renderError();
        }
    }

    async fetchAvailableDates() {
        try {
            this.availableDates = await getAvailableDates(); // Fetches all dates with entries
        } catch (error) {
            console.error('Error fetching available dates:', error);
            throw error;
        }
    }

    async fetchData() {
        try {
            this.honorsData = await getHonors(this.currentDate);
        } catch (error) {
            console.error('Error fetching honors data:', error);
            throw error;
        }
    }

    render() {
        const content = `
        <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
            <h1>${translate('manage_honors')}</h1>
            <div class="date-navigation">
                <button id="prevDate">&larr; ${translate('previous')}</button>
                <h2 id="currentDate">${this.formatDate(this.currentDate)}</h2>
                <button id="nextDate">${translate('next')} &rarr;</button>
            </div>
            <div class="sort-options">
                <button data-sort="name">${translate('sort_by_name')}</button>
                <button data-sort="honors">${translate('sort_by_honors')}</button>
            </div>
            <div id="honors-list">
                ${this.renderHonorsList()}
            </div>
            <div class="fixed-bottom">
                <button class="honor-btn" id="awardHonorButton">${translate('award_honor')}</button>
            </div>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderHonorsList() {
        if (this.honorsData.names.length === 0) {
            return `<p>${translate('no_honors_on_this_date')}</p>`;
        }

        let html = '';
        this.honorsData.groups.forEach(group => {
            html += `<div class="group-header">${group.name}</div>`;
            const groupNames = this.honorsData.names.filter(name => name.group_id === group.id);
            groupNames.forEach(name => {
                html += `
                    <div class="list-item" data-name-id="${name.name_id}" data-group-id="${name.group_id}">
                        <input type="checkbox" id="name-${name.name_id}" ${name.honored_today ? 'checked disabled' : ''}>
                        <label for="name-${name.name_id}">${name.first_name} (${name.total_honors} ${translate('honors')})</label>
                    </div>
                `;
            });
        });
        return html;
    }

    attachEventListeners() {
        document.getElementById('prevDate').addEventListener('click', () => this.changeDate('prev'));
        document.getElementById('nextDate').addEventListener('click', () => this.changeDate('next'));
        document.querySelectorAll('.sort-options button').forEach(button => {
            button.addEventListener('click', () => this.sortItems(button.dataset.sort));
        });
        document.getElementById('awardHonorButton').addEventListener('click', () => this.awardHonor());
    }

    async changeDate(direction) {
        const currentIndex = this.availableDates.indexOf(this.currentDate);

        if (direction === 'next' && currentIndex > 0) {
            this.currentDate = this.availableDates[currentIndex - 1];
        } else if (direction === 'prev' && currentIndex < this.availableDates.length - 1) {
            this.currentDate = this.availableDates[currentIndex + 1];
        }

        document.getElementById('currentDate').textContent = this.formatDate(this.currentDate);
        await this.fetchData();
        this.updateHonorsListUI();
    }

    updateHonorsListUI() {
        const honorsList = document.getElementById('honors-list');
        honorsList.innerHTML = this.renderHonorsList();
    }

    sortItems(sortBy) {
        const honorsList = document.getElementById('honors-list');
        const items = Array.from(honorsList.querySelectorAll('.list-item'));

        items.sort((a, b) => {
            const aValue = a.querySelector('label').textContent;
            const bValue = b.querySelector('label').textContent;
            if (sortBy === 'name') {
                return aValue.localeCompare(bValue);
            } else if (sortBy === 'honors') {
                const aHonors = parseInt(aValue.match(/\((\d+)/)[1]);
                const bHonors = parseInt(bValue.match(/\((\d+)/)[1]);
                return bHonors - aHonors;
            }
        });

        items.forEach(item => honorsList.appendChild(item));
    }

    async awardHonor() {
        const selectedItems = document.querySelectorAll('.list-item input[type="checkbox"]:checked:not(:disabled)');
        if (selectedItems.length === 0) {
            alert(translate('select_individuals'));
            return;
        }

        const honors = Array.from(selectedItems).map(item => ({
            nameId: item.closest('.list-item').dataset.nameId,
            date: this.currentDate
        }));

        try {
            const result = await awardHonor(honors);
            if (result.status === 'success') {
                alert(translate('honor_awarded_successfully'));
                await this.fetchData();
                this.updateHonorsListUI();
            } else {
                throw new Error(result.message || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Error:', error);
            alert(`${translate('error_awarding_honor')}: ${error.message}`);
        }
    }

    formatDate(dateString) {
        const options = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto' };
        return new Date(dateString).toLocaleDateString(this.app.lang, options);
    }

    renderError() {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_honors')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}
