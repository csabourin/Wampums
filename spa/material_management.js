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

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <section class="page material-management-page">
        <div class="card">
          <h1>${escapeHTML(translate("material_management_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("material_management_description"))}</p>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("select_equipment"))}</h2>
          <div class="equipment-selection">
            ${this.equipment.length === 0
              ? `<p>${escapeHTML(translate("no_data_available"))}</p>`
              : this.equipment.map((item) => `
                  <div class="equipment-item" data-equipment-id="${item.id}">
                    <label class="equipment-checkbox">
                      <input 
                        type="checkbox" 
                        class="equipment-selector" 
                        data-equipment-id="${item.id}"
                        ${this.selectedItems.has(item.id) ? 'checked' : ''}
                      />
                      <span class="equipment-name">${escapeHTML(item.name)}</span>
                      <span class="equipment-category">${escapeHTML(item.category || '')}</span>
                      <span class="equipment-available">(${escapeHTML(translate("equipment_available"))}: ${item.quantity_total ?? 0})</span>
                    </label>
                    ${this.selectedItems.has(item.id) ? `
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
                    ` : ''}
                  </div>
                `).join('')}
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
              
              <form id="bulkReservationForm" class="stacked">
                <div class="grid grid-2">
                  <label class="stacked">
                    <span>${escapeHTML(translate("date_from"))}</span>
                    <input type="date" name="date_from" value="${getTodayISO()}" required />
                  </label>
                  <label class="stacked">
                    <span>${escapeHTML(translate("date_to"))}</span>
                    <input type="date" name="date_to" value="${getTodayISO()}" required />
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
                <button type="submit" class="btn primary">${escapeHTML(translate("reserve_selected"))}</button>
              </form>
            `}
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("equipment_reservations"))}</h2>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("equipment_name"))}</th>
                  <th>${escapeHTML(translate("reservation_date_range"))}</th>
                  <th>${escapeHTML(translate("reserved_quantity"))}</th>
                  <th>${escapeHTML(translate("reservation_for"))}</th>
                  <th>${escapeHTML(translate("reservation_status"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.reservations.length === 0
                  ? `<tr><td colspan="5">${escapeHTML(translate("no_data_available"))}</td></tr>`
                  : this.reservations.map((reservation) => {
                      const dateRange = reservation.date_from && reservation.date_to
                        ? `${formatDate(reservation.date_from, this.app.lang || 'en')} - ${formatDate(reservation.date_to, this.app.lang || 'en')}`
                        : formatDate(reservation.meeting_date, this.app.lang || 'en');
                      return `
                        <tr>
                          <td>${escapeHTML(reservation.equipment_name || '')}</td>
                          <td>${escapeHTML(dateRange)}</td>
                          <td>${escapeHTML(String(reservation.reserved_quantity || 0))}</td>
                          <td>${escapeHTML(reservation.reserved_for || '-')}</td>
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
        const payload = {
          date_from: formData.get('date_from'),
          date_to: formData.get('date_to'),
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
