import {
  getRevenueDashboard,
  getRevenueBySource,
  getRevenueByCategory,
  getRevenueComparison,
  getBudgetCategories
} from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import { getTodayISO } from "./utils/DateUtils.js";
import { LoadingStateManager, retryWithBackoff } from "./utils/PerformanceUtils.js";

const DEFAULT_CURRENCY = "CAD";

/**
 * Revenue Dashboard Module
 * Comprehensive view of all revenue sources aggregated
 */
export class RevenueDashboard {
  constructor(app) {
    this.app = app;
    this.dashboardData = null;
    this.bySourceData = [];
    this.byCategoryData = [];
    this.comparisonData = null;
    this.categories = [];
    this.activeTab = "overview";
    this.fiscalYear = this.getCurrentFiscalYear();
    this.customDateRange = {
      start: this.fiscalYear.start,
      end: this.fiscalYear.end
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
      await this.loadCategories();
      await this.loadAllData();
    } catch (error) {
      debugError("Error loading revenue data:", error);
      // Continue rendering even if some data failed to load
      this.app.showMessage(translate("error_loading_data"), "warning");
    }

    // Always render the page, even with partial data
    try {
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Unable to render revenue dashboard:", error);
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

  async loadAllData() {
    // Individual load methods have their own error handling
    // Don't throw here - allow page to render with partial data
    await Promise.all([
      this.loadDashboardData(),
      this.loadBySourceData(),
      this.loadByCategoryData(),
      this.loadComparisonData()
    ]);
  }

  async loadDashboardData() {
    try {
      const response = await getRevenueDashboard(
        this.customDateRange.start,
        this.customDateRange.end
      );
      this.dashboardData = response?.data || null;
      debugLog("Loaded dashboard data", this.dashboardData);
    } catch (error) {
      debugError("Error loading dashboard data", error);
      this.dashboardData = null;
    }
  }

  async loadBySourceData() {
    try {
      const response = await getRevenueBySource(
        this.customDateRange.start,
        this.customDateRange.end
      );
      this.bySourceData = response?.data || [];
      debugLog("Loaded by source data", this.bySourceData);
    } catch (error) {
      debugError("Error loading by source data", error);
      this.bySourceData = [];
    }
  }

  async loadByCategoryData() {
    try {
      const response = await getRevenueByCategory(
        this.customDateRange.start,
        this.customDateRange.end
      );
      this.byCategoryData = response?.data || [];
      debugLog("Loaded by category data", this.byCategoryData);
    } catch (error) {
      debugError("Error loading by category data", error);
      this.byCategoryData = [];
    }
  }

  async loadComparisonData() {
    try {
      const response = await getRevenueComparison(
        this.fiscalYear.start,
        this.fiscalYear.end
      );
      this.comparisonData = response?.data || null;
      debugLog("Loaded comparison data", this.comparisonData);
    } catch (error) {
      debugError("Error loading comparison data", error);
      this.comparisonData = null;
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

  getSourceLabel(source) {
    const labels = {
      'participant_fee': translate("participant_fees"),
      'fees': translate("participant_fees"),
      'fundraiser': translate("fundraisers"),
      'fundraisers': translate("fundraisers"),
      'calendar_sale': translate("calendar_sales"),
      'calendar_sales': translate("calendar_sales"),
      'external': translate("external_revenue"),
      'other': translate("other")
    };
    return labels[source] || source;
  }

  async render() {
    const container = document.getElementById("app");
    if (!container) return;

    container.innerHTML = `
      <div class="page-container revenue-dashboard-page">
        <div class="page-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div class="page-header-content">
            <h1>${translate("revenue_dashboard")}</h1>
            <div class="fiscal-year-display">
              <span>${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></span>
            </div>
          </div>
        </div>

        ${this.renderDateRangeSelector()}
        ${this.renderSummaryCards()}

        <div class="tab-navigation">
          <button class="tab-btn ${this.activeTab === "overview" ? "active" : ""}" data-tab="overview">
            ${translate("overview")}
          </button>
          <button class="tab-btn ${this.activeTab === "by-source" ? "active" : ""}" data-tab="by-source">
            ${translate("by_source")}
          </button>
          <button class="tab-btn ${this.activeTab === "by-category" ? "active" : ""}" data-tab="by-category">
            ${translate("by_category")}
          </button>
          <button class="tab-btn ${this.activeTab === "comparison" ? "active" : ""}" data-tab="comparison">
            ${translate("budget_comparison")}
          </button>
        </div>

        <div class="tab-content">
          ${this.renderTabContent()}
        </div>
      </div>
    `;
  }

  renderDateRangeSelector() {
    return `
      <div class="date-range-selector">
        <div class="date-range-inputs">
          <div class="form-group">
            <label for="date-range-start">${translate("start_date")}</label>
            <input type="date" id="date-range-start" value="${this.customDateRange.start}">
          </div>
          <div class="form-group">
            <label for="date-range-end">${translate("end_date")}</label>
            <input type="date" id="date-range-end" value="${this.customDateRange.end}">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="apply-date-range-btn">
              ${translate("apply")}
            </button>
            <button class="btn btn-secondary" id="reset-to-fiscal-year-btn">
              ${translate("reset_to_fiscal_year")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderSummaryCards() {
    if (!this.dashboardData || !this.dashboardData.totals) {
      return "";
    }

    const totals = this.dashboardData.totals;

    return `
      <div class="summary-cards">
        <div class="summary-card revenue-card primary">
          <div class="card-icon">💰</div>
          <div class="card-content">
            <div class="card-label">${translate("total_revenue")}</div>
            <div class="card-value">${this.formatCurrency(totals.total_revenue)}</div>
            <div class="card-detail">${totals.total_transactions} ${translate("transactions")}</div>
          </div>
        </div>

        <div class="summary-card info-card">
          <div class="card-icon">📊</div>
          <div class="card-content">
            <div class="card-label">${translate("revenue_sources")}</div>
            <div class="card-value">${totals.sources_count}</div>
            <div class="card-detail">${translate("active_sources")}</div>
          </div>
        </div>

        <div class="summary-card action-card">
          <div class="card-content">
            <button class="btn btn-secondary" id="export-dashboard-btn">
              ${translate("export_csv")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderTabContent() {
    switch (this.activeTab) {
      case "overview":
        return this.renderOverview();
      case "by-source":
        return this.renderBySource();
      case "by-category":
        return this.renderByCategory();
      case "comparison":
        return this.renderComparison();
      default:
        return "";
    }
  }

  renderOverview() {
    if (!this.dashboardData || !this.dashboardData.breakdown) {
      return `<div class="no-data"><p>${translate("no_data_available")}</p></div>`;
    }

    // Group breakdown by source
    const sourceGroups = {};
    this.dashboardData.breakdown.forEach(item => {
      const source = item.revenue_source || 'other';
      if (!sourceGroups[source]) {
        sourceGroups[source] = {
          source: source,
          items: [],
          total: 0,
          count: 0
        };
      }
      sourceGroups[source].items.push(item);
      sourceGroups[source].total += item.total_amount;
      sourceGroups[source].count += item.transaction_count;
    });

    return `
      <div class="overview-section">
        <h2>${translate("revenue_by_source_and_category")}</h2>
        ${Object.values(sourceGroups).map(group => this.renderSourceGroup(group)).join("")}
      </div>
    `;
  }

  renderSourceGroup(group) {
    return `
      <div class="source-group">
        <h3>${this.getSourceLabel(group.source)}</h3>
        <div class="source-summary">
          <span class="source-total">${this.formatCurrency(group.total)}</span>
          <span class="source-count">${group.count} ${translate("transactions")}</span>
        </div>
        <table class="data-table source-breakdown-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("transactions")}</th>
              <th class="text-right">${translate("amount")}</th>
              <th class="text-right">${translate("percentage")}</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map(item => {
              const percentage = group.total > 0 ? (item.total_amount / group.total * 100) : 0;
              return `
                <tr>
                  <td>${escapeHTML(item.category_name || translate("uncategorized"))}</td>
                  <td class="text-right">${item.transaction_count}</td>
                  <td class="text-right amount revenue">${this.formatCurrency(item.total_amount)}</td>
                  <td class="text-right">${percentage.toFixed(1)}%</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderBySource() {
    if (!this.bySourceData || this.bySourceData.length === 0) {
      return `<div class="no-data"><p>${translate("no_data_available")}</p></div>`;
    }

    const totalRevenue = this.bySourceData.reduce((sum, item) => sum + item.total_amount, 0);

    return `
      <div class="by-source-section">
        <h2>${translate("revenue_breakdown_by_source")}</h2>
        <div class="chart-container">
          ${this.renderSourceChart(this.bySourceData, totalRevenue)}
        </div>
        <table class="data-table source-table">
          <thead>
            <tr>
              <th>${translate("revenue_source")}</th>
              <th class="text-right">${translate("transactions")}</th>
              <th class="text-right">${translate("total_amount")}</th>
              <th class="text-right">${translate("percentage_of_total")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.bySourceData.map(item => {
              const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue * 100) : 0;
              return `
                <tr>
                  <td><strong>${this.getSourceLabel(item.revenue_source)}</strong></td>
                  <td class="text-right">${item.transaction_count}</td>
                  <td class="text-right amount revenue">${this.formatCurrency(item.total_amount)}</td>
                  <td class="text-right">${percentage.toFixed(1)}%</td>
                </tr>
              `;
            }).join("")}
          </tbody>
          <tfoot>
            <tr class="summary-total">
              <td><strong>${translate("total")}</strong></td>
              <td class="text-right"><strong>${this.bySourceData.reduce((sum, item) => sum + item.transaction_count, 0)}</strong></td>
              <td class="text-right amount revenue"><strong>${this.formatCurrency(totalRevenue)}</strong></td>
              <td class="text-right"><strong>100%</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  renderSourceChart(data, total) {
    return `
      <div class="horizontal-bar-chart">
        ${data.map(item => {
          const percentage = total > 0 ? (item.total_amount / total * 100) : 0;
          return `
            <div class="chart-bar-item">
              <div class="chart-label">
                <span>${this.getSourceLabel(item.revenue_source)}</span>
                <span class="chart-value">${this.formatCurrency(item.total_amount)}</span>
              </div>
              <div class="chart-bar-container">
                <div class="chart-bar revenue" style="width: ${percentage}%"></div>
              </div>
              <div class="chart-percentage">${percentage.toFixed(1)}%</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  renderByCategory() {
    if (!this.byCategoryData || this.byCategoryData.length === 0) {
      return `<div class="no-data"><p>${translate("no_data_available")}</p></div>`;
    }

    const totalRevenue = this.byCategoryData.reduce((sum, item) => sum + item.total_amount, 0);

    return `
      <div class="by-category-section">
        <h2>${translate("revenue_breakdown_by_category")}</h2>
        <div class="chart-container">
          ${this.renderCategoryChart(this.byCategoryData, totalRevenue)}
        </div>
        <table class="data-table category-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("transactions")}</th>
              <th class="text-right">${translate("total_amount")}</th>
              <th class="text-right">${translate("percentage_of_total")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.byCategoryData.map(item => {
              const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue * 100) : 0;
              return `
                <tr>
                  <td><strong>${escapeHTML(item.category_name || translate("uncategorized"))}</strong></td>
                  <td class="text-right">${item.transaction_count}</td>
                  <td class="text-right amount revenue">${this.formatCurrency(item.total_amount)}</td>
                  <td class="text-right">${percentage.toFixed(1)}%</td>
                </tr>
              `;
            }).join("")}
          </tbody>
          <tfoot>
            <tr class="summary-total">
              <td><strong>${translate("total")}</strong></td>
              <td class="text-right"><strong>${this.byCategoryData.reduce((sum, item) => sum + item.transaction_count, 0)}</strong></td>
              <td class="text-right amount revenue"><strong>${this.formatCurrency(totalRevenue)}</strong></td>
              <td class="text-right"><strong>100%</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  renderCategoryChart(data, total) {
    return `
      <div class="horizontal-bar-chart">
        ${data.map(item => {
          const percentage = total > 0 ? (item.total_amount / total * 100) : 0;
          return `
            <div class="chart-bar-item">
              <div class="chart-label">
                <span>${escapeHTML(item.category_name || translate("uncategorized"))}</span>
                <span class="chart-value">${this.formatCurrency(item.total_amount)}</span>
              </div>
              <div class="chart-bar-container">
                <div class="chart-bar revenue" style="width: ${percentage}%"></div>
              </div>
              <div class="chart-percentage">${percentage.toFixed(1)}%</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  renderComparison() {
    if (!this.comparisonData || !this.comparisonData.comparison) {
      return `<div class="no-data"><p>${translate("no_comparison_data")}</p></div>`;
    }

    const comparison = this.comparisonData.comparison;
    const totals = this.comparisonData.totals;

    return `
      <div class="comparison-section">
        <h2>${translate("budgeted_vs_actual_revenue")}</h2>
        <p class="info-text">${translate("fiscal_year")}: <strong>${escapeHTML(this.fiscalYear.label)}</strong></p>
        
        <div class="comparison-summary">
          <div class="comparison-card">
            <div class="comparison-label">${translate("budgeted_revenue")}</div>
            <div class="comparison-value">${this.formatCurrency(totals.budgeted_revenue)}</div>
          </div>
          <div class="comparison-card">
            <div class="comparison-label">${translate("actual_revenue")}</div>
            <div class="comparison-value revenue">${this.formatCurrency(totals.actual_revenue)}</div>
          </div>
          <div class="comparison-card ${totals.variance >= 0 ? 'positive' : 'negative'}">
            <div class="comparison-label">${translate("variance")}</div>
            <div class="comparison-value">${this.formatCurrency(Math.abs(totals.variance))}</div>
            <div class="comparison-percentage">${totals.variance_percent.toFixed(1)}%</div>
          </div>
        </div>

        <table class="data-table comparison-table">
          <thead>
            <tr>
              <th>${translate("category")}</th>
              <th class="text-right">${translate("budgeted")}</th>
              <th class="text-right">${translate("actual")}</th>
              <th class="text-right">${translate("variance")}</th>
              <th class="text-right">${translate("variance_percentage")}</th>
            </tr>
          </thead>
          <tbody>
            ${comparison.map(item => `
              <tr>
                <td><strong>${escapeHTML(item.category_name || translate("uncategorized"))}</strong></td>
                <td class="text-right amount">${this.formatCurrency(item.budgeted_revenue)}</td>
                <td class="text-right amount revenue">${this.formatCurrency(item.actual_revenue)}</td>
                <td class="text-right amount ${item.variance >= 0 ? 'positive' : 'negative'}">
                  ${this.formatCurrency(Math.abs(item.variance))}
                </td>
                <td class="text-right ${item.variance >= 0 ? 'positive' : 'negative'}">
                  ${Math.abs(item.variance_percent).toFixed(1)}%
                </td>
              </tr>
            `).join("")}
          </tbody>
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

    // Date range selector
    const applyDateRangeBtn = document.getElementById("apply-date-range-btn");
    if (applyDateRangeBtn) {
      applyDateRangeBtn.addEventListener("click", () => this.applyDateRange());
    }

    const resetToFiscalYearBtn = document.getElementById("reset-to-fiscal-year-btn");
    if (resetToFiscalYearBtn) {
      resetToFiscalYearBtn.addEventListener("click", () => this.resetToFiscalYear());
    }

    // Export button
    const exportDashboardBtn = document.getElementById("export-dashboard-btn");
    if (exportDashboardBtn) {
      exportDashboardBtn.addEventListener("click", () => this.exportDashboard());
    }
  }

  async applyDateRange() {
    const startDate = document.getElementById("date-range-start").value;
    const endDate = document.getElementById("date-range-end").value;

    if (!startDate || !endDate) {
      this.app.showMessage(translate("please_select_date_range"), "warning");
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      this.app.showMessage(translate("start_date_before_end_date"), "error");
      return;
    }

    this.customDateRange.start = startDate;
    this.customDateRange.end = endDate;

    await this.loadAllData();
    this.render();
    this.attachEventListeners();
  }

  async resetToFiscalYear() {
    this.customDateRange.start = this.fiscalYear.start;
    this.customDateRange.end = this.fiscalYear.end;

    await this.loadAllData();
    this.render();
    this.attachEventListeners();
  }

  exportDashboard() {
    if (!this.dashboardData || !this.dashboardData.breakdown) {
      this.app.showMessage(translate("no_data_to_export"), "warning");
      return;
    }

    // Build CSV content
    const headers = [
      translate("revenue_source"),
      translate("category"),
      translate("transactions"),
      translate("amount")
    ];

    const rows = this.dashboardData.breakdown.map(item => [
      this.getSourceLabel(item.revenue_source),
      item.category_name || translate("uncategorized"),
      item.transaction_count,
      item.total_amount
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
    link.setAttribute("download", `revenue_dashboard_${getTodayISO()}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.app.showMessage(translate("export_successful"), "success");
  }
}

export default RevenueDashboard;
