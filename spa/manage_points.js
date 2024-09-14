import { getParticipants, getGroups, updatePoints, getAuthHeader } from './ajax-functions.js';
import { translate } from './app.js';
import { saveOfflineData, getOfflineData, clearOfflineData, openDB, setCachedData, getCachedData } from './indexedDB.js';

export class ManagePoints {
    constructor(app) {
        this.app = app;
        this.selectedItem = null;
        this.pendingUpdates = [];
        this.updateTimeout = null;
        this.currentSort = { key: 'group', order: 'asc' };
        this.currentFilter = '';
    }

    async init() {
        try {
            await this.fetchData();
            this.render();
            this.attachEventListeners();
            if (navigator.onLine) {
                await this.refreshPointsData();
            }
        } catch (error) {
            console.error('Error initializing manage points:', error);
            this.renderError();
        }
    }

    async fetchData() {
        try {
            [this.participants, this.groups] = await Promise.all([
                getParticipants(),
                getGroups()
            ]);
        } catch (error) {
            console.error('Error fetching manage points data:', error);
            throw error;
        }
    }

    render() {
        const content = `
        <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
            <h1>${translate('manage_points')}</h1>
            <div class="sort-options">
                <button data-sort="name">${translate('sort_by_name')}</button>
                <button data-sort="group">${translate('sort_by_group')}</button>
                <button data-sort="points">${translate('sort_by_points')}</button>
            </div>
            <div class="filter-options">
                <label for="group-filter">${translate('filter_by_group')}:</label>
                <select id="group-filter">
                    <option value="">${translate('all_groups')}</option>
                    ${this.groups.map(group => `<option value="${group.id}">${group.name}</option>`).join('')}
                </select>
            </div>
            <div id="points-list">
                ${this.renderPointsList()}
            </div>
            <div class="fixed-bottom">
                <button class="point-btn add" data-points="1">+1</button>
                <button class="point-btn add" data-points="3">+3</button>
                <button class="point-btn add" data-points="5">+5</button>
                <button class="point-btn remove" data-points="-1">-1</button>
                <button class="point-btn remove" data-points="-3">-3</button>
                <button class="point-btn remove" data-points="-5">-5</button>
            </div>
        `;
        document.getElementById('app').innerHTML = content;
    }

    renderPointsList() {
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
        document.querySelectorAll('.list-item, .group-header').forEach(item => {
            item.addEventListener('click', () => this.handleItemClick(item));
        });

        document.querySelectorAll('.point-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handlePointButtonClick(btn));
        });

        document.getElementById('group-filter').addEventListener('change', (e) => this.filterByGroup(e.target.value));

        document.querySelectorAll('.sort-options button').forEach(btn => {
            btn.addEventListener('click', () => this.sortItems(btn.dataset.sort));
        });
    }

    handleItemClick(item) {
        if (this.selectedItem) {
            this.selectedItem.classList.remove('selected');
        }
        item.classList.add('selected');
        this.selectedItem = item;
    }

    async handlePointButtonClick(btn) {
        const points = parseInt(btn.dataset.points);
        await this.updatePoints(points);
    }

    async updatePoints(points) {
        if (!this.selectedItem) {
            alert(translate('please_select_group_or_individual'));
            return;
        }

        const type = this.selectedItem.dataset.type;
        const id = type === 'group' ? this.selectedItem.dataset.groupId : this.selectedItem.dataset.nameId;

        if (type === 'no-group') {
            alert(translate('cannot_assign_points_to_no_group'));
            return;
        }

        console.log(`Updating points for ${type} with id ${id}: ${points} points`);

        // Provide immediate visual feedback
        this.updatePointsUI(type, id, points);

        const updateData = { type, id, points, timestamp: new Date().toISOString() };
        this.pendingUpdates.push(updateData);

        // Clear any existing timeout
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        // Set a new timeout to send updates after a short delay
        this.updateTimeout = setTimeout(() => this.sendBatchUpdate(), 300); // 300ms delay

        // If it's the first update in the batch, also trigger an immediate send
        if (this.pendingUpdates.length === 1) {
            this.sendBatchUpdate();
        }
    }

    async sendBatchUpdate() {
        if (this.pendingUpdates.length === 0) return;

        const updates = [...this.pendingUpdates];
        this.pendingUpdates = [];

        if (navigator.onLine) {
            try {
                const response = await fetch('/api.php?action=update_points', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getAuthHeader()
                    },
                    body: JSON.stringify(updates)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                if (data.status === 'error') {
                    throw new Error(data.message || 'Unknown error occurred');
                }

                console.log('Batch update successful:', data);

                // Apply server updates
                if (data.updates && Array.isArray(data.updates)) {
                    data.updates.forEach(update => {
                        if (update.type === 'group') {
                            this.updateGroupPoints(update.id, update.totalPoints, update.memberIds);
                        } else {
                            this.updateIndividualPoints(update.id, update.totalPoints);
                        }
                    });
                } else {
                    console.warn('Unexpected response format:', data);
                }

            } catch (error) {
                console.error('Error in batch update:', error);
                // If there's an error, add the updates back to the pending list
                this.pendingUpdates.push(...updates);

                // Show an error message to the user
                alert(`An error occurred while updating points: ${error.message}`);

            }
        } else {
            // Save updates for later sync
            updates.forEach(update => saveOfflineData('updatePoints', update));
        }
    }

    updateGroupPoints(groupId, totalPoints, memberIds) {
        const groupElement = document.querySelector(`.group-header[data-group-id="${groupId}"]`);
        if (groupElement) {
            const pointsElement = groupElement.querySelector(`#group-points-${groupId}`);
            if (pointsElement) {
                pointsElement.textContent = `${totalPoints} ${translate('points')}`;
            }
            groupElement.dataset.points = totalPoints;
            this.addHighlightEffect(groupElement);
        }

        // Update individual members
        memberIds.forEach(memberId => {
            const memberElement = document.querySelector(`.list-item[data-name-id="${memberId}"]`);
            if (memberElement) {
                const memberPointsElement = memberElement.querySelector(`#name-points-${memberId}`);
                if (memberPointsElement) {
                    const currentPoints = parseInt(memberElement.dataset.points) || 0;
                    const newPoints = currentPoints + (totalPoints - parseInt(groupElement.dataset.points));
                    memberPointsElement.textContent = `${newPoints} ${translate('points')}`;
                    memberElement.dataset.points = newPoints;
                    this.addHighlightEffect(memberElement);
                }
            }
        });
    }

    updateIndividualPoints(nameId, totalPoints) {
        const nameElement = document.querySelector(`.list-item[data-name-id="${nameId}"]`);
        if (nameElement) {
            const pointsElement = nameElement.querySelector(`#name-points-${nameId}`);
            if (pointsElement) {
                pointsElement.textContent = `${totalPoints} ${translate('points')}`;
            }
            nameElement.dataset.points = totalPoints;
            this.addHighlightEffect(nameElement);
        }
    }

    updatePointsUI(type, id, points) {
        const selector = type === 'group' ? `.group-header[data-group-id="${id}"]` : `.list-item[data-name-id="${id}"]`;
        const element = document.querySelector(selector);
        if (!element) return;

        const pointsElement = element.querySelector(`#${type}-points-${id}`);
        if (!pointsElement) return;

        const currentPoints = parseInt(element.dataset.points) || 0;
        const newPoints = currentPoints + points;

        pointsElement.textContent = `${newPoints} ${translate('points')}`;
        element.dataset.points = newPoints;

        // Show the change with a temporary element
        const changeElement = document.createElement('span');
        changeElement.textContent = points > 0 ? `+${points}` : points;
        changeElement.className = 'point-change';
        changeElement.style.color = points > 0 ? 'green' : 'red';
        pointsElement.appendChild(changeElement);

        // Remove the change element after a short delay
        setTimeout(() => {
            changeElement.remove();
        }, 2000);

        // Add highlight effect
        this.addHighlightEffect(element);

        // If it's a group update, also update the UI for all members
        if (type === 'group') {
            const memberElements = document.querySelectorAll(`.list-item[data-group-id="${id}"]`);
            memberElements.forEach(memberElement => {
                const memberPointsElement = memberElement.querySelector(`[id^="name-points-"]`);
                if (memberPointsElement) {
                    const memberCurrentPoints = parseInt(memberElement.dataset.points) || 0;
                    const memberNewPoints = memberCurrentPoints + points;
                    memberPointsElement.textContent = `${memberNewPoints} ${translate('points')}`;
                    memberElement.dataset.points = memberNewPoints;
                    this.addHighlightEffect(memberElement);
                }
            });
        }
    }

    addHighlightEffect(element) {
        element.classList.add('highlight');
        setTimeout(() => {
            element.classList.remove('highlight');
        }, 500);
    }

    sortItems(key) {
        console.log(`Sorting by ${key}`);
        const list = document.getElementById('points-list');
        const groups = Array.from(list.querySelectorAll('.group-header'));
        const items = Array.from(list.querySelectorAll('.list-item'));

        if (key === 'group') {
            // Sort groups
            groups.sort((a, b) => {
                return a.textContent.localeCompare(b.textContent) * (this.currentSort.order === 'asc' ? 1 : -1);
            });

            // Clear the list
            list.innerHTML = '';

            // Append sorted groups with their items
            groups.forEach(group => {
                list.appendChild(group);
                const groupId = group.dataset.groupId;
                const groupItems = items.filter(item => item.dataset.groupId === groupId);
                groupItems.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
                groupItems.forEach(item => list.appendChild(item));
            });
        } else {
            // Sort all items
            items.sort((a, b) => {
                let valueA, valueB;
                if (key === 'name') {
                    valueA = a.dataset.name;
                    valueB = b.dataset.name;
                } else if (key === 'points') {
                    valueA = parseInt(a.dataset.points);
                    valueB = parseInt(b.dataset.points);
                }
                return (valueA < valueB ? -1 : valueA > valueB ? 1 : 0) * (this.currentSort.order === 'asc' ? 1 : -1);
            });

            // Clear the list
            list.innerHTML = '';

            // Append all groups (to maintain structure) and sorted items
            groups.forEach(group => list.appendChild(group));
            items.forEach(item => list.appendChild(item));
        }

        // Update current sort
        if (this.currentSort.key === key) {
            this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.key = key;
            this.currentSort.order = 'asc';
        }

        console.log(`Sorted by ${key}, order: ${this.currentSort.order}`);
    }

    filterByGroup(groupId) {
        this.currentFilter = groupId;
        const headers = document.querySelectorAll('.group-header');
        const items = document.querySelectorAll('.list-item');

        headers.forEach(header => {
            header.style.display = (groupId === '' || header.dataset.groupId === groupId) ? '' : 'none';
        });

        items.forEach(item => {
            item.style.display = (groupId === '' || item.dataset.groupId === groupId) ? '' : 'none';
        });
    }

    async refreshPointsData() {
            const cacheKey = 'pointsData';
            try {
                // Try to get cached data first
                const cachedData = await getCachedData(cacheKey);
                if (cachedData) {
                    console.log('Using cached points data');
                    this.updatePointsDisplay(cachedData);
                    return cachedData;
                }

                // If no cached data, fetch from server
                console.log('Fetching fresh points data');
                const response = await this.fetchWithCacheBusting('/get_points_data.php');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();

                // Cache the new data
                await setCachedData(cacheKey, data);

                this.updatePointsDisplay(data);
                return data;
            } catch (error) {
                console.error('Error fetching points data:', error);
                // If offline, try to use any available cached data, even if expired
                if (!navigator.onLine) {
                    const cachedData = await getCachedData(cacheKey);
                    if (cachedData) {
                        console.log('Using expired cached data due to offline status');
                        this.updatePointsDisplay(cachedData);
                        return cachedData;
                    }
                }
                throw error;
            }
        }

        updatePointsDisplay(data) {
            console.log('Updating points display with data:', data);

            // Update group points
            data.groups.forEach(group => {
                const groupElement = document.querySelector(`.group-header[data-group-id="${group.id}"]`);
                if (groupElement) {
                    const pointsElement = groupElement.querySelector(`#group-points-${group.id}`);
                    if (pointsElement) {
                        pointsElement.textContent = `${group.total_points} ${translate('points')}`;
                    } else {
                        console.log(`Points element not found for group ${group.id}`);
                    }
                    groupElement.dataset.points = group.total_points;
                } else {
                    console.log(`Group element not found for id ${group.id}`);
                }
            });

            // Update individual points
            data.names.forEach(name => {
                const nameElement = document.querySelector(`.list-item[data-name-id="${name.id}"]`);
                if (nameElement) {
                    const pointsElement = nameElement.querySelector(`#name-points-${name.id}`);
                    if (pointsElement) {
                        pointsElement.textContent = `${name.total_points} ${translate('points')}`;
                    } else {
                        console.log(`Points element not found for name ${name.id}`);
                    }
                    nameElement.dataset.points = name.total_points;
                } else {
                    console.log(`Name element not found for id ${name.id}`);
                }
            });

            console.log('Finished updating points display');
        }

        async fetchWithCacheBusting(url) {
            const cacheBuster = new Date().getTime();
            const separator = url.includes('?') ? '&' : '?';
            return fetch(`${url}${separator}_=${cacheBuster}`);
        }

        renderError() {
            const errorMessage = `
                <h1>${translate('error')}</h1>
                <p>${translate('error_loading_manage_points')}</p>
            `;
            document.getElementById('app').innerHTML = errorMessage;
        }
    }