import { translate } from "./app.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import {
  getEquipmentInventory,
  saveEquipmentItem,
  updateEquipmentItem,
  uploadEquipmentPhoto,
  deleteEquipmentPhoto,
  deleteEquipmentItem
} from "./api/api-endpoints.js";

// Maximum photo file size: 3MB
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Inventory management page for equipment and materials
 * Features: equipment CRUD, photo upload, gallery view, mobile-first design
 */
export class Inventory {
  constructor(app) {
    this.app = app;
    this.equipment = [];
    this.viewMode = 'gallery'; // 'gallery' or 'table'
    this.editingEquipment = null;
    this.photoPreview = null;
    this.selectedPhotoFile = null;
    this.modalPhotoPreview = null;
    this.modalSelectedPhotoFile = null;
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

  formatDate(dateString) {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(localStorage.getItem('language') === 'en' ? 'en-CA' : 'fr-CA');
    } catch {
      return '-';
    }
  }

  formatCurrency(value) {
    if (value === null || value === undefined || value === '') return '-';
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return '-';
    return new Intl.NumberFormat(localStorage.getItem('language') === 'en' ? 'en-CA' : 'fr-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(numValue);
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

        <!-- Equipment Form for Adding New -->
        <div class="card">
          <h2>${escapeHTML(translate("equipment_add_new"))}</h2>
          <form id="equipmentForm" class="stacked">
            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_name"))} *</span>
                <input type="text" name="name" id="equipment_name" maxlength="150" required />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_category"))}</span>
                <input type="text" name="category" id="equipment_category" maxlength="100" />
              </label>
            </div>

            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_quantity_total"))}</span>
                <input type="number" name="quantity_total" id="equipment_quantity_total" min="0" value="1" />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_available"))}</span>
                <input type="number" name="quantity_available" id="equipment_quantity_available" min="0" />
              </label>
            </div>

            <div class="grid grid-2">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_item_value"))}</span>
                <input type="number" name="item_value" id="equipment_item_value" min="0" step="0.01" placeholder="0.00" />
              </label>
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_acquisition_date"))}</span>
                <input type="date" name="acquisition_date" id="equipment_acquisition_date" />
              </label>
            </div>

            <label class="stacked">
              <span>${escapeHTML(translate("equipment_condition"))}</span>
              <input type="text" name="condition_note" id="equipment_condition_note" maxlength="500" />
            </label>

            <label class="stacked">
              <span>${escapeHTML(translate("equipment_description"))}</span>
              <textarea name="description" id="equipment_description" rows="2" maxlength="2000"></textarea>
            </label>

            <!-- Photo Upload Section -->
            <div class="photo-upload-section">
              <label class="stacked">
                <span>${escapeHTML(translate("equipment_photo"))}</span>
                <div class="photo-upload-container" id="photo-upload-container">
                  <div class="photo-preview" id="photo-preview">
                    <div class="photo-placeholder" id="photo-placeholder">
                      <span class="photo-icon">📷</span>
                      <span class="photo-text">${escapeHTML(translate("equipment_photo_click_to_upload"))}</span>
                      <span class="photo-hint">${escapeHTML(translate("equipment_photo_max_size"))}</span>
                    </div>
                    <img id="photo-preview-img" class="hidden" alt="" />
                    <button type="button" id="remove-photo-btn" class="remove-photo-btn hidden" aria-label="${escapeHTML(translate("equipment_photo_remove"))}">×</button>
                  </div>
                  <input type="file" id="photo-input" name="photo" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" />
                </div>
              </label>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn primary">${escapeHTML(translate("save_equipment"))}</button>
            </div>
          </form>
        </div>

        <!-- View Toggle and Equipment Display -->
        <div class="card">
          <div class="inventory-header">
            <h2>${escapeHTML(translate("equipment_inventory_title"))}</h2>
            <div class="view-toggle">
              <button type="button" class="view-toggle-btn ${this.viewMode === 'gallery' ? 'active' : ''}" id="gallery-view-btn" aria-label="${escapeHTML(translate("equipment_gallery_view"))}">
                <span class="view-icon">▦</span>
              </button>
              <button type="button" class="view-toggle-btn ${this.viewMode === 'table' ? 'active' : ''}" id="table-view-btn" aria-label="${escapeHTML(translate("equipment_table_view"))}">
                <span class="view-icon">☰</span>
              </button>
            </div>
          </div>

          ${this.viewMode === 'gallery' ? this.renderGalleryView() : this.renderTableView()}
        </div>
      </section>

      <!-- Edit Equipment Modal -->
      <div class="modal-overlay hidden" id="edit-equipment-modal">
        <div class="modal-container">
          <div class="modal-header">
            <h2>${escapeHTML(translate("equipment_edit"))}</h2>
            <button type="button" class="modal-close-btn" id="modal-close-btn" aria-label="${escapeHTML(translate("close"))}">×</button>
          </div>
          <div class="modal-body">
            <form id="editEquipmentForm" class="stacked">
              <input type="hidden" name="equipment_id" id="modal_equipment_id" />

              <div class="grid grid-2">
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_name"))} *</span>
                  <input type="text" name="name" id="modal_equipment_name" maxlength="150" required />
                </label>
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_category"))}</span>
                  <input type="text" name="category" id="modal_equipment_category" maxlength="100" />
                </label>
              </div>

              <div class="grid grid-2">
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_quantity_total"))}</span>
                  <input type="number" name="quantity_total" id="modal_equipment_quantity_total" min="0" value="1" />
                </label>
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_available"))}</span>
                  <input type="number" name="quantity_available" id="modal_equipment_quantity_available" min="0" />
                </label>
              </div>

              <div class="grid grid-2">
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_item_value"))}</span>
                  <input type="number" name="item_value" id="modal_equipment_item_value" min="0" step="0.01" placeholder="0.00" />
                </label>
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_acquisition_date"))}</span>
                  <input type="date" name="acquisition_date" id="modal_equipment_acquisition_date" />
                </label>
              </div>

              <label class="stacked">
                <span>${escapeHTML(translate("equipment_condition"))}</span>
                <input type="text" name="condition_note" id="modal_equipment_condition_note" maxlength="500" />
              </label>

              <label class="stacked">
                <span>${escapeHTML(translate("equipment_description"))}</span>
                <textarea name="description" id="modal_equipment_description" rows="2" maxlength="2000"></textarea>
              </label>

              <!-- Photo Upload Section in Modal -->
              <div class="photo-upload-section">
                <label class="stacked">
                  <span>${escapeHTML(translate("equipment_photo"))}</span>
                  <div class="photo-upload-container" id="modal-photo-upload-container">
                    <div class="photo-preview" id="modal-photo-preview">
                      <div class="photo-placeholder" id="modal-photo-placeholder">
                        <span class="photo-icon">📷</span>
                        <span class="photo-text">${escapeHTML(translate("equipment_photo_click_to_upload"))}</span>
                        <span class="photo-hint">${escapeHTML(translate("equipment_photo_max_size"))}</span>
                      </div>
                      <img id="modal-photo-preview-img" class="hidden" alt="" />
                      <button type="button" id="modal-remove-photo-btn" class="remove-photo-btn hidden" aria-label="${escapeHTML(translate("equipment_photo_remove"))}">×</button>
                    </div>
                    <input type="file" id="modal-photo-input" name="photo" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" />
                  </div>
                </label>
              </div>

              <div class="form-actions modal-actions">
                <button type="submit" class="btn primary">${escapeHTML(translate("save_changes"))}</button>
                <button type="button" class="btn secondary" id="modal-cancel-btn">${escapeHTML(translate("cancel"))}</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Delete Confirmation Modal -->
      <div class="modal-overlay hidden" id="delete-confirm-modal">
        <div class="modal-container modal-small">
          <div class="modal-header">
            <h2>${escapeHTML(translate("equipment_delete_confirm_title"))}</h2>
            <button type="button" class="modal-close-btn" id="delete-modal-close-btn" aria-label="${escapeHTML(translate("close"))}">×</button>
          </div>
          <div class="modal-body">
            <p id="delete-confirm-message"></p>
            <div class="form-actions modal-actions">
              <button type="button" class="btn danger" id="confirm-delete-btn">${escapeHTML(translate("delete"))}</button>
              <button type="button" class="btn secondary" id="cancel-delete-btn">${escapeHTML(translate("cancel"))}</button>
            </div>
          </div>
        </div>
      </div>

      <style>
        /* Mobile-first inventory styles */
        .inventory-page .photo-upload-section {
          margin: 1rem 0;
        }

        .inventory-page .photo-upload-container {
          cursor: pointer;
        }

        .inventory-page .photo-preview {
          position: relative;
          width: 100%;
          max-width: 300px;
          aspect-ratio: 4/3;
          border: 2px dashed var(--border-color, #ccc);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: var(--bg-secondary, #f5f5f5);
          transition: border-color 0.2s, background-color 0.2s;
        }

        .inventory-page .photo-preview:hover {
          border-color: var(--primary-color, #4a90d9);
          background: var(--bg-hover, #eef4fc);
        }

        .inventory-page .photo-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-muted, #666);
          text-align: center;
          padding: 1rem;
        }

        .inventory-page .photo-icon {
          font-size: 2rem;
        }

        .inventory-page .photo-text {
          font-weight: 500;
        }

        .inventory-page .photo-hint {
          font-size: 0.8rem;
          opacity: 0.7;
        }

        .inventory-page #photo-preview-img,
        .inventory-page #modal-photo-preview-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .inventory-page .remove-photo-btn {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(220, 53, 69, 0.9);
          color: white;
          border: none;
          font-size: 1.2rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .inventory-page .remove-photo-btn:hover {
          background: rgba(220, 53, 69, 1);
        }

        .inventory-page .form-actions {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
        }

        .inventory-page .inventory-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .inventory-page .inventory-header h2 {
          margin: 0;
        }

        .inventory-page .view-toggle {
          display: flex;
          gap: 0.25rem;
          background: var(--bg-secondary, #f0f0f0);
          border-radius: 6px;
          padding: 0.25rem;
        }

        .inventory-page .view-toggle-btn {
          padding: 0.5rem 0.75rem;
          border: none;
          background: transparent;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          transition: background-color 0.2s;
        }

        .inventory-page .view-toggle-btn.active {
          background: var(--bg-card, white);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .inventory-page .view-toggle-btn:hover:not(.active) {
          background: var(--bg-hover, #e0e0e0);
        }

        /* Gallery View */
        .inventory-page .equipment-gallery {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
        }

        .inventory-page .equipment-card {
          background: var(--bg-card, white);
          border: 1px solid var(--border-color, #ddd);
          border-radius: 8px;
          overflow: hidden;
          transition: box-shadow 0.2s, transform 0.2s;
        }

        .inventory-page .equipment-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transform: translateY(-2px);
        }

        .inventory-page .equipment-card-image {
          width: 100%;
          aspect-ratio: 4/3;
          background: var(--bg-secondary, #f5f5f5);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .inventory-page .equipment-card-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .inventory-page .equipment-card-image .no-photo {
          font-size: 3rem;
          opacity: 0.3;
        }

        .inventory-page .equipment-card-content {
          padding: 1rem;
        }

        .inventory-page .equipment-card-title {
          font-weight: 600;
          font-size: 1.1rem;
          margin: 0 0 0.5rem;
          color: var(--text-primary, #333);
        }

        .inventory-page .equipment-card-category {
          font-size: 0.85rem;
          color: var(--text-muted, #666);
          margin-bottom: 0.75rem;
        }

        .inventory-page .equipment-card-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          font-size: 0.9rem;
        }

        .inventory-page .equipment-card-detail {
          display: flex;
          flex-direction: column;
        }

        .inventory-page .equipment-card-detail-label {
          font-size: 0.75rem;
          color: var(--text-muted, #888);
          text-transform: uppercase;
        }

        .inventory-page .equipment-card-detail-value {
          font-weight: 500;
        }

        .inventory-page .equipment-card-actions {
          padding: 0.75rem 1rem;
          border-top: 1px solid var(--border-color, #eee);
          display: flex;
          gap: 0.5rem;
        }

        .inventory-page .equipment-card-actions .btn {
          flex: 1;
          padding: 0.5rem;
          font-size: 0.85rem;
        }

        /* Table View */
        .inventory-page .table-container {
          overflow-x: auto;
        }

        .inventory-page .data-table {
          width: 100%;
          border-collapse: collapse;
        }

        .inventory-page .data-table th,
        .inventory-page .data-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .inventory-page .data-table th {
          font-weight: 600;
          background: var(--bg-secondary, #f5f5f5);
        }

        .inventory-page .table-photo {
          width: 60px;
          height: 45px;
          object-fit: cover;
          border-radius: 4px;
        }

        .inventory-page .table-no-photo {
          width: 60px;
          height: 45px;
          background: var(--bg-secondary, #f0f0f0);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 1.2rem;
          opacity: 0.5;
        }

        .inventory-page .table-actions {
          display: flex;
          gap: 0.5rem;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 1rem;
        }

        .modal-overlay.hidden {
          display: none;
        }

        .modal-container {
          background: var(--bg-card, white);
          border-radius: 12px;
          width: 100%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }

        .modal-container.modal-small {
          max-width: 400px;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .modal-header h2 {
          margin: 0;
          font-size: 1.25rem;
        }

        .modal-close-btn {
          width: 32px;
          height: 32px;
          border: none;
          background: transparent;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-muted, #666);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
        }

        .modal-close-btn:hover {
          background: var(--bg-secondary, #f0f0f0);
        }

        .modal-body {
          padding: 1.5rem;
        }

        .modal-actions {
          justify-content: flex-end;
        }

        .btn.danger {
          background: #dc3545;
          color: white;
          border: none;
        }

        .btn.danger:hover {
          background: #c82333;
        }

        /* Mobile adjustments */
        @media (max-width: 640px) {
          .inventory-page .equipment-gallery {
            grid-template-columns: 1fr;
          }

          .inventory-page .grid-2 {
            grid-template-columns: 1fr;
          }

          .inventory-page .data-table th:nth-child(n+5),
          .inventory-page .data-table td:nth-child(n+5) {
            display: none;
          }

          .modal-container {
            max-height: 95vh;
          }
        }
      </style>
    `;
  }

  renderGalleryView() {
    if (this.equipment.length === 0) {
      return `
        <div class="empty-state">
          <p>${escapeHTML(translate("no_data_available"))}</p>
        </div>
      `;
    }

    return `
      <div class="equipment-gallery">
        ${this.equipment.map((item) => `
          <div class="equipment-card" data-equipment-id="${item.id}">
            <div class="equipment-card-image">
              ${item.photo_url
                ? `<img src="${escapeHTML(item.photo_url)}" alt="${escapeHTML(item.name)}" loading="lazy" />`
                : `<span class="no-photo">📦</span>`
              }
            </div>
            <div class="equipment-card-content">
              <h3 class="equipment-card-title">${escapeHTML(item.name)}</h3>
              ${item.category ? `<div class="equipment-card-category">${escapeHTML(item.category)}</div>` : ''}
              <div class="equipment-card-details">
                <div class="equipment-card-detail">
                  <span class="equipment-card-detail-label">${escapeHTML(translate("equipment_quantity_total"))}</span>
                  <span class="equipment-card-detail-value">${escapeHTML(String(item.quantity_total ?? 0))}</span>
                </div>
                <div class="equipment-card-detail">
                  <span class="equipment-card-detail-label">${escapeHTML(translate("equipment_reserved"))}</span>
                  <span class="equipment-card-detail-value">${escapeHTML(String(item.reserved_quantity ?? 0))}</span>
                </div>
                <div class="equipment-card-detail">
                  <span class="equipment-card-detail-label">${escapeHTML(translate("equipment_item_value"))}</span>
                  <span class="equipment-card-detail-value">${escapeHTML(this.formatCurrency(item.item_value))}</span>
                </div>
                <div class="equipment-card-detail">
                  <span class="equipment-card-detail-label">${escapeHTML(translate("equipment_acquisition_date"))}</span>
                  <span class="equipment-card-detail-value">${escapeHTML(this.formatDate(item.acquisition_date))}</span>
                </div>
              </div>
            </div>
            <div class="equipment-card-actions">
              <button type="button" class="btn secondary edit-equipment-btn" data-id="${item.id}">${escapeHTML(translate("edit"))}</button>
              <button type="button" class="btn danger delete-equipment-btn" data-id="${item.id}" data-name="${escapeHTML(item.name)}">${escapeHTML(translate("delete"))}</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderTableView() {
    if (this.equipment.length === 0) {
      return `
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>${escapeHTML(translate("equipment_photo"))}</th>
                <th>${escapeHTML(translate("equipment_name"))}</th>
                <th>${escapeHTML(translate("equipment_category"))}</th>
                <th>${escapeHTML(translate("equipment_quantity_total"))}</th>
                <th>${escapeHTML(translate("equipment_item_value"))}</th>
                <th>${escapeHTML(translate("actions"))}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colspan="6">${escapeHTML(translate("no_data_available"))}</td></tr>
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHTML(translate("equipment_photo"))}</th>
              <th>${escapeHTML(translate("equipment_name"))}</th>
              <th>${escapeHTML(translate("equipment_category"))}</th>
              <th>${escapeHTML(translate("equipment_quantity_total"))}</th>
              <th>${escapeHTML(translate("equipment_item_value"))}</th>
              <th>${escapeHTML(translate("actions"))}</th>
            </tr>
          </thead>
          <tbody>
            ${this.equipment.map((item) => `
              <tr>
                <td>
                  ${item.photo_url
                    ? `<img src="${escapeHTML(item.photo_url)}" alt="${escapeHTML(item.name)}" class="table-photo" loading="lazy" />`
                    : `<div class="table-no-photo">📦</div>`
                  }
                </td>
                <td>${escapeHTML(item.name)}</td>
                <td>${escapeHTML(item.category || '-')}</td>
                <td>${escapeHTML(String(item.quantity_total ?? 0))}</td>
                <td>${escapeHTML(this.formatCurrency(item.item_value))}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="btn secondary small edit-equipment-btn" data-id="${item.id}">${escapeHTML(translate("edit"))}</button>
                    <button type="button" class="btn danger small delete-equipment-btn" data-id="${item.id}" data-name="${escapeHTML(item.name)}">${escapeHTML(translate("delete"))}</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  attachEventHandlers() {
    // View toggle handlers
    const galleryBtn = document.getElementById("gallery-view-btn");
    const tableBtn = document.getElementById("table-view-btn");

    if (galleryBtn) {
      galleryBtn.addEventListener("click", () => {
        this.viewMode = 'gallery';
        this.render();
        this.attachEventHandlers();
      });
    }

    if (tableBtn) {
      tableBtn.addEventListener("click", () => {
        this.viewMode = 'table';
        this.render();
        this.attachEventHandlers();
      });
    }

    // Photo upload handlers for main form
    this.setupPhotoUpload('photo-upload-container', 'photo-input', 'photo-preview-img', 'photo-placeholder', 'remove-photo-btn', false);

    // Equipment form handler for creating new
    const equipmentForm = document.getElementById("equipmentForm");
    if (equipmentForm) {
      equipmentForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.handleCreateSubmit();
      });
    }

    // Edit equipment handlers
    document.querySelectorAll(".edit-equipment-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const equipmentId = parseInt(event.target.dataset.id, 10);
        this.openEditModal(equipmentId);
      });
    });

    // Delete equipment handlers
    document.querySelectorAll(".delete-equipment-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const equipmentId = parseInt(event.target.dataset.id, 10);
        const equipmentName = event.target.dataset.name;
        this.openDeleteConfirmation(equipmentId, equipmentName);
      });
    });

    // Modal handlers
    this.setupModalHandlers();
  }

  setupPhotoUpload(containerId, inputId, previewImgId, placeholderId, removeBtnId, isModal) {
    const photoUploadContainer = document.getElementById(containerId);
    const photoInput = document.getElementById(inputId);
    const photoPreviewImg = document.getElementById(previewImgId);
    const photoPlaceholder = document.getElementById(placeholderId);
    const removePhotoBtn = document.getElementById(removeBtnId);

    if (photoUploadContainer && photoInput) {
      photoUploadContainer.addEventListener("click", (e) => {
        if (e.target !== removePhotoBtn && !removePhotoBtn.contains(e.target)) {
          photoInput.click();
        }
      });

      photoInput.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
          // Validate file
          if (file.size > MAX_PHOTO_SIZE) {
            this.app.showMessage(translate("equipment_photo_too_large"), "error");
            photoInput.value = '';
            return;
          }

          if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
            this.app.showMessage(translate("equipment_photo_invalid_type"), "error");
            photoInput.value = '';
            return;
          }

          if (isModal) {
            this.modalSelectedPhotoFile = file;
          } else {
            this.selectedPhotoFile = file;
          }

          // Show preview
          const reader = new FileReader();
          reader.onload = (e) => {
            photoPreviewImg.src = e.target.result;
            photoPreviewImg.classList.remove('hidden');
            photoPlaceholder.classList.add('hidden');
            removePhotoBtn.classList.remove('hidden');
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (removePhotoBtn) {
      removePhotoBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isModal) {
          this.clearModalPhotoPreview();
        } else {
          this.clearPhotoPreview();
        }
      });
    }
  }

  setupModalHandlers() {
    // Edit modal handlers
    const editModal = document.getElementById("edit-equipment-modal");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalCancelBtn = document.getElementById("modal-cancel-btn");
    const editForm = document.getElementById("editEquipmentForm");

    if (modalCloseBtn) {
      modalCloseBtn.addEventListener("click", () => this.closeEditModal());
    }

    if (modalCancelBtn) {
      modalCancelBtn.addEventListener("click", () => this.closeEditModal());
    }

    if (editModal) {
      editModal.addEventListener("click", (e) => {
        if (e.target === editModal) {
          this.closeEditModal();
        }
      });
    }

    if (editForm) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleEditSubmit();
      });
    }

    // Photo upload for modal
    this.setupPhotoUpload('modal-photo-upload-container', 'modal-photo-input', 'modal-photo-preview-img', 'modal-photo-placeholder', 'modal-remove-photo-btn', true);

    // Delete confirmation modal handlers
    const deleteModal = document.getElementById("delete-confirm-modal");
    const deleteModalCloseBtn = document.getElementById("delete-modal-close-btn");
    const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
    const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

    if (deleteModalCloseBtn) {
      deleteModalCloseBtn.addEventListener("click", () => this.closeDeleteModal());
    }

    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener("click", () => this.closeDeleteModal());
    }

    if (deleteModal) {
      deleteModal.addEventListener("click", (e) => {
        if (e.target === deleteModal) {
          this.closeDeleteModal();
        }
      });
    }

    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener("click", async () => {
        await this.handleDelete();
      });
    }
  }

  clearPhotoPreview() {
    const photoInput = document.getElementById("photo-input");
    const photoPreviewImg = document.getElementById("photo-preview-img");
    const photoPlaceholder = document.getElementById("photo-placeholder");
    const removePhotoBtn = document.getElementById("remove-photo-btn");

    if (photoInput) photoInput.value = '';
    if (photoPreviewImg) {
      photoPreviewImg.src = '';
      photoPreviewImg.classList.add('hidden');
    }
    if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
    if (removePhotoBtn) removePhotoBtn.classList.add('hidden');

    this.selectedPhotoFile = null;
    this.photoPreview = null;
  }

  clearModalPhotoPreview() {
    const photoInput = document.getElementById("modal-photo-input");
    const photoPreviewImg = document.getElementById("modal-photo-preview-img");
    const photoPlaceholder = document.getElementById("modal-photo-placeholder");
    const removePhotoBtn = document.getElementById("modal-remove-photo-btn");

    if (photoInput) photoInput.value = '';
    if (photoPreviewImg) {
      photoPreviewImg.src = '';
      photoPreviewImg.classList.add('hidden');
    }
    if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
    if (removePhotoBtn) removePhotoBtn.classList.add('hidden');

    this.modalSelectedPhotoFile = null;
    this.modalPhotoPreview = null;
  }

  openEditModal(equipmentId) {
    const equipment = this.equipment.find(e => e.id === equipmentId);
    if (!equipment) return;

    this.editingEquipment = equipment;

    // Populate modal form
    document.getElementById("modal_equipment_id").value = equipment.id;
    document.getElementById("modal_equipment_name").value = equipment.name || '';
    document.getElementById("modal_equipment_category").value = equipment.category || '';
    document.getElementById("modal_equipment_quantity_total").value = equipment.quantity_total || 1;
    document.getElementById("modal_equipment_quantity_available").value = equipment.quantity_available || '';
    document.getElementById("modal_equipment_item_value").value = equipment.item_value || '';
    document.getElementById("modal_equipment_acquisition_date").value = equipment.acquisition_date ? equipment.acquisition_date.slice(0, 10) : '';
    document.getElementById("modal_equipment_condition_note").value = equipment.condition_note || '';
    document.getElementById("modal_equipment_description").value = equipment.description || '';

    // Show existing photo if available
    if (equipment.photo_url) {
      const photoPreviewImg = document.getElementById("modal-photo-preview-img");
      const photoPlaceholder = document.getElementById("modal-photo-placeholder");
      const removePhotoBtn = document.getElementById("modal-remove-photo-btn");

      if (photoPreviewImg) {
        photoPreviewImg.src = equipment.photo_url;
        photoPreviewImg.classList.remove('hidden');
      }
      if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
      if (removePhotoBtn) removePhotoBtn.classList.remove('hidden');

      this.modalPhotoPreview = equipment.photo_url;
    } else {
      this.clearModalPhotoPreview();
    }

    // Show modal
    document.getElementById("edit-equipment-modal").classList.remove("hidden");
    document.body.style.overflow = 'hidden';
  }

  closeEditModal() {
    document.getElementById("edit-equipment-modal").classList.add("hidden");
    document.body.style.overflow = '';
    this.editingEquipment = null;
    this.clearModalPhotoPreview();
    document.getElementById("editEquipmentForm").reset();
  }

  openDeleteConfirmation(equipmentId, equipmentName) {
    this.deletingEquipmentId = equipmentId;
    const message = translate("equipment_delete_confirm_message").replace("{name}", equipmentName);
    document.getElementById("delete-confirm-message").textContent = message;
    document.getElementById("delete-confirm-modal").classList.remove("hidden");
    document.body.style.overflow = 'hidden';
  }

  closeDeleteModal() {
    document.getElementById("delete-confirm-modal").classList.add("hidden");
    document.body.style.overflow = '';
    this.deletingEquipmentId = null;
  }

  async handleCreateSubmit() {
    const form = document.getElementById("equipmentForm");
    const formData = new FormData(form);

    const payload = {
      name: formData.get('name')?.trim() || '',
      category: formData.get('category')?.trim() || null,
      description: formData.get('description')?.trim() || null,
      quantity_total: parseInt(formData.get('quantity_total'), 10) || 1,
      quantity_available: formData.get('quantity_available') ? parseInt(formData.get('quantity_available'), 10) : null,
      condition_note: formData.get('condition_note')?.trim() || null,
      item_value: formData.get('item_value') ? parseFloat(formData.get('item_value')) : null,
      acquisition_date: formData.get('acquisition_date')?.trim() || null
    };

    // Remove null/undefined values to avoid validation issues
    Object.keys(payload).forEach(key => {
      if (payload[key] === null || payload[key] === undefined || payload[key] === '') {
        if (key !== 'name') { // name is required, keep empty string
          delete payload[key];
        }
      }
    });

    debugLog('Equipment save payload:', payload);

    try {
      const response = await saveEquipmentItem(payload);
      const savedEquipment = response?.data?.equipment || response?.equipment;

      // Upload photo if selected
      if (this.selectedPhotoFile && savedEquipment?.id) {
        try {
          await uploadEquipmentPhoto(savedEquipment.id, this.selectedPhotoFile);
        } catch (photoError) {
          debugError("Error uploading photo:", photoError);
          this.app.showMessage(translate("equipment_photo_upload_error"), "warning");
        }
      }

      this.app.showMessage(translate("inventory_saved"), "success");
      form.reset();
      this.clearPhotoPreview();
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error saving equipment", error);
      this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
    }
  }

  async handleEditSubmit() {
    const form = document.getElementById("editEquipmentForm");
    const formData = new FormData(form);
    const equipmentId = formData.get('equipment_id');

    const payload = {
      name: formData.get('name')?.trim() || '',
      category: formData.get('category')?.trim() || null,
      description: formData.get('description')?.trim() || null,
      quantity_total: parseInt(formData.get('quantity_total'), 10) || 1,
      quantity_available: formData.get('quantity_available') ? parseInt(formData.get('quantity_available'), 10) : null,
      condition_note: formData.get('condition_note')?.trim() || null,
      item_value: formData.get('item_value') ? parseFloat(formData.get('item_value')) : null,
      acquisition_date: formData.get('acquisition_date')?.trim() || null
    };

    // Remove null/undefined values to avoid validation issues
    Object.keys(payload).forEach(key => {
      if (payload[key] === null || payload[key] === undefined || payload[key] === '') {
        if (key !== 'name') { // name is required, keep empty string
          delete payload[key];
        }
      }
    });

    debugLog('Equipment update payload:', payload);

    try {
      await updateEquipmentItem(equipmentId, payload);

      // Handle photo deletion if user removed the photo
      if (this.editingEquipment?.photo_url && !this.modalPhotoPreview && !this.modalSelectedPhotoFile) {
        await deleteEquipmentPhoto(equipmentId);
      }

      // Upload new photo if selected
      if (this.modalSelectedPhotoFile) {
        try {
          await uploadEquipmentPhoto(equipmentId, this.modalSelectedPhotoFile);
        } catch (photoError) {
          debugError("Error uploading photo:", photoError);
          this.app.showMessage(translate("equipment_photo_upload_error"), "warning");
        }
      }

      this.app.showMessage(translate("equipment_updated"), "success");
      this.closeEditModal();
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error updating equipment", error);
      this.app.showMessage(translate("resource_dashboard_error_loading"), "error");
    }
  }

  async handleDelete() {
    if (!this.deletingEquipmentId) return;

    try {
      await deleteEquipmentItem(this.deletingEquipmentId);
      this.app.showMessage(translate("equipment_deleted"), "success");
      this.closeDeleteModal();
      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error deleting equipment", error);
      const errorMessage = error.message || translate("resource_dashboard_error_loading");
      this.app.showMessage(errorMessage, "error");
      this.closeDeleteModal();
    }
  }
}
