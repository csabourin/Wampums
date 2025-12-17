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
  getBudgetRevenueBreakdown,
  getBudgetPlans,
  createBudgetPlan,
  updateBudgetPlan,
  deleteBudgetPlan,
} from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";
import { LoadingStateManager, retryWithBackoff } from "./utils/PerformanceUtils.js";
import { validateMoney, validateRequired } from "./utils/ValidationUtils.js";

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
    this.revenueBreakdown = null;
    this.budgetPlans = [];
    this.activeTab = "overview";
    this.fiscalYear = this.getCurrentFiscalYear();
    this.revenueFilters = {
      source: "all",
      category: "all",
    };

    // Loading state management
    this.loadingManager = new LoadingStateManager();
    this.isInitializing = false;
  }

  /**
   * Calculate current fiscal year (Sept 1 - Aug 31)
   */
  getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    if (month >= 8) {
      // September or later (month 8 = September)
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
      debugError("Budgets init already in progress, skipping duplicate call");
      return;
    }

    this.isInitializing = true;
    this.setActiveTabFromQuery();

    try {
      // Render loading state immediately
      this.renderLoading();

      await this.loadCoreData();

      // Render with data
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error loading budgets data:", error);
      // Render error state but allow partial functionality
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate("error_loading_data"), "warning");
    } finally {
      this.isInitializing = false;
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
    return this.loadingManager.withLoading('core-data', async () => {
      debugLog("Loading budget data...");
      // Load data with individual error handling and retry logic
      const [categories, items, expenses, summary, plans] = await Promise.all([
        retryWithBackoff(
          () => getBudgetCategories(),
          {
            maxRetries: 2,
            onRetry: (attempt, max, delay) => {
              debugLog(`Retrying budget categories (${attempt}/${max}) in ${delay}ms`);
            }
          }
        ).catch(error => {
          debugError("Error loading budget categories:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getBudgetItems(),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading budget items:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getBudgetExpenses({
            start_date: this.fiscalYear.start,
            end_date: this.fiscalYear.end,
          }),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading budget expenses:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getBudgetSummaryReport(this.fiscalYear.start, this.fiscalYear.end),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading budget summary:", error);
          return { data: null };
        }),
        retryWithBackoff(
          () => getBudgetPlans(this.fiscalYear.start, this.fiscalYear.end),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading budget plans:", error);
          return { data: [] };
        }),
      ]);

      this.categories = categories?.data || [];
      this.items = items?.data || [];
      this.expenses = expenses?.data || [];
      this.summaryReport = summary?.data || null;
      this.budgetPlans = plans?.data || [];

      debugLog(
        `Loaded ${this.categories.length} categories, ${this.expenses.length} expenses, ${this.budgetPlans.length} plans`,
      );
    });
  }

  formatCurrency(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat(this.app.lang || "en", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value);
  }

  renderLoading() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container budget-page">
        <div class="page-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div class="page-header-content">
            <h1>${translate("budget_management")}</h1>
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

    const tabContent = await this.renderTabContent();

    container.innerHTML = `
      <div class="page-container budgets-page">
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
        <div class="page-header">
          <div class="page-header-content">
            <h1>${translate("budget_management")}</h1>
            <div class="fiscal-year-display">
              <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
            </div>
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
          <button class="tab-btn ${this.activeTab === "planning" ? "active" : ""}"
                  data-tab="planning">
            ${translate("planning")}
          </button>
          <button class="tab-btn ${this.activeTab === "reports" ? "active" : ""}"
                  data-tab="reports">
            ${translate("reports")}
          </button>
        </div>

        <div class="tab-content active">
          ${tabContent}
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
    const netAmount = totals.net_amount || totalRevenue - totalExpense;

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

  async renderTabContent() {
    switch (this.activeTab) {
      case "overview":
        return this.renderOverview();
      case "categories":
        return this.renderCategories();
      case "expenses":
        return this.renderExpenses();
      case "planning":
        return this.renderPlanning();
      case "reports":
        return await this.renderReports();
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
            ${categories
              .map(
                (cat) => `
              <tr>
                <td><strong>${escapeHTML(cat.category_name || translate("uncategorized"))}</strong></td>
                <td class="text-right amount revenue">${this.formatCurrency(cat.total_revenue)}</td>
                <td class="text-right amount expense">${this.formatCurrency(cat.total_expense)}</td>
                <td class="text-right amount ${cat.net_amount >= 0 ? "positive" : "negative"}">
                  ${this.formatCurrency(cat.net_amount)}
                </td>
              </tr>
            `,
              )
              .join("")}
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
          ${
            this.categories.length === 0
              ? `<p class="no-data">${translate("no_categories_found")}</p>`
              : this.categories
                  .map(
                    (cat) => `
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
            `,
                  )
                  .join("")
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
            ${
              this.expenses.length === 0
                ? `<tr><td colspan="5" class="text-center">${translate("no_expenses_found")}</td></tr>`
                : this.expenses
                    .map(
                      (expense) => `
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
              `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    `;
  }

  renderPlanning() {
    return `
      <div class="planning-content">
        <div class="section-header">
          <h2>${translate("budget_planning")}</h2>
          <button class="btn btn-primary" id="add-plan-btn">
            ${translate("add_budget_plan")}
          </button>
        </div>

        <div class="planning-info">
          <p>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></p>
        </div>

        <div id="plans-list">
          ${this.renderPlansList()}
        </div>

        ${this.renderBudgetVsActual()}
      </div>
    `;
  }

  renderPlansList() {
    if (!this.budgetPlans || this.budgetPlans.length === 0) {
      return `<p class="no-data">${translate("no_budget_plans")}</p>`;
    }

    return `
      <table class="data-table plans-table">
        <thead>
          <tr>
            <th>${translate("budget_item")}</th>
            <th>${translate("category")}</th>
            <th class="text-right">${translate("budgeted_revenue")}</th>
            <th class="text-right">${translate("budgeted_expense")}</th>
            <th>${translate("notes")}</th>
            <th>${translate("actions")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.budgetPlans
            .map(
              (plan) => `
            <tr data-plan-id="${plan.id}">
              <td>${escapeHTML(plan.item_name || "-")}</td>
              <td>${escapeHTML(plan.category_name || "-")}</td>
              <td class="text-right amount revenue">${this.formatCurrency(plan.budgeted_revenue)}</td>
              <td class="text-right amount expense">${this.formatCurrency(plan.budgeted_expense)}</td>
              <td class="notes-cell">${escapeHTML(plan.notes || "")}</td>
              <td>
                <button class="btn btn-sm btn-secondary edit-plan-btn" data-id="${plan.id}">
                  ${translate("edit")}
                </button>
                <button class="btn btn-sm btn-danger delete-plan-btn" data-id="${plan.id}">
                  ${translate("delete")}
                </button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  renderBudgetVsActual() {
    if (
      !this.budgetPlans ||
      this.budgetPlans.length === 0 ||
      !this.summaryReport
    ) {
      return "";
    }

    const totals = this.summaryReport.totals || {};
    const actualRevenue = totals.total_revenue || 0;
    const actualExpense = totals.total_expense || 0;

    const plannedRevenue = this.budgetPlans.reduce(
      (sum, plan) => sum + (parseFloat(plan.budgeted_revenue) || 0),
      0,
    );
    const plannedExpense = this.budgetPlans.reduce(
      (sum, plan) => sum + (parseFloat(plan.budgeted_expense) || 0),
      0,
    );

    const revenueVariance = actualRevenue - plannedRevenue;
    const expenseVariance = actualExpense - plannedExpense;
    const revenueVariancePct =
      plannedRevenue > 0 ? (revenueVariance / plannedRevenue) * 100 : 0;
    const expenseVariancePct =
      plannedExpense > 0 ? (expenseVariance / plannedExpense) * 100 : 0;

    return `
      <div class="budget-vs-actual">
        <h3>${translate("budget_vs_actual")}</h3>
        <table class="data-table comparison-table">
          <thead>
            <tr>
              <th></th>
              <th class="text-right">${translate("planned_budget")}</th>
              <th class="text-right">${translate("actual_amount")}</th>
              <th class="text-right">${translate("variance")}</th>
              <th class="text-right">${translate("variance_percentage")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>${translate("revenue")}</strong></td>
              <td class="text-right amount">${this.formatCurrency(plannedRevenue)}</td>
              <td class="text-right amount revenue">${this.formatCurrency(actualRevenue)}</td>
              <td class="text-right amount ${revenueVariance >= 0 ? "positive" : "negative"}">
                ${this.formatCurrency(revenueVariance)}
              </td>
              <td class="text-right ${revenueVariance >= 0 ? "positive" : "negative"}">
                ${revenueVariancePct.toFixed(1)}%
              </td>
            </tr>
            <tr>
              <td><strong>${translate("expenses")}</strong></td>
              <td class="text-right amount">${this.formatCurrency(plannedExpense)}</td>
              <td class="text-right amount expense">${this.formatCurrency(actualExpense)}</td>
              <td class="text-right amount ${expenseVariance <= 0 ? "positive" : "negative"}">
                ${this.formatCurrency(Math.abs(expenseVariance))} ${expenseVariance > 0 ? translate("over_budget") : translate("under_budget")}
              </td>
              <td class="text-right ${expenseVariance <= 0 ? "positive" : "negative"}">
                ${Math.abs(expenseVariancePct).toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  async renderReports() {
    // Load revenue breakdown data first since it's async
    await this.loadRevenueBreakdown();

    return `
      <div class="reports-content">
        <div class="report-section">
          ${this.renderProfitLossStatement()}
        </div>
        
        <div class="report-section">
          ${this.renderCategoryTrends()}
        </div>
        
        <div class="report-section">
          ${this.renderRevenueBreakdownContent()}
        </div>
      </div>
    `;
  }

  async loadRevenueBreakdown() {
    // Load revenue breakdown data with filters
    try {
      const categoryId =
        this.revenueFilters.category && this.revenueFilters.category !== "all"
          ? this.revenueFilters.category
          : null;

      const revenueSource =
        this.revenueFilters.source && this.revenueFilters.source !== "all"
          ? this.revenueFilters.source
          : null;

      const response = await getBudgetRevenueBreakdown(
        this.fiscalYear.start,
        this.fiscalYear.end,
        categoryId,
        revenueSource,
      );

      // Handle new response format with breakdown and summary
      const data = response?.data;
      this.revenueBreakdown = data?.breakdown || data || [];
      this.revenueBreakdownSummary = data?.summary || null;
    } catch (error) {
      debugError("Error loading revenue breakdown", error);
      this.revenueBreakdown = [];
      this.revenueBreakdownSummary = null;
    }
  }

  renderProfitLossStatement() {
    if (!this.summaryReport || !this.summaryReport.categories) {
      return `<p class="no-data">${translate("no_budget_data")}</p>`;
    }

    const categories = this.summaryReport.categories;
    const totals = this.summaryReport.totals || {};

    // Separate revenue and expense categories
    const revenueCategories = categories.filter((cat) => cat.total_revenue > 0);
    const expenseCategories = categories.filter((cat) => cat.total_expense > 0);

    const totalRevenue = totals.total_revenue || 0;
    const totalExpense = totals.total_expense || 0;
    const netAmount = totalRevenue - totalExpense;

    return `
      <div class="profit-loss-statement">
        <h2>${translate("profit_loss_statement")}</h2>
        <div class="statement-period muted-text">
          ${translate("fiscal_year")}: ${escapeHTML(this.fiscalYear.label)}
        </div>

        <div class="statement-section">
          <h3 class="statement-section-title">${translate("revenue_by_source")}</h3>
          <table class="data-table statement-table">
            <tbody>
              ${revenueCategories
                .map(
                  (cat) => `
                <tr>
                  <td>${escapeHTML(cat.category_name || translate("uncategorized"))}</td>
                  <td class="text-right amount revenue">${this.formatCurrency(cat.total_revenue)}</td>
                </tr>
              `,
                )
                .join("")}
              <tr class="statement-total">
                <td><strong>${translate("gross_revenue")}</strong></td>
                <td class="text-right amount revenue"><strong>${this.formatCurrency(totalRevenue)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="statement-section">
          <h3 class="statement-section-title">${translate("expense_by_category")}</h3>
          <table class="data-table statement-table">
            <tbody>
              ${expenseCategories
                .map(
                  (cat) => `
                <tr>
                  <td>${escapeHTML(cat.category_name || translate("uncategorized"))}</td>
                  <td class="text-right amount expense">${this.formatCurrency(cat.total_expense)}</td>
                </tr>
              `,
                )
                .join("")}
              <tr class="statement-total">
                <td><strong>${translate("gross_expenses")}</strong></td>
                <td class="text-right amount expense"><strong>${this.formatCurrency(totalExpense)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="statement-section net-section">
          <table class="data-table statement-table">
            <tbody>
              <tr class="statement-net ${netAmount >= 0 ? "positive" : "negative"}">
                <td><strong>${netAmount >= 0 ? translate("net_income") : translate("net_loss")}</strong></td>
                <td class="text-right amount"><strong>${this.formatCurrency(Math.abs(netAmount))}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderCategoryTrends() {
    if (!this.summaryReport || !this.summaryReport.categories) {
      return `<p class="no-data">${translate("no_budget_data")}</p>`;
    }

    const categories = this.summaryReport.categories;
    const totals = this.summaryReport.totals || {};
    const totalRevenue = totals.total_revenue || 0;
    const totalExpense = totals.total_expense || 0;

    return `
      <div class="category-trends">
        <h2>${translate("category_trends")}</h2>
        
        <div class="trends-section">
          <h3>${translate("revenue")} ${translate("category_breakdown")}</h3>
          <div class="trend-bars">
            ${categories
              .filter((cat) => cat.total_revenue > 0)
              .map((cat) => {
                const percentage =
                  totalRevenue > 0
                    ? (cat.total_revenue / totalRevenue) * 100
                    : 0;
                return `
                <div class="trend-item">
                  <div class="trend-label">
                    <span>${escapeHTML(cat.category_name || translate("uncategorized"))}</span>
                    <span class="trend-amount">${this.formatCurrency(cat.total_revenue)}</span>
                  </div>
                  <div class="trend-bar-container">
                    <div class="trend-bar revenue" style="width: ${percentage}%"></div>
                  </div>
                  <div class="trend-percentage">${percentage.toFixed(1)}%</div>
                </div>
              `;
              })
              .join("")}
          </div>
        </div>

        <div class="trends-section">
          <h3>${translate("expenses")} ${translate("category_breakdown")}</h3>
          <div class="trend-bars">
            ${categories
              .filter((cat) => cat.total_expense > 0)
              .map((cat) => {
                const percentage =
                  totalExpense > 0
                    ? (cat.total_expense / totalExpense) * 100
                    : 0;
                return `
                <div class="trend-item">
                  <div class="trend-label">
                    <span>${escapeHTML(cat.category_name || translate("uncategorized"))}</span>
                    <span class="trend-amount">${this.formatCurrency(cat.total_expense)}</span>
                  </div>
                  <div class="trend-bar-container">
                    <div class="trend-bar expense" style="width: ${percentage}%"></div>
                  </div>
                  <div class="trend-percentage">${percentage.toFixed(1)}%</div>
                </div>
              `;
              })
              .join("")}
          </div>
        </div>
      </div>
    `;
  }

  renderRevenueBreakdownContent() {
    if (!this.revenueBreakdown || this.revenueBreakdown.length === 0) {
      return `
        <div class="revenue-breakdown">
          <h2>${translate("revenue_breakdown")}</h2>
          ${this.renderRevenueFilters()}
          <p class="no-data">${translate("no_budget_data")}</p>
        </div>
      `;
    }

    // Group by revenue source
    const bySource = {};
    this.revenueBreakdown.forEach((item) => {
      const source = item.revenue_source || "other";
      if (!bySource[source]) {
        bySource[source] = {
          items: [],
          total: 0,
          count: 0,
        };
      }
      bySource[source].items.push(item);
      bySource[source].total += parseFloat(item.total_amount || 0);
      bySource[source].count += parseInt(item.transaction_count || 0);
    });

    const sourceLabels = {
      participant_fee: translate("fee_revenue"),
      fees: translate("fees"),
      fundraiser: translate("fundraiser_revenue"),
      fundraisers: translate("fundraisers"),
      calendar_sale: translate("calendar_revenue"),
      calendar_sales: translate("calendar_sales"),
      other: translate("other"),
    };

    return `
      <div class="revenue-breakdown">
        <h2>${translate("revenue_breakdown")}</h2>
        
        ${this.renderRevenueFilters()}
        
        ${
          this.revenueBreakdownSummary
            ? `
          <div class="breakdown-summary">
            <div class="summary-stat">
              <span class="stat-label">${translate("transaction_count")}</span>
              <span class="stat-value">${this.revenueBreakdownSummary.total_transactions}</span>
            </div>
            <div class="summary-stat">
              <span class="stat-label">${translate("total_revenue")}</span>
              <span class="stat-value revenue">${this.formatCurrency(this.revenueBreakdownSummary.total_revenue)}</span>
            </div>
          </div>
        `
            : ""
        }
        
        ${Object.keys(bySource)
          .map(
            (source) => `
          <div class="breakdown-section">
            <h3>${sourceLabels[source] || source}</h3>
            <table class="data-table breakdown-table">
              <thead>
                <tr>
                  <th>${translate("category")}</th>
                  <th class="text-right">${translate("transaction_count")}</th>
                  <th class="text-right">${translate("amount")}</th>
                  <th class="text-right">${translate("percentage_of_total")}</th>
                </tr>
              </thead>
              <tbody>
                ${bySource[source].items
                  .map((item) => {
                    const percentage =
                      this.revenueBreakdownSummary &&
                      this.revenueBreakdownSummary.total_revenue > 0
                        ? (item.total_amount /
                            this.revenueBreakdownSummary.total_revenue) *
                          100
                        : 0;
                    return `
                    <tr>
                      <td>${escapeHTML(item.category_name || translate("uncategorized"))}</td>
                      <td class="text-right">${item.transaction_count}</td>
                      <td class="text-right amount revenue">${this.formatCurrency(item.total_amount)}</td>
                      <td class="text-right">${percentage.toFixed(1)}%</td>
                    </tr>
                  `;
                  })
                  .join("")}
                <tr class="breakdown-total">
                  <td><strong>${translate("total")}</strong></td>
                  <td class="text-right"><strong>${bySource[source].count}</strong></td>
                  <td class="text-right amount revenue"><strong>${this.formatCurrency(bySource[source].total)}</strong></td>
                  <td class="text-right"><strong>${this.revenueBreakdownSummary && this.revenueBreakdownSummary.total_revenue > 0 ? ((bySource[source].total / this.revenueBreakdownSummary.total_revenue) * 100).toFixed(1) : 0}%</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  renderRevenueFilters() {
    return `
      <div class="revenue-filters">
        <div class="filter-group">
          <label for="revenue-source-filter">${translate("filter_by_source")}</label>
          <select id="revenue-source-filter" class="filter-select">
            <option value="all" ${this.revenueFilters.source === "all" ? "selected" : ""}>${translate("all_sources")}</option>
            <option value="participant_fee" ${this.revenueFilters.source === "participant_fee" ? "selected" : ""}>${translate("fee_revenue")}</option>
            <option value="fundraiser" ${this.revenueFilters.source === "fundraiser" ? "selected" : ""}>${translate("fundraiser_revenue")}</option>
            <option value="calendar_sale" ${this.revenueFilters.source === "calendar_sale" ? "selected" : ""}>${translate("calendar_revenue")}</option>
          </select>
        </div>
        
        <div class="filter-group">
          <label for="revenue-category-filter">${translate("filter_by_category")}</label>
          <select id="revenue-category-filter" class="filter-select">
            <option value="all" ${this.revenueFilters.category === "all" ? "selected" : ""}>${translate("all_categories")}</option>
            ${this.categories
              .map(
                (cat) => `
              <option value="${cat.id}" ${this.revenueFilters.category == cat.id ? "selected" : ""}>
                ${escapeHTML(cat.name)}
              </option>
            `,
              )
              .join("")}
          </select>
        </div>
        
        <button class="btn btn-secondary" id="apply-revenue-filters-btn">
          ${translate("apply_filters")}
        </button>
        <button class="btn btn-secondary" id="reset-revenue-filters-btn">
          ${translate("reset_filters")}
        </button>
      </div>
    `;
  }

  attachEventListeners() {
    // Tab navigation
    document.querySelectorAll(".tab-btn").forEach((btn) => {
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
    document.querySelectorAll(".edit-category-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const category = this.categories.find((c) => c.id === id);
        if (category) {
          this.showCategoryModal(category);
        }
      });
    });

    // Delete category buttons
    document.querySelectorAll(".delete-category-btn").forEach((btn) => {
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
    document.querySelectorAll(".edit-expense-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const expense = this.expenses.find((ex) => ex.id === id);
        if (expense) {
          this.showExpenseModal(expense);
        }
      });
    });

    // Delete expense buttons
    document.querySelectorAll(".delete-expense-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_expense"))) {
          await this.deleteExpense(id);
        }
      });
    });

    // Add budget plan button
    const addPlanBtn = document.getElementById("add-plan-btn");
    if (addPlanBtn) {
      addPlanBtn.addEventListener("click", () => this.showPlanModal());
    }

    // Edit plan buttons
    document.querySelectorAll(".edit-plan-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = parseInt(e.target.dataset.id);
        const plan = this.budgetPlans.find((p) => p.id === id);
        if (plan) {
          this.showPlanModal(plan);
        }
      });
    });

    // Delete plan buttons
    document.querySelectorAll(".delete-plan-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm(translate("confirm_delete_budget_plan"))) {
          await this.deletePlan(id);
        }
      });
    });

    // Revenue filter buttons
    const applyFiltersBtn = document.getElementById(
      "apply-revenue-filters-btn",
    );
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener("click", () =>
        this.applyRevenueFilters(),
      );
    }

    const resetFiltersBtn = document.getElementById(
      "reset-revenue-filters-btn",
    );
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () =>
        this.resetRevenueFilters(),
      );
    }
  }

  async applyRevenueFilters() {
    const sourceFilter = document.getElementById("revenue-source-filter");
    const categoryFilter = document.getElementById("revenue-category-filter");

    if (sourceFilter) {
      this.revenueFilters.source = sourceFilter.value;
    }

    if (categoryFilter) {
      this.revenueFilters.category = categoryFilter.value;
    }

    // Clear cached data to force reload with new filters
    this.revenueBreakdown = null;
    this.revenueBreakdownSummary = null;

    // Only update the reports tab content if we're on the reports tab
    if (this.activeTab === "reports") {
      await this.updateReportsTabContent();
    }
  }

  async resetRevenueFilters() {
    this.revenueFilters = {
      source: "all",
      category: "all",
    };

    // Clear cached data
    this.revenueBreakdown = null;
    this.revenueBreakdownSummary = null;

    // Only update the reports tab content if we're on the reports tab
    if (this.activeTab === "reports") {
      await this.updateReportsTabContent();
    }
  }

  async updateReportsTabContent() {
    const tabContent = document.querySelector(".tab-content");
    if (!tabContent) return;

    await this.loadRevenueBreakdown();

    const reportsHTML = await this.renderReports();
    tabContent.innerHTML = reportsHTML;

    // Re-attach event listeners for the reports tab
    const applyFiltersBtn = document.getElementById(
      "apply-revenue-filters-btn",
    );
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener("click", () =>
        this.applyRevenueFilters(),
      );
    }

    const resetFiltersBtn = document.getElementById(
      "reset-revenue-filters-btn",
    );
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () =>
        this.resetRevenueFilters(),
      );
    }
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

    document
      .getElementById("close-category-modal")
      .addEventListener("click", () => {
        document.getElementById("category-modal").remove();
      });

    document
      .getElementById("cancel-category-btn")
      .addEventListener("click", () => {
        document.getElementById("category-modal").remove();
      });

    document
      .getElementById("category-form")
      .addEventListener("submit", async (e) => {
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
                  ${this.categories
                    .map(
                      (cat) => `
                    <option value="${cat.id}" ${expense?.budget_category_id === cat.id ? "selected" : ""}>
                      ${escapeHTML(cat.name)}
                    </option>
                  `,
                    )
                    .join("")}
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

    document
      .getElementById("close-expense-modal")
      .addEventListener("click", () => {
        document.getElementById("expense-modal").remove();
      });

    document
      .getElementById("cancel-expense-btn")
      .addEventListener("click", () => {
        document.getElementById("expense-modal").remove();
      });

    document
      .getElementById("expense-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.saveExpense(expense?.id);
      });
  }

  async saveExpense(expenseId = null) {
    const categoryId =
      document.getElementById("expense-category").value || null;
    const amount = parseFloat(document.getElementById("expense-amount").value);
    const date = document.getElementById("expense-date").value;
    const description = document.getElementById("expense-description").value;
    const paymentMethod = document.getElementById(
      "expense-payment-method",
    ).value;

    try {
      const payload = {
        budget_category_id: categoryId,
        amount,
        expense_date: date,
        description,
        payment_method: paymentMethod,
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

  showPlanModal(plan = null) {
    const isEdit = !!plan;
    const modalHTML = `
      <div class="modal-overlay" id="plan-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${isEdit ? translate("edit_budget_plan") : translate("add_budget_plan")}</h3>
            <button class="modal-close" id="close-plan-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="plan-form">
              <div class="form-group">
                <label for="plan-item">${translate("budget_item")}</label>
                <select id="plan-item">
                  <option value="">${translate("select")}...</option>
                  ${this.items
                    .map(
                      (item) => `
                    <option value="${item.id}" ${plan?.budget_item_id === item.id ? "selected" : ""}>
                      ${escapeHTML(item.name)} (${escapeHTML(item.category_name || "-")})
                    </option>
                  `,
                    )
                    .join("")}
                </select>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="plan-fy-start">${translate("fiscal_year")} ${translate("start_date")}</label>
                  <input type="date" id="plan-fy-start" required
                         value="${plan ? plan.fiscal_year_start : this.fiscalYear.start}">
                </div>
                <div class="form-group">
                  <label for="plan-fy-end">${translate("end_date")}</label>
                  <input type="date" id="plan-fy-end" required
                         value="${plan ? plan.fiscal_year_end : this.fiscalYear.end}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="plan-revenue">${translate("budgeted_revenue")}</label>
                  <input type="number" id="plan-revenue" step="0.01" min="0"
                         value="${plan ? plan.budgeted_revenue : 0}">
                </div>
                <div class="form-group">
                  <label for="plan-expense">${translate("budgeted_expense")}</label>
                  <input type="number" id="plan-expense" step="0.01" min="0"
                         value="${plan ? plan.budgeted_expense : 0}">
                </div>
              </div>
              <div class="form-group">
                <label for="plan-notes">${translate("notes")}</label>
                <textarea id="plan-notes" rows="3">${plan ? escapeHTML(plan.notes || "") : ""}</textarea>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-plan-btn">
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
      .getElementById("close-plan-modal")
      .addEventListener("click", () => {
        document.getElementById("plan-modal").remove();
      });

    document.getElementById("cancel-plan-btn").addEventListener("click", () => {
      document.getElementById("plan-modal").remove();
    });

    document
      .getElementById("plan-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.savePlan(plan?.id);
      });
  }

  async savePlan(planId = null) {
    const itemId = document.getElementById("plan-item").value || null;
    const fyStart = document.getElementById("plan-fy-start").value;
    const fyEnd = document.getElementById("plan-fy-end").value;
    const revenue =
      parseFloat(document.getElementById("plan-revenue").value) || 0;
    const expense =
      parseFloat(document.getElementById("plan-expense").value) || 0;
    const notes = document.getElementById("plan-notes").value;

    try {
      const payload = {
        budget_item_id: itemId,
        fiscal_year_start: fyStart,
        fiscal_year_end: fyEnd,
        budgeted_revenue: revenue,
        budgeted_expense: expense,
        notes,
      };

      if (planId) {
        await updateBudgetPlan(planId, payload);
        this.app.showMessage(translate("budget_plan_updated"), "success");
      } else {
        await createBudgetPlan(payload);
        this.app.showMessage(translate("budget_plan_created"), "success");
      }

      document.getElementById("plan-modal").remove();
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error saving budget plan", error);
      this.app.showMessage(translate("error_saving_budget_plan"), "error");
    }
  }

  async deletePlan(planId) {
    try {
      await deleteBudgetPlan(planId);
      this.app.showMessage(translate("budget_plan_deleted"), "success");
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error deleting budget plan", error);
      this.app.showMessage(translate("error_deleting_budget_plan"), "error");
    }
  }
}

export default Budgets;
