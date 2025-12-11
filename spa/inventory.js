import { translate } from "./app.js";
import { debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import {
  getEquipmentInventory,
  saveEquipmentItem
} from "./api/api-endpoints.js";

/**
 * Inventory management page for equipment and materials
 */
export class Inventory {
  constructor(app) {
    this.app = app;
    this.equipment = [];
  }

  async init() {
    try {
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error initializing inventory:", error);
      this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
    }
  }

  async refreshData() {
    const equipmentResponse = await getEquipmentInventory();
    this.equipment = equipmentResponse?.data?.equipment || equipmentResponse?.equipment || [];
  }

  render() {
    const container = document.getElementById("app");
    if (!container) {
      return;
    }

    container.innerHTML = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <section class="page inventory-page">
        <div class="card">
          <h1>${escapeHTML(translate("inventory_title"))}</h1>
          <p class="subtitle">${escapeHTML(translate("inventory_description"))}</p>
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
      </section>
    `;
  }

  attachEventHandlers() {
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
          equipmentForm.reset();
          await this.refreshData();
          this.render();
          this.attachEventHandlers();
        } catch (error) {
          debugError("Error saving equipment", error);
          this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
        }
      });
    }
  }
}
