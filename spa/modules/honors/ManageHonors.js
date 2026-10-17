import { getHonorsAndParticipants, awardHonor } from '../../ajax-functions.js';
import { updateHonor, deleteHonor } from '../../api/api-endpoints.js';
import { debugLog, debugError, debugWarn } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { getTodayISO, formatDate, isValidDate, isPastDate as isDateInPast } from '../../utils/DateUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { deleteCachedData, getCachedData } from '../../indexedDB.js';
import { escapeHTML, sanitizeHTML } from '../../utils/SecurityUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { openModal, closeModal } from '../../utils/ModalUtils.js';
import { offlineManager } from '../OfflineManager.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
export class ManageHonors {
  constructor(app) {
    this.app = app;
    this.currentDate = getTodayISO();
    this.honorsData = { groups: [], names: [] };
    this.availableDates = [];
    this.allHonors = [];
    this.allParticipants = [];
    this.currentSort = { key: 'name', order: 'asc' };
    this.pendingHonors = []; // Store honors being processed
    this.currentHonorIndex = 0; // Track which honor we're entering
    this.recentlyAwardedHonors = []; // Track recently awarded honors for undo window
    this.UNDO_WINDOW_MS = 10 * 60 * 1000; // 10 minutes undo window
    this.documentClickHandler = null; // Store reference to document click handler to prevent memory leaks
    this.destroyed = false;
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('manage_honors'), className: 'manage-honors-page' };
  }

  async init() {
    showPageLoading(document.getElementById('app'), this.pageOptions());
    try {
      await this.fetchData();
    } catch (error) {
      debugError('Error initializing manage honors:', error);
      this.renderError();
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.processHonors();
    this.render();
    this.attachEventListeners();
  }

  async fetchData() {
    try {
      // Check for camp-prepared data first
      if (offlineManager.campMode || offlineManager.isDatePrepared(this.currentDate)) {
        const cachedHonors = await getCachedData(`honors_${this.currentDate}`);
        const cachedAllHonors = await getCachedData('honors_all');
        const cachedParticipants = await getCachedData('participants_v2');

        if (cachedHonors || cachedAllHonors) {
          debugLog('Using camp-prepared honors data for', this.currentDate);

          // Get honors data - prefer date-specific, fall back to all
          const honorsData = cachedHonors?.data || cachedHonors || [];
          const allHonorsData = cachedAllHonors?.data || cachedAllHonors || [];

          this.allHonors = allHonorsData.length > 0 ? allHonorsData : honorsData;

          // Get participants from cache
          if (cachedParticipants) {
            const participantsData = cachedParticipants.data || cachedParticipants;
            this.allParticipants = participantsData.map(p => ({
              participant_id: p.id,
              first_name: p.first_name,
              last_name: p.last_name,
              group_id: p.group_id,
              group_name: p.group_name
            }));
          }

          // Get available dates from prepared activity
          const preparedActivity = offlineManager.getPreparedActivityForDate(this.currentDate);
          if (preparedActivity && preparedActivity.dates) {
            this.availableDates = [...preparedActivity.dates];
          } else {
            this.availableDates = [this.currentDate];
          }

          const today = getTodayISO();
          if (!this.availableDates.includes(today)) {
            this.availableDates.unshift(today);
          }
          this.availableDates.sort((a, b) => new Date(b) - new Date(a));

          debugLog('Loaded from camp cache:', {
            honors: this.allHonors.length,
            participants: this.allParticipants.length,
            dates: this.availableDates.length
          });
          return;
        }
      }

      const response = await getHonorsAndParticipants(this.currentDate);
      debugLog('API Response:', response); // Add this line for debugging

      // Support both new format (response.data.participants) and old format (response.participants)
      const data = response.data || response;

      this.allParticipants = data.participants || [];
      this.allHonors = data.honors || [];

      // Filter out null, undefined, and invalid dates
      this.availableDates = (data.availableDates || []).filter(date => {
        return isValidDate(date);
      });

      const today = getTodayISO();
      if (!this.availableDates.includes(today)) {
        this.availableDates.unshift(today);
      }

      if (!this.availableDates.includes(this.currentDate)) {
        this.availableDates.push(this.currentDate);
      }

      // Sort the dates in descending order
      this.availableDates.sort((a, b) => new Date(b) - new Date(a));

      debugLog('Processed availableDates:', this.availableDates); // Add this line for debugging
    } catch (error) {
      debugError('Error fetching honors data:', error);
      throw error;
    }
  }

  processHonors() {
    const today = getTodayISO();
    const isCurrentDate = this.currentDate === today;

    debugLog('[processHonors] Current date:', this.currentDate);
    debugLog('[processHonors] All honors received:', this.allHonors);
    debugLog('[processHonors] Sample honor:', this.allHonors[0]);

    // Create a flat list of participants instead of grouping by group
    this.honorsData.names = [];

    this.allParticipants.forEach(participant => {
      const honorsForDate = this.allHonors.filter(
        honor => Number(honor.participant_id) === Number(participant.participant_id) && honor.date === this.currentDate
      );
      const totalHonors = this.allHonors.filter(
        honor => Number(honor.participant_id) === Number(participant.participant_id) && new Date(honor.date) <= new Date(this.currentDate)
      ).length;

      // Get the honor details for the current date
      const currentHonor = honorsForDate.length > 0 ? honorsForDate[0] : null;
      const honorReason = currentHonor ? (currentHonor.reason || '') : '';
      const honorId = currentHonor ? currentHonor.id : null;
      const honorCreatedAt = currentHonor ? currentHonor.created_at : null;

      // Debug logging for participants with honors
      if (honorsForDate.length > 0) {
        debugLog(`[processHonors] ${participant.first_name} ${participant.last_name}:`, {
          honorsForDate: honorsForDate.length,
          currentHonor,
          honorId,
          honorCreatedAt,
          honored_today: true
        });
      }

      // Check if honor is within undo window (10 minutes)
      const canUndo = honorCreatedAt && (new Date() - new Date(honorCreatedAt)) < this.UNDO_WINDOW_MS;

      // Get the most recent honor date (excluding current date)
      const previousHonors = this.allHonors.filter(
        honor => Number(honor.participant_id) === Number(participant.participant_id) &&
        new Date(honor.date) < new Date(this.currentDate)
      );
      const lastHonorDate = previousHonors.length > 0
        ? previousHonors.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date
        : null;

      const processedParticipant = {
        ...participant,
        honored_today: honorsForDate.length > 0,
        total_honors: totalHonors,
        last_honor_date: lastHonorDate,
        reason: honorReason,
        honor_id: honorId,
        honor_created_at: honorCreatedAt,
        can_undo: canUndo,
        visible: isCurrentDate || honorsForDate.length > 0
      };

      if (processedParticipant.visible) {
        this.honorsData.names.push(processedParticipant);
      }
    });
  }

  render() {
    const dateOptions = this.availableDates.map(date =>
      `<option value="${date}" ${date === this.currentDate ? 'selected' : ''}>${formatDate(date, this.app.lang)}</option>`
    ).join('');

    const content = `
        ${renderBackLink()}
        <div class="page-header page-header--compact">
            <h1>${translate('manage_honors')}</h1>
        </div>
        <div class="date-navigation date-navigation--inline">
            <label for="date-select">${translate('select_date')}:</label>
            <select id="date-select" class="date-dropdown">
                ${dateOptions}
            </select>
        </div>
        <div class="honors-table">
            <div class="honors-table__header">
                <div class="honors-table__header-cell honors-table__header-cell--checkbox"></div>
                <div class="honors-table__header-cell honors-table__header-cell--name" data-sort="name">
                    ${translate('name')}
                    <span class="sort-indicator">${this.getSortIndicator('name')}</span>
                </div>
                <div class="honors-table__header-cell honors-table__header-cell--count" data-sort="honors">
                    ${translate('number_of_honors')}
                    <span class="sort-indicator">${this.getSortIndicator('honors')}</span>
                </div>
                <div class="honors-table__header-cell honors-table__header-cell--date" data-sort="last_date">
                    ${translate('last_honor_date')}
                    <span class="sort-indicator">${this.getSortIndicator('last_date')}</span>
                </div>
            </div>
            <div id="honors-list">
                ${this.renderHonorsList()}
            </div>
        </div>
        <div class="fixed-bottom">
            <button class="honor-btn" id="awardHonorButton" ${
  this.isPastDate() ? 'disabled' : ''
}>${translate('award_honor')}</button>
        </div>
    `;
    setContent(document.getElementById('app'), content);
  }

  getSortIndicator(sortKey) {
    if (this.currentSort.key !== sortKey) {return '';}
    return this.currentSort.order === 'asc' ? '↑' : '↓';
  }

  renderHonorsList() {
    if (this.honorsData.names.length === 0) {
      return `<p>${translate('no_honors_on_this_date')}</p>`;
    }

    // Render participants without grouping
    return this.honorsData.names.map(participant => this.renderParticipantItem(participant)).join('');
  }

  renderParticipantItem(participant) {
    // Only disable if past date - honored participants should remain interactive for menu access
    const isDisabled = this.isPastDate();
    const selectedClass = participant.honored_today ? 'selected' : '';
    const disabledClass = isDisabled ? 'disabled' : '';
    const lastHonorDateFormatted = participant.last_honor_date
      ? formatDate(participant.last_honor_date, this.app.lang)
      : '-';
    const reasonText = participant.reason ? sanitizeHTML(participant.reason) : '';

    // Show contextual menu for honored participants
    const showMenu = participant.honored_today && participant.honor_id;

    // Debug logging for participants with honors
    if (participant.honored_today) {
      debugLog(`[renderParticipantItem] ${participant.first_name}:`, {
        honored_today: participant.honored_today,
        honor_id: participant.honor_id,
        showMenu,
        reason: participant.reason
      });
    }

    const menuHtml = showMenu ? `
      <div class="honor-actions">
        <button class="honor-actions__trigger" data-honor-id="${participant.honor_id}" aria-label="${translate('actions')}">
          ⋮
        </button>
        <div class="honor-actions__menu" data-honor-id="${participant.honor_id}">
          <button class="honor-actions__item" data-action="edit-reason" data-honor-id="${participant.honor_id}">
            ✏️ ${translate('edit_reason')}
          </button>
          <button class="honor-actions__item" data-action="edit-date" data-honor-id="${participant.honor_id}">
            📅 ${translate('change_date')}
          </button>
          ${participant.can_undo ? `
            <button class="honor-actions__item honor-actions__item--undo" data-action="undo" data-honor-id="${participant.honor_id}">
              ⏪ ${translate('undo')} (${this.getUndoTimeRemaining(participant.honor_created_at)})
            </button>
          ` : ''}
          <button class="honor-actions__item honor-actions__item--danger" data-action="delete" data-honor-id="${participant.honor_id}">
            🗑️ ${translate('delete')}
          </button>
        </div>
      </div>
    ` : '';

    return `
      <div class="honors-table__row ${selectedClass} ${disabledClass}" data-participant-id="${participant.participant_id}" data-group-id="${participant.group_id}" data-honor-id="${participant.honor_id || ''}">
        <div class="honors-table__cell honors-table__cell--checkbox">
          <input type="checkbox" id="participant-${participant.participant_id}" ${isDisabled || participant.honored_today ? 'disabled' : ''} ${participant.honored_today ? 'checked' : ''}>
        </div>
        <div class="honors-table__cell honors-table__cell--name">
          <label for="participant-${participant.participant_id}">
            <div class="participant-name">${escapeHTML(participant.first_name)} ${escapeHTML(participant.last_name)}</div>
            ${reasonText ? `<div class="participant-reason">${translate('honor_reason_label')}: ${reasonText}</div>` : ''}
            <div class="participant-last-honor">${translate('last_honor_date')}: ${lastHonorDateFormatted}</div>
          </label>
        </div>
        <div class="honors-table__cell honors-table__cell--count">
          <strong>${participant.total_honors}</strong>
        </div>
        <div class="honors-table__cell honors-table__cell--date">
          ${lastHonorDateFormatted}
        </div>
        ${showMenu ? `<div class="honors-table__cell honors-table__cell--actions">${menuHtml}</div>` : ''}
      </div>
    `;
  }

  /**
   * Get remaining time for undo window in human-readable format
   */
  getUndoTimeRemaining(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const remainingMs = this.UNDO_WINDOW_MS - (now - created);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return `${remainingMinutes}min`;
  }

  attachEventListeners() {
    document.querySelectorAll('.honors-table__row').forEach((item) => {
      item.addEventListener('click', (event) => this.handleItemClick(event));
    });

    // Add listener for date dropdown
    const dateSelect = document.getElementById('date-select');
    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => this.onDateChange(e.target.value));
    }

    // Add click listeners to table headers for sorting
    document.querySelectorAll('.honors-table__header-cell[data-sort]').forEach((header) => {
      header.addEventListener('click', () => this.sortItems(header.dataset.sort));
    });

    document.getElementById('awardHonorButton').addEventListener('click', () => this.awardHonor());

    // Attach honor action listeners
    this.attachHonorActionListeners();
  }

  /**
   * Attach event listeners for honor action menus (edit, delete, undo)
   */
  attachHonorActionListeners() {
    // Remove previous document click handler to prevent memory leaks
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
    }

    // Toggle menu on trigger click
    document.querySelectorAll('.honor-actions__trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const honorId = trigger.dataset.honorId;
        const menu = document.querySelector(`.honor-actions__menu[data-honor-id="${honorId}"]`);
        const row = trigger.closest('.honors-table__row');

        // Close all other menus
        document.querySelectorAll('.honor-actions__menu.show').forEach(m => {
          if (m !== menu) {m.classList.remove('show');}
        });
        // Remove menu-open from all rows except current
        document.querySelectorAll('.honors-table__row.menu-open').forEach(r => {
          if (r !== row) {r.classList.remove('menu-open');}
        });

        const isNowOpen = !menu.classList.contains('show');
        menu.classList.toggle('show');
        if (row) {
          row.classList.toggle('menu-open', isNowOpen);
        }
      });
    });

    // Handle menu item clicks
    document.querySelectorAll('.honor-actions__item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        const honorId = parseInt(item.dataset.honorId);
        const row = item.closest('.honors-table__row');

        // Close menu
        document.querySelectorAll('.honor-actions__menu.show').forEach(m => m.classList.remove('show'));
        if (row) {row.classList.remove('menu-open');}

        switch (action) {
          case 'edit-reason':
            await this.showEditReasonModal(honorId);
            break;
          case 'edit-date':
            await this.showEditDateModal(honorId);
            break;
          case 'undo':
            await this.handleUndoHonor(honorId);
            break;
          case 'delete':
            await this.handleDeleteHonor(honorId);
            break;
        }
      });
    });

    // Store the handler function so we can remove it later
    this.documentClickHandler = () => {
      document.querySelectorAll('.honor-actions__menu.show').forEach(m => m.classList.remove('show'));
      document.querySelectorAll('.honors-table__row.menu-open').forEach(r => r.classList.remove('menu-open'));
    };

    // Close menus when clicking outside
    document.addEventListener('click', this.documentClickHandler);
  }

  /**
   * Called by the router before navigating away.
   */
  destroy() {
    this.destroyed = true;
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
      this.documentClickHandler = null;
    }
  }

  handleItemClick(event) {
    // Don't handle click if it came from the actions menu or trigger
    if (event.target.closest('.honor-actions')) {
      return;
    }

    const item = event.currentTarget;
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox.disabled) {return;}
    checkbox.checked = !checkbox.checked;
    item.classList.toggle('selected', checkbox.checked);
  }

  async onDateChange(newDate) {
    this.currentDate = newDate;
    await this.fetchData();
    this.processHonors();
    this.updateHonorsListUI();
  }

  updateHonorsListUI() {
    setContent(document.getElementById('honors-list'), this.renderHonorsList());
    document.getElementById('awardHonorButton').disabled = this.isPastDate();

    // Attach event listeners to list items only
    this.attachEventListenersToListItems();
    // Attach honor action listeners
    this.attachHonorActionListeners();
  }


  isPastDate() {
    return isDateInPast(this.currentDate);
  }

  async awardHonor() {
    const selectedItems = document.querySelectorAll('.honors-table__row input[type="checkbox"]:checked:not(:disabled)');
    if (selectedItems.length === 0) {
      this.app.showMessage(translate('select_individuals'), 'error');
      return;
    }

    // Prepare the list of participants needing reasons
    this.pendingHonors = Array.from(selectedItems).map(item => ({
      participantId: item.closest('.honors-table__row').dataset.participantId,
      participantName: item.closest('.honors-table__row').querySelector('.participant-name').textContent.trim(),
      reason: ''
    }));

    this.currentHonorIndex = 0;
    this.showReasonModal();
  }

  showReasonModal() {
    if (this.currentHonorIndex >= this.pendingHonors.length) {
      // All reasons collected, submit the honors
      this.submitHonors();
      return;
    }

    const currentHonor = this.pendingHonors[this.currentHonorIndex];
    const isLast = this.currentHonorIndex >= this.pendingHonors.length - 1;
    const { overlay } = openModal({
      id: 'honor-reason-modal',
      title: translate('honor_reason_prompt'),
      body: `
        <p class="modal-participant-name">${escapeHTML(currentHonor.participantName)}</p>
        <p class="modal-progress">${this.currentHonorIndex + 1} ${translate('of')} ${this.pendingHonors.length}</p>
        <form id="honor-reason-form">
          <div class="form-group">
            <label for="honor-reason-input">${translate('honor_reason_label')}:</label>
            <textarea
              id="honor-reason-input"
              class="form-control"
              rows="3"
              required
              placeholder="${escapeHTML(translate('honor_reason_placeholder') || translate('honor_reason_prompt'))}"
            ></textarea>
          </div>
        </form>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="honor-reason-form">
          ${isLast ? translate('submit') : translate('next')}
        </button>
      `,
      initialFocus: '#honor-reason-input',
      // Any way out other than moving to the next child cancels the batch
      onClose: () => {
        if (!this.advancingHonor) {
          this.pendingHonors = [];
          this.currentHonorIndex = 0;
        }
      },
    });

    overlay.querySelector('#honor-reason-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleReasonSubmit();
    });
  }

  handleReasonSubmit() {
    const reasonInput = document.getElementById('honor-reason-input');
    const reason = reasonInput.value.trim();

    if (!reason) {
      this.app.showMessage(translate('honor_reason_required'), 'error');
      return;
    }

    // Save the reason
    this.pendingHonors[this.currentHonorIndex].reason = reason;

    // Close modal only (without resetting)
    this.closeReasonModal();
    this.currentHonorIndex++;
    this.showReasonModal();
  }

  closeReasonModal() {
    this.advancingHonor = true;
    closeModal('honor-reason-modal');
    this.advancingHonor = false;
  }

  cancelHonorProcess() {
    closeModal('honor-reason-modal');
    // Reset when cancelled
    this.pendingHonors = [];
    this.currentHonorIndex = 0;
  }

  async submitHonors() {
    const honors = this.pendingHonors.map(h => ({
      participantId: h.participantId,
      date: this.currentDate,
      reason: h.reason
    }));

    try {
      // Optimistic update: immediately update the UI with new honors
      this.optimisticallyAddHonors(honors);
      this.processHonors();
      this.updateHonorsListUI();

      // Award the honors on the server
      const result = await awardHonor(honors);
      if (result.success !== true) {
        throw new Error(result.message || 'Unknown error occurred');
      }

      // Merge returned honor IDs into optimistic entries to avoid refetch
      this.applyAwardResults(result);
      this.processHonors();
      this.updateHonorsListUI();
      this.app.showMessage(translate('honors_awarded_successfully'), 'success');

      // Clear cache so next navigation loads fresh data, without immediate GET
      await this.clearHonorsCaches();
    } catch (error) {
      debugError('Error:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_awarding_honor'), 'error');
      // Refresh data to undo optimistic update on error
      await this.fetchData();
      this.processHonors();
      this.updateHonorsListUI();
    } finally {
      this.pendingHonors = [];
      this.currentHonorIndex = 0;
    }
  }

  /**
   * Apply API award results to in-memory honors, setting IDs and deduping.
   * @param {Object} apiResult - Response from awardHonor()
   */
  applyAwardResults(apiResult) {
    try {
      const data = apiResult?.data || apiResult || {};
      const results = Array.isArray(data.results) ? data.results : [];

      results.forEach(r => {
        const participantId = Number(r.participantId);
        const action = r.action;
        const honorId = r.honorId;

        if (action === 'awarded' && honorId) {
          // Find the optimistic honor (no id yet) for this participant/date
          const optimistic = this.allHonors.find(h =>
            Number(h.participant_id) === participantId &&
            h.date === this.currentDate &&
            (h.id === undefined || h.id === null)
          );
          if (optimistic) {
            optimistic.id = honorId;
          }
        } else if (action === 'already_awarded') {
          // Remove any optimistic duplicate (without id) added for this participant/date
          this.allHonors = this.allHonors.filter(h => {
            const isOptimisticDuplicate = Number(h.participant_id) === participantId &&
              h.date === this.currentDate &&
              (h.id === undefined || h.id === null);
            return !isOptimisticDuplicate;
          });
        }
      });
    } catch (err) {
      debugWarn('Failed to apply award results optimistically:', err);
    }
  }

  /**
   * Optimistically add honors to the local data without waiting for server response
   */
  optimisticallyAddHonors(honors) {
    honors.forEach(honor => {
      const participantId = Number(honor.participantId);

      // Add to allHonors array
      this.allHonors.push({
        participant_id: honor.participantId,
        date: honor.date,
        reason: honor.reason,
        created_at: new Date().toISOString()
      });

      // Update the participant's honored status
      const participant = this.allParticipants.find(p => p.participant_id === participantId);
      if (participant) {
        debugLog(`Optimistically marking participant ${participant.participant_id} as honored`);
      }
    });

    debugLog('Optimistic update complete:', this.allHonors);
  }

  /**
   * Clear all honors-related caches
   */
  async clearHonorsCaches() {
    try {
      // Build cache keys for different dates that might be cached
      const cacheKeysToDelete = [
        `v1/honors`,
        `v1/honors?date=${this.currentDate}`,
        `v1/honors/history`,
        `recent_honors`
      ];

      for (const key of cacheKeysToDelete) {
        try {
          await deleteCachedData(key);
          debugLog(`Deleted cache for key: ${key}`);
        } catch (err) {
          debugWarn(`Could not delete cache for key ${key}:`, err);
        }
      }
    } catch (error) {
      debugError('Error clearing honors caches:', error);
    }
  }

  sortItems(sortBy) {
    // Toggle sort order if clicking same key, otherwise start with asc
    if (this.currentSort.key === sortBy) {
      this.currentSort.order =
        this.currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.key = sortBy;
      this.currentSort.order = 'asc';
    }

    // Sort participants by name, honors, or last honor date
    this.honorsData.names.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
      } else if (sortBy === 'honors') {
        comparison = a.total_honors - b.total_honors;
      } else if (sortBy === 'last_date') {
        // Handle null dates - push them to the end
        if (!a.last_honor_date && !b.last_honor_date) {
          comparison = 0;
        } else if (!a.last_honor_date) {
          comparison = 1;
        } else if (!b.last_honor_date) {
          comparison = -1;
        } else {
          comparison = new Date(a.last_honor_date) - new Date(b.last_honor_date);
        }
      }
      return this.currentSort.order === 'asc' ? comparison : -comparison;
    });

    // Re-render to update the UI with new sort order and indicators
    this.render();
    this.attachEventListeners();
  }

  attachEventListenersToListItems() {
    document.querySelectorAll('.honors-table__row').forEach((item) => {
      item.addEventListener('click', (event) => this.handleItemClick(event));
    });
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    showPageError(document.getElementById('app'), {
      ...this.pageOptions(),
      message: translate('error_loading_honors'),
    }, () => this.init());
  }

  /**
   * Show modal to edit honor reason
   */
  async showEditReasonModal(honorId) {
    const honor = this.allHonors.find(h => h.id === honorId);
    if (!honor) {return;}

    const { overlay, close: closeDialog } = openModal({
      id: 'edit-reason-modal',
      title: translate('edit_reason'),
      body: `
        <form id="edit-reason-form">
          <div class="form-group">
            <label for="edit-reason-input">${translate('honor_reason_label')}:</label>
            <textarea
              id="edit-reason-input"
              class="form-control"
              rows="3"
              required
            >${sanitizeHTML(honor.reason || '')}</textarea>
          </div>
        </form>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="edit-reason-form">${translate('save')}</button>
      `,
      initialFocus: '#edit-reason-input',
    });
    const form = overlay.querySelector('#edit-reason-form');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newReason = document.getElementById('edit-reason-input').value.trim();

      if (!newReason) {
        this.app.showMessage(translate('honor_reason_required'), 'error');
        return;
      }

      try {
        await updateHonor(honorId, { reason: newReason });
        this.app.showMessage(translate('honor_updated_successfully'), 'success');
        closeDialog();
        await this.clearHonorsCaches();
        await this.fetchData();
        this.processHonors();
        this.updateHonorsListUI();
      } catch (error) {
        debugError('Error updating honor reason:', error);
        this.app.showMessage(translate('error_updating_honor'), 'error');
      }
    });

  }

  /**
   * Show modal to edit honor date
   */
  async showEditDateModal(honorId) {
    const honor = this.allHonors.find(h => h.id === honorId);
    if (!honor) {return;}

    const { overlay, close: closeDialog } = openModal({
      id: 'edit-date-modal',
      title: translate('change_date'),
      body: `
        <p class="warning-text"><span aria-hidden="true">⚠️</span> ${translate('changing_date_warning')}</p>
        <form id="edit-date-form">
          <div class="form-group">
            <label for="edit-date-input">${translate('new_date')}:</label>
            <input
              type="date"
              id="edit-date-input"
              class="form-control"
              value="${escapeHTML(honor.date)}"
              required
            />
          </div>
        </form>
      `,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="edit-date-form">${translate('save')}</button>
      `,
      initialFocus: '#edit-date-input',
    });
    const form = overlay.querySelector('#edit-date-form');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newDate = document.getElementById('edit-date-input').value;

      if (!newDate) {
        this.app.showMessage(translate('date_required'), 'error');
        return;
      }

      try {
        await updateHonor(honorId, { date: newDate });
        this.app.showMessage(translate('honor_date_updated_successfully'), 'success');
        closeDialog();
        await this.clearHonorsCaches();
        await this.fetchData();
        this.processHonors();
        this.updateHonorsListUI();
      } catch (error) {
        debugError('Error updating honor date:', error);
        this.app.showMessage(translate('error_updating_honor'), 'error');
      }
    });

  }

  /**
   * Handle undo honor (quick delete within time window)
   */
  async handleUndoHonor(honorId) {
    const honor = this.allHonors.find(h => h.id === honorId);
    if (!honor) {return;}

    try {
      await deleteHonor(honorId);
      this.app.showMessage(translate('honor_undone_successfully'), 'success');
      await this.clearHonorsCaches();
      await this.fetchData();
      this.processHonors();
      this.updateHonorsListUI();
    } catch (error) {
      debugError('Error undoing honor:', error);
      this.app.showMessage(translate('error_undoing_honor'), 'error');
    }
  }

  /**
   * Handle delete honor (with confirmation)
   */
  async handleDeleteHonor(honorId) {
    const honor = this.allHonors.find(h => h.id === honorId);
    if (!honor) {return;}

    const participant = this.allParticipants.find(p => p.participant_id === honor.participant_id);
    const participantName = participant ? `${participant.first_name} ${participant.last_name}` : '';

    if (!(await confirmDestructive(`${translate('confirm_delete_honor')} ${participantName}?`))) {
      return;
    }

    try {
      await deleteHonor(honorId);
      this.app.showMessage(translate('honor_deleted_successfully'), 'success');
      await this.clearHonorsCaches();
      await this.fetchData();
      this.processHonors();
      this.updateHonorsListUI();
    } catch (error) {
      debugError('Error deleting honor:', error);
      this.app.showMessage(translate('error_deleting_honor'), 'error');
    }
  }
}
