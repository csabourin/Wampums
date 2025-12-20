import { translate } from "./app.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { CONFIG } from "./config.js";
import {
  getEquipmentInventory,
  saveEquipmentItem,
  updateEquipmentItem,
  uploadEquipmentPhoto,
  deleteEquipmentPhoto,
  deleteEquipmentItem
} from "./api/api-endpoints.js";
import { deleteCachedData } from "./indexedDB.js";
import { canViewInventory } from "./utils/PermissionUtils.js";

// Maximum photo file size: 3MB
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
];
const HEIC_PHOTO_TYPES = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
];
const ALLOWED_PHOTO_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'heic', 'heif'];
const GENERIC_PHOTO_MIME_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];
const HEIC_PHOTO_EXTENSIONS = ['heic', 'heif'];

/**
 * Determine whether a selected photo file is allowed based on MIME type or safe extension fallback.
 * Some browsers provide empty or generic MIME types for HEIC/HEIF uploads; in those cases we
 * fall back to validating the extension while keeping the allowed list narrow.
 * @param {File} file
 * @returns {boolean}
 */
function isAllowedPhotoFile(file) {
  if (!file) {
    return false;
  }

  const mimeType = (file.type || '').toLowerCase().split(';')[0];
  if (ALLOWED_PHOTO_TYPES.includes(mimeType)) {
    return true;
  }

  const extension = (file.name || '').split('.').pop();
  if (!extension) {
    return false;
  }

  const normalizedExtension = extension.toLowerCase();
  const isKnownExtension = ALLOWED_PHOTO_EXTENSIONS.includes(normalizedExtension);
  return isKnownExtension && GENERIC_PHOTO_MIME_TYPES.includes(mimeType);
}

/**
 * Determine if a file should be treated as HEIC/HEIF based on MIME type or extension.
 * @param {File} file
 * @returns {boolean}
 */
function isHeicPhotoFile(file) {
  if (!file) {
    return false;
  }
  const mimeType = (file.type || '').toLowerCase().split(';')[0];
  if (HEIC_PHOTO_TYPES.includes(mimeType)) {
    return true;
  }
  const extension = (file.name || '').split('.').pop();
  if (!extension) {
    return false;
  }
  const normalizedExtension = extension.toLowerCase();
  return HEIC_PHOTO_EXTENSIONS.includes(normalizedExtension) && GENERIC_PHOTO_MIME_TYPES.includes(mimeType);
}

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
    this.photoPreviewUrl = null;
    this.selectedPhotoFile = null;
    this.modalPhotoPreview = null;
    this.modalPhotoPreviewUrl = null;
    this.modalSelectedPhotoFile = null;
    this.lastFocusedElement = null;
    this.heicConverterPromise = null;
    this.handleImagePreviewKeydown = this.handleImagePreviewKeydown.bind(this);
  }

  async init() {
    // Check permission
    if (!canViewInventory()) {
      this.app.router.navigate("/dashboard");
      return;
    }

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
    // Force refresh to bypass cache - ensures we get the latest data including updated photos
    const equipmentResponse = await getEquipmentInventory({}, { forceRefresh: true });
    this.equipment = equipmentResponse?.data?.equipment || equipmentResponse?.equipment || [];
  }

  getLocale() {
    const storedLang = localStorage.getItem('lang') || localStorage.getItem('language') || this.app?.lang || CONFIG.DEFAULT_LANG;
    if (storedLang === 'en') return 'en-CA';
    if (storedLang === 'uk') return 'uk-UA';
    return 'fr-CA';
  }

  formatDate(dateString) {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(this.getLocale());
    } catch {
      return '-';
    }
  }

  formatCurrency(value) {
    if (value === null || value === undefined || value === '') return '-';
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return '-';
    return new Intl.NumberFormat(this.getLocale(), {
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
                  <input type="file" id="photo-input" name="photo" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" class="hidden" />
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
                    <input type="file" id="modal-photo-input" name="photo" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" class="hidden" />
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

      <!-- Image Preview Modal -->
      <div class="modal-overlay hidden" id="image-preview-modal" aria-hidden="true">
        <div class="modal-container modal-image-preview" role="dialog" aria-modal="true" aria-labelledby="image-preview-title">
          <div class="modal-header">
            <h2 id="image-preview-title">${escapeHTML(translate("inventory_image_preview_title"))}</h2>
            <button type="button" class="modal-close-btn" id="image-preview-close-btn" aria-label="${escapeHTML(translate("inventory_image_preview_close"))}">×</button>
          </div>
          <div class="modal-body image-preview-body">
            <img id="image-preview-img" alt="" />
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
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .inventory-page .previewable-image:focus-visible {
          outline: 3px solid var(--primary-color, #4a90d9);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.25);
        }

        .inventory-page .previewable-image:hover {
          transform: scale(1.01);
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.15);
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
          position: relative;
          z-index: 1001;
          background: var(--bg-card, white);
          border-radius: 12px;
          width: 100%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          min-width: 300px;
        }

        .modal-container.modal-small {
          max-width: 400px;
        }

        .modal-container.modal-image-preview {
          max-width: 1000px;
          width: 100%;
          background: transparent;
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

        .image-preview-body {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 1rem;
          background: var(--bg-card, white);
        }

        #image-preview-img {
          max-width: calc(100vw - 2.5rem);
          max-height: calc(100vh - 8rem);
          width: 100%;
          height: auto;
          object-fit: contain;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
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

          #image-preview-img {
            max-height: calc(100vh - 7rem);
            max-width: calc(100vw - 2rem);
          }
        }

        @media (min-width: 768px) {
          .modal-container.modal-image-preview {
            max-width: 90vw;
          }

          #image-preview-img {
            max-width: calc(90vw - 3rem);
            max-height: calc(90vh - 6rem);
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
                ? `<img src="${escapeHTML(item.photo_url)}" alt="${escapeHTML(item.name)}" loading="lazy" class="previewable-image" role="button" tabindex="0" data-photo-url="${escapeHTML(item.photo_url)}" data-photo-alt="${escapeHTML(item.name)}" />`
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
                    ? `<img src="${escapeHTML(item.photo_url)}" alt="${escapeHTML(item.name)}" class="table-photo previewable-image" loading="lazy" role="button" tabindex="0" data-photo-url="${escapeHTML(item.photo_url)}" data-photo-alt="${escapeHTML(item.name)}" />`
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

    // Image preview handlers
    this.setupImagePreviewHandlers();
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

      photoInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (file) {
          // Validate file
          if (file.size > MAX_PHOTO_SIZE) {
            this.app.showMessage(translate("equipment_photo_too_large"), "error");
            photoInput.value = '';
            return;
          }

          if (!isAllowedPhotoFile(file)) {
            this.app.showMessage(translate("equipment_photo_invalid_type"), "error");
            photoInput.value = '';
            return;
          }

          const normalization = await this.normalizePhotoFile(file);

          if (isModal) {
            this.modalSelectedPhotoFile = normalization.processedFile;
          } else {
            this.selectedPhotoFile = normalization.processedFile;
          }

          if (normalization.previewFile) {
            // Show preview using an object URL (works for converted WebP)
            const previewUrl = URL.createObjectURL(normalization.previewFile);
            photoPreviewImg.src = previewUrl;
            photoPreviewImg.classList.remove('hidden');
            photoPlaceholder.classList.add('hidden');
            removePhotoBtn.classList.remove('hidden');

            if (isModal) {
              if (this.modalPhotoPreviewUrl) {
                URL.revokeObjectURL(this.modalPhotoPreviewUrl);
              }
              this.modalPhotoPreviewUrl = previewUrl;
            } else {
              if (this.photoPreviewUrl) {
                URL.revokeObjectURL(this.photoPreviewUrl);
              }
              this.photoPreviewUrl = previewUrl;
            }
          } else {
            if (isModal && this.modalPhotoPreviewUrl) {
              URL.revokeObjectURL(this.modalPhotoPreviewUrl);
              this.modalPhotoPreviewUrl = null;
            }
            if (!isModal && this.photoPreviewUrl) {
              URL.revokeObjectURL(this.photoPreviewUrl);
              this.photoPreviewUrl = null;
            }
            this.showPreviewUnavailableState(photoPreviewImg, photoPlaceholder);
            removePhotoBtn.classList.remove('hidden');
            if (normalization.error) {
              this.app.showMessage(translate("equipment_photo_preview_unavailable"), "warning");
            }
          }
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

  async loadHeicConverter() {
    if (this.heicConverterPromise) {
      return this.heicConverterPromise;
    }

    this.heicConverterPromise = import(
      /* @vite-ignore */ CONFIG.UI.HEIC_CONVERTER_URL
    ).then((module) => module.default || module);

    return this.heicConverterPromise;
  }

  showPreviewUnavailableState(photoPreviewImg, photoPlaceholder) {
    if (photoPreviewImg) {
      photoPreviewImg.src = '';
      photoPreviewImg.classList.add('hidden');
    }

    if (photoPlaceholder) {
      const textEl = photoPlaceholder.querySelector('.photo-text');
      const hintEl = photoPlaceholder.querySelector('.photo-hint');
      if (textEl) {
        textEl.textContent = translate("equipment_photo_preview_unavailable");
      }
      if (hintEl) {
        hintEl.textContent = translate("equipment_photo_click_to_upload");
      }
      photoPlaceholder.classList.remove('hidden');
    }
  }

  /**
   * Normalize a selected photo file to ensure previewability and upload consistency.
   * Converts HEIC/HEIF inputs to WebP for browsers that cannot render HEIC directly.
   * @param {File} file
   * @returns {Promise<{processedFile: File, previewFile: File, error?: Error}>}
   */
  async normalizePhotoFile(file) {
    if (!isHeicPhotoFile(file)) {
      return { processedFile: file, previewFile: file };
    }

    try {
      const heic2any = await this.loadHeicConverter();
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/webp',
        quality: 0.82
      });
      const normalizedName = this.buildWebpFilename(file.name);
      const convertedFile = new File([convertedBlob], normalizedName, { type: 'image/webp' });
      return { processedFile: convertedFile, previewFile: convertedFile };
    } catch (conversionError) {
      debugError("Error converting HEIC for preview:", conversionError);
      this.heicConverterPromise = null;
      return { processedFile: file, previewFile: null, error: conversionError };
    }
  }

  buildWebpFilename(originalName) {
    if (!originalName) {
      return 'photo.webp';
    }
    const withoutExtension = originalName.includes('.')
      ? originalName.replace(/\.[^.]+$/, '')
      : originalName;
    return `${withoutExtension}.webp`;
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

  setupImagePreviewHandlers() {
    const previewableImages = document.querySelectorAll(".previewable-image");
    const overlay = document.getElementById("image-preview-modal");
    const closeBtn = document.getElementById("image-preview-close-btn");

    previewableImages.forEach((img) => {
      const openHandler = () => {
        const photoUrl = img.getAttribute("data-photo-url");
        const altText = img.getAttribute("data-photo-alt") || "";
        this.openImagePreview(photoUrl, altText);
      };

      img.addEventListener("click", openHandler);
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openHandler();
        }
      });
    });

    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          this.closeImagePreview();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.closeImagePreview());
    }
  }

  openImagePreview(imageUrl, altText = "") {
    const overlay = document.getElementById("image-preview-modal");
    const image = document.getElementById("image-preview-img");
    const closeBtn = document.getElementById("image-preview-close-btn");
    const safeSrc = this.getSafeImageSrc(imageUrl);

    if (!overlay || !image || !closeBtn || !safeSrc) {
      return;
    }

    this.lastFocusedElement = document.activeElement;
    image.setAttribute("src", safeSrc);
    image.setAttribute("alt", altText || translate("inventory_image_preview_alt_fallback"));

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    this.updateBodyScrollLock();
    closeBtn.focus({ preventScroll: true });

    document.addEventListener("keydown", this.handleImagePreviewKeydown);
  }

  closeImagePreview() {
    const overlay = document.getElementById("image-preview-modal");
    const image = document.getElementById("image-preview-img");

    if (overlay) {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
    }

    if (image) {
      image.removeAttribute("src");
      image.setAttribute("alt", "");
    }

    this.updateBodyScrollLock();
    document.removeEventListener("keydown", this.handleImagePreviewKeydown);

    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === "function") {
      this.lastFocusedElement.focus({ preventScroll: true });
    }
    this.lastFocusedElement = null;
  }

  handleImagePreviewKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeImagePreview();
    }
  }

  getSafeImageSrc(imageUrl) {
    if (typeof imageUrl !== "string") {
      return null;
    }

    const trimmed = imageUrl.trim();
    const lowered = trimmed.toLowerCase();

    if (lowered.startsWith("javascript:") || lowered.startsWith("vbscript:")) {
      debugError("Blocked unsafe image src", imageUrl);
      return null;
    }

    if (lowered.startsWith("data:")) {
      return lowered.startsWith("data:image/") ? trimmed : null;
    }

    if (lowered.startsWith("blob:") ||
        lowered.startsWith("http://") ||
        lowered.startsWith("https://") ||
        lowered.startsWith("//") ||
        lowered.startsWith("/")) {
      return trimmed;
    }

    return trimmed;
  }

  updateBodyScrollLock() {
    const activeOverlays = document.querySelectorAll(".modal-overlay:not(.hidden)");
    document.body.style.overflow = activeOverlays.length > 0 ? "hidden" : "";
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

    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
      this.photoPreviewUrl = null;
    }

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

    if (this.modalPhotoPreviewUrl) {
      URL.revokeObjectURL(this.modalPhotoPreviewUrl);
      this.modalPhotoPreviewUrl = null;
    }

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
    this.updateBodyScrollLock();
  }

  closeEditModal() {
    document.getElementById("edit-equipment-modal").classList.add("hidden");
    this.updateBodyScrollLock();
    this.editingEquipment = null;
    this.clearModalPhotoPreview();
    document.getElementById("editEquipmentForm").reset();
  }

  openDeleteConfirmation(equipmentId, equipmentName) {
    this.deletingEquipmentId = equipmentId;
    const message = translate("equipment_delete_confirm_message").replace("{name}", equipmentName);
    document.getElementById("delete-confirm-message").textContent = message;
    document.getElementById("delete-confirm-modal").classList.remove("hidden");
    this.updateBodyScrollLock();
  }

  closeDeleteModal() {
    document.getElementById("delete-confirm-modal").classList.add("hidden");
    this.updateBodyScrollLock();
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

      // Invalidate cache to ensure fresh data
      await deleteCachedData('v1/resources/equipment');

      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error saving equipment", error);
      this.app.showMessage(error.message || translate("resource_dashboard_error_loading"), "error");
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

      // Invalidate cache to ensure fresh data
      await deleteCachedData('v1/resources/equipment');

      await this.refreshData();
      this.render();
      this.attachEventHandlers();
    } catch (error) {
      debugError("Error updating equipment", error);
      this.app.showMessage(error.message || translate("resource_dashboard_error_loading"), "error");
    }
  }

  async handleDelete() {
    if (!this.deletingEquipmentId) return;

    try {
      await deleteEquipmentItem(this.deletingEquipmentId);
      this.app.showMessage(translate("equipment_deleted"), "success");
      this.closeDeleteModal();

      // Invalidate cache to ensure fresh data
      await deleteCachedData('v1/resources/equipment');

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
