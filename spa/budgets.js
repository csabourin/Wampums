import {
  getBudgetCategories,
  createBudgetCategory,
  updateBudgetCategory,
  deleteBudgetCategory,
  getBudgetItems,
  createBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  getBudgetExpenses,
  createBudgetExpense,
  updateBudgetExpense,
  deleteBudgetExpense,
  getBudgetSummaryReport,
  getBudgetRevenueBreakdown
} from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";

const DEFAULT_CURRENCY = "CAD";

/**
 * Budget Management Module
 * Provides categorized expense tracking and comprehensive revenue/expense reporting
 * Integrates with existing payment and fundraiser systems
 */
export class Budgets {
  constructor(app) {
    this.app = app;
    this.categories = [];
    this.items = [];
    this.expenses = [];
    this.summaryReport = null;
    this.activeTab = "overview";
    this.fiscalYear = this.getCurrentFiscalYear();
  }

  /**
   * Calculate current fiscal year (Sept 1 - Aug 31)
   */
  getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    if (month >= 8) { // September or later (month 8 = September)
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
    this.setActiveTabFromQuery();
    try {
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Unable to initialize budgets page", error);
      this.app.showMessage(translate("error_loading_data"), "error");
    }
  }

  setActiveTabFromQuery() {
    try {
      const url = new URL(window.location.href);
      this.activeTab = url.searchParams.get("tab") || "overview";
    } catch (error) {
      this.activeTab = "overview";
    }
  }

  async loadCoreData() {
    debugLog("Loading budget data...");
    const [categories, items, expenses, summary] = await Promise.all([
      getBudgetCategories(),
      getBudgetItems(),
      getBudgetExpenses({
        start_date: this.fiscalYear.start,
        end_date: this.fiscalYear.end
      }),
      getBudgetSummaryReport(this.fiscalYear.start, this.fiscalYear.end)
    ]);

    this.categories = categories?.data || [];
    this.items = items?.data || [];
    this.expenses = expenses?.data || [];
    this.summaryReport = summary?.data || null;

    debugLog(`Loaded ${this.categories.length} categories, ${this.expenses.length} expenses`);
  }

  formatCurrency(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat(this.app.lang || "en", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2
    }).format(value);
  }

  render() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container budgets-page">
        <div class="page-header">
          <h1>${translate("budget_management")}</h1>
          <div class="fiscal-year-display">
            <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
          </div>
        </div>

        ${this.renderSummaryCards()}

        <div class="tab-navigation">
          <button class="tab-btn ${this.activeTab === "overview" ? "active" : ""}"
                  data-tab="overview">
            ${translate("overview")}
          </button>
          <button class="tab-btn ${this.activeTab === "categories" ? "active" : ""}"
                  data-tab="categories">
            ${translate("categories")}
          </button>
          <button class="tab-btn ${this.activeTab === "expenses" ? "active" : ""}"
                  data-tab="expenses">
            ${translate("expenses")}
          </button>
          <button class="tab-btn ${this.activeTab === "reports" ? "active" : ""}"
                  data-tab="reports">
            ${translate("reports")}
          </button>
        </div>

        <div class="tab-content">
          ${this.renderTabContent()}
        </div>
      </div>
    `;
  }

  renderSummaryCards() {
    if (!this.summaryReport) {
      return "";
    }

    const totals = this.summaryReport.totals || {};
    const totalRevenue = totals.total_revenue || 0;
    const totalExpense = totals.total_expense || 0;
    const netAmount = totals.net_amount || (totalRevenue - totalExpense);

    return `
      <div class="summary-cards">
        <div class="summary-card revenue-card">
          <div class="card-icon">💰</div>
          <div class="card-content">
            <div class="card-label">${translate("total_revenue")}</div>
            <div class="card-value">${this.formatCurrency(totalRevenue)}</div>
          </div>
        </div>

        <div class="summary-card expense-card">
          <div class="card-icon">📊</div>
          <div class="card-content">
            <div class="card-label">${translate("total_expenses")}</div>
            <div class="card-value">${this.formatCurrency(totalExpense)}</div>
          </div>
        </div>

        <div class="summary-card net-card ${netAmount >= 0 ? "positive" : "negative"}">
          <div class="card-icon">${netAmount >= 0 ? "✅" : "⚠️"}</div>
          <div class="card-content">
            <div class="card-label">${translate("net_position")}</div>
            <div class="card-value">${this.formatCurrency(netAmount)}</div>
          </div>
        </div>
      </div>
    `;
  }

  renderTabContent() {
    switch (this.activeTab) {
      case "overview":
        return this.renderOverview();
      case "categories":
        return this.renderCategories();
      case "expenses":
        return this.renderExpenses();
      case "reports":
        return this.renderReports();
      default:
        return "";
    }
  }

  renderOverview() {
    if (!this.summaryReport || !this.summaryReport.categories) {
      return `<p class="no-data">${translate("no_budget_data")}</p>`;
    }

    const categories = this.summaryReport.categories;

    return `
      <div class="overview-content">
        <h2>${translate("category_breakdown")}</h2>
        <table class="data-table budget-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("revenue")}</th>
              <th class="text-right">${translate("expenses")}</th>
              <th class="text-right">${translate("net")}</th>
            </tr>
          </thead>
          <tbody>
            ${categories.map(cat => `
              <tr>
                <td><strong>${escapeHTML(cat.category_name || translate("uncategorized"))}</strong></td>
                <td class="text-right amount revenue">${this.formatCurrency(cat.total_revenue)}</td>
                <td class="text-right amount expense">${this.formatCurrency(cat.total_expense)}</td>
                <td class="text-right amount ${cat.net_amount >= 0 ? "positive" : "negative"}">
                  ${this.formatCurrency(cat.net_amount)}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderCategories() {
    return `
      <div class="categories-content">
        <div class="section-header">
          <h2>${translate("budget_categories")}</h2>
          <button class="btn btn-primary" id="add-category-btn">
            ${translate("add_category")}
          </button>
        </div>

        <div class="categories-grid">
          ${this.categories.length === 0 ?
            `<p class="no-data">${translate("no_categories_found")}</p>` :
            this.categories.map(cat => `
              <div class="category-card" data-category-id="${cat.id}">
                <div class="category-header">
                  <h3>${escapeHTML(cat.name)}</h3>
                  <span class="item-count">${cat.item_count || 0} ${translate("items")}</span>
                </div>
                ${cat.description ? `<p class="category-description">${escapeHTML(cat.description)}</p>` : ""}
                <div class="category-actions">
                  <button class="btn btn-sm btn-secondary edit-category-btn" data-id="${cat.id}">
                    ${translate("edit")}
                  </button>
                  <button class="btn btn-sm btn-danger delete-category-btn" data-id="${cat.id}">
                    ${translate("delete")}
                  </button>
                </div>
              </div>
            `).join("")
          }
        </div>
      </div>
    `;
  }

  renderExpenses() {
    return `
      <div class="expenses-content">
        <div class="section-header">
          <h2>${translate("expenses")}</h2>
          <button class="btn btn-primary" id="add-expense-btn">
            ${translate("add_expense")}
          </button>
        </div>

        <table class="data-table expenses-table">
          <thead>
            <tr>
              <th>${translate("date")}</th>
              <th>${translate("category")}</th>
              <th>${translate("description")}</th>
              <th class="text-right">${translate("amount")}</th>
              <th>${translate("actions")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.expenses.length === 0 ?
              `<tr><td colspan="5" class="text-center">${translate("no_expenses_found")}</td></tr>` :
              this.expenses.map(expense => `
                <tr data-expense-id="${expense.id}">
                  <td>${formatDateShort(expense.expense_date)}</td>
                  <td>${escapeHTML(expense.category_name || "-")}</td>
                  <td>${escapeHTML(expense.description)}</td>
                  <td class="text-right amount expense">${this.formatCurrency(expense.amount)}</td>
                  <td>
                    <button class="btn btn-sm btn-secondary edit-expense-btn" data-id="${expense.id}">
                      ${translate("edit")}
                    </button>
                    <button class="btn btn-sm btn-danger delete-expense-btn" data-id="${expense.id}">
                      ${translate("delete")}
                    </button>
                  </td>
                </tr>
              `).join("")
            }
          </tbody>
        </table>
      </div>
    `;
  }

  renderReports() {
    return `
      <div class="reports-content">
        <h2>${translate("budget_reports")}</h2>
        <p>${translate("detailed_reports_coming_soon")}</p>
      </div>
    `;
  }

  attachEventListeners() {
    // Tab navigation
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        this.activeTab = e.target.dataset.tab;
        this.updateURL();
        this.render();
        this.attachEventListeners();
      });
    });

    // Add category button
    const addCategoryBtn = document.getElementById("add-category-btn");
    if (addCategoryBtn) {
      addCategoryBtn.addEventListener("click", () => this.showCategoryModal());
    }

    // Edit category buttons
    document.querySelectorAll(".edit-category-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const category = this.categories.find(c => c.id === id);
        if (category) {
          this.showCategoryModal(category);
        }
      });
    });

    // Delete category buttons
    document.querySelectorAll(".delete-category-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_category"))) {
          await this.deleteCategory(id);
        }
      });
    });

    // Add expense button
    const addExpenseBtn = document.getElementById("add-expense-btn");
    if (addExpenseBtn) {
      addExpenseBtn.addEventListener("click", () => this.showExpenseModal());
    }

    // Edit expense buttons
    document.querySelectorAll(".edit-expense-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const expense = this.expenses.find(ex => ex.id === id);
        if (expense) {
          this.showExpenseModal(expense);
        }
      });
    });

    // Delete expense buttons
    document.querySelectorAll(".delete-expense-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_expense"))) {
          await this.deleteExpense(id);
        }
      });
    });
  }

  updateURL() {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", this.activeTab);
    window.history.pushState({}, "", url);
  }

  showCategoryModal(category = null) {
    const isEdit = !!category;
    const modalHTML = `
      <div class="modal-overlay" id="category-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${isEdit ? translate("edit_category") : translate("add_category")}</h3>
            <button class="modal-close" id="close-category-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="category-form">
              <div class="form-group">
                <label for="category-name">${translate("category_name")}*</label>
                <input type="text" id="category-name" required
                       value="${category ? escapeHTML(category.name) : ""}">
              </div>
              <div class="form-group">
                <label for="category-description">${translate("description")}</label>
                <textarea id="category-description" rows="3">${category ? escapeHTML(category.description || "") : ""}</textarea>
              </div>
              <div class="form-group">
                <label for="category-type">${translate("category_type")}</label>
                <select id="category-type">
                  <option value="registration" ${category?.category_type === "registration" ? "selected" : ""}>${translate("registration")}</option>
                  <option value="fundraising" ${category?.category_type === "fundraising" ? "selected" : ""}>${translate("fundraising")}</option>
                  <option value="activity" ${category?.category_type === "activity" ? "selected" : ""}>${translate("activity")}</option>
                  <option value="operations" ${category?.category_type === "operations" ? "selected" : ""}>${translate("operations")}</option>
                  <option value="other" ${category?.category_type === "other" ? "selected" : ""}>${translate("other")}</option>
                </select>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-category-btn">
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

    document.getElementById("close-category-modal").addEventListener("click", () => {
      document.getElementById("category-modal").remove();
    });

    document.getElementById("cancel-category-btn").addEventListener("click", () => {
      document.getElementById("category-modal").remove();
    });

    document.getElementById("category-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveCategory(category?.id);
    });
  }

  async saveCategory(categoryId = null) {
    const name = document.getElementById("category-name").value;
    const description = document.getElementById("category-description").value;
    const categoryType = document.getElementById("category-type").value;

    try {
      const payload = { name, description, category_type: categoryType };

      if (categoryId) {
        await updateBudgetCategory(categoryId, payload);
        this.app.showMessage(translate("category_updated"), "success");
      } else {
        await createBudgetCategory(payload);
        this.app.showMessage(translate("category_created"), "success");
      }

      document.getElementById("category-modal").remove();
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving category", error);
      this.app.showMessage(translate("error_saving_category"), "error");
    }
  }

  async deleteCategory(categoryId) {
    try {
      await deleteBudgetCategory(categoryId);
      this.app.showMessage(translate("category_deleted"), "success");
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error deleting category", error);
      this.app.showMessage(translate("error_deleting_category"), "error");
    }
  }

  showExpenseModal(expense = null) {
    const isEdit = !!expense;
    const modalHTML = `
      <div class="modal-overlay" id="expense-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${isEdit ? translate("edit_expense") : translate("add_expense")}</h3>
            <button class="modal-close" id="close-expense-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="expense-form">
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
                <label for="expense-amount">${translate("amount")}*</label>
                <input type="number" id="expense-amount" step="0.01" min="0" required
                       value="${expense ? expense.amount : ""}">
              </div>
              <div class="form-group">
                <label for="expense-date">${translate("date")}*</label>
                <input type="date" id="expense-date" required
                       value="${expense ? expense.expense_date : getTodayISO()}">
              </div>
              <div class="form-group">
                <label for="expense-description">${translate("description")}*</label>
                <textarea id="expense-description" rows="3" required>${expense ? escapeHTML(expense.description) : ""}</textarea>
              </div>
              <div class="form-group">
                <label for="expense-payment-method">${translate("payment_method")}</label>
                <input type="text" id="expense-payment-method"
                       value="${expense ? escapeHTML(expense.payment_method || "") : ""}">
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

  async saveExpense(expenseId = null) {
    const categoryId = document.getElementById("expense-category").value || null;
    const amount = parseFloat(document.getElementById("expense-amount").value);
    const date = document.getElementById("expense-date").value;
    const description = document.getElementById("expense-description").value;
    const paymentMethod = document.getElementById("expense-payment-method").value;

    try {
      const payload = {
        budget_category_id: categoryId,
        amount,
        expense_date: date,
        description,
        payment_method: paymentMethod
      };

      if (expenseId) {
        await updateBudgetExpense(expenseId, payload);
        this.app.showMessage(translate("expense_updated"), "success");
      } else {
        await createBudgetExpense(payload);
        this.app.showMessage(translate("expense_created"), "success");
      }

      document.getElementById("expense-modal").remove();
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving expense", error);
      this.app.showMessage(translate("error_saving_expense"), "error");
    }
  }

  async deleteExpense(expenseId) {
    try {
      await deleteBudgetExpense(expenseId);
      this.app.showMessage(translate("expense_deleted"), "success");
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error deleting expense", error);
      this.app.showMessage(translate("error_deleting_expense"), "error");
    }
  }
}

export default Budgets;
