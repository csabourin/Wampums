import {
  getExternalRevenue,
  createExternalRevenue,
  updateExternalRevenue,
  deleteExternalRevenue,
  getExternalRevenueSummary,
  getBudgetCategories,
} from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";
import {
  LoadingStateManager,
  debounce,
  retryWithBackoff,
} from "./utils/PerformanceUtils.js";
import {
  validateMoney,
  validateDateField,
  validateRequired,
} from "./utils/ValidationUtils.js";
import { canApproveFinance, canManageFinance } from "./utils/PermissionUtils.js";

const DEFAULT_CURRENCY = "CAD";

/**
 * External Revenue Management Module
 * Track donations, sponsorships, grants, and other external income
 */
export class ExternalRevenue {
  constructor(app) {
    this.app = app;
    this.revenues = [];
    this.categories = [];
    this.summary = null;
    this.filters = {
      start_date: "",
      end_date: "",
      revenue_type: "all",
      category_id: "all",
    };
    this.fiscalYear = this.getCurrentFiscalYear();

    // Loading state management
    this.loadingManager = new LoadingStateManager();
    this.isInitializing = false;

    // Debounced filter application
    this.debouncedApplyFilters = debounce(this.applyFilters.bind(this), 300);
  }

  /**
   * Calculate current fiscal year (Sept 1 - Aug 31)
   */
  getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    if (month >= 8) {
      // September or later
      return {
        start: `${year}-09-01`,
        end: `${year + 1}-08-31`,
        label: `${year}-${year + 1}`,
      };
    } else {
      return {
        start: `${year - 1}-09-01`,
        end: `${year}-08-31`,
        label: `${year - 1}-${year}`,
      };
    }
  }

  async init() {
    // Prevent race conditions - only one init at a time
    if (this.isInitializing) {
      debugError(
        "ExternalRevenue init already in progress, skipping duplicate call",
      );
      return;
    }

    this.isInitializing = true;

    try {
      // Set default date filters to current fiscal year
      this.filters.start_date = this.fiscalYear.start;
      this.filters.end_date = this.fiscalYear.end;

      // Render loading state immediately
      this.renderLoading();

      // Load data - each function handles its own errors
      await this.loadCategories();
      await this.loadRevenues();
      await this.loadSummary();

      // Render with data
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Unable to initialize external revenue page", error);
      // Render error state but allow partial functionality
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate("error_loading_data"), "error");
    } finally {
      this.isInitializing = false;
    }
  }

  async loadCategories() {
    return this.loadingManager.withLoading("categories", async () => {
      try {
        const response = await retryWithBackoff(() => getBudgetCategories(), {
          maxRetries: 2,
        });
        this.categories = response?.data || [];
        debugLog(`Loaded ${this.categories.length} categories`);
      } catch (error) {
        debugError("Error loading categories", error);
        this.categories = [];
      }
    });
  }

  async loadRevenues() {
    return this.loadingManager.withLoading("revenues", async () => {
      try {
        const response = await retryWithBackoff(
          () => getExternalRevenue(this.filters),
          { maxRetries: 2 },
        );
        this.revenues = response?.data || [];
        debugLog(`Loaded ${this.revenues.length} external revenue entries`);
      } catch (error) {
        debugError("Error loading external revenues", error);
        this.revenues = [];
        // Don't throw - allow page to render with empty data
      }
    });
  }

  async loadSummary() {
    try {
      const response = await getExternalRevenueSummary(
        this.filters.start_date,
        this.filters.end_date,
      );
      this.summary = response?.data || null;
      debugLog("Loaded external revenue summary", this.summary);
    } catch (error) {
      debugError("Error loading summary", error);
      this.summary = null;
    }
  }

  formatCurrency(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat(this.app.lang || "en", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value);
  }

  getRevenueTypeLabel(type) {
    const types = {
      donation: translate("donation"),
      sponsorship: translate("sponsorship"),
      grant: translate("grant"),
      other: translate("other"),
    };
    return types[type] || type;
  }

  renderLoading() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container external-revenue-page">
        <div class="page-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div class="page-header-content">
            <h1>${translate("external_revenue")}</h1>
            <div class="fiscal-year-display">
              <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
            </div>
          </div>
        </div>
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p>${translate("loading")}...</p>
        </div>
      </div>
    `;
  }

  async render() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container external-revenue-page">
        <div class="page-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div class="page-header-content">
            <h1>${translate("external_revenue")}</h1>
            <div class="fiscal-year-display">
              <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
            </div>
          </div>
        </div>

        ${this.renderSummaryCards()}
        ${this.renderFilters()}
        ${this.renderActionButtons()}
        ${this.renderRevenueList()}
      </div>
    `;
  }

  renderSummaryCards() {
    if (!this.summary || !this.summary.totals) {
      return "";
    }

    const totals = this.summary.totals;

    return `
      <div class="summary-cards">
        <div class="summary-card revenue-card">
          <div class="card-icon">💰</div>
          <div class="card-content">
            <div class="card-label">${translate("total_external_revenue")}</div>
            <div class="card-value">${this.formatCurrency(totals.total_amount)}</div>
            <div class="card-detail">${totals.entry_count} ${translate("entries")}</div>
          </div>
        </div>
      </div>
    `;
  }

  renderFilters() {
    return `
      <div class="filters-section">
        <div class="filters-row">
          <div class="filter-group">
            <label for="filter-start-date">${translate("start_date")}</label>
            <input type="date" id="filter-start-date" value="${this.filters.start_date}">
          </div>
          
          <div class="filter-group">
            <label for="filter-end-date">${translate("end_date")}</label>
            <input type="date" id="filter-end-date" value="${this.filters.end_date}">
          </div>

          <div class="filter-group">
            <label for="filter-revenue-type">${translate("revenue_type")}</label>
            <select id="filter-revenue-type">
              <option value="all" ${this.filters.revenue_type === "all" ? "selected" : ""}>${translate("all_types")}</option>
              <option value="donation" ${this.filters.revenue_type === "donation" ? "selected" : ""}>${translate("donation")}</option>
              <option value="sponsorship" ${this.filters.revenue_type === "sponsorship" ? "selected" : ""}>${translate("sponsorship")}</option>
              <option value="grant" ${this.filters.revenue_type === "grant" ? "selected" : ""}>${translate("grant")}</option>
              <option value="other" ${this.filters.revenue_type === "other" ? "selected" : ""}>${translate("other")}</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="filter-category">${translate("category")}</label>
            <select id="filter-category">
              <option value="all" ${this.filters.category_id === "all" ? "selected" : ""}>${translate("all_categories")}</option>
              ${this.categories
                .map(
                  (cat) => `
                <option value="${cat.id}" ${this.filters.category_id == cat.id ? "selected" : ""}>
                  ${escapeHTML(cat.name)}
                </option>
              `,
                )
                .join("")}
            </select>
          </div>

          <div class="filter-actions">
            <button class="btn btn-primary" id="apply-filters-btn">
              ${translate("apply_filters")}
            </button>
            <button class="btn btn-secondary" id="reset-filters-btn">
              ${translate("reset")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderActionButtons() {
    const canEdit = canManageFinance();

    if (!canEdit) {
      return "";
    }

    return `
      <div class="action-buttons">
        <button class="btn btn-primary" id="add-revenue-btn">
          ${translate("add_external_revenue")}
        </button>
        <button class="btn btn-secondary" id="export-revenue-btn">
          ${translate("export_csv")}
        </button>
      </div>
    `;
  }

  renderRevenueList() {
    if (this.revenues.length === 0) {
      return `<div class="no-data"><p>${translate("no_external_revenue_entries")}</p></div>`;
    }

    return `
      <div class="revenue-list">
        <table class="data-table revenue-table">
          <thead>
            <tr>
              <th>${translate("date")}</th>
              <th>${translate("type")}</th>
              <th>${translate("source_donor")}</th>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("amount")}</th>
              <th>${translate("reference")}</th>
              <th>${translate("actions")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.revenues.map((revenue) => this.renderRevenueRow(revenue)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderRevenueRow(revenue) {
    const canEdit = canManageFinance();
    const canDelete = canApproveFinance();

    return `
      <tr data-revenue-id="${revenue.id}">
        <td>${formatDateShort(revenue.revenue_date)}</td>
        <td><span class="badge badge-${revenue.revenue_type}">${this.getRevenueTypeLabel(revenue.revenue_type)}</span></td>
        <td>${escapeHTML(revenue.description)}</td>
        <td>${escapeHTML(revenue.category_name || "-")}</td>
        <td class="text-right amount revenue">${this.formatCurrency(revenue.amount)}</td>
        <td class="text-small">${escapeHTML(revenue.reference_number || "-")}</td>
        <td class="actions-cell">
          ${
            canEdit
              ? `
            <button class="btn btn-sm btn-secondary edit-revenue-btn" data-id="${revenue.id}">
              ${translate("edit")}
            </button>
          `
              : ""
          }
          ${
            canDelete
              ? `
            <button class="btn btn-sm btn-danger delete-revenue-btn" data-id="${revenue.id}">
              ${translate("delete")}
            </button>
          `
              : ""
          }
        </td>
      </tr>
    `;
  }

  attachEventListeners() {
    // Filter buttons
    const applyFiltersBtn = document.getElementById("apply-filters-btn");
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener("click", () => this.applyFilters());
    }

    const resetFiltersBtn = document.getElementById("reset-filters-btn");
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () => this.resetFilters());
    }

    // Add button
    const addRevenueBtn = document.getElementById("add-revenue-btn");
    if (addRevenueBtn) {
      addRevenueBtn.addEventListener("click", () => this.showRevenueModal());
    }

    // Export button
    const exportRevenueBtn = document.getElementById("export-revenue-btn");
    if (exportRevenueBtn) {
      exportRevenueBtn.addEventListener("click", () => this.exportToCSV());
    }

    // Edit buttons
    document.querySelectorAll(".edit-revenue-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const revenue = this.revenues.find((r) => r.id === id);
        if (revenue) {
          this.showRevenueModal(revenue);
        }
      });
    });

    // Delete buttons
    document.querySelectorAll(".delete-revenue-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_external_revenue"))) {
          await this.deleteRevenue(id);
        }
      });
    });
  }

  async applyFilters() {
    this.filters.start_date =
      document.getElementById("filter-start-date").value;
    this.filters.end_date = document.getElementById("filter-end-date").value;
    this.filters.revenue_type = document.getElementById(
      "filter-revenue-type",
    ).value;
    this.filters.category_id = document.getElementById("filter-category").value;

    await Promise.all([this.loadRevenues(), this.loadSummary()]);
    this.render();
    this.attachEventListeners();
  }

  async resetFilters() {
    this.filters = {
      start_date: this.fiscalYear.start,
      end_date: this.fiscalYear.end,
      revenue_type: "all",
      category_id: "all",
    };

    await Promise.all([this.loadRevenues(), this.loadSummary()]);
    this.render();
    this.attachEventListeners();
  }

  showRevenueModal(revenue = null) {
    const isEdit = !!revenue;
    const modalHTML = `
      <div class="modal-overlay" id="revenue-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${isEdit ? translate("edit_external_revenue") : translate("add_external_revenue")}</h3>
            <button class="modal-close" id="close-revenue-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="revenue-form">
              <div class="form-group">
                <label for="revenue-type">${translate("revenue_type")}*</label>
                <select id="revenue-type" required>
                  <option value="donation" ${revenue?.revenue_type === "donation" ? "selected" : ""}>${translate("donation")}</option>
                  <option value="sponsorship" ${revenue?.revenue_type === "sponsorship" ? "selected" : ""}>${translate("sponsorship")}</option>
                  <option value="grant" ${revenue?.revenue_type === "grant" ? "selected" : ""}>${translate("grant")}</option>
                  <option value="other" ${revenue?.revenue_type === "other" ? "selected" : ""}>${translate("other")}</option>
                </select>
              </div>

              <div class="form-group">
                <label for="revenue-date">${translate("date")}*</label>
                <input type="date" id="revenue-date" required
                       value="${revenue ? revenue.revenue_date : getTodayISO()}">
              </div>

              <div class="form-group">
                <label for="revenue-description">${translate("source_donor")}*</label>
                <input type="text" id="revenue-description" required
                       value="${revenue ? escapeHTML(revenue.description) : ""}"
                       placeholder="${translate("enter_source_donor_name")}">
              </div>

              <div class="form-group">
                <label for="revenue-amount">${translate("amount")}*</label>
                <input type="number" id="revenue-amount" step="0.01" min="0" required
                       value="${revenue ? revenue.amount : ""}">
              </div>

              <div class="form-group">
                <label for="revenue-category">${translate("category")}</label>
                <select id="revenue-category">
                  <option value="">${translate("uncategorized")}</option>
                  ${this.categories
                    .map(
                      (cat) => `
                    <option value="${cat.id}" ${revenue?.budget_category_id === cat.id ? "selected" : ""}>
                      ${escapeHTML(cat.name)}
                    </option>
                  `,
                    )
                    .join("")}
                </select>
              </div>

              <div class="form-group">
                <label for="revenue-reference">${translate("reference_number")}</label>
                <input type="text" id="revenue-reference"
                       value="${revenue ? escapeHTML(revenue.reference_number || "") : ""}"
                       placeholder="${translate("check_number_transfer_id")}">
              </div>

              <div class="form-group">
                <label for="revenue-payment-method">${translate("payment_method")}</label>
                <input type="text" id="revenue-payment-method"
                       value="${revenue ? escapeHTML(revenue.payment_method || "") : ""}"
                       placeholder="${translate("cash_check_transfer")}">
              </div>

              <div class="form-group">
                <label for="revenue-receipt-url">${translate("receipt_url")}</label>
                <input type="url" id="revenue-receipt-url"
                       value="${revenue ? escapeHTML(revenue.receipt_url || "") : ""}"
                       placeholder="https://">
              </div>

              <div class="form-group">
                <label for="revenue-notes">${translate("notes")}</label>
                <textarea id="revenue-notes" rows="3">${revenue ? escapeHTML(revenue.notes || "") : ""}</textarea>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-revenue-btn">
                  ${translate("cancel")}
                </button>
                <button type="submit" class="btn btn-primary">
                  ${isEdit ? translate("update") : translate("create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);

    document
      .getElementById("close-revenue-modal")
      .addEventListener("click", () => {
        document.getElementById("revenue-modal").remove();
      });

    document
      .getElementById("cancel-revenue-btn")
      .addEventListener("click", () => {
        document.getElementById("revenue-modal").remove();
      });

    document
      .getElementById("revenue-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.saveRevenue(revenue?.id);
      });
  }

  async saveRevenue(revenueId = null) {
    const revenueType = document.getElementById("revenue-type").value;
    const revenueDate = document.getElementById("revenue-date").value;
    const description = document.getElementById("revenue-description").value;
    const amount = parseFloat(document.getElementById("revenue-amount").value);
    const categoryId =
      document.getElementById("revenue-category").value || null;
    const referenceNumber = document.getElementById("revenue-reference").value;
    const paymentMethod = document.getElementById(
      "revenue-payment-method",
    ).value;
    const receiptUrl = document.getElementById("revenue-receipt-url").value;
    const notes = document.getElementById("revenue-notes").value;

    try {
      const payload = {
        revenue_type: revenueType,
        revenue_date: revenueDate,
        description,
        amount,
        budget_category_id: categoryId,
        reference_number: referenceNumber,
        payment_method: paymentMethod,
        receipt_url: receiptUrl,
        notes,
      };

      if (revenueId) {
        await updateExternalRevenue(revenueId, payload);
        this.app.showMessage(translate("external_revenue_updated"), "success");
      } else {
        await createExternalRevenue(payload);
        this.app.showMessage(translate("external_revenue_created"), "success");
      }

      document.getElementById("revenue-modal").remove();
      await Promise.all([this.loadRevenues(), this.loadSummary()]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving external revenue", error);
      this.app.showMessage(translate("error_saving_external_revenue"), "error");
    }
  }

  async deleteRevenue(revenueId) {
    try {
      await deleteExternalRevenue(revenueId);
      this.app.showMessage(translate("external_revenue_deleted"), "success");
      await Promise.all([this.loadRevenues(), this.loadSummary()]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error deleting external revenue", error);
      this.app.showMessage(
        translate("error_deleting_external_revenue"),
        "error",
      );
    }
  }

  exportToCSV() {
    if (this.revenues.length === 0) {
      this.app.showMessage(translate("no_data_to_export"), "warning");
      return;
    }

    // Build CSV content
    const headers = [
      translate("date"),
      translate("type"),
      translate("source_donor"),
      translate("category"),
      translate("amount"),
      translate("reference"),
      translate("payment_method"),
      translate("notes"),
    ];

    const rows = this.revenues.map((revenue) => [
      revenue.revenue_date,
      this.getRevenueTypeLabel(revenue.revenue_type),
      revenue.description,
      revenue.category_name || "-",
      revenue.amount,
      revenue.reference_number || "-",
      revenue.payment_method || "-",
      revenue.notes || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    // Download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `external_revenue_${getTodayISO()}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.app.showMessage(translate("export_successful"), "success");
  }
}

export default ExternalRevenue;
