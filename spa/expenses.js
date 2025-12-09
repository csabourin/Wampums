import {
  getBudgetExpenses,
  createBudgetExpense,
  createExpensesBulk,
  updateBudgetExpense,
  deleteBudgetExpense,
  getExpenseSummary,
  getExpensesMonthly,
  getBudgetCategories,
  getBudgetItems
} from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";

const DEFAULT_CURRENCY = "CAD";

// Quebec tax rates
const TAX_GST = 0.05; // 5%
const TAX_QST = 0.09975; // 9.975%

/**
 * Enhanced Expense Tracking Module
 * Item-level expense entry with tax calculation and detailed tracking
 */
export class Expenses {
  constructor(app) {
    this.app = app;
    this.expenses = [];
    this.categories = [];
    this.items = [];
    this.summary = null;
    this.monthlyData = null;
    this.activeTab = "list";
    this.filters = {
      start_date: '',
      end_date: '',
      category_id: 'all'
    };
    this.fiscalYear = this.getCurrentFiscalYear();
  }

  /**
   * Calculate current fiscal year (Sept 1 - Aug 31)
   */
  getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    if (month >= 8) { // September or later
      return {
        start: `${year}-09-01`,
        end: `${year + 1}-08-31`,
        label: `${year}-${year + 1}`
      };
    } else {
      return {
        start: `${year - 1}-09-01`,
        end: `${year}-08-31`,
        label: `${year - 1}-${year}`
      };
    }
  }

  async init() {
    try {
      // Set default date filters to current fiscal year
      this.filters.start_date = this.fiscalYear.start;
      this.filters.end_date = this.fiscalYear.end;

      await Promise.all([
        this.loadCategories(),
        this.loadItems(),
        this.loadExpenses(),
        this.loadSummary(),
        this.loadMonthlyData()
      ]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Unable to initialize expenses page", error);
      this.app.showMessage(translate("error_loading_data"), "error");
    }
  }

  async loadCategories() {
    try {
      const response = await getBudgetCategories();
      this.categories = response?.data || [];
      debugLog(`Loaded ${this.categories.length} categories`);
    } catch (error) {
      debugError("Error loading categories", error);
      this.categories = [];
    }
  }

  async loadItems() {
    try {
      const response = await getBudgetItems();
      this.items = response?.data || [];
      debugLog(`Loaded ${this.items.length} budget items`);
    } catch (error) {
      debugError("Error loading budget items", error);
      this.items = [];
    }
  }

  async loadExpenses() {
    try {
      const filters = {
        start_date: this.filters.start_date,
        end_date: this.filters.end_date
      };
      if (this.filters.category_id !== 'all') {
        filters.category_id = this.filters.category_id;
      }

      const response = await getBudgetExpenses(filters);
      // Filter out external revenue entries (they have [EXTERNAL_REVENUE] in notes)
      this.expenses = (response?.data || []).filter(expense => 
        !expense.notes || !expense.notes.includes('[EXTERNAL_REVENUE]')
      );
      debugLog(`Loaded ${this.expenses.length} expenses`);
    } catch (error) {
      debugError("Error loading expenses", error);
      this.expenses = [];
      throw error;
    }
  }

  async loadSummary() {
    try {
      const response = await getExpenseSummary(
        this.filters.start_date,
        this.filters.end_date,
        this.filters.category_id !== 'all' ? this.filters.category_id : null
      );
      this.summary = response?.data || null;
      debugLog("Loaded expense summary", this.summary);
    } catch (error) {
      debugError("Error loading summary", error);
      this.summary = null;
    }
  }

  async loadMonthlyData() {
    try {
      const response = await getExpensesMonthly(
        this.fiscalYear.start,
        this.fiscalYear.end,
        this.filters.category_id !== 'all' ? this.filters.category_id : null
      );
      this.monthlyData = response?.data || [];
      debugLog("Loaded monthly expense data", this.monthlyData);
    } catch (error) {
      debugError("Error loading monthly data", error);
      this.monthlyData = [];
    }
  }

  formatCurrency(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat(this.app.lang || "en", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2
    }).format(value);
  }

  /**
   * Calculate taxes for Quebec
   */
  calculateTaxes(subtotal) {
    const gst = subtotal * TAX_GST;
    const qst = subtotal * TAX_QST;
    const total = subtotal + gst + qst;
    return {
      subtotal,
      gst,
      qst,
      total
    };
  }

  async render() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container expenses-page">
        <div class="page-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div class="page-header-content">
            <h1>${translate("expense_tracking")}</h1>
            <div class="fiscal-year-display">
              <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
            </div>
          </div>
        </div>

        ${this.renderSummaryCards()}

        <div class="tab-navigation">
          <button class="tab-btn ${this.activeTab === "list" ? "active" : ""}" data-tab="list">
            ${translate("expense_list")}
          </button>
          <button class="tab-btn ${this.activeTab === "summary" ? "active" : ""}" data-tab="summary">
            ${translate("summary")}
          </button>
          <button class="tab-btn ${this.activeTab === "monthly" ? "active" : ""}" data-tab="monthly">
            ${translate("monthly_breakdown")}
          </button>
        </div>

        <div class="tab-content">
          ${this.renderTabContent()}
        </div>
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
        <div class="summary-card expense-card">
          <div class="card-icon">📊</div>
          <div class="card-content">
            <div class="card-label">${translate("total_expenses")}</div>
            <div class="card-value">${this.formatCurrency(totals.total_amount)}</div>
            <div class="card-detail">${totals.expense_count} ${translate("entries")}</div>
          </div>
        </div>
      </div>
    `;
  }

  renderTabContent() {
    switch (this.activeTab) {
      case "list":
        return this.renderExpenseList();
      case "summary":
        return this.renderSummaryView();
      case "monthly":
        return this.renderMonthlyView();
      default:
        return "";
    }
  }

  renderExpenseList() {
    return `
      ${this.renderFilters()}
      ${this.renderActionButtons()}
      ${this.renderExpenseTable()}
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
            <label for="filter-category">${translate("category")}</label>
            <select id="filter-category">
              <option value="all" ${this.filters.category_id === 'all' ? 'selected' : ''}>${translate("all_categories")}</option>
              ${this.categories.map(cat => `
                <option value="${cat.id}" ${this.filters.category_id == cat.id ? 'selected' : ''}>
                  ${escapeHTML(cat.name)}
                </option>
              `).join("")}
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
    const canEdit = this.app.userRole === 'admin' || this.app.userRole === 'animation';
    
    if (!canEdit) {
      return '';
    }

    return `
      <div class="action-buttons">
        <button class="btn btn-primary" id="add-expense-btn">
          ${translate("add_expense")}
        </button>
        <button class="btn btn-secondary" id="bulk-add-expense-btn">
          ${translate("bulk_add_expenses")}
        </button>
        <button class="btn btn-secondary" id="export-expenses-btn">
          ${translate("export_csv")}
        </button>
      </div>
    `;
  }

  renderExpenseTable() {
    if (this.expenses.length === 0) {
      return `<div class="no-data"><p>${translate("no_expenses_found")}</p></div>`;
    }

    return `
      <div class="expense-list">
        <table class="data-table expense-table">
          <thead>
            <tr>
              <th>${translate("date")}</th>
              <th>${translate("category")}</th>
              <th>${translate("item")}</th>
              <th>${translate("description")}</th>
              <th class="text-right">${translate("amount")}</th>
              <th>${translate("payment_method")}</th>
              <th>${translate("reference")}</th>
              <th>${translate("actions")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.expenses.map(expense => this.renderExpenseRow(expense)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderExpenseRow(expense) {
    const canEdit = this.app.userRole === 'admin' || this.app.userRole === 'animation';
    const canDelete = this.app.userRole === 'admin';

    return `
      <tr data-expense-id="${expense.id}">
        <td>${formatDateShort(expense.expense_date)}</td>
        <td>${escapeHTML(expense.category_name || "-")}</td>
        <td class="text-small">${escapeHTML(expense.item_name || "-")}</td>
        <td>${escapeHTML(expense.description)}</td>
        <td class="text-right amount expense">${this.formatCurrency(expense.amount)}</td>
        <td class="text-small">${escapeHTML(expense.payment_method || "-")}</td>
        <td class="text-small">${escapeHTML(expense.reference_number || "-")}</td>
        <td class="actions-cell">
          ${canEdit ? `
            <button class="btn btn-sm btn-secondary edit-expense-btn" data-id="${expense.id}">
              ${translate("edit")}
            </button>
          ` : ''}
          ${canDelete ? `
            <button class="btn btn-sm btn-danger delete-expense-btn" data-id="${expense.id}">
              ${translate("delete")}
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }

  renderSummaryView() {
    if (!this.summary || !this.summary.summary || this.summary.summary.length === 0) {
      return `<div class="no-data"><p>${translate("no_data_available")}</p></div>`;
    }

    const summaryData = this.summary.summary;

    return `
      <div class="summary-view">
        <h2>${translate("expense_summary_by_category")}</h2>
        <table class="data-table summary-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("expense_count")}</th>
              <th class="text-right">${translate("total_amount")}</th>
              <th class="text-right">${translate("average_amount")}</th>
              <th>${translate("date_range")}</th>
            </tr>
          </thead>
          <tbody>
            ${summaryData.map(cat => `
              <tr>
                <td><strong>${escapeHTML(cat.category_name || translate("uncategorized"))}</strong></td>
                <td class="text-right">${cat.expense_count}</td>
                <td class="text-right amount expense">${this.formatCurrency(cat.total_amount)}</td>
                <td class="text-right amount">${this.formatCurrency(cat.average_amount)}</td>
                <td class="text-small">
                  ${formatDateShort(cat.first_expense_date)} - ${formatDateShort(cat.last_expense_date)}
                </td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr class="summary-total">
              <td><strong>${translate("total")}</strong></td>
              <td class="text-right"><strong>${this.summary.totals.expense_count}</strong></td>
              <td class="text-right amount expense"><strong>${this.formatCurrency(this.summary.totals.total_amount)}</strong></td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  renderMonthlyView() {
    if (!this.monthlyData || this.monthlyData.length === 0) {
      return `<div class="no-data"><p>${translate("no_data_available")}</p></div>`;
    }

    // Group by month
    const monthlyMap = new Map();
    this.monthlyData.forEach(item => {
      const monthKey = item.month;
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey,
          categories: [],
          total: 0
        });
      }
      const monthData = monthlyMap.get(monthKey);
      monthData.categories.push(item);
      monthData.total += item.total_amount;
    });

    const months = Array.from(monthlyMap.values()).sort((a, b) => 
      new Date(b.month) - new Date(a.month)
    );

    return `
      <div class="monthly-view">
        <h2>${translate("monthly_expense_breakdown")}</h2>
        ${months.map(monthData => this.renderMonthSection(monthData)).join("")}
      </div>
    `;
  }

  renderMonthSection(monthData) {
    const monthDate = new Date(monthData.month);
    const monthLabel = monthDate.toLocaleDateString(this.app.lang || "en", { 
      year: 'numeric', 
      month: 'long' 
    });

    return `
      <div class="month-section">
        <h3>${monthLabel}</h3>
        <table class="data-table month-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("expense_count")}</th>
              <th class="text-right">${translate("total_amount")}</th>
            </tr>
          </thead>
          <tbody>
            ${monthData.categories.map(cat => `
              <tr>
                <td>${escapeHTML(cat.category_name || translate("uncategorized"))}</td>
                <td class="text-right">${cat.expense_count}</td>
                <td class="text-right amount expense">${this.formatCurrency(cat.total_amount)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr class="summary-total">
              <td><strong>${translate("month_total")}</strong></td>
              <td class="text-right"><strong>${monthData.categories.reduce((sum, cat) => sum + cat.expense_count, 0)}</strong></td>
              <td class="text-right amount expense"><strong>${this.formatCurrency(monthData.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  attachEventListeners() {
    // Tab navigation
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        this.activeTab = e.target.dataset.tab;
        this.render();
        this.attachEventListeners();
      });
    });

    // Filter buttons
    const applyFiltersBtn = document.getElementById("apply-filters-btn");
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener("click", () => this.applyFilters());
    }

    const resetFiltersBtn = document.getElementById("reset-filters-btn");
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () => this.resetFilters());
    }

    // Action buttons
    const addExpenseBtn = document.getElementById("add-expense-btn");
    if (addExpenseBtn) {
      addExpenseBtn.addEventListener("click", () => this.showExpenseModal());
    }

    const bulkAddExpenseBtn = document.getElementById("bulk-add-expense-btn");
    if (bulkAddExpenseBtn) {
      bulkAddExpenseBtn.addEventListener("click", () => this.showBulkExpenseModal());
    }

    const exportExpensesBtn = document.getElementById("export-expenses-btn");
    if (exportExpensesBtn) {
      exportExpensesBtn.addEventListener("click", () => this.exportToCSV());
    }

    // Edit buttons
    document.querySelectorAll(".edit-expense-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const expense = this.expenses.find(exp => exp.id === id);
        if (expense) {
          this.showExpenseModal(expense);
        }
      });
    });

    // Delete buttons
    document.querySelectorAll(".delete-expense-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_expense"))) {
          await this.deleteExpense(id);
        }
      });
    });
  }

  async applyFilters() {
    this.filters.start_date = document.getElementById("filter-start-date").value;
    this.filters.end_date = document.getElementById("filter-end-date").value;
    this.filters.category_id = document.getElementById("filter-category").value;

    await Promise.all([
      this.loadExpenses(),
      this.loadSummary(),
      this.loadMonthlyData()
    ]);
    this.render();
    this.attachEventListeners();
  }

  async resetFilters() {
    this.filters = {
      start_date: this.fiscalYear.start,
      end_date: this.fiscalYear.end,
      category_id: 'all'
    };

    await Promise.all([
      this.loadExpenses(),
      this.loadSummary(),
      this.loadMonthlyData()
    ]);
    this.render();
    this.attachEventListeners();
  }

  showExpenseModal(expense = null) {
    const isEdit = !!expense;
    const modalHTML = `
      <div class="modal-overlay" id="expense-modal">
        <div class="modal-content modal-large">
          <div class="modal-header">
            <h3>${isEdit ? translate("edit_expense") : translate("add_expense")}</h3>
            <button class="modal-close" id="close-expense-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="expense-form">
              <div class="form-row">
                <div class="form-group">
                  <label for="expense-date">${translate("date")}*</label>
                  <input type="date" id="expense-date" required
                         value="${expense ? expense.expense_date : getTodayISO()}">
                </div>

                <div class="form-group">
                  <label for="expense-category">${translate("category")}</label>
                  <select id="expense-category">
                    <option value="">${translate("uncategorized")}</option>
                    ${this.categories.map(cat => `
                      <option value="${cat.id}" ${expense?.budget_category_id === cat.id ? "selected" : ""}>
                        ${escapeHTML(cat.name)}
                      </option>
                    `).join("")}
                  </select>
                </div>

                <div class="form-group">
                  <label for="expense-item">${translate("budget_item")}</label>
                  <select id="expense-item">
                    <option value="">${translate("select_item")}</option>
                    ${this.items.map(item => `
                      <option value="${item.id}" ${expense?.budget_item_id === item.id ? "selected" : ""}>
                        ${escapeHTML(item.name)}
                      </option>
                    `).join("")}
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label for="expense-description">${translate("description")}*</label>
                <input type="text" id="expense-description" required
                       value="${expense ? escapeHTML(expense.description) : ""}"
                       placeholder="${translate("enter_expense_description")}">
              </div>

              <div class="tax-calculator-section">
                <h4>${translate("amount_and_taxes")}</h4>
                <div class="form-row">
                  <div class="form-group">
                    <label for="expense-subtotal">${translate("subtotal_before_tax")}</label>
                    <input type="number" id="expense-subtotal" step="0.01" min="0"
                           value="${expense ? expense.amount : ""}"
                           placeholder="0.00">
                  </div>
                  <div class="form-group">
                    <button type="button" class="btn btn-secondary" id="calculate-taxes-btn">
                      ${translate("calculate_taxes")}
                    </button>
                  </div>
                </div>
                <div id="tax-breakdown" class="tax-breakdown" style="display: none;">
                  <p><strong>${translate("gst")} (5%):</strong> <span id="tax-gst">$0.00</span></p>
                  <p><strong>${translate("qst")} (9.975%):</strong> <span id="tax-qst">$0.00</span></p>
                  <p><strong>${translate("total_with_taxes")}:</strong> <span id="tax-total">$0.00</span></p>
                </div>
              </div>

              <div class="form-group">
                <label for="expense-amount">${translate("final_amount")}*</label>
                <input type="number" id="expense-amount" step="0.01" min="0" required
                       value="${expense ? expense.amount : ""}"
                       placeholder="0.00">
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="expense-payment-method">${translate("payment_method")}</label>
                  <input type="text" id="expense-payment-method"
                         value="${expense ? escapeHTML(expense.payment_method || "") : ""}"
                         placeholder="${translate("cash_check_card")}">
                </div>

                <div class="form-group">
                  <label for="expense-reference">${translate("reference_number")}</label>
                  <input type="text" id="expense-reference"
                         value="${expense ? escapeHTML(expense.reference_number || "") : ""}"
                         placeholder="${translate("invoice_check_number")}">
                </div>
              </div>

              <div class="form-group">
                <label for="expense-receipt-url">${translate("receipt_url")}</label>
                <input type="url" id="expense-receipt-url"
                       value="${expense ? escapeHTML(expense.receipt_url || "") : ""}"
                       placeholder="https://">
              </div>

              <div class="form-group">
                <label for="expense-notes">${translate("notes")}</label>
                <textarea id="expense-notes" rows="3">${expense ? escapeHTML(expense.notes || "") : ""}</textarea>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-expense-btn">
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

    // Tax calculator
    document.getElementById("calculate-taxes-btn").addEventListener("click", () => {
      const subtotal = parseFloat(document.getElementById("expense-subtotal").value) || 0;
      const taxes = this.calculateTaxes(subtotal);
      
      document.getElementById("tax-gst").textContent = this.formatCurrency(taxes.gst);
      document.getElementById("tax-qst").textContent = this.formatCurrency(taxes.qst);
      document.getElementById("tax-total").textContent = this.formatCurrency(taxes.total);
      document.getElementById("tax-breakdown").style.display = "block";
      document.getElementById("expense-amount").value = taxes.total.toFixed(2);
    });

    document.getElementById("close-expense-modal").addEventListener("click", () => {
      document.getElementById("expense-modal").remove();
    });

    document.getElementById("cancel-expense-btn").addEventListener("click", () => {
      document.getElementById("expense-modal").remove();
    });

    document.getElementById("expense-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveExpense(expense?.id);
    });
  }

  showBulkExpenseModal() {
    const modalHTML = `
      <div class="modal-overlay" id="bulk-expense-modal">
        <div class="modal-content modal-large">
          <div class="modal-header">
            <h3>${translate("bulk_add_expenses")}</h3>
            <button class="modal-close" id="close-bulk-modal">&times;</button>
          </div>
          <div class="modal-body">
            <p class="info-text">${translate("bulk_expense_info")}</p>
            <form id="bulk-expense-form">
              <div id="bulk-expense-rows">
                ${this.renderBulkExpenseRow(0)}
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="add-bulk-row-btn">
                  ${translate("add_row")}
                </button>
                <button type="button" class="btn btn-secondary" id="cancel-bulk-btn">
                  ${translate("cancel")}
                </button>
                <button type="submit" class="btn btn-primary">
                  ${translate("create_all")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);

    let rowCount = 1;

    document.getElementById("add-bulk-row-btn").addEventListener("click", () => {
      const container = document.getElementById("bulk-expense-rows");
      container.insertAdjacentHTML("beforeend", this.renderBulkExpenseRow(rowCount));
      rowCount++;
    });

    document.getElementById("close-bulk-modal").addEventListener("click", () => {
      document.getElementById("bulk-expense-modal").remove();
    });

    document.getElementById("cancel-bulk-btn").addEventListener("click", () => {
      document.getElementById("bulk-expense-modal").remove();
    });

    document.getElementById("bulk-expense-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveBulkExpenses();
    });
  }

  renderBulkExpenseRow(index) {
    return `
      <div class="bulk-expense-row" data-row="${index}">
        <div class="form-row">
          <div class="form-group form-group-sm">
            <input type="date" class="bulk-date" required value="${getTodayISO()}">
          </div>
          <div class="form-group form-group-sm">
            <select class="bulk-category">
              <option value="">${translate("category")}</option>
              ${this.categories.map(cat => `
                <option value="${cat.id}">${escapeHTML(cat.name)}</option>
              `).join("")}
            </select>
          </div>
          <div class="form-group">
            <input type="text" class="bulk-description" required placeholder="${translate("description")}">
          </div>
          <div class="form-group form-group-sm">
            <input type="number" class="bulk-amount" step="0.01" min="0" required placeholder="${translate("amount")}">
          </div>
          <div class="form-group form-group-sm">
            <input type="text" class="bulk-reference" placeholder="${translate("reference")}">
          </div>
          <button type="button" class="btn btn-sm btn-danger remove-bulk-row-btn" data-row="${index}">✕</button>
        </div>
      </div>
    `;
  }

  async saveExpense(expenseId = null) {
    const expenseDate = document.getElementById("expense-date").value;
    const categoryId = document.getElementById("expense-category").value || null;
    const itemId = document.getElementById("expense-item").value || null;
    const description = document.getElementById("expense-description").value;
    const amount = parseFloat(document.getElementById("expense-amount").value);
    const paymentMethod = document.getElementById("expense-payment-method").value;
    const referenceNumber = document.getElementById("expense-reference").value;
    const receiptUrl = document.getElementById("expense-receipt-url").value;
    const notes = document.getElementById("expense-notes").value;

    try {
      const payload = {
        expense_date: expenseDate,
        budget_category_id: categoryId,
        budget_item_id: itemId,
        description,
        amount,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        receipt_url: receiptUrl,
        notes
      };

      if (expenseId) {
        await updateBudgetExpense(expenseId, payload);
        this.app.showMessage(translate("expense_updated"), "success");
      } else {
        await createBudgetExpense(payload);
        this.app.showMessage(translate("expense_created"), "success");
      }

      document.getElementById("expense-modal").remove();
      await Promise.all([
        this.loadExpenses(),
        this.loadSummary(),
        this.loadMonthlyData()
      ]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving expense", error);
      this.app.showMessage(translate("error_saving_expense"), "error");
    }
  }

  async saveBulkExpenses() {
    const rows = document.querySelectorAll(".bulk-expense-row");
    const expenses = [];

    rows.forEach(row => {
      const date = row.querySelector(".bulk-date").value;
      const categoryId = row.querySelector(".bulk-category").value || null;
      const description = row.querySelector(".bulk-description").value;
      const amount = parseFloat(row.querySelector(".bulk-amount").value);
      const reference = row.querySelector(".bulk-reference").value;

      if (date && description && amount) {
        expenses.push({
          expense_date: date,
          budget_category_id: categoryId,
          budget_item_id: null,
          description,
          amount,
          payment_method: null,
          reference_number: reference,
          receipt_url: null,
          notes: null
        });
      }
    });

    if (expenses.length === 0) {
      this.app.showMessage(translate("no_expenses_to_create"), "warning");
      return;
    }

    try {
      await createExpensesBulk(expenses);
      this.app.showMessage(translate("bulk_expenses_created", { count: expenses.length }), "success");
      
      document.getElementById("bulk-expense-modal").remove();
      await Promise.all([
        this.loadExpenses(),
        this.loadSummary(),
        this.loadMonthlyData()
      ]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error creating bulk expenses", error);
      this.app.showMessage(translate("error_creating_bulk_expenses"), "error");
    }
  }

  async deleteExpense(expenseId) {
    try {
      await deleteBudgetExpense(expenseId);
      this.app.showMessage(translate("expense_deleted"), "success");
      await Promise.all([
        this.loadExpenses(),
        this.loadSummary(),
        this.loadMonthlyData()
      ]);
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error deleting expense", error);
      this.app.showMessage(translate("error_deleting_expense"), "error");
    }
  }

  exportToCSV() {
    if (this.expenses.length === 0) {
      this.app.showMessage(translate("no_data_to_export"), "warning");
      return;
    }

    // Build CSV content
    const headers = [
      translate("date"),
      translate("category"),
      translate("item"),
      translate("description"),
      translate("amount"),
      translate("payment_method"),
      translate("reference"),
      translate("notes")
    ];

    const rows = this.expenses.map(expense => [
      expense.expense_date,
      expense.category_name || "-",
      expense.item_name || "-",
      expense.description,
      expense.amount,
      expense.payment_method || "-",
      expense.reference_number || "-",
      expense.notes || ""
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    // Download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `expenses_${getTodayISO()}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.app.showMessage(translate("export_successful"), "success");
  }
}

export default Expenses;
