import { getParticipants, getAttendance, updateAttendance, getAttendanceDates } from './ajax-functions.js';
import { translate } from './app.js';

export class Attendance {
    constructor(app) {
        this.app = app;
        this.currentDate = new Date().toISOString().split('T')[0];
        this.participants = [];
        this.attendanceData = {};
        this.selectedParticipant = null;
        this.availableDates = [];
    }

    async init() {
        try {
            await this.fetchAttendanceDates();
            await this.fetchData();
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing attendance:', error);
            this.renderError();
        }
    }

    async fetchAttendanceDates() {
        try {
            this.availableDates = await getAttendanceDates();
            this.availableDates.sort((a, b) => new Date(b) - new Date(a)); // Sort dates in descending order
            const today = new Date().toISOString().split('T')[0];
            if (!this.availableDates.includes(today)) {
                this.availableDates.unshift(today);
            }
            this.currentDate = this.availableDates[0];
        } catch (error) {
            console.error('Error fetching attendance dates:', error);
            throw error;
        }
    }

    async fetchData() {
        try {
            this.participants = await getParticipants();
            this.attendanceData = await getAttendance(this.currentDate);
        } catch (error) {
            console.error('Error fetching attendance data:', error);
            throw error;
        }
    }

    render() {
        const content = `
            <div class="attendance-container">
                <div class="date-navigation fixed-header">
                <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
                   
                    <select id="dateSelect" class="date-select">
                        ${this.renderDateOptions()}
                    </select>

                </div>
                <div id="attendance-list" class="attendance-list">
                    ${this.renderGroupsAndNames()}
                </div>
                <div class="status-buttons fixed-footer">
                    <button class="status-btn present" data-status="present">${translate('present')}</button>
                    <button class="status-btn absent" data-status="absent">${translate('absent')}</button>
                    <button class="status-btn late" data-status="late">${translate('late')}</button>
                    <button class="status-btn excused" data-status="excused">${translate('excused')}</button>
                </div>
            </div>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderDateOptions() {
        return this.availableDates.map(date => 
            `<option value="${date}" ${date === this.currentDate ? 'selected' : ''}>
                ${this.formatDate(date)}
            </option>`
        ).join('');
    }

    renderGroupsAndNames() {
        let html = '';
        let currentGroup = null;

        this.participants.forEach(participant => {
            if (currentGroup !== participant.group_id) {
                if (currentGroup !== null) {
                    html += '</div>'; // Close previous group
                }
                currentGroup = participant.group_id;
                html += `<div class="group-card"><h3>${participant.group_name}</h3>`;
            }
            const status = this.attendanceData[participant.id] || 'present';
            html += `
                <div class="participant-row" data-id="${participant.id}">
                    <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
                    <span class="participant-status ${status}">${translate(status)}</span>
                </div>
            `;
        });

        if (currentGroup !== null) {
            html += '</div>'; // Close last group
        }

        return html;
    }

    attachEventListeners() {
        // document.getElementById('prevDate').addEventListener('click', () => this.changeDate('prev'));
        // document.getElementById('nextDate').addEventListener('click', () => this.changeDate('next'));
        document.getElementById('dateSelect').addEventListener('change', (e) => this.changeDate(e.target.value));
        document.querySelectorAll('.participant-row').forEach(row => {
            row.addEventListener('click', (e) => this.selectParticipant(e.currentTarget));
        });
        document.querySelectorAll('.status-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleStatusChange(e.currentTarget.dataset.status));
        });
    }

    selectParticipant(row) {
        if (this.selectedParticipant) {
            this.selectedParticipant.classList.remove('selected');
        }
        row.classList.add('selected');
        this.selectedParticipant = row;
    }

    async handleStatusChange(newStatus) {
        if (!this.selectedParticipant) {
            alert(translate('select_participant'));
            return;
        }

        const participantId = this.selectedParticipant.dataset.id;
        const statusSpan = this.selectedParticipant.querySelector('.participant-status');
        const previousStatus = statusSpan.classList[1];

        try {
            const result = await updateAttendance(participantId, newStatus, this.currentDate, previousStatus);
            if (result.status === 'success') {
                statusSpan.classList.remove(previousStatus);
                statusSpan.classList.add(newStatus);
                statusSpan.textContent = translate(newStatus);

                let pointAdjustment = 0;

                // Calculate point adjustment
                if (previousStatus !== 'absent' && newStatus === 'absent') {
                    pointAdjustment = -1; // Remove a point for new absence
                } else if (previousStatus === 'absent' && newStatus !== 'absent') {
                    pointAdjustment = 1; // Return the point if no longer absent
                }

                if (pointAdjustment !== 0) {
                    this.updatePointsUI(participantId, pointAdjustment);
                }

                console.log(`Status changed from ${previousStatus} to ${newStatus}. Point adjustment: ${pointAdjustment}`);
            } else {
                throw new Error(result.message || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Error:', error);
            alert(`${translate('error_updating_attendance')}: ${error.message}`);
        }
    }

    async changeDate(value) {
        if (value === 'prev' || value === 'next') {
            const currentIndex = this.availableDates.indexOf(this.currentDate);
            const newIndex = value === 'prev' ? currentIndex + 1 : currentIndex - 1;
            if (newIndex >= 0 && newIndex < this.availableDates.length) {
                this.currentDate = this.availableDates[newIndex];
            } else {
                return; // Don't change if out of bounds
            }
        } else {
            this.currentDate = value;
        }
        document.getElementById('dateSelect').value = this.currentDate;
        await this.loadAttendanceForDate(this.currentDate);
    }

    async loadAttendanceForDate(date) {
        try {
            this.attendanceData = await getAttendance(date);
            this.updateAttendanceUIForDate();
        } catch (error) {
            console.error('Error:', error);
            alert(translate('error_loading_attendance'));
        }
    }

    updateAttendanceUIForDate() {
        document.querySelectorAll('.participant-row').forEach(row => {
            const participantId = row.dataset.id;
            const statusSpan = row.querySelector('.participant-status');
            const status = this.attendanceData[participantId] || 'present';
            statusSpan.className = `participant-status ${status}`;
            statusSpan.textContent = translate(status);
        });
    }

    updatePointsUI(participantId, pointAdjustment) {
        // Implement point update UI logic here if needed
        console.log(`Points updated for ${participantId}: ${pointAdjustment}`);
    }

    formatDate(dateString) {
        const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Toronto' };
        return new Date(dateString).toLocaleDateString(this.app.lang, options);
    }

    renderError() {
        const errorMessage = `
            <h1>${translate('error')}</h1>
            <p>${translate('error_loading_attendance')}</p>
        `;
        document.getElementById('app').innerHTML = errorMessage;
    }
}