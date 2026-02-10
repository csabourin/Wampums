// carpool_dashboard.js
// Carpool coordination dashboard for parents and staff with carpool permissions
import { translate } from './app.js';
import {
  getActivity,
  getActivityParticipants
} from './api/api-activities.js';
import {
  getCarpoolOffers,
  createCarpoolOffer,
  updateCarpoolOffer,
  cancelCarpoolOffer,
  assignParticipantToCarpool,
  removeAssignment,
  getUnassignedParticipants
} from './api/api-carpools.js';
import { canManageCarpools, canViewCarpools, isParent } from './utils/PermissionUtils.js';
import { OptimisticUpdateManager, generateOptimisticId } from './utils/OptimisticUpdateManager.js';
import { skeletonCarpoolDashboard, setButtonLoading } from './utils/SkeletonUtils.js';
import { debugError, debugLog } from './utils/DebugUtils.js';
import { offlineManager } from './modules/OfflineManager.js';
import { getCachedData } from './indexedDB.js';
import { setContent, loadStylesheet } from "./utils/DOMUtils.js";
import { buildNotFoundMarkup } from "./utils/NotFoundUtils.js";
import { parseDate } from './utils/DateUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { withButtonLoading } from './utils/PerformanceUtils.js';
import {
  formatActivityDateRange,
  getActivityStartDate
} from './utils/ActivityDateUtils.js';

export class CarpoolDashboard {
  constructor(app, activityId) {
    this.app = app;
    this.activityId = parseInt(activityId);
    this.activity = null;
    this.carpoolOffers = [];
    this.participants = [];
    this.unassignedParticipants = [];
    this.isParentUser = isParent();
    this.isStaff = !this.isParentUser && canManageCarpools();
    this.hasCarpoolAccess = canViewCarpools() || canManageCarpools();
    // Optimistic update manager for instant UI feedback
    this.optimisticManager = new OptimisticUpdateManager();
    this.isLoading = true;
  }

  async init() {
    // Load page-specific CSS
    await loadStylesheet("/css/carpool.css");

    if (!this.hasCarpoolAccess) {
      this.app.router.navigate("/dashboard");
      return;
    }

    // Show loading skeleton
    this.isLoading = true;
    this.render();

    await this.loadData();

    // Show actual content
    this.isLoading = false;
    this.render();
    this.attachEventListeners();
  }

  async loadData() {
    try {
      // Check for cached data first (camp mode or offline)
      if (offlineManager.campMode || offlineManager.isOffline) {
        const cachedActivity = await getCachedData(`activity_${this.activityId}`);
        const cachedOffers = await getCachedData(`carpool_offers_activity_${this.activityId}`);
        const cachedAssignments = await getCachedData(`carpool_assignments_activity_${this.activityId}`);
        const cachedParticipants = await getCachedData('participants_v2');

        if (cachedActivity?.data && cachedOffers?.data && cachedParticipants?.data) {
          debugLog('CarpoolDashboard: Using cached data');
          this.activity = cachedActivity.data;

          // Merge assignments into offers
          const assignmentsByOffer = {};
          if (cachedAssignments?.data) {
            cachedAssignments.data.forEach(a => {
              if (!assignmentsByOffer[a.carpool_offer_id]) {
                assignmentsByOffer[a.carpool_offer_id] = [];
              }
              assignmentsByOffer[a.carpool_offer_id].push({
                assignment_id: a.id,
                participant_id: a.participant_id,
                participant_name: `${a.first_name} ${a.last_name}`,
                trip_direction: a.trip_direction
              });
            });
          }

          this.carpoolOffers = cachedOffers.data.map(offer => ({
            ...offer,
            assignments: assignmentsByOffer[offer.id] || [],
            seats_used_going: (assignmentsByOffer[offer.id] || [])
              .filter(a => ['both', 'to_activity'].includes(a.trip_direction)).length,
            seats_used_return: (assignmentsByOffer[offer.id] || [])
              .filter(a => ['both', 'from_activity'].includes(a.trip_direction)).length
          }));

          this.participants = cachedParticipants.data;
          this.unassignedParticipants = []; // Skip when using cached data
          return;
        }

        // Offline with no cached data available
        if (offlineManager.isOffline) {
          this.offlineNoData = true;
          return;
        }
      }

      // Fall back to API calls
      [this.activity, this.carpoolOffers, this.participants] = await Promise.all([
        getActivity(this.activityId),
        getCarpoolOffers(this.activityId),
        getActivityParticipants(this.activityId)
      ]);

      if (this.isStaff) {
        this.unassignedParticipants = await getUnassignedParticipants(this.activityId);
      }
    } catch (error) {
      debugError('Error loading carpool data:', error);
      this.app.showMessage(translate('error_loading_carpool_data'), 'error');
    }
  }

  render() {
    const container = document.getElementById('app');

    // Show loading skeleton while data is being fetched
    if (this.isLoading) {
      setContent(container, skeletonCarpoolDashboard());
      return;
    }

    if (this.offlineNoData) {
      setContent(container, `
        <section class="page">
          <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
          <div class="card" style="text-align:center; padding:2rem;">
            <h2>${translate('offline_indicator')}</h2>
            <p>${translate('offline_data_not_prepared')}</p>
          </div>
        </section>
      `);
      return;
    }

    if (!this.activity) {
      setContent(container, `
        ${buildNotFoundMarkup({
          messageKey: 'activity_not_found',
          resourceLabel: translate('activity')
        })}
      `);
      return;
    }

    const activityDateString = getActivityStartDate(this.activity);
    const activityDate = parseDate(activityDateString);
    const activityDateLabel = formatActivityDateRange(this.activity, this.app.lang || 'fr');

    setContent(container, `
      <section class="page carpool-page">
        <header class="page__header">
          <div class="page__header-top">
            <button class="button button--ghost" id="back-btn">
              ← ${translate('back')}
            </button>
            <h1>${translate('carpool_coordination')}</h1>
          </div>
        </header>

        <!-- Activity Info Card -->
        <div class="activity-info-card">
          <h2>${this.activity.name}</h2>
          <p class="activity-info-card__date">${activityDate ? activityDateLabel : ''}</p>

          <div class="activity-info-card__details">
            <div class="info-block">
              <strong>${translate('going')}:</strong>
              <p>${translate('meeting')}: ${escapeHTML(this.activity.meeting_time_going || '-')} @ ${escapeHTML(this.activity.meeting_location_going || '-')}</p>
              <p>${translate('departure')}: ${escapeHTML(this.activity.departure_time_going || '-')}</p>
            </div>

            ${this.activity.meeting_location_return ? `
              <div class="info-block">
                <strong>${translate('returning')}:</strong>
                <p>${translate('meeting')}: ${escapeHTML(this.activity.meeting_time_return || '-')} @ ${escapeHTML(this.activity.meeting_location_return)}</p>
                <p>${translate('departure')}: ${escapeHTML(this.activity.departure_time_return || '-')}</p>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="carpool-actions">
          <button class="button button--primary button--large" id="offer-ride-btn">
            <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="3" width="15" height="13"></rect>
              <path d="M16 8h2"></path>
              <circle cx="18.5" cy="15.5" r="2.5"></circle>
              <circle cx="5.5" cy="15.5" r="2.5"></circle>
            </svg>
            ${translate('offer_a_ride')}
          </button>

          ${this.renderLookForRideButton()}
        </div>

        ${this.isStaff && this.unassignedParticipants.length > 0 ? `
          <div class="alert alert--warning">
            <strong>${translate('attention')}:</strong> ${this.unassignedParticipants.length} ${translate('participants_need_rides')}
          </div>
        ` : ''}

        <!-- Available Rides -->
        <section class="carpool-section">
          <h2 class="carpool-section__title">${translate('available_rides')}</h2>
          ${this.renderCarpoolOffers()}
        </section>

        ${this.isStaff ? this.renderUnassignedParticipants() : ''}

        <!-- Current Assignments -->
        <section class="carpool-section">
          <h2 class="carpool-section__title">${translate('current_assignments')}</h2>
          ${this.renderAssignments()}
        </section>
      </section>
    `);
  }

  renderLookForRideButton() {
    // Get user's children who need rides
    const userChildren = this.participants.filter(p => {
      const assignments = p.carpool_assignments || [];
      const hasBothDirections = assignments.some(a => a.trip_direction === 'both');
      const hasGoing = hasBothDirections || assignments.some(a => a.trip_direction === 'to_activity');
      const hasReturn = hasBothDirections || assignments.some(a => a.trip_direction === 'from_activity');

      // Check if user is guardian
      const isGuardian = p.guardians && p.guardians.some(g => g.user_id === localStorage.getItem('userId'));

      // Need ride if they don't have both directions covered
      return isGuardian && (!hasGoing || (this.activity.meeting_location_return && !hasReturn));
    });

    if (userChildren.length === 0 && !this.isStaff) {
      return ''; // Don't show button if no children need rides
    }

    return `
      <button class="button button--secondary button--large" id="look-for-ride-btn">
        <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        ${translate('look_for_ride')}
      </button>
    `;
  }

  renderCarpoolOffers() {
    if (this.carpoolOffers.length === 0) {
      return `<p class="empty-state">${translate('no_rides_offered_yet')}</p>`;
    }

    return `
      <div class="carpool-offers">
        ${this.carpoolOffers.map(offer => this.renderCarpoolOfferCard(offer)).join('')}
      </div>
    `;
  }

  renderCarpoolOfferCard(offer) {
    const assignments = offer.assignments || [];
    const seatsUsedGoing = offer.seats_used_going || 0;
    const seatsUsedReturn = offer.seats_used_return || 0;
    const totalSeats = offer.total_seats_available;

    const showGoing = ['both', 'to_activity'].includes(offer.trip_direction);
    const showReturn = ['both', 'from_activity'].includes(offer.trip_direction);

    const userId = localStorage.getItem('userId');
    const isOwner = offer.user_id === userId;

    return `
      <div class="carpool-offer-card" data-offer-id="${offer.id}">
        <div class="carpool-offer-card__header">
          <div class="carpool-offer-card__driver">
            <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <strong>${offer.driver_name}</strong>
            ${isOwner ? `<span class="badge badge--primary">${translate('you')}</span>` : ''}
          </div>

          ${isOwner || this.isStaff ? `
            <div class="carpool-offer-card__actions">
              <button class="button button--small button--ghost edit-offer-btn"
                      data-offer-id="${offer.id}" aria-label="${translate('edit')}">
                ✏️
              </button>
              <button class="button button--small button--ghost delete-offer-btn"
                      data-offer-id="${offer.id}" aria-label="${translate('cancel_ride')}">
                🗑️
              </button>
            </div>
          ` : ''}
        </div>

        <div class="carpool-offer-card__vehicle">
          <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="3" width="15" height="13"></rect>
            <path d="M16 8h2"></path>
            <circle cx="18.5" cy="15.5" r="2.5"></circle>
            <circle cx="5.5" cy="15.5" r="2.5"></circle>
          </svg>
          ${offer.vehicle_color} ${offer.vehicle_make}
        </div>

        ${offer.notes ? `
          <p class="carpool-offer-card__notes">${offer.notes}</p>
        ` : ''}

        <div class="carpool-offer-card__capacity">
          ${showGoing ? `
            <div class="capacity-indicator">
              <span class="capacity-indicator__label">${translate('going')}:</span>
              <div class="capacity-indicator__bar">
                <div class="capacity-indicator__fill" style="width: ${(seatsUsedGoing / totalSeats) * 100}%"></div>
              </div>
              <span class="capacity-indicator__text">${seatsUsedGoing}/${totalSeats} ${translate('seats')}</span>
            </div>
          ` : ''}

          ${showReturn ? `
            <div class="capacity-indicator">
              <span class="capacity-indicator__label">${translate('returning')}:</span>
              <div class="capacity-indicator__bar">
                <div class="capacity-indicator__fill" style="width: ${(seatsUsedReturn / totalSeats) * 100}%"></div>
              </div>
              <span class="capacity-indicator__text">${seatsUsedReturn}/${totalSeats} ${translate('seats')}</span>
            </div>
          ` : ''}
        </div>

        ${assignments.length > 0 ? `
          <details class="carpool-offer-card__passengers">
            <summary>${translate('passengers')} (${assignments.length})</summary>
            <ul class="passenger-list">
              ${assignments.map(a => `
                <li class="passenger-item">
                  <span>${a.participant_name}</span>
                  <span class="badge badge--${a.trip_direction === 'both' ? 'primary' : 'secondary'}">
                    ${translate(a.trip_direction)}
                  </span>
                </li>
              `).join('')}
            </ul>
          </details>
        ` : ''}

        ${(seatsUsedGoing < totalSeats || seatsUsedReturn < totalSeats) ? `
          <button class="button button--primary button--block assign-to-ride-btn" data-offer-id="${offer.id}">
            ${translate('assign_participant')}
          </button>
        ` : ''}
      </div>
    `;
  }

  renderUnassignedParticipants() {
    if (this.unassignedParticipants.length === 0) {
      return '';
    }

    return `
      <section class="carpool-section">
        <h2 class="carpool-section__title">${translate('participants_needing_rides')}</h2>
        <div class="unassigned-list">
          ${this.unassignedParticipants.map(p => `
            <div class="unassigned-item">
              <div class="unassigned-item__info">
                <strong>${p.first_name} ${p.last_name}</strong>
                <div class="unassigned-item__status">
                  ${!p.has_ride_going ? `<span class="badge badge--warning">${translate('needs_ride_going')}</span>` : ''}
                  ${!p.has_ride_return && this.activity.meeting_location_return ?
        `<span class="badge badge--warning">${translate('needs_ride_return')}</span>` : ''}
                </div>
              </div>
              <button class="button button--small button--primary quick-assign-btn"
                      data-participant-id="${p.id}">
                ${translate('assign')}
              </button>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  renderAssignments() {
    const allAssignments = [];

    this.carpoolOffers.forEach(offer => {
      if (offer.assignments && offer.assignments.length > 0) {
        offer.assignments.forEach(assignment => {
          allAssignments.push({
            ...assignment,
            driver_name: offer.driver_name,
            vehicle_make: offer.vehicle_make,
            vehicle_color: offer.vehicle_color,
            offer_id: offer.id
          });
        });
      }
    });

    if (allAssignments.length === 0) {
      return `<p class="empty-state">${translate('no_assignments_yet')}</p>`;
    }

    // Group by participant
    const groupedByParticipant = allAssignments.reduce((acc, assignment) => {
      if (!acc[assignment.participant_id]) {
        acc[assignment.participant_id] = [];
      }
      acc[assignment.participant_id].push(assignment);
      return acc;
    }, {});

    return `
      <div class="assignments-list">
        ${Object.entries(groupedByParticipant).map(([participantId, assignments]) => {
      const firstAssignment = assignments[0];
      const userId = localStorage.getItem('userId');
      const canRemove = this.isStaff || firstAssignment.assigned_by === userId;

      return `
            <div class="assignment-card">
              <div class="assignment-card__header">
                <strong>${firstAssignment.participant_name}</strong>
              </div>
              ${assignments.map(a => `
                <div class="assignment-card__ride">
                  <div class="assignment-card__details">
                    <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="1" y="3" width="15" height="13"></rect>
                      <path d="M16 8h2"></path>
                      <circle cx="18.5" cy="15.5" r="2.5"></circle>
                      <circle cx="5.5" cy="15.5" r="2.5"></circle>
                    </svg>
                    <div>
                      <p><strong>${a.driver_name}</strong> - ${a.vehicle_color} ${a.vehicle_make}</p>
                      <p class="text-small">${translate(a.trip_direction)}</p>
                    </div>
                  </div>
                  ${canRemove ? `
                    <button class="button button--small button--danger remove-assignment-btn"
                            data-assignment-id="${a.assignment_id}">
                      ${translate('remove')}
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  attachEventListeners() {
    // Back button
    document.getElementById('back-btn')?.addEventListener('click', () => {
      window.history.back();
    });

    // Offer ride button
    document.getElementById('offer-ride-btn')?.addEventListener('click', () => {
      this.showOfferRideModal();
    });

    // Look for ride button
    document.getElementById('look-for-ride-btn')?.addEventListener('click', () => {
      this.showLookForRideModal();
    });

    // Edit offer buttons
    document.querySelectorAll('.edit-offer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const offerId = parseInt(e.target.closest('[data-offer-id]').dataset.offerId);
        const offer = this.carpoolOffers.find(o => o.id === offerId);
        if (offer) {
          this.showOfferRideModal(offer);
        }
      });
    });

    // Delete offer buttons
    document.querySelectorAll('.delete-offer-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const button = e.target;
        const offerId = parseInt(button.closest('[data-offer-id]').dataset.offerId);
        setButtonLoading(button, true);
        try {
          await this.handleCancelOffer(offerId);
        } finally {
          setButtonLoading(button, false);
        }
      });
    });

    // Assign to ride buttons
    document.querySelectorAll('.assign-to-ride-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const offerId = parseInt(e.target.dataset.offerId);
        this.showAssignmentModal(offerId);
      });
    });

    // Quick assign buttons (for staff users)
    document.querySelectorAll('.quick-assign-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const participantId = parseInt(e.target.dataset.participantId);
        this.showAssignmentModal(null, participantId);
      });
    });

    // Remove assignment buttons
    document.querySelectorAll('.remove-assignment-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const button = e.target;
        const assignmentId = parseInt(button.dataset.assignmentId);
        setButtonLoading(button, true);
        try {
          await this.handleRemoveAssignment(assignmentId);
        } finally {
          setButtonLoading(button, false);
        }
      });
    });
  }

  showOfferRideModal(offer = null) {
    const isEdit = offer !== null;
    const modalId = 'offer-ride-modal';

    const modalHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="offer-ride-modal-title">
        <header class="modal__header">
          <h2 id="offer-ride-modal-title">
            ${isEdit ? translate('edit_ride_offer') : translate('offer_a_ride')}
          </h2>
          <button class="ghost-button" id="close-offer-modal" aria-label="${translate('close')}">✕</button>
        </header>

        <form class="modal__content" id="offer-ride-form">
          <div class="info-box info-box--warning">
            <strong>${translate('important')}:</strong>
            <ul>
              <li>${translate('front_seat_notice')}</li>
              <li>${translate('adult_child_ratio_notice')}</li>
            </ul>
          </div>

          <div class="form-group">
            <label for="vehicle-make">${translate('vehicle_make')} <span class="required">*</span></label>
            <input type="text" id="vehicle-make" name="vehicle_make"
                   value="${offer?.vehicle_make || ''}" required
                   class="form-control" placeholder="${translate('vehicle_make_placeholder')}">
          </div>

          <div class="form-group">
            <label for="vehicle-color">${translate('vehicle_color')} <span class="required">*</span></label>
            <input type="text" id="vehicle-color" name="vehicle_color"
                   value="${offer?.vehicle_color || ''}" required
                   class="form-control" placeholder="${translate('vehicle_color_placeholder')}">
          </div>

          <div class="form-group">
            <label for="total-seats">${translate('seats_available')} <span class="required">*</span></label>
            <input type="number" id="total-seats" name="total_seats_available"
                   value="${offer?.total_seats_available || 3}" required
                   min="1" max="8" class="form-control">
            <small class="form-help">${translate('seats_available_help')}</small>
          </div>

          <div class="form-group">
            <label>${translate('trip_direction')} <span class="required">*</span></label>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="trip_direction" value="both"
                       ${!offer || offer.trip_direction === 'both' ? 'checked' : ''} required>
                <span>${translate('round_trip')}</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="trip_direction" value="to_activity"
                       ${offer?.trip_direction === 'to_activity' ? 'checked' : ''}>
                <span>${translate('to_activity_only')}</span>
              </label>
              ${this.activity.meeting_location_return ? `
                <label class="radio-label">
                  <input type="radio" name="trip_direction" value="from_activity"
                         ${offer?.trip_direction === 'from_activity' ? 'checked' : ''}>
                  <span>${translate('from_activity_only')}</span>
                </label>
              ` : ''}
            </div>
          </div>

          <div class="form-group">
            <label for="notes">${translate('additional_notes')}</label>
            <textarea id="notes" name="notes" class="form-control" rows="3"
                      placeholder="${translate('notes_placeholder')}">${offer?.notes || ''}</textarea>
          </div>

          <div class="modal__actions">
            <button type="button" class="button button--secondary" id="cancel-offer-btn">
              ${translate('cancel')}
            </button>
            <button type="submit" class="button button--primary">
              ${isEdit ? translate('save_changes') : translate('offer_ride')}
            </button>
          </div>
        </form>
      </div>
    `;

    this.showModal(modalId, modalHTML, async (formData) => {
      const data = {
        activity_id: this.activityId,
        ...Object.fromEntries(formData.entries())
      };

      try {
        if (isEdit) {
          await updateCarpoolOffer(offer.id, data);
          this.app.showMessage(translate('ride_offer_updated'), 'success');
        } else {
          await createCarpoolOffer(data);
          this.app.showMessage(translate('ride_offer_created'), 'success');
        }
        await this.loadData();
        this.render();
        this.attachEventListeners();
      } catch (error) {
        debugError('Error saving ride offer:', error);
        throw error;
      }
    });
  }

  showLookForRideModal() {
    // Get user's children who need rides
    const userChildren = this.participants.filter(p => {
      const isGuardian = p.guardians && p.guardians.some(g => g.user_id === localStorage.getItem('userId'));
      return isGuardian || this.isStaff;
    });

    if (userChildren.length === 0) {
      this.app.showMessage(translate('no_children_found'), 'warning');
      return;
    }

    const modalId = 'look-for-ride-modal';

    const modalHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="look-for-ride-modal-title">
        <header class="modal__header">
          <h2 id="look-for-ride-modal-title">${translate('look_for_ride')}</h2>
          <button class="ghost-button" id="close-look-modal" aria-label="${translate('close')}">✕</button>
        </header>

        <div class="modal__content">
          <p>${translate('select_child_to_assign')}</p>

          <div class="child-selection-list">
            ${userChildren.map(child => {
      const assignments = child.carpool_assignments || [];
      const hasBothDirections = assignments.some(a => a.trip_direction === 'both');
      const hasGoing = hasBothDirections || assignments.some(a => a.trip_direction === 'to_activity');
      const hasReturn = hasBothDirections || assignments.some(a => a.trip_direction === 'from_activity');

      return `
                <div class="child-selection-card">
                  <div class="child-selection-card__info">
                    <strong>${child.first_name} ${child.last_name}</strong>
                    <div class="child-selection-card__status">
                      ${hasGoing ?
          `<span class="badge badge--success">✓ ${translate('has_ride_going')}</span>` :
          `<span class="badge badge--warning">${translate('needs_ride_going')}</span>`
        }
                      ${this.activity.meeting_location_return ? (hasReturn ?
          `<span class="badge badge--success">✓ ${translate('has_ride_return')}</span>` :
          `<span class="badge badge--warning">${translate('needs_ride_return')}</span>`
        ) : ''}
                    </div>
                  </div>
                  <button class="button button--primary select-child-btn"
                          data-participant-id="${child.id}">
                    ${translate('select')}
                  </button>
                </div>
              `;
    }).join('')}
          </div>
        </div>
      </div>
    `;

    let modalContainer = document.getElementById(modalId);
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = modalId;
      modalContainer.className = 'modal-container';
      document.body.appendChild(modalContainer);
    }
    // Use innerHTML directly to avoid sanitization issues with forms
    modalContainer.innerHTML = modalHTML;
    modalContainer.classList.add('modal-container--visible');

    const closeModal = () => {
      modalContainer.remove();
    };

    document.getElementById('close-look-modal')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal__backdrop')?.addEventListener('click', closeModal);

    document.querySelectorAll('.select-child-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const participantId = parseInt(e.target.dataset.participantId);
        closeModal();
        this.showAssignmentModal(null, participantId);
      });
    });
  }

  showAssignmentModal(offerId = null, participantId = null) {
    const availableOffers = this.carpoolOffers.filter(o => {
      const seatsUsedGoing = o.seats_used_going || 0;
      const seatsUsedReturn = o.seats_used_return || 0;
      return seatsUsedGoing < o.total_seats_available || seatsUsedReturn < o.total_seats_available;
    });

    if (availableOffers.length === 0) {
      this.app.showMessage(translate('no_available_rides'), 'warning');
      return;
    }

    // Filter offers if a specific one is selected
    const offersToShow = offerId ? availableOffers.filter(o => o.id === offerId) : availableOffers;

    // Get participants to assign
    const participantsToAssign = participantId
      ? this.participants.filter(p => p.id === participantId)
      : this.participants.filter(p => {
        const isGuardian = p.guardians && p.guardians.some(g => g.user_id === localStorage.getItem('userId'));
        return isGuardian || this.isStaff;
      });

    const modalId = 'assignment-modal';

    const modalHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="assignment-modal-title">
        <header class="modal__header">
          <h2 id="assignment-modal-title">${translate('assign_to_carpool')}</h2>
          <button class="ghost-button" id="close-assignment-modal" aria-label="${translate('close')}">✕</button>
        </header>

        <form class="modal__content" id="assignment-form">
          <div class="form-group">
            <label for="participant-select">${translate('participant')} <span class="required">*</span></label>
            <select id="participant-select" name="participant_id" class="form-control" required>
              <option value="">${translate('select_participant')}</option>
              ${participantsToAssign.map(p => `
                <option value="${p.id}">${p.first_name} ${p.last_name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="offer-select">${translate('vehicle')} <span class="required">*</span></label>
            <select id="offer-select" name="carpool_offer_id" class="form-control" required>
              <option value="">${translate('select_vehicle')}</option>
              ${offersToShow.map(o => `
                <option value="${o.id}">
                  ${o.driver_name} - ${o.vehicle_color} ${o.vehicle_make}
                  (${translate(o.trip_direction)})
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>${translate('trip_direction')} <span class="required">*</span></label>
            <div class="radio-group" id="trip-direction-options">
              <label class="radio-label">
                <input type="radio" name="trip_direction" value="both" checked required>
                <span>${translate('round_trip')}</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="trip_direction" value="to_activity">
                <span>${translate('to_activity_only')}</span>
              </label>
              ${this.activity.meeting_location_return ? `
                <label class="radio-label">
                  <input type="radio" name="trip_direction" value="from_activity">
                  <span>${translate('from_activity_only')}</span>
                </label>
              ` : ''}
            </div>
          </div>

          <div class="modal__actions">
            <button type="button" class="button button--secondary" id="cancel-assignment-btn">
              ${translate('cancel')}
            </button>
            <button type="submit" class="button button--primary">
              ${translate('assign')}
            </button>
          </div>
        </form>
      </div>
    `;

    this.showModal(modalId, modalHTML, async (formData) => {
      const data = Object.fromEntries(formData.entries());
      const participantId = parseInt(data.participant_id);
      const offerId = parseInt(data.carpool_offer_id);
      const tripDirection = data.trip_direction;

      await this.optimisticManager.execute(`assign-${participantId}-${offerId}`, {
        optimisticFn: () => {
          // Save original state for rollback
          const originalOffers = JSON.parse(JSON.stringify(this.carpoolOffers));

          // Find participant and offer
          const participant = this.participants.find(p => p.id === participantId);
          const offer = this.carpoolOffers.find(o => o.id === offerId);

          if (!participant || !offer) {
            return { originalOffers };
          }

          // Create optimistic assignment
          const optimisticAssignment = {
            assignment_id: generateOptimisticId('assignment'),
            participant_id: participantId,
            participant_name: `${participant.first_name} ${participant.last_name}`,
            carpool_offer_id: offerId,
            trip_direction: tripDirection,
            assigned_by: localStorage.getItem('userId'),
            _optimistic: true
          };

          // Update carpool offers optimistically
          this.carpoolOffers = this.carpoolOffers.map(o => {
            if (o.id === offerId) {
              const seatsToUseGoing = ['both', 'to_activity'].includes(tripDirection) ? 1 : 0;
              const seatsToUseReturn = ['both', 'from_activity'].includes(tripDirection) ? 1 : 0;

              return {
                ...o,
                assignments: [...(o.assignments || []), optimisticAssignment],
                seats_used_going: (o.seats_used_going || 0) + seatsToUseGoing,
                seats_used_return: (o.seats_used_return || 0) + seatsToUseReturn
              };
            }
            return o;
          });

          // Re-render immediately with optimistic state
          this.render();
          this.attachEventListeners();

          return { originalOffers };
        },

        apiFn: async () => {
          // Make actual API call in background
          return await assignParticipantToCarpool(data);
        },

        successFn: (result) => {
          // Reload fresh data from server to replace optimistic data
          this.loadData().then(() => {
            this.render();
            this.attachEventListeners();
          });
          this.app.showMessage(translate('participant_assigned_success'), 'success');
        },

        rollbackFn: ({ originalOffers }, error) => {
          // Rollback to original state on error
          this.carpoolOffers = originalOffers;
          this.render();
          this.attachEventListeners();
          debugError('Error assigning participant:', error);
          throw error; // Re-throw to show error message
        }
      });
    });

    // Pre-select if IDs provided
    if (offerId) {
      document.getElementById('offer-select').value = offerId;
    }
    if (participantId) {
      document.getElementById('participant-select').value = participantId;
    }

    // Update trip direction options based on selected offer
    document.getElementById('offer-select')?.addEventListener('change', (e) => {
      const selectedOfferId = parseInt(e.target.value);
      if (selectedOfferId) {
        const offer = this.carpoolOffers.find(o => o.id === selectedOfferId);
        if (offer) {
          // Enable/disable trip direction options based on offer's direction
          const directionInputs = document.querySelectorAll('input[name="trip_direction"]');
          directionInputs.forEach(input => {
            if (offer.trip_direction === 'both') {
              input.disabled = false;
            } else if (offer.trip_direction === 'to_activity') {
              input.disabled = input.value === 'from_activity';
              if (input.value === 'to_activity') input.checked = true;
            } else if (offer.trip_direction === 'from_activity') {
              input.disabled = input.value === 'to_activity';
              if (input.value === 'from_activity') input.checked = true;
            }
          });
        }
      }
    });
  }

  async handleCancelOffer(offerId) {
    const offer = this.carpoolOffers.find(o => o.id === offerId);
    const hasAssignments = offer.assignments && offer.assignments.length > 0;

    let confirmed = false;
    let reason = '';

    if (hasAssignments) {
      reason = prompt(translate('cancel_ride_with_assignments_prompt'));
      confirmed = reason !== null; // null means cancelled prompt
    } else {
      confirmed = confirm(translate('confirm_cancel_ride'));
    }

    if (!confirmed) return;

    await this.optimisticManager.execute(`cancel-offer-${offerId}`, {
      optimisticFn: () => {
        // Save original state for rollback
        const originalOffers = JSON.parse(JSON.stringify(this.carpoolOffers));

        // Remove offer optimistically
        this.carpoolOffers = this.carpoolOffers.filter(o => o.id !== offerId);

        // Re-render immediately with optimistic state
        this.render();
        this.attachEventListeners();

        return { originalOffers };
      },

      apiFn: async () => {
        // Make actual API call in background
        return await cancelCarpoolOffer(offerId, reason);
      },

      successFn: (result) => {
        // Reload fresh data from server
        this.loadData().then(() => {
          this.render();
          this.attachEventListeners();
        });
        this.app.showMessage(translate('ride_cancelled_success'), 'success');
      },

      rollbackFn: ({ originalOffers }, error) => {
        // Rollback to original state on error
        this.carpoolOffers = originalOffers;
        this.render();
        this.attachEventListeners();
        debugError('Error cancelling ride:', error);
        this.app.showMessage(error.message || translate('error_cancelling_ride'), 'error');
      }
    });
  }

  async handleRemoveAssignment(assignmentId) {
    if (!confirm(translate('confirm_remove_assignment'))) {
      return;
    }

    await this.optimisticManager.execute(`remove-assignment-${assignmentId}`, {
      optimisticFn: () => {
        // Save original state for rollback
        const originalOffers = JSON.parse(JSON.stringify(this.carpoolOffers));

        // Remove assignment optimistically
        this.carpoolOffers = this.carpoolOffers.map(offer => {
          if (offer.assignments && offer.assignments.length > 0) {
            const updatedAssignments = offer.assignments.filter(a => a.assignment_id !== assignmentId);

            // Find the removed assignment to update seat counts
            const removedAssignment = offer.assignments.find(a => a.assignment_id === assignmentId);
            if (removedAssignment) {
              const seatsToFree = ['both', 'to_activity'].includes(removedAssignment.trip_direction) ? 1 : 0;
              const seatsToFreeReturn = ['both', 'from_activity'].includes(removedAssignment.trip_direction) ? 1 : 0;

              return {
                ...offer,
                assignments: updatedAssignments,
                seats_used_going: (offer.seats_used_going || 0) - seatsToFree,
                seats_used_return: (offer.seats_used_return || 0) - seatsToFreeReturn
              };
            }
          }
          return offer;
        });

        // Re-render immediately with optimistic state
        this.render();
        this.attachEventListeners();

        return { originalOffers };
      },

      apiFn: async () => {
        // Make actual API call in background
        return await removeAssignment(assignmentId);
      },

      successFn: (result) => {
        // Reload fresh data from server to ensure consistency
        this.loadData().then(() => {
          this.render();
          this.attachEventListeners();
        });
        this.app.showMessage(translate('assignment_removed_success'), 'success');
      },

      rollbackFn: ({ originalOffers }, error) => {
        // Rollback to original state on error
        this.carpoolOffers = originalOffers;
        this.render();
        this.attachEventListeners();
        this.app.showMessage(error.message || translate('error_removing_assignment'), 'error');
      }
    });
  }

  showModal(modalId, modalHTML, onSubmit) {
    let modalContainer = document.getElementById(modalId);
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = modalId;
      modalContainer.className = 'modal-container';
      document.body.appendChild(modalContainer);
    }
    // Use innerHTML directly to avoid sanitization issues with forms
    modalContainer.innerHTML = modalHTML;
    modalContainer.classList.add('modal-container--visible');

    const closeModal = () => {
      modalContainer.remove();
    };

    // Close modal handlers
    modalContainer.querySelector('.ghost-button')?.addEventListener('click', closeModal);
    modalContainer.querySelectorAll('[id^="cancel-"]').forEach(btn => {
      btn.addEventListener('click', closeModal);
    });
    modalContainer.querySelector('.modal__backdrop')?.addEventListener('click', closeModal);

    // Form submission
    const form = modalContainer.querySelector('form');
    if (form && onSubmit) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);

        withButtonLoading(submitBtn, async () => {
          try {
            await onSubmit(formData);
            closeModal();
          } catch (error) {
            this.app.showMessage(error.message || translate('error_occurred'), 'error');
          }
        });
      });
    }
  }
}
