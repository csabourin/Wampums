import { translate } from "./app.js";
import { debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import {
  getEquipmentInventory,
  getEquipmentReservations,
  saveBulkReservations
} from "./api/api-endpoints.js";
import { deleteCachedData } from "./indexedDB.js";
import { CONFIG } from "./config.js";

const LOCATION_TYPES = [
  { value: 'local_scout_hall', labelKey: 'location_type_local_scout_hall' },
  { value: 'warehouse', labelKey: 'location_type_warehouse' },
  { value: 'leader_home', labelKey: 'location_type_leader_home' },
  { value: 'other', labelKey: 'location_type_other' }
];

/**
 * Material management page for reserving equipment for activities
 */
export class MaterialManagement {
  constructor(app) {
    this.app = app;
    this.equipment = [];
    this.reservations = [];
    this.selectedItems = new Map(); // Map of equipment_id -> quantity
  }

  async init() {
    try {
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing material management:", error);
      this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
    }
  }

  async refreshData() {
    const [equipmentResponse, reservationResponse] = await Promise.all([
      getEquipmentInventory(),
      getEquipmentReservations()
    ]);

    this.equipment = equipmentResponse?.data?.equipment || equipmentResponse?.equipment || [];
    this.reservations = reservationResponse?.data?.reservations || reservationResponse?.reservations || [];
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

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    const selectedItemsList = Array.from(this.selectedItems.entries())
      .map(([equipmentId, quantity]) => {
        const equipment = this.equipment.find(e => e.id === parseInt(equipmentId));
        return equipment ? { ...equipment, selectedQuantity: quantity } : null;
      })
      .filter(item => item !== null);

    // Get current date values for checking conflicts
    const dateFrom = document.getElementById('reservationDateFrom')?.value || getTodayISO();
    const dateTo = document.getElementById('reservationDateTo')?.value || getTodayISO();

    container.innerHTML = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <section class="page material-management-page">
        <div class="card">
          <h1>${escapeHTML(translate("material_management_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("material_management_description"))}</p>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("reservation_form"))}</h2>
          <form id="bulkReservationForm" class="stacked">
            <div class="grid grid-2" style="margin-bottom: 1.5rem;">
              <label class="stacked">
                <span>${escapeHTML(translate("date_from"))}</span>
                <input type="date" id="reservationDateFrom" value="${dateFrom}" required />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("date_to"))}</span>
                <input type="date" id="reservationDateTo" value="${dateTo}" required />
              </label>
            </div>
            <label class="stacked">
              <span>${escapeHTML(translate("activity_name"))}</span>
              <input type="text" name="reserved_for" maxlength="200" required />
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate("reservation_notes"))}</span>
              <textarea name="notes" rows="2" maxlength="2000"></textarea>
            </label>
            <button type="submit" class="btn primary" ${selectedItemsList.length === 0 ? 'disabled' : ''}>${escapeHTML(translate("reserve_selected"))}</button>
          </form>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("select_equipment"))}</h2>
          <div class="equipment-selection">
            ${this.equipment.length === 0
              ? `<p>${escapeHTML(translate("no_data_available"))}</p>`
              : this.equipment.map((item) => {
                  const conflicts = this.getConflictingReservations(item.id, dateFrom, dateTo);
                  const isChecked = this.selectedItems.has(item.id);
                  return `
                  <div class="equipment-item ${isChecked && conflicts.length > 0 ? 'has-conflicts' : ''}" data-equipment-id="${item.id}">
                    <label class="equipment-checkbox">
                      <input
                        type="checkbox"
                        class="equipment-selector"
                        data-equipment-id="${item.id}"
                        ${isChecked ? 'checked' : ''}
                      />
                      <span class="equipment-name">${escapeHTML(item.name)}</span>
                      <span class="equipment-category">${escapeHTML(item.category || '')}</span>
                      <span class="equipment-available">(${escapeHTML(translate("equipment_available"))}: ${item.quantity_total ?? 0})</span>
                      <span class="equipment-location">${escapeHTML(this.formatLocation(item))}</span>
                    </label>
                    ${isChecked ? `
                      <label class="quantity-input">
                        <span>${escapeHTML(translate("reserved_quantity"))}</span>
                        <input
                          type="number"
                          min="1"
                          max="${item.quantity_total ?? 1}"
                          value="${this.selectedItems.get(item.id)}"
                          class="equipment-quantity"
                          data-equipment-id="${item.id}"
                        />
                      </label>
                      ${conflicts.length > 0 ? `
                        <div class="conflict-warning" style="color: #d97706; font-size: 0.9em; margin-top: 0.5rem; padding: 0.5rem; background: #fef3c7; border-radius: 4px;">
                          ⚠️ <strong>${escapeHTML(translate("existing_reservations") || "Existing reservations")}:</strong>
                          <ul style="margin: 0.25rem 0 0 1.5rem; padding: 0;">
                            ${conflicts.map(conflict => {
                              const conflictDateRange = conflict.date_from && conflict.date_to
                                ? `${formatDate(conflict.date_from, this.app.lang || 'en')} - ${formatDate(conflict.date_to, this.app.lang || 'en')}`
                                : formatDate(conflict.meeting_date, this.app.lang || 'en');
                              return `<li>${escapeHTML(conflictDateRange)} - ${escapeHTML(conflict.reserved_for || '-')} (${escapeHTML(conflict.organization_name || translate('unknown'))}, qty: ${conflict.reserved_quantity})</li>`;
                            }).join('')}
                          </ul>
                        </div>
                      ` : ''}
                    ` : ''}
                  </div>
                `;
                }).join('')}
          </div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("selected_items"))}</h2>
          ${selectedItemsList.length === 0
            ? `<p>${escapeHTML(translate("no_items_selected"))}</p>`
            : `
              <ul class="selected-items-list">
                ${selectedItemsList.map(item => `
                  <li>
                    <strong>${escapeHTML(item.name)}</strong> -
                    ${escapeHTML(translate("reserved_quantity"))}: ${item.selectedQuantity}
                  </li>
                `).join('')}
              </ul>
            `}
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("equipment_reservations"))}</h2>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("equipment_name"))}</th>
                  <th>${escapeHTML(translate("equipment_location"))}</th>
                  <th>${escapeHTML(translate("reservation_date_range"))}</th>
                  <th>${escapeHTML(translate("reserved_quantity"))}</th>
                  <th>${escapeHTML(translate("reservation_for"))}</th>
                  <th>${escapeHTML(translate("organization"))}</th>
                  <th>${escapeHTML(translate("reservation_status"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.reservations.length === 0
                  ? `<tr><td colspan="7">${escapeHTML(translate("no_data_available"))}</td></tr>`
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
                          <td>${escapeHTML(reservation.status)}</td>
                        </tr>
                      `;
                    }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  attachEventHandlers() {
    // Handle date changes - re-render to update conflict warnings
    const dateFromInput = document.getElementById('reservationDateFrom');
    const dateToInput = document.getElementById('reservationDateTo');

    if (dateFromInput) {
      dateFromInput.addEventListener('change', () => {
        this.render();
        this.attachEventHandlers();
      });
    }

    if (dateToInput) {
      dateToInput.addEventListener('change', () => {
        this.render();
        this.attachEventHandlers();
      });
    }

    // Handle equipment selection checkboxes
    // Note: We re-render to update the quantity inputs visibility and selected items list
    const checkboxes = document.querySelectorAll('.equipment-selector');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (event) => {
        const equipmentId = parseInt(event.target.dataset.equipmentId);
        if (event.target.checked) {
          this.selectedItems.set(equipmentId, 1); // Default quantity of 1
        } else {
          this.selectedItems.delete(equipmentId);
        }
        this.render();
        this.attachEventHandlers();
      });
    });

    // Handle quantity changes
    const quantityInputs = document.querySelectorAll('.equipment-quantity');
    quantityInputs.forEach(input => {
      input.addEventListener('change', (event) => {
        const equipmentId = parseInt(event.target.dataset.equipmentId);
        const quantity = parseInt(event.target.value) || 1;
        this.selectedItems.set(equipmentId, quantity);
        // Update the selected items list to reflect the new quantity
        this.updateSelectedItemsList();
      });
    });

    // Handle bulk reservation form submission
    const bulkForm = document.getElementById('bulkReservationForm');
    if (bulkForm) {
      bulkForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(bulkForm);

        // Get dates from the top inputs
        const dateFrom = document.getElementById('reservationDateFrom')?.value;
        const dateTo = document.getElementById('reservationDateTo')?.value;

        if (!dateFrom || !dateTo) {
          this.app.showMessage(translate("date_required") || "Please select reservation dates", "error");
          return;
        }

        const payload = {
          date_from: dateFrom,
          date_to: dateTo,
          reserved_for: formData.get('reserved_for'),
          notes: formData.get('notes') || '',
          items: Array.from(this.selectedItems.entries()).map(([equipment_id, quantity]) => ({
            equipment_id,
            quantity
          }))
        };

        try {
          // Optimistic update: Add reservations to local state immediately
          const optimisticReservations = payload.items.map(item => {
            const equipment = this.equipment.find(e => e.id === item.equipment_id);
            return {
              id: `temp-${Date.now()}-${item.equipment_id}`,
              equipment_id: item.equipment_id,
              equipment_name: equipment?.name || 'Unknown',
              reserved_quantity: item.quantity,
              reserved_for: payload.reserved_for,
              date_from: payload.date_from,
              date_to: payload.date_to,
              status: 'reserved',
              notes: payload.notes
            };
          });

          // Add to local reservations array
          this.reservations = [...optimisticReservations, ...this.reservations];

          // Update equipment reserved quantities optimistically
          payload.items.forEach(item => {
            const equipment = this.equipment.find(e => e.id === item.equipment_id);
            if (equipment) {
              equipment.reserved_quantity = (equipment.reserved_quantity || 0) + item.quantity;
            }
          });

          // Re-render with optimistic data
          this.render();
          this.attachEventHandlers();

          // Save to backend
          const response = await saveBulkReservations(payload);

          if (response.success) {
            this.app.showMessage(translate("bulk_reservation_saved"), "success");
            this.selectedItems.clear();

            // Invalidate cache to ensure fresh data on next load
            await deleteCachedData('v1/resources/equipment');
            await deleteCachedData('v1/resources/equipment/reservations');

            // Refresh from server to get actual IDs and updated quantities
            await this.refreshData();
            this.render();
            this.attachEventHandlers();
          } else {
            throw new Error(response.message || 'Failed to save reservations');
          }
        } catch (error) {
          debugError("Error saving bulk reservations", error);
          this.app.showMessage(error.message || translate("resource_dashboard_error_loading"), "error");

          // Revert optimistic update on error
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        }
      });
    }
  }

  /**
   * Update only the selected items list without full re-render
   */
  updateSelectedItemsList() {
    const selectedItemsList = Array.from(this.selectedItems.entries())
      .map(([equipmentId, quantity]) => {
        const equipment = this.equipment.find(e => e.id === parseInt(equipmentId));
        return equipment ? { ...equipment, selectedQuantity: quantity } : null;
      })
      .filter(item => item !== null);

    const listContainer = document.querySelector('.selected-items-list');
    if (listContainer && selectedItemsList.length > 0) {
      listContainer.innerHTML = selectedItemsList.map(item => `
        <li>
          <strong>${escapeHTML(item.name)}</strong> - 
          ${escapeHTML(translate("reserved_quantity"))}: ${item.selectedQuantity}
        </li>
      `).join('');
    }
  }
}
