import { translate } from "./app.js";
import { debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { formatDate, getTodayISO } from "./utils/DateUtils.js";
import {
  getEquipmentInventory,
  saveEquipmentItem,
  getEquipmentReservations,
  saveEquipmentReservation,
  getResourceDashboard
} from "./api/api-endpoints.js";
import { deleteCachedData } from "./indexedDB.js";

export class ResourceDashboard {
  constructor(app) {
    this.app = app;
    this.meetingDate = getTodayISO();
    this.equipment = [];
    this.reservations = [];
    this.dashboardSummary = { reservations: [] };
  }

  async init() {
    try {
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing resource dashboard:", error);
      this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
    }
  }

  async refreshData() {
    const [equipmentResponse, reservationResponse, summaryResponse] = await Promise.all([
      getEquipmentInventory(),
      getEquipmentReservations({ meeting_date: this.meetingDate }),
      getResourceDashboard({ meeting_date: this.meetingDate })
    ]);

    this.equipment = equipmentResponse?.data?.equipment || equipmentResponse?.equipment || [];
    this.reservations = reservationResponse?.data?.reservations || reservationResponse?.reservations || [];
    this.dashboardSummary = summaryResponse?.data || summaryResponse || { reservations: [] };
  }

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    const reservationSummary = this.dashboardSummary?.reservations || [];

    setContent(container, `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <section class="page resource-dashboard">
        <div class="card">
          <h1>${escapeHTML(translate("resource_dashboard_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("resource_dashboard_description"))}</p>
          <label class="stacked">
            <span>${escapeHTML(translate("meeting_date_label"))}</span>
            <input type="date" id="meetingDateInput" value="${escapeHTML(this.meetingDate)}" />
          </label>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("dashboard_summary_title"))}</h2>
          <div class="summary-grid">
            <div class="summary-tile">
              <div class="summary-label">${escapeHTML(translate("equipment_reservations"))}</div>
              <ul class="summary-list">
                ${reservationSummary.length === 0
                  ? `<li>${escapeHTML(translate("no_data_available"))}</li>`
                  : reservationSummary
                      .map((row) => `<li>${escapeHTML(row.name)} (${escapeHTML(row.status)}): <strong>${row.reserved_quantity}</strong></li>`)
                      .join('')}
              </ul>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("equipment_inventory_title"))}</h2>
          <form id="equipmentForm" class="stacked">
            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_name"))}</span>
                <input type="text" name="name" maxlength="150" required />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_category"))}</span>
                <input type="text" name="category" maxlength="100" />
              </label>
            </div>
            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_quantity_total"))}</span>
                <input type="number" name="quantity_total" min="0" value="1" />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_available"))}</span>
                <input type="number" name="quantity_available" min="0" />
              </label>
            </div>
            <label class="stacked">
              <span>${escapeHTML(translate("equipment_condition"))}</span>
              <input type="text" name="condition_note" maxlength="500" />
            </label>
            <label class="stacked">
              <span>${escapeHTML(translate("equipment_description"))}</span>
              <textarea name="description" rows="2" maxlength="2000"></textarea>
            </label>
            <button type="submit" class="btn primary">${escapeHTML(translate("save_equipment"))}</button>
          </form>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("equipment_name"))}</th>
                  <th>${escapeHTML(translate("equipment_category"))}</th>
                  <th>${escapeHTML(translate("equipment_quantity_total"))}</th>
                  <th>${escapeHTML(translate("equipment_reserved"))}</th>
                  <th>${escapeHTML(translate("shared_with"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.equipment.length === 0
                  ? `<tr><td colspan="5">${escapeHTML(translate("no_data_available"))}</td></tr>`
                  : this.equipment
                      .map((item) => `
                        <tr>
                          <td>${escapeHTML(item.name)}</td>
                          <td>${escapeHTML(item.category || '-')}</td>
                          <td>${escapeHTML(String(item.quantity_total ?? 0))}</td>
                          <td>${escapeHTML(String(item.reserved_quantity ?? 0))}</td>
                          <td>${escapeHTML((item.shared_organizations || []).join(', ') || '-')}</td>
                        </tr>
                      `)
                      .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>${escapeHTML(translate("reservation_section_title"))}</h2>
          <form id="reservationForm" class="stacked">
            <label class="stacked">
              <span>${escapeHTML(translate("equipment_label"))}</span>
              <select name="equipment_id" required>
                <option value="">${escapeHTML(translate("reservation_equipment_placeholder"))}</option>
                ${this.equipment
                  .map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
                  .join('')}
              </select>
            </label>
            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("reserved_quantity"))}</span>
                <input type="number" name="reserved_quantity" min="1" value="1" />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("reservation_for"))}</span>
                <input type="text" name="reserved_for" maxlength="200" />
              </label>
            </div>
            <label class="stacked">
              <span>${escapeHTML(translate("reservation_notes"))}</span>
              <textarea name="notes" rows="2" maxlength="2000"></textarea>
            </label>
            <button type="submit" class="btn primary">${escapeHTML(translate("reservation_save"))}</button>
          </form>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${escapeHTML(translate("equipment_name"))}</th>
                  <th>${escapeHTML(translate("meeting_date_label"))}</th>
                  <th>${escapeHTML(translate("reserved_quantity"))}</th>
                  <th>${escapeHTML(translate("reservation_for"))}</th>
                  <th>${escapeHTML(translate("reservation_status"))}</th>
                  <th>${escapeHTML(translate("reservation_organization"))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.reservations.length === 0
                  ? `<tr><td colspan="6">${escapeHTML(translate("no_data_available"))}</td></tr>`
                  : this.reservations
                      .map((reservation) => `
                        <tr>
                          <td>${escapeHTML(reservation.equipment_name || '')}</td>
                          <td>${escapeHTML(formatDate(reservation.meeting_date, this.app.lang || 'en'))}</td>
                          <td>${escapeHTML(String(reservation.reserved_quantity || 0))}</td>
                          <td>${escapeHTML(reservation.reserved_for || '-')}</td>
                          <td>${escapeHTML(reservation.status)}</td>
                          <td>${escapeHTML(String(reservation.reservation_organization_id || '-'))}</td>
                        </tr>
                      `)
                      .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  attachEventHandlers() {
    const meetingDateInput = document.getElementById("meetingDateInput");
    if (meetingDateInput) {
      meetingDateInput.addEventListener("change", async (event) => {
        this.meetingDate = event.target.value || getTodayISO();
        await this.refreshData();
        this.render();
        this.attachEventHandlers();
      });
    }

    const equipmentForm = document.getElementById("equipmentForm");
    if (equipmentForm) {
      equipmentForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(equipmentForm);
        const payload = Object.fromEntries(formData.entries());
        payload.quantity_total = payload.quantity_total ? parseInt(payload.quantity_total, 10) : 1;
        payload.quantity_available = payload.quantity_available ? parseInt(payload.quantity_available, 10) : undefined;

        try {
          await saveEquipmentItem(payload);
          this.app.showMessage(translate("inventory_saved"), "success");

          // Invalidate cache to ensure fresh data
          await deleteCachedData('v1/resources/equipment');

          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        } catch (error) {
          debugError("Error saving equipment", error);
          this.app.showMessage(error.message || translate("resource_dashboard_error_loading"), "error");
        }
      });
    }

    const reservationForm = document.getElementById("reservationForm");
    if (reservationForm) {
      reservationForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(reservationForm);
        const payload = Object.fromEntries(formData.entries());
        payload.meeting_date = this.meetingDate;
        payload.equipment_id = parseInt(payload.equipment_id, 10);
        payload.reserved_quantity = payload.reserved_quantity ? parseInt(payload.reserved_quantity, 10) : 1;

        try {
          // Optimistic update: Add reservation to local state immediately
          const equipment = this.equipment.find(e => e.id === payload.equipment_id);
          if (equipment) {
            const optimisticReservation = {
              id: `temp-${Date.now()}`,
              equipment_id: payload.equipment_id,
              equipment_name: equipment.name,
              reserved_quantity: payload.reserved_quantity,
              reserved_for: payload.reserved_for,
              meeting_date: payload.meeting_date,
              status: payload.status || 'reserved',
              notes: payload.notes,
              reservation_organization_id: localStorage.getItem('currentOrganizationId')
            };

            // Add to local reservations array
            this.reservations = [optimisticReservation, ...this.reservations];

            // Update equipment reserved quantity optimistically
            equipment.reserved_quantity = (equipment.reserved_quantity || 0) + payload.reserved_quantity;

            // Re-render with optimistic data
            this.render();
            this.attachEventHandlers();
          }

          // Save to backend
          await saveEquipmentReservation(payload);
          this.app.showMessage(translate("reservation_saved"), "success");

          // Invalidate cache to ensure fresh data
          await deleteCachedData('v1/resources/equipment');
          await deleteCachedData('v1/resources/equipment/reservations');
          await deleteCachedData('v1/resources/status/dashboard');

          // Refresh from server to get actual IDs and updated quantities
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        } catch (error) {
          debugError("Error saving reservation", error);
          this.app.showMessage(error.message || translate("resource_dashboard_error_loading"), "error");

          // Revert optimistic update on error
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        }
      });
    }

  }
}
