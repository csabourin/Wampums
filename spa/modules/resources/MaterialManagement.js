import { translate } from '../../app.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML, escapeAttribute, sanitizeURL } from '../../utils/SecurityUtils.js';
import { EQUIPMENT_CATEGORIES, equipmentCategoryLabel } from '../../utils/EquipmentCategoryUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import {
  formatActivityDateRange,
  getActivityEndDate,
  getActivityStartDate
} from '../../utils/ActivityDateUtils.js';
import {
  getEquipmentInventory,
  getEquipmentPhotoUrl,
  getEquipmentReservations,
  saveBulkReservations,
  updateEquipmentReservation,
  getActivities
} from '../../api/api-endpoints.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { getCurrentOrganizationId } from '../../ajax-functions.js';
import { deleteCachedData } from '../../indexedDB.js';
import { setContent } from '../../utils/DOMUtils.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
/**
 * What a leader can do to a reservation, given where it currently stands.
 *
 * The lifecycle is a line, not a free-for-all: gear is spoken for, then it goes
 * out, then it comes back. Offering only the next step keeps the table honest —
 * there is no button to return equipment that was never picked up.
 *
 * The terminal states (`returned`, `cancelled`, `expired`) are absent on
 * purpose: a reservation that is over stays over, and a new one is the way to
 * take the equipment out again.
 */
const RESERVATION_ACTIONS = {
  reserved: [
    { status: 'confirmed', labelKey: 'reservation_action_pick_up', variant: 'primary' },
    { status: 'cancelled', labelKey: 'reservation_action_cancel', variant: 'danger' }
  ],
  confirmed: [
    { status: 'returned', labelKey: 'reservation_action_return', variant: 'primary' }
  ]
};

/** How the picker can be sorted. */
const MATERIAL_SORTS = ['category', 'name', 'available'];

/**
 * Text as the search compares it: lower case, accents removed.
 * @param {string} text
 * @returns {string}
 */
function normalizeSearch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LOCATION_TYPES = [
  { value: 'local_scout_hall', labelKey: 'location_type_local_scout_hall' },
  { value: 'warehouse', labelKey: 'location_type_warehouse' },
  { value: 'leader_home', labelKey: 'location_type_leader_home' },
  { value: 'other', labelKey: 'location_type_other' }
];

/**
 * Material management page for reserving equipment for activities
 */
/**
 * Label a reservation status in the reader's language.
 *
 * The status arrives from the database as a bare English keyword. Printing it
 * straight into the table put "reserved" in the middle of a French page, which
 * the project's first rule forbids. An unrecognised value falls back to itself
 * rather than to an empty cell -- a row with an odd label is still readable, a
 * row with a blank status is not.
 *
 * @param {string} status - Stored status keyword
 * @returns {string} Translated label
 */
function reservationStatusLabel(status) {
  if (!status) {
    return '';
  }
  const key = `reservation_status_${status}`;
  const label = translate(key);
  return label && label !== key ? label : status;
}

export class MaterialManagement {
  constructor(app) {
    this.app = app;
    this.destroyed = false;
    this.equipment = [];
    this.reservations = [];
    this.activities = [];
    this.selectedItems = new Map(); // Map of equipment_id -> quantity
    this.selectedActivityId = null;
    // The form and the picker keep their state, so redrawing either never
    // loses what was typed or chosen.
    this.dateFrom = getTodayISO();
    this.dateTo = getTodayISO();
    this.reservedFor = '';
    this.notes = '';
    this.search = '';
    this.categoryFilter = 'all';
    this.sortOrder = 'category';
    // Checking gear in and out is the same right as reserving it, and only the
    // unit that owns a reservation may do either.
    this.canReserve = hasPermission('inventory.reserve');
    this.organizationId = getCurrentOrganizationId();
  }

  async init() {
    showPageLoading(document.getElementById('app'), this.pageOptions());
    try {
      await this.refreshData();
    } catch (error) {
      // A list that did not load is never shown as an empty one.
      debugError('Error initializing material management:', error);
      if (!this.destroyed) {
        showPageError(document.getElementById('app'), this.pageOptions(), () => this.init());
      }
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventHandlers();
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('material_management_title'), className: 'material-management-page' };
  }

  /**
   * Reload after a write the server accepted. The write stands even if the
   * reload fails: the page keeps what it showed and says it could not refresh.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    try {
      await this.refreshData();
    } catch (error) {
      debugError('Error refreshing material management:', error);
      if (!this.destroyed) {
        this.app.showMessage(translate('error_loading_data'), 'error');
      }
    }
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventHandlers();
  }


  async refreshData() {
    const [equipmentResponse, reservationResponse, activitiesResponse] = await Promise.all([
      getEquipmentInventory(),
      getEquipmentReservations(),
      getActivities()
    ]);

    this.equipment = equipmentResponse?.data?.equipment || equipmentResponse?.equipment || [];
    this.reservations = reservationResponse?.data?.reservations || reservationResponse?.reservations || [];
    this.activities = activitiesResponse?.data?.activities || activitiesResponse?.activities || [];
  }

  /**
   * Get conflicting reservations for an equipment item
   */
  getConflictingReservations(equipmentId, dateFrom, dateTo) {
    if (!dateFrom || !dateTo) {
      return [];
    }

    return this.reservations.filter(reservation => {
      if (reservation.equipment_id !== equipmentId) {
        return false;
      }

      // Only show active reservations
      if (reservation.status !== 'reserved' && reservation.status !== 'confirmed') {
        return false;
      }

      // Check for date overlap
      const resFrom = reservation.date_from || reservation.meeting_date;
      const resTo = reservation.date_to || reservation.meeting_date;

      // Reservations overlap if: res.date_from <= selected.date_to AND res.date_to >= selected.date_from
      return resFrom <= dateTo && resTo >= dateFrom;
    });
  }

  /**
   * Format the pickup location with translated labels for display.
   * @param {Object} item
   * @returns {string}
   */
  formatLocation(item = {}) {
    const type = item.location_type || LOCATION_TYPES[0].value;
    const typeLabel = translate(
      LOCATION_TYPES.find((entry) => entry.value === type)?.labelKey || LOCATION_TYPES[0].labelKey
    );
    const details = item.location_details || '';
    const cleanedDetails = details.trim();
    if (cleanedDetails) {
      return `${typeLabel} — ${cleanedDetails}`;
    }
    return typeLabel;
  }

  /**
   * Buttons that move a reservation to its next state.
   *
   * Two things withhold them. A reservation belonging to another unit is shown
   * here because the equipment is shared, but only its owner may check it in or
   * out -- and the API would answer 404 anyway, so offering the button would
   * only promise something that cannot happen. And a leader without
   * `inventory.reserve` may read the table without changing it.
   *
   * @param {Object} reservation - Reservation row
   * @returns {string} Markup for the actions cell
   */
  renderReservationActions(reservation) {
    const isOwn =
      String(reservation.reservation_organization_id ?? '') === String(this.organizationId ?? '');
    const actions = RESERVATION_ACTIONS[reservation.status] || [];

    if (!this.canReserve || !isOwn || actions.length === 0) {
      return '<span class="muted-text">&mdash;</span>';
    }

    return actions
      .map(
        (action) => `
          <button type="button"
                  class="button button--small button--${action.variant} js-reservation-action"
                  data-reservation-id="${escapeHTML(String(reservation.id))}"
                  data-next-status="${escapeHTML(action.status)}">
            ${escapeHTML(translate(action.labelKey))}
          </button>`
      )
      .join('');
  }

  /**
   * Move one reservation to its next state.
   *
   * Cancelling asks first: it is the one action here that throws away a claim
   * rather than advancing it, and nothing in this table can put it back.
   *
   * @param {string} reservationId - Reservation ID
   * @param {string} nextStatus - Status to move to
   * @returns {Promise<void>}
   */
  async handleReservationAction(reservationId, nextStatus) {
    if (nextStatus === 'cancelled') {
      const confirmed = await confirmDestructive({
        message: translate('reservation_action_cancel_confirm'),
        confirmLabel: translate('reservation_action_cancel')
      });
      if (!confirmed) {
        return;
      }
    }

    try {
      await updateEquipmentReservation(reservationId, { status: nextStatus });
    } catch (error) {
      debugError('Failed to update reservation status:', error);
      this.app.showMessage(
        apiErrorMessage(error, 'reservation_status_update_failed'),
        'error'
      );
      return;
    }

    // The status changed on the server: nothing below reports otherwise.
    this.app.showMessage(translate('reservation_status_updated'), 'success');
    // The equipment listing reports availability, and this just changed it.
    await deleteCachedData('v1/resources/equipment');
    await deleteCachedData('v1/resources/equipment/reservations');
    await this.reload();
  }

  /**
   * Units of an item free for the dates chosen: what the unit owns, less what
   * other reservations of those dates hold and what is out on loan.
   *
   * @param {Object} item - Equipment row
   * @returns {number}
   */
  availableFor(item) {
    const reserved = this.getConflictingReservations(item.id, this.dateFrom, this.dateTo)
      .reduce((total, reservation) => total + (Number(reservation.reserved_quantity) || 0), 0);
    return Math.max(0, (Number(item.quantity_total) || 0) - reserved - (Number(item.loaned_quantity) || 0));
  }

  /**
   * The equipment shown in the picker: matching the search and the category
   * chosen, sorted as asked. The search ignores case and accents and looks at
   * the name, the category and the place it is kept.
   *
   * @returns {Array<Object>}
   */
  visibleEquipment() {
    const terms = normalizeSearch(this.search).split(' ').filter(Boolean);
    const matches = this.equipment.filter((item) => {
      if (this.categoryFilter !== 'all' && (item.category || 'other') !== this.categoryFilter) {
        return false;
      }
      const haystack = normalizeSearch(
        `${item.name} ${equipmentCategoryLabel(item.category)} ${this.formatLocation(item)} ${item.description || ''}`,
      );
      return terms.every((term) => haystack.includes(term));
    });
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), this.app.lang || 'fr');
    const sorters = {
      category: (a, b) => equipmentCategoryLabel(a.category).localeCompare(equipmentCategoryLabel(b.category)) || byName(a, b),
      name: byName,
      available: (a, b) => this.availableFor(b) - this.availableFor(a) || byName(a, b),
    };
    return [...matches].sort(sorters[this.sortOrder] || sorters.category);
  }

  /** @returns {Array<Object>} The selected equipment, with the quantity chosen */
  selectedEquipment() {
    return Array.from(this.selectedItems.entries())
      .map(([equipmentId, quantity]) => {
        const equipment = this.equipment.find((item) => item.id === Number(equipmentId));
        return equipment ? { ...equipment, selectedQuantity: quantity } : null;
      })
      .filter((item) => item !== null);
  }

  render() {
    const container = document.getElementById('app');
    if (!container || this.destroyed) {
      return;
    }
    const categoryOptions = EQUIPMENT_CATEGORIES
      .filter((key) => this.equipment.some((item) => (item.category || 'other') === key))
      .map((key) => ({ key, label: equipmentCategoryLabel(key) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const readonly = this.selectedActivityId ? 'readonly' : '';

    setContent(container, `
      ${renderBackLink()}
      <section class="page material-management-page">
        <div class="card">
          <h1>${escapeHTML(translate('material_management_title'))}</h1>
          <p class="subtitle">${escapeHTML(translate('material_management_description'))}</p>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate('reservation_form'))}</h2>
          <form id="bulkReservationForm" class="stacked">
            <label class="stacked">
              <span>${escapeHTML(translate('select_activity_optional'))}</span>
              <select id="activitySelect">
                <option value="">${escapeHTML(translate('manual_date_entry'))}</option>
                ${this.activities.map((activity) => `
                  <option value="${Number(activity.id)}" ${this.selectedActivityId === activity.id ? 'selected' : ''}>
                    ${escapeHTML(activity.name)} - ${escapeHTML(formatActivityDateRange(activity, this.app.lang || 'fr'))}
                  </option>
                `).join('')}
              </select>
            </label>
            <div class="grid grid-2 material-dates">
              <label class="stacked">
                <span>${escapeHTML(translate('date_from'))}</span>
                <input type="date" id="reservationDateFrom" value="${escapeAttribute(this.dateFrom)}" ${readonly} required />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate('date_to'))}</span>
                <input type="date" id="reservationDateTo" value="${escapeAttribute(this.dateTo)}" ${readonly} required />
              </label>
            </div>
            <label class="stacked">
              <span>${escapeHTML(translate('activity_name'))}</span>
              <input type="text" name="reserved_for" id="reservedFor" maxlength="200" value="${escapeAttribute(this.reservedFor)}" ${readonly} required />
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate('reservation_notes'))}</span>
              <textarea name="notes" id="reservationNotes" rows="2" maxlength="2000">${escapeHTML(this.notes)}</textarea>
            </label>
            <button type="submit" class="button button--primary" id="material-reserve-submit" ${this.selectedItems.size === 0 ? 'disabled' : ''}>${escapeHTML(translate('reserve_selected'))}</button>
          </form>
        </div>

        <div class="card">
          <h2 id="material-select-title">${escapeHTML(translate('select_equipment'))}</h2>
          <div class="material-picker-controls" role="search" aria-labelledby="material-select-title">
            <label class="stacked material-search">
              <span>${escapeHTML(translate('material_search_label'))}</span>
              <input type="search" id="material-search" value="${escapeAttribute(this.search)}"
                autocomplete="off" aria-describedby="material-result-count" data-archive-safe />
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate('material_category_filter'))}</span>
              <select id="material-category-filter" data-archive-safe>
                <option value="all">${escapeHTML(translate('material_all_categories'))}</option>
                ${categoryOptions.map(({ key, label }) => `
                  <option value="${escapeAttribute(key)}" ${this.categoryFilter === key ? 'selected' : ''}>${escapeHTML(label)}</option>
                `).join('')}
              </select>
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate('material_sort_label'))}</span>
              <select id="material-sort" data-archive-safe>
                ${MATERIAL_SORTS.map((sort) => `
                  <option value="${sort}" ${this.sortOrder === sort ? 'selected' : ''}>${escapeHTML(translate(`material_sort_${sort}`))}</option>
                `).join('')}
              </select>
            </label>
          </div>
          <p class="material-selected-count" id="material-selected-count" role="status">${escapeHTML(this.selectedCountText())}</p>
          <div id="material-equipment-list">${this.equipmentListMarkup()}</div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate('selected_items'))}</h2>
          <div id="material-selected-items">${this.selectedItemsMarkup()}</div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate('equipment_reservations'))}</h2>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate('equipment_name'))}</th>
                  <th>${escapeHTML(translate('equipment_location'))}</th>
                  <th>${escapeHTML(translate('reservation_date_range'))}</th>
                  <th>${escapeHTML(translate('reserved_quantity'))}</th>
                  <th>${escapeHTML(translate('reservation_for'))}</th>
                  <th>${escapeHTML(translate('organization'))}</th>
                  <th>${escapeHTML(translate('reservation_status'))}</th>
                  <th>${escapeHTML(translate('reservation_actions'))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.reservations.length === 0
    ? `<tr><td colspan="8">${escapeHTML(translate('no_data_available'))}</td></tr>`
    : this.reservations.map((reservation) => {
      const dateRange = reservation.date_from && reservation.date_to
        ? `${formatDate(reservation.date_from, this.app.lang || 'en')} - ${formatDate(reservation.date_to, this.app.lang || 'en')}`
        : formatDate(reservation.meeting_date, this.app.lang || 'en');
      return `
                        <tr>
                          <td>${escapeHTML(reservation.equipment_name || '')}</td>
                          <td>${escapeHTML(this.formatLocation(reservation))}</td>
                          <td>${escapeHTML(dateRange)}</td>
                          <td>${escapeHTML(String(reservation.reserved_quantity || 0))}</td>
                          <td>${escapeHTML(reservation.reserved_for || '-')}</td>
                          <td>${escapeHTML(reservation.organization_name || '-')}</td>
                          <td>${escapeHTML(reservationStatusLabel(reservation.status))}</td>
                          <td class="reservation-actions">${this.renderReservationActions(reservation)}</td>
                        </tr>
                      `;
    }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `);
  }

  /** @returns {string} "3 items selected" / "12 items shown" in the reader's language */
  selectedCountText() {
    return translate('material_selected_count').replace('{count}', String(this.selectedItems.size));
  }

  /**
   * The picker list: grouped under their category when sorted by category.
   * An item none of which is free for the dates cannot be picked.
   *
   * @returns {string} HTML
   */
  equipmentListMarkup() {
    if (this.equipment.length === 0) {
      return `<p>${escapeHTML(translate('no_data_available'))}</p>`;
    }
    const items = this.visibleEquipment();
    const count = `<p class="material-result-count" id="material-result-count">${escapeHTML(
      translate('material_result_count').replace('{count}', String(items.length)))}</p>`;
    if (items.length === 0) {
      return `${count}<p class="material-no-match">${escapeHTML(translate('material_no_match'))}</p>`;
    }
    if (this.sortOrder !== 'category') {
      return `${count}<ul class="material-equipment-list">${items.map((item) => this.equipmentItemMarkup(item)).join('')}</ul>`;
    }
    const groups = [];
    items.forEach((item) => {
      const label = equipmentCategoryLabel(item.category);
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    });
    return `${count}${groups.map((group) => `
      <section class="material-category-group">
        <h3>${escapeHTML(group.label)}</h3>
        <ul class="material-equipment-list">${group.items.map((item) => this.equipmentItemMarkup(item)).join('')}</ul>
      </section>`).join('')}`;
  }

  /** @param {Object} item @returns {string} One item of the picker */
  equipmentItemMarkup(item) {
    const id = Number(item.id);
    const isChecked = this.selectedItems.has(id);
    const available = this.availableFor(item);
    const total = Number(item.quantity_total) || 0;
    const conflicts = isChecked ? this.getConflictingReservations(id, this.dateFrom, this.dateTo) : [];
    const photo = item.photo_url ? sanitizeURL(item.photo_url) : '';
    const thumbnail = photo
      ? `<button type="button" class="material-thumb" data-photo-equipment="${id}"
           aria-label="${escapeAttribute(translate('material_view_photo').replace('{name}', item.name))}">
           <img src="${escapeAttribute(photo)}" alt="" loading="lazy" width="48" height="48" />
         </button>`
      : '<span class="material-thumb material-thumb--empty" aria-hidden="true"><i class="fa-solid fa-box"></i></span>';
    const availability = translate('material_available_for_dates')
      .replace('{available}', String(available))
      .replace('{total}', String(total));
    const availabilityText = available === 0 ? translate('material_none_available') : availability;
    const lang = this.app.lang || 'en';

    return `
      <li class="equipment-item ${isChecked && conflicts.length > 0 ? 'has-conflicts' : ''}" data-equipment-id="${id}">
        <div class="material-item-row">
          ${thumbnail}
          <label class="equipment-checkbox">
            <input type="checkbox" class="equipment-selector" id="material-select-${id}" data-equipment-id="${id}"
              ${isChecked ? 'checked' : ''} ${!isChecked && available === 0 ? 'disabled' : ''} />
            <span class="equipment-name">${escapeHTML(item.name)}</span>
          </label>
        </div>
        <p class="material-item-details">
          <span class="equipment-category">${escapeHTML(equipmentCategoryLabel(item.category))}</span>
          <span class="equipment-available ${available === 0 ? 'is-unavailable' : ''}">${escapeHTML(availabilityText)}</span>
          <span class="equipment-location">${escapeHTML(this.formatLocation(item))}</span>
        </p>
        ${isChecked ? `
          <label class="quantity-input">
            <span>${escapeHTML(translate('reserved_quantity'))}</span>
            <input type="number" min="1" max="${Math.max(1, available)}" value="${Number(this.selectedItems.get(id)) || 1}"
              class="equipment-quantity" id="material-quantity-${id}" data-equipment-id="${id}" />
          </label>
          ${conflicts.length > 0 ? `
            <div class="conflict-warning">
              <span aria-hidden="true">⚠️</span> <strong>${escapeHTML(translate('existing_reservations'))}:</strong>
              <ul>
                ${conflicts.map((conflict) => {
    const conflictDateRange = conflict.date_from && conflict.date_to
      ? `${formatDate(conflict.date_from, lang)} - ${formatDate(conflict.date_to, lang)}`
      : formatDate(conflict.meeting_date, lang);
    return `<li>${escapeHTML(conflictDateRange)} - ${escapeHTML(conflict.reserved_for || '-')} (${escapeHTML(conflict.organization_name || translate('unknown'))}, ${escapeHTML(translate('reserved_quantity'))}: ${Number(conflict.reserved_quantity) || 0})</li>`;
  }).join('')}
              </ul>
            </div>
          ` : ''}
        ` : ''}
      </li>`;
  }

  /** @returns {string} The selected items, with their quantity */
  selectedItemsMarkup() {
    const items = this.selectedEquipment();
    if (items.length === 0) {
      return `<p>${escapeHTML(translate('no_items_selected'))}</p>`;
    }
    return `<ul class="selected-items-list">${items.map((item) => `
      <li><strong>${escapeHTML(item.name)}</strong> - ${escapeHTML(translate('reserved_quantity'))}: ${Number(item.selectedQuantity) || 1}</li>
    `).join('')}</ul>`;
  }

  /**
   * Redraw the picker and what depends on the selection, leaving the rest of
   * the page (and what is typed in it) alone.
   *
   * @param {string|null} focusId - Element to focus afterwards
   */
  refreshEquipmentList(focusId = null) {
    const list = document.getElementById('material-equipment-list');
    if (!list) {
      return;
    }
    setContent(list, this.equipmentListMarkup());
    this.updateSelectionSummary();
    if (focusId) {
      document.getElementById(focusId)?.focus();
    }
  }

  /** Update the count, the selected list and the submit button. */
  updateSelectionSummary() {
    const count = document.getElementById('material-selected-count');
    if (count) {
      count.textContent = this.selectedCountText();
    }
    const selected = document.getElementById('material-selected-items');
    if (selected) {
      setContent(selected, this.selectedItemsMarkup());
    }
    const submit = document.getElementById('material-reserve-submit');
    if (submit) {
      submit.disabled = this.selectedItems.size === 0;
    }
  }

  /**
   * Show an item's photo large. The stored address may have expired, so a
   * fresh one is asked for first; the one shown in the list is the fallback.
   *
   * @param {number} equipmentId
   * @param {HTMLElement} opener - Where focus returns when it closes
   */
  async openPhoto(equipmentId, opener) {
    const item = this.equipment.find((entry) => entry.id === equipmentId);
    if (!item) {
      return;
    }
    let url = item.photo_url;
    try {
      const response = await getEquipmentPhotoUrl(equipmentId);
      url = response?.data?.photo_url || url;
    } catch (error) {
      debugError('Failed to renew equipment photo:', error);
    }
    const safe = sanitizeURL(url || '');
    if (!safe || this.destroyed) {
      return;
    }
    const { overlay } = openModal({
      id: 'material-photo-modal',
      title: escapeHTML(item.name),
      size: 'large',
      className: 'modal-image-preview',
      body: '<div class="image-preview-body"><img id="material-photo-img" alt="" /></div>',
      initialFocus: '.modal-close',
      returnFocus: opener,
    });
    const image = overlay.querySelector('#material-photo-img');
    image.setAttribute('src', safe);
    image.setAttribute('alt', translate('material_photo_alt').replace('{name}', item.name));
  }

  attachEventHandlers() {
    document.querySelectorAll('.js-reservation-action').forEach((button) => {
      button.addEventListener('click', (event) => {
        const target = event.currentTarget;
        target.disabled = true;
        this.handleReservationAction(
          target.dataset.reservationId,
          target.dataset.nextStatus
        );
      });
    });

    document.getElementById('activitySelect')?.addEventListener('change', (event) => {
      const activityId = event.target.value ? Number(event.target.value) : null;
      this.selectedActivityId = activityId;
      const activity = activityId ? this.activities.find((entry) => entry.id === activityId) : null;
      if (activity) {
        this.dateFrom = getActivityStartDate(activity);
        this.dateTo = getActivityEndDate(activity);
        this.reservedFor = activity.name;
      }
      this.render();
      this.attachEventHandlers();
      document.getElementById('activitySelect')?.focus();
    });

    // Availability depends on the dates: the picker is redrawn, not the page.
    document.getElementById('reservationDateFrom')?.addEventListener('change', (event) => {
      this.dateFrom = event.target.value;
      this.refreshEquipmentList();
    });
    document.getElementById('reservationDateTo')?.addEventListener('change', (event) => {
      this.dateTo = event.target.value;
      this.refreshEquipmentList();
    });
    document.getElementById('reservedFor')?.addEventListener('input', (event) => {
      this.reservedFor = event.target.value;
    });
    document.getElementById('reservationNotes')?.addEventListener('input', (event) => {
      this.notes = event.target.value;
    });

    document.getElementById('material-search')?.addEventListener('input', (event) => {
      this.search = event.target.value;
      this.refreshEquipmentList();
    });
    document.getElementById('material-category-filter')?.addEventListener('change', (event) => {
      this.categoryFilter = event.target.value;
      this.refreshEquipmentList();
    });
    document.getElementById('material-sort')?.addEventListener('change', (event) => {
      this.sortOrder = MATERIAL_SORTS.includes(event.target.value) ? event.target.value : 'category';
      this.refreshEquipmentList();
    });

    // The list is redrawn as filters change, so its controls are delegated.
    const list = document.getElementById('material-equipment-list');
    list?.addEventListener('change', (event) => {
      const { target } = event;
      if (target.classList.contains('equipment-selector')) {
        const equipmentId = Number(target.dataset.equipmentId);
        if (target.checked) {
          this.selectedItems.set(equipmentId, 1);
        } else {
          this.selectedItems.delete(equipmentId);
        }
        this.refreshEquipmentList(target.id);
      } else if (target.classList.contains('equipment-quantity')) {
        this.selectedItems.set(Number(target.dataset.equipmentId), Math.max(1, Math.trunc(Number(target.value)) || 1));
        this.updateSelectionSummary();
      }
    });
    list?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-photo-equipment]');
      if (button) {
        this.openPhoto(Number(button.dataset.photoEquipment), button);
      }
    });

    const bulkForm = document.getElementById('bulkReservationForm');
    bulkForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitReservation();
    });
  }

  /** Reserve the selected equipment for the activity or the dates chosen. */
  async submitReservation() {
    if (!this.dateFrom || !this.dateTo) {
      this.app.showMessage(translate('date_required'), 'error');
      return;
    }

    const payload = {
      reserved_for: this.reservedFor,
      notes: this.notes || '',
      items: Array.from(this.selectedItems.entries()).map(([equipmentId, quantity]) => ({
        equipment_id: equipmentId,
        quantity,
      })),
    };
    if (this.selectedActivityId) {
      payload.activity_id = this.selectedActivityId;
    } else {
      payload.date_from = this.dateFrom;
      payload.date_to = this.dateTo;
    }

    let response;
    try {
      response = await saveBulkReservations(payload);
    } catch (error) {
      debugError('Error saving bulk reservations', error);
      this.app.showMessage(apiErrorMessage(error, 'error_saving'), 'error');
      return;
    }
    if (!response?.success) {
      this.app.showMessage(translate('error_saving'), 'error');
      return;
    }

    // Saved: the selection is done with, whatever the reload below brings.
    this.app.showMessage(translate('bulk_reservation_saved'), 'success');
    this.selectedItems.clear();
    this.notes = '';
    await deleteCachedData('v1/resources/equipment');
    await deleteCachedData('v1/resources/equipment/reservations');
    await this.reload();
  }
}
