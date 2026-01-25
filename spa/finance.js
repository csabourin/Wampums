import {
  getFeeDefinitions,
  createFeeDefinition,
  updateFeeDefinition,
  deleteFeeDefinition,
  getParticipantFees,
  createParticipantFee,
  updateParticipantFee,
  getParticipantPayments,
  createParticipantPayment,
  updatePayment,
  getPaymentPlans,
  createPaymentPlan,
  updatePaymentPlan,
  deletePaymentPlan,
  getFinanceReport,
  getParticipants
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { aiParseReceipt } from "./modules/AI.js";
import { setButtonLoading } from "./utils/SkeletonUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";
import { clearFinanceRelatedCaches } from "./indexedDB.js";
import { LoadingStateManager, CacheWithTTL, retryWithBackoff } from "./utils/PerformanceUtils.js";
import { validateMoney, validateDateField, validatePositiveInteger } from "./utils/ValidationUtils.js";
import { canManageFinance, canViewFinance } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { BaseModule } from "./utils/BaseModule.js";

const DEFAULT_CURRENCY = "CAD";

export class Finance extends BaseModule {
  constructor(app) {
    super(app);
    this.feeDefinitions = [];
    this.participantFees = [];
    this.participants = [];
    this.financeSummary = null;
    this.activeTab = "memberships";

    // Enhanced caching with TTL (5 minutes)
    this.paymentsCache = new CacheWithTTL(300000);
    this.paymentPlanCache = new CacheWithTTL(300000);
    this.lastPaymentAmounts = new Map();

    // Loading state management
    this.loadingManager = new LoadingStateManager();
    this.isInitializing = false;

    this.sortField = 'name'; // Default sort field: name, outstanding, total
    this.sortDirection = 'asc'; // asc or desc
  }

  async init() {
    // Check permission
    if (!canViewFinance()) {
      this.app.router.navigate("/dashboard");
      return;
    }

    // Prevent race conditions - only one init at a time
    if (this.isInitializing) {
      debugError("Finance init already in progress, skipping duplicate call");
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
      debugError("Error loading finance data:", error);
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
      this.activeTab = url.searchParams.get("tab") || "memberships";
    } catch (error) {
      this.activeTab = "memberships";
    }
  }

  async loadCoreData() {
    return this.loadingManager.withLoading('core-data', async () => {
      // Load data with individual error handling and retry logic
      const [fees, feeDefs, participants, summary] = await Promise.all([
        retryWithBackoff(
          () => getParticipantFees(),
          {
            maxRetries: 2,
            onRetry: (attempt, max, delay) => {
              debugError(`Retrying participant fees (${attempt}/${max}) in ${delay}ms`);
            }
          }
        ).catch(error => {
          debugError("Error loading participant fees:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getFeeDefinitions(),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading fee definitions:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getParticipants(),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading participants:", error);
          return { data: [] };
        }),
        retryWithBackoff(
          () => getFinanceReport(),
          { maxRetries: 2 }
        ).catch(error => {
          debugError("Error loading finance report:", error);
          return { data: null };
        })
      ]);

      this.participantFees = fees?.data || fees?.participant_fees || [];
      this.feeDefinitions = feeDefs?.data || feeDefs?.fee_definitions || [];
      this.participants = participants?.data || participants?.participants || [];
      this.financeSummary = summary?.data || null;
    });
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
   * Extracts a numeric year from a date-like value.
   * Falls back to matching a 4-digit year when Date parsing fails.
   * @param {string | number | Date} dateValue
   * @returns {number | null}
   */
  extractYear(dateValue) {
    if (!dateValue) return null;
    const parsedDate = new Date(dateValue);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getFullYear();
    }

    const match = String(dateValue).match(/\d{4}/);
    return match ? Number(match[0]) : null;
  }

  /**
   * Formats a year range for display while avoiding invalid date output.
   * @param {string | number | Date} start
   * @param {string | number | Date} end
   * @returns {string}
   */
  formatYearRange(start, end) {
    const startYear = this.extractYear(start);
    const endYear = this.extractYear(end);

    if (startYear && endYear) {
      return `${startYear} - ${endYear}`;
    }
    if (startYear || endYear) {
      return String(startYear || endYear);
    }
    return translate("unknown");
  }

  /**
   * Computes the outstanding balance for a fee row.
   * @param {object} fee
   * @returns {number}
   */
  getOutstanding(fee) {
    if (!fee) return 0;
    const totalAmount = Number(fee.total_amount) || 0;
    const totalPaid = Number(fee.total_paid) || 0;
    return Math.max(totalAmount - totalPaid, 0);
  }

  /**
   * Returns a sorted copy of fee definitions with the most recent year first.
   * @returns {Array}
   */
  getSortedFeeDefinitions() {
    return [...this.feeDefinitions].sort((a, b) => {
      const bYear = this.extractYear(b.year_end || b.year_start) || -Infinity;
      const aYear = this.extractYear(a.year_end || a.year_start) || -Infinity;
      return bYear - aYear;
    });
  }

  /**
   * Returns the active fee definition id based on today's date.
   * @returns {number | null}
   */
  getDefaultFeeDefinitionId() {
    const today = new Date(getTodayISO());
    const active = this.feeDefinitions.find((def) => {
      const start = new Date(def.year_start);
      const end = new Date(def.year_end);
      return start <= today && today <= end;
    });
    return active ? Number(active.id) : null;
  }

  /**
   * Populate the fee totals using a selected definition.
   * @param {string | number} definitionId
   */
  populateFeesFromDefinition(definitionId) {
    const form = document.getElementById("participant-fee-form");
    if (!form) return;
    const definition = this.feeDefinitions.find((item) => String(item.id) === String(definitionId));
    if (!definition) return;
    form.total_registration_fee.value = definition.registration_fee ?? "";
    form.total_membership_fee.value = definition.membership_fee ?? "";
  }

  renderLoading() {
    const content = `
      <section class="finance-page">
        <header class="finance-header">
          <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
          <div>
            <p class="finance-kicker">${translate("dashboard_day_to_day_section")}</p>
            <h1>${translate("finance_center_title")}</h1>
            <p class="finance-subtitle">${translate("finance_center_subtitle")}</p>
          </div>
        </header>
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p>${translate("loading")}...</p>
        </div>
      </section>
    `;

    setContent(document.getElementById("app"), content);
  }

  render() {
    const canEditDefinitions = canManageFinance();
    const canSeeReports = canViewFinance();
    const content = `
      <section class="finance-page">
        <header class="finance-header">
          <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
          <div>
            <p class="finance-kicker">${translate("dashboard_day_to_day_section")}</p>
            <h1>${translate("finance_center_title")}</h1>
            <p class="finance-subtitle">${translate("finance_center_subtitle")}</p>
          </div>
        </header>
        <div class="finance-tabs" role="tablist">
          ${this.renderTabButton("memberships", translate("finance_memberships_tab"))}
          ${canEditDefinitions ? this.renderTabButton("definitions", translate("finance_definitions_tab")) : ""}
          ${canSeeReports ? this.renderTabButton("reports", translate("financial_report")) : ""}
        </div>
        <div id="finance-content" class="finance-content" aria-live="polite">
          ${this.renderActiveTab()}
        </div>
      </section>
      ${this.renderPaymentModal()}
      ${this.renderPlanModal()}
    `;

    setContent(document.getElementById("app"), content);
  }

  renderTabButton(tab, label) {
    const isActive = this.activeTab === tab;
    return `
      <button class="finance-tab ${isActive ? "active" : ""}" data-tab="${tab}" role="tab" aria-selected="${isActive}">
        ${label}
      </button>
    `;
  }

  renderActiveTab() {
    switch (this.activeTab) {
      case "definitions":
        return this.renderDefinitionsSection();
      case "reports":
        return this.renderReportsSection();
      case "memberships":
      default:
        return this.renderMembershipsSection();
    }
  }

  renderDefinitionsSection() {
    if (!canManageFinance()) {
      return `<p class="finance-helper">${translate("finance_admin_only")}</p>`;
    }

    const sortedDefinitions = this.getSortedFeeDefinitions();

    const options = sortedDefinitions
      .map((def) => {
        const yearRange = this.formatYearRange(def.year_start, def.year_end);
        return `
          <article class="finance-card" data-definition-id="${def.id}">
            <div class="finance-card__header">
              <h3>${yearRange}</h3>
              <span class="finance-pill">${this.formatCurrency(def.registration_fee)} / ${this.formatCurrency(def.membership_fee)}</span>
            </div>
            <p class="finance-meta">${translate("registration_fee_label")}: ${this.formatCurrency(def.registration_fee)}</p>
            <p class="finance-meta">${translate("membership_fee_label")}: ${this.formatCurrency(def.membership_fee)}</p>
            <div class="finance-actions">
              <button class="secondary-button" data-action="edit-definition" data-id="${def.id}">${translate("edit")}</button>
              <button class="btn-danger" data-action="delete-definition" data-id="${def.id}">${translate("delete")}</button>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <div class="finance-grid">
        <article class="finance-card">
          <h2>${translate("add_fee_definition")}</h2>
          <form id="fee-definition-form" class="finance-form" novalidate>
            <input type="hidden" name="definition_id" id="definition_id">
            <label for="year_start">${translate("year_start")}</label>
            <input type="date" name="year_start" id="year_start" required>
            <label for="year_end">${translate("year_end")}</label>
            <input type="date" name="year_end" id="year_end" required>
            <label for="registration_fee">${translate("registration_fee_label")}</label>
            <input type="number" step="0.01" min="0" name="registration_fee" id="registration_fee" required>
            <label for="membership_fee">${translate("membership_fee_label")}</label>
            <input type="number" step="0.01" min="0" name="membership_fee" id="membership_fee" required>
            <div class="finance-actions">
              <button type="submit" class="primary-button">${translate("save")}</button>
              <button type="button" class="ghost-button" id="reset-definition-form">${translate("reset")}</button>
            </div>
          </form>
        </article>
        <section class="finance-card">
          <h2>${translate("existing_fee_definitions")}</h2>
          ${options || `<p class="finance-helper">${translate("no_definitions")}</p>`}
        </section>
      </div>
    `;
  }

  renderMembershipsSection() {
    const sortedFees = this.getSortedParticipantFees();

    return `
      <div class="finance-section">
        <h2>${translate("participant_fees")}</h2>
        ${sortedFees.length > 0 ? this.renderParticipantFeesTable(sortedFees) : `<p class="finance-helper">${translate("no_participant_fees")}</p>`}
      </div>

      <div class="finance-section">
        <details class="finance-card">
          <summary><h2>${translate("assign_membership_fee")}</h2></summary>
          <form id="participant-fee-form" class="finance-form" novalidate>
            <label for="participant_select">${translate("select_participant")}</label>
            <select id="participant_select" name="participant_id" required>
              <option value="">${translate("select_participant")}</option>
              ${this.participants
        .map(
          (p) => `
                    <option value="${p.id}">${escapeHTML(p.first_name || "")} ${escapeHTML(p.last_name || "")}</option>
                  `
        )
        .join("")}
            </select>
            <label for="fee_definition">${translate("select_fee_definition")}</label>
            <select id="fee_definition" name="fee_definition_id" required>
              <option value="">${translate("select_fee_definition")}</option>
              ${this.getSortedFeeDefinitions()
        .map(
          (def) => `
                    <option value="${def.id}">${this.formatYearRange(def.year_start, def.year_end)}</option>
                  `
        )
        .join("")}
            </select>
            <label for="registration_total">${translate("registration_fee_label")}</label>
            <input type="number" step="0.01" min="0" id="registration_total" name="total_registration_fee" required>
            <label for="membership_total">${translate("membership_fee_label")}</label>
            <input type="number" step="0.01" min="0" id="membership_total" name="total_membership_fee" required>
            <label for="fee_notes">${translate("notes")}</label>
            <textarea id="fee_notes" name="notes" rows="2"></textarea>
            <div class="finance-plan-toggle">
              <label for="enable_plan" class="checkbox-label">
                <input type="checkbox" id="enable_plan" name="enable_plan"> ${translate("add_payment_plan_optional")}
              </label>
              <p class="finance-helper">${translate("add_payment_plan_optional_helper")}</p>
            </div>
            <div id="inline-plan-fields" class="finance-plan-fields hidden">
              <label for="inline_number_of_payments">${translate("number_of_payments")}</label>
              <input type="number" min="1" id="inline_number_of_payments" name="plan_number_of_payments">
              <label for="inline_amount_per_payment">${translate("amount_per_payment")}</label>
              <input type="number" step="0.01" min="0" id="inline_amount_per_payment" name="plan_amount_per_payment">
              <label for="inline_start_date">${translate("start_date")}</label>
              <input type="date" id="inline_start_date" name="plan_start_date" value="${getTodayISO()}">
              <label for="inline_frequency">${translate("frequency")}</label>
              <select id="inline_frequency" name="plan_frequency">
                <option value="monthly">${translate("monthly")}</option>
                <option value="biweekly">${translate("biweekly")}</option>
                <option value="weekly">${translate("weekly")}</option>
              </select>
              <label for="inline_plan_notes">${translate("notes")}</label>
              <textarea id="inline_plan_notes" name="plan_notes" rows="2"></textarea>
            </div>
            <button type="submit" class="primary-button">${translate("save")}</button>
          </form>
        </details>
      </div>
    `;
  }

  getSortedParticipantFees() {
    const fees = [...this.participantFees];
    fees.sort((a, b) => {
      let valA, valB;

      switch (this.sortField) {
        case 'name':
          valA = `${a.first_name} ${a.last_name}`.toLowerCase();
          valB = `${b.first_name} ${b.last_name}`.toLowerCase();
          break;
        case 'outstanding':
          valA = this.getOutstanding(a);
          valB = this.getOutstanding(b);
          break;
        case 'total':
          valA = Number(a.total_amount) || 0;
          valB = Number(b.total_amount) || 0;
          break;
        case 'paid':
          valA = Number(a.total_paid) || 0;
          valB = Number(b.total_paid) || 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return fees;
  }

  renderParticipantFeesTable(fees) {
    const sortIcon = (field) => {
      if (this.sortField === field) {
        return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
      }
      return '';
    };

    return `
      <div class="finance-table-container">
        <table class="finance-table">
          <thead>
            <tr>
              <th><button class="sort-btn" data-sort="name">${translate("participant")}${sortIcon('name')}</button></th>
              <th>${translate("period")}</th>
              <th><button class="sort-btn" data-sort="total">${translate("total_billed")}${sortIcon('total')}</button></th>
              <th><button class="sort-btn" data-sort="paid">${translate("total_paid")}${sortIcon('paid')}</button></th>
              <th><button class="sort-btn" data-sort="outstanding">${translate("outstanding_balance")}${sortIcon('outstanding')}</button></th>
              <th>${translate("status")}</th>
              <th>${translate("actions")}</th>
            </tr>
          </thead>
          <tbody>
            ${fees.map((fee) => this.renderParticipantFeeRow(fee)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderParticipantFeeRow(fee) {
    const participantName = `${escapeHTML(fee.first_name || "")} ${escapeHTML(fee.last_name || "")}`;
    const feeDefinition = this.feeDefinitions.find(def => String(def.id) === String(fee.fee_definition_id));
    const yearRange = feeDefinition
      ? this.formatYearRange(feeDefinition.year_start, feeDefinition.year_end)
      : translate("unknown");
    const outstanding = this.getOutstanding(fee);
    const statusLabel = translate(fee.status) || fee.status;
    const statusClass = fee.status === 'paid' ? 'success' : fee.status === 'partial' ? 'warning' : 'danger';

    return `
      <tr data-fee-id="${fee.id}">
        <td><strong>${participantName}</strong></td>
        <td>${yearRange}</td>
        <td>${this.formatCurrency(fee.total_amount)}</td>
        <td>${this.formatCurrency(fee.total_paid)}</td>
        <td><strong class="text-${statusClass}">${this.formatCurrency(outstanding)}</strong></td>
        <td><span class="finance-pill finance-pill--${statusClass}">${statusLabel}</span></td>
        <td class="finance-actions">
          <button class="secondary-button" data-action="open-payment" data-id="${fee.id}">${translate("make_payment")}</button>
          <button class="ghost-button" data-action="open-plan" data-id="${fee.id}">${translate("manage_installments")}</button>
        </td>
      </tr>
    `;
  }

  renderReportsSection() {
    const summary = this.financeSummary || {};
    const totals = summary.totals || {};
    const byDefinition = summary.definitions || [];
    const participants = summary.participants || [];

    const definitionsHtml = byDefinition
      .map(
        (item) => `
          <div class="finance-list__row">
            <div>
              <p class="finance-meta">${formatDateShort(item.year_start)} → ${formatDateShort(item.year_end)}</p>
            </div>
            <div class="finance-row-values">
              <span>${this.formatCurrency(item.total_billed)}</span>
              <span>${this.formatCurrency(item.total_paid)}</span>
              <span class="finance-stat__value--alert">${this.formatCurrency(item.total_outstanding)}</span>
            </div>
          </div>
        `
      )
      .join("");

    const participantRows = participants
      .map(
        (p) => `
          <div class="finance-list__row">
            <div>
              <p class="finance-meta">${escapeHTML(p.first_name || "")} ${escapeHTML(p.last_name || "")}</p>
            </div>
            <div class="finance-row-values">
              <span>${this.formatCurrency(p.total_billed)}</span>
              <span>${this.formatCurrency(p.total_paid)}</span>
              <span class="finance-stat__value--alert">${this.formatCurrency(p.total_outstanding)}</span>
            </div>
          </div>
        `
      )
      .join("");

    return `
      <section class="finance-grid">
        <article class="finance-card finance-card--highlight">
          <h2>${translate("financial_report")}</h2>
          <div class="finance-stats">
            <div>
              <p class="finance-stat__label">${translate("total_billed")}</p>
              <p class="finance-stat__value">${this.formatCurrency(totals.total_billed)}</p>
            </div>
            <div>
              <p class="finance-stat__label">${translate("total_paid")}</p>
              <p class="finance-stat__value">${this.formatCurrency(totals.total_paid)}</p>
            </div>
            <div>
              <p class="finance-stat__label">${translate("outstanding_balance")}</p>
              <p class="finance-stat__value finance-stat__value--alert">${this.formatCurrency(totals.total_outstanding)}</p>
            </div>
          </div>
        </article>
        <article class="finance-card">
          <h3>${translate("by_year")}</h3>
          ${definitionsHtml || `<p class="finance-helper">${translate("no_definitions")}</p>`}
        </article>
        <article class="finance-card">
          <h3>${translate("by_participant")}</h3>
          ${participantRows || `<p class="finance-helper">${translate("no_participant_fees")}</p>`}
        </article>
      </section>
    `;
  }

  renderPaymentModal() {
    return `
      <div id="payment-modal" class="modal" aria-hidden="true" role="dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h2 id="payment-modal-title">${translate("payment_details")}</h2>
            <button class="modal-close" aria-label="${translate("close")}">&times;</button>
          </div>
          <div class="modal-body">
            <div class="finance-amounts">
              <div>
                <p id="payment-total-label" class="finance-stat__label">${translate("total_amount")}</p>
                <output id="payment-total-output" class="finance-stat__value">--</output>
              </div>
            </div>
            <div id="payment-history" class="finance-list"></div>
            <form id="payment-form" class="finance-form" novalidate>
              <input type="hidden" id="payment_fee_id" name="participant_fee_id">
              <div id="payment-rows">${this.renderPaymentRow(0)}</div>
              <button type="button" class="ghost-button" id="add-payment-row">${translate("add_payment_row")}</button>
              <button type="submit" class="primary-button">${translate("save_payment")}</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  renderPaymentRow(index) {
    const today = getTodayISO();
    return `
      <fieldset class="payment-row" data-index="${index}">
        <legend class="sr-only">${translate("payment_entry")} ${index + 1}</legend>
        <label for="payment_amount_${index}">${translate("amount")}</label>
        <input type="number" step="0.01" min="0" id="payment_amount_${index}" name="amount_${index}">
        <label for="payment_date_${index}">${translate("payment_date")}</label>
        <input type="date" id="payment_date_${index}" name="payment_date_${index}" value="${today}">
        <label for="payment_method_${index}">${translate("payment_method")}</label>
        <select id="payment_method_${index}" name="method_${index}">
          <option value="cash">${translate("cash")}</option>
          <option value="card">${translate("card")}</option>
          <option value="etransfer">${translate("etransfer")}</option>
          <option value="cheque">${translate("cheque")}</option>
        </select>
        <label for="payment_reference_${index}">${translate("reference_number")}</label>
        <input type="text" id="payment_reference_${index}" name="reference_number_${index}">
      </fieldset>
    `;
  }

  addPaymentRow() {
    const container = document.getElementById('payment-rows');
    if (!container) return;
    const newIndex = container.querySelectorAll('.payment-row').length;
    container.insertAdjacentHTML('beforeend', this.renderPaymentRow(newIndex));
  }

  resetPaymentRows() {
    const container = document.getElementById('payment-rows');
    if (container) {
      setContent(container, this.renderPaymentRow(0));
    }
  }

  renderPlanModal() {
    return `
      <div id="plan-modal" class="modal" aria-hidden="true" role="dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h2 id="plan-modal-title">${translate("manage_installments")}</h2>
            <button class="modal-close" aria-label="${translate("close")}">&times;</button>
          </div>
          <div class="modal-body">
            <div id="plan-details" class="finance-list"></div>
            <form id="plan-form" class="finance-form" novalidate>
              <input type="hidden" id="plan_fee_id" name="participant_fee_id">
              <label for="plan_count">${translate("number_of_payments")}</label>
              <input type="number" min="1" id="plan_count" name="number_of_payments" required>
              <label for="plan_amount">${translate("amount_per_payment")}</label>
              <input type="number" step="0.01" min="0" id="plan_amount" name="amount_per_payment" required>
              <label for="plan_start">${translate("start_date")}</label>
              <input type="date" id="plan_start" name="start_date" required>
              <label for="plan_frequency">${translate("frequency")}</label>
              <select id="plan_frequency" name="frequency" required>
                <option value="monthly">${translate("monthly")}</option>
                <option value="biweekly">${translate("biweekly")}</option>
                <option value="weekly">${translate("weekly")}</option>
              </select>
              <label for="plan_notes">${translate("notes")}</label>
              <textarea id="plan_notes" name="notes" rows="2"></textarea>
              <div class="finance-actions">
                <button type="submit" class="primary-button">${translate("save")}</button>
                <button type="button" class="btn-danger" id="delete-plan-btn">${translate("delete")}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    document.querySelectorAll('.finance-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.activeTab = e.currentTarget.dataset.tab;
        const url = new URL(window.location.href);
        url.searchParams.set('tab', this.activeTab);
        window.history.replaceState({}, '', url.toString());
        this.render();
        this.attachEventListeners();
      });
    });

    // Sort button listeners
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const newSortField = e.currentTarget.dataset.sort;
        if (this.sortField === newSortField) {
          // Toggle direction if clicking the same field
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          // New field, default to ascending
          this.sortField = newSortField;
          this.sortDirection = 'asc';
        }
        this.render();
        this.attachEventListeners();
      });
    });

    const definitionForm = document.getElementById('fee-definition-form');
    if (definitionForm) {
      definitionForm.addEventListener('submit', (e) => this.handleDefinitionSubmit(e));
    }

    const resetDefinition = document.getElementById('reset-definition-form');
    if (resetDefinition) {
      resetDefinition.addEventListener('click', () => this.resetDefinitionForm());
    }

    document.querySelectorAll('[data-action="edit-definition"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this.populateDefinitionForm(e.currentTarget.dataset.id));
    });

    document.querySelectorAll('[data-action="delete-definition"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm(translate('confirm_delete'))) {
          await deleteFeeDefinition(id);
          await this.loadCoreData();
          this.render();
          this.attachEventListeners();
        }
      });
    });

    const participantFeeForm = document.getElementById('participant-fee-form');
    if (participantFeeForm) {
      participantFeeForm.addEventListener('submit', (e) => this.handleParticipantFeeSubmit(e));
    }

    const participantSelect = document.getElementById('participant_select');
    if (participantSelect) {
      participantSelect.addEventListener('change', () => this.syncParticipantFeeFormState());
    }

    const feeDefinitionSelect = document.getElementById('fee_definition');
    if (feeDefinitionSelect) {
      feeDefinitionSelect.addEventListener('change', (e) => {
        this.populateFeesFromDefinition(e.target.value);
        this.syncParticipantFeeFormState();
      });
      if (feeDefinitionSelect.value) {
        this.populateFeesFromDefinition(feeDefinitionSelect.value);
      } else {
        const defaultDefinitionId = this.getDefaultFeeDefinitionId();
        if (defaultDefinitionId) {
          feeDefinitionSelect.value = defaultDefinitionId;
          this.populateFeesFromDefinition(defaultDefinitionId);
        }
      }
    }

    this.syncParticipantFeeFormState();

    const planToggle = document.getElementById('enable_plan');
    const inlinePlanFields = document.getElementById('inline-plan-fields');
    if (planToggle && inlinePlanFields) {
      const syncVisibility = () => inlinePlanFields.classList.toggle('hidden', !planToggle.checked);
      planToggle.addEventListener('change', () => {
        syncVisibility();
        this.updateInlinePlanAmount();
      });
      syncVisibility();
    }

    const planPaymentsInput = document.getElementById('inline_number_of_payments');
    const membershipTotalInput = document.getElementById('membership_total');
    const registrationTotalInput = document.getElementById('registration_total');
    const recalcPlanAmount = () => this.updateInlinePlanAmount();

    planPaymentsInput?.addEventListener('input', recalcPlanAmount);
    membershipTotalInput?.addEventListener('input', recalcPlanAmount);
    registrationTotalInput?.addEventListener('input', recalcPlanAmount);

    document.querySelectorAll('[data-action="open-payment"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this.openPaymentModal(e.currentTarget.dataset.id));
    });

    document.querySelectorAll('[data-action="open-plan"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this.openPlanModal(e.currentTarget.dataset.id));
    });

    const installmentSelect = document.getElementById('installment_fee_select');
    const planShortcut = document.getElementById('open-plan-shortcut');
    const paymentShortcut = document.getElementById('open-payment-shortcut');
    const requireSelection = () => this.app.showMessage(translate('select_fee_before_action'), 'error');
    planShortcut?.addEventListener('click', () => {
      const selectedId = installmentSelect?.value;
      if (selectedId) {
        this.openPlanModal(selectedId);
      } else {
        requireSelection();
      }
    });
    paymentShortcut?.addEventListener('click', () => {
      const selectedId = installmentSelect?.value;
      if (selectedId) {
        this.openPaymentModal(selectedId);
      } else {
        requireSelection();
      }
    });

    const paymentModal = document.getElementById('payment-modal');
    if (paymentModal) {
      document.getElementById('ai-scan-receipt-btn')?.addEventListener('click', () => {
        document.getElementById('receipt-upload-input')?.click();
      });

      document.getElementById('receipt-upload-input')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const btn = document.getElementById('ai-scan-receipt-btn');
        const status = document.getElementById('scan-status');

        // Ensure setButtonLoading and aiParseReceipt are defined or imported
        // For this example, assuming they are globally available or part of `this.app`
        // If not, you'd need to define them or adjust the call.
        // For now, I'll assume `setButtonLoading` is available.
        // `aiParseReceipt` is also assumed to be available.

        if (btn) setButtonLoading(btn, true);
        if (status) status.textContent = translate("scanning_receipt");

        try {
          const result = await aiParseReceipt(file);
          const data = result.data;

          if (data.total) document.getElementById('expense-amount').value = data.total;
          if (data.date) document.getElementById('expense-date').value = data.date;
          if (data.vendor) document.getElementById('expense-merchant').value = data.vendor;
          // Use category or items for description if available, otherwise just "Receipt from [Vendor]"
          if (data.vendor) document.getElementById('expense-description').value = `${translate("purchase_at")} ${data.vendor}`;

          this.app.showMessage(translate("receipt_scanned_success"), "success");
          if (status) status.textContent = "";

        } catch (error) {
          let msg = error.message;
          if (error.error?.code === 'AI_BUDGET_EXCEEDED') msg = translate('ai_budget_exceeded');
          this.app.showMessage(translate("error_scanning_receipt") + ": " + msg, "error");
          if (status) status.textContent = translate("scan_failed");
        } finally {
          if (btn) setButtonLoading(btn, false);
          // Reset input so same file can be selected again
          e.target.value = '';
        }
      });

      paymentModal.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal(paymentModal));
      paymentModal.addEventListener('click', (e) => {
        if (e.target === paymentModal) {
          this.closeModal(paymentModal);
        }
      });
      const paymentForm = document.getElementById('payment-form');
      paymentForm?.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
      document.getElementById('add-payment-row')?.addEventListener('click', () => this.addPaymentRow());
    }

    const planModal = document.getElementById('plan-modal');
    if (planModal) {
      planModal.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal(planModal));
      planModal.addEventListener('click', (e) => {
        if (e.target === planModal) {
          this.closeModal(planModal);
        }
      });
      const planForm = document.getElementById('plan-form');
      planForm?.addEventListener('submit', (e) => this.handlePlanSubmit(e));
      document.getElementById('delete-plan-btn')?.addEventListener('click', () => this.handlePlanDelete());
    }
  }

  async handleDefinitionSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const definitionId = form.definition_id.value;
    const payload = {
      year_start: form.year_start.value,
      year_end: form.year_end.value,
      registration_fee: parseFloat(form.registration_fee.value || 0),
      membership_fee: parseFloat(form.membership_fee.value || 0)
    };

    try {
      if (definitionId) {
        await updateFeeDefinition(definitionId, payload);
      } else {
        await createFeeDefinition(payload);
      }
      await clearFinanceRelatedCaches();
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error saving fee definition', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  resetDefinitionForm() {
    const form = document.getElementById('fee-definition-form');
    if (form) {
      form.reset();
      form.definition_id.value = '';
    }
  }

  populateDefinitionForm(id) {
    const def = this.feeDefinitions.find((item) => String(item.id) === String(id));
    if (!def) return;
    const form = document.getElementById('fee-definition-form');
    if (!form) return;
    form.definition_id.value = def.id;
    form.year_start.value = def.year_start?.split('T')[0] || def.year_start;
    form.year_end.value = def.year_end?.split('T')[0] || def.year_end;
    form.registration_fee.value = def.registration_fee;
    form.membership_fee.value = def.membership_fee;
  }

  /**
   * Finds an existing participant fee for the current selection.
   * Prefers an exact fee definition match before falling back to any fee for the participant.
   * @param {number | null} participantId
   * @param {number | null} feeDefinitionId
   * @returns {object | null}
   */
  findExistingParticipantFee(participantId, feeDefinitionId) {
    if (!participantId) return null;
    if (feeDefinitionId) {
      const exactMatch = this.participantFees.find(
        (fee) => Number(fee.participant_id) === participantId && Number(fee.fee_definition_id) === feeDefinitionId
      );
      if (exactMatch) return exactMatch;
    }
    return this.participantFees.find((fee) => Number(fee.participant_id) === participantId) || null;
  }

  /**
   * Syncs the membership fee form with existing data and toggles the submit label.
   */
  syncParticipantFeeFormState() {
    const form = document.getElementById('participant-fee-form');
    if (!form) return;

    const participantId = Number.parseInt(form.participant_id.value, 10);
    const feeDefinitionId = Number.parseInt(form.fee_definition_id.value, 10);
    const normalizedParticipantId = Number.isNaN(participantId) ? null : participantId;
    const normalizedDefinitionId = Number.isNaN(feeDefinitionId) ? null : feeDefinitionId;
    const submitButton = form.querySelector('button[type="submit"]');

    if (!submitButton) return;

    const existingFee = this.findExistingParticipantFee(normalizedParticipantId, normalizedDefinitionId);

    if (existingFee) {
      form.dataset.participantFeeId = existingFee.id;
      if (existingFee.fee_definition_id) {
        form.fee_definition_id.value = existingFee.fee_definition_id;
      }
      if (existingFee.total_registration_fee !== undefined) {
        form.total_registration_fee.value = existingFee.total_registration_fee;
      }
      if (existingFee.total_membership_fee !== undefined) {
        form.total_membership_fee.value = existingFee.total_membership_fee;
      }
      form.notes.value = existingFee.notes || '';
      submitButton.textContent = translate('modify');
    } else {
      form.dataset.participantFeeId = '';
      submitButton.textContent = translate('save');
      form.notes.value = '';
      if (normalizedDefinitionId) {
        this.populateFeesFromDefinition(normalizedDefinitionId);
      }
    }

    this.updateInlinePlanAmount();
  }

  /**
   * Calculates the base total for plan generation using the outstanding amount when available.
   * Falls back to the current form totals when creating a new fee.
   * @param {HTMLFormElement} form
   * @param {object | null} existingFee
   * @returns {number}
   */
  getPlanBaseAmount(form, existingFee) {
    if (existingFee) {
      const outstanding = this.getOutstanding(existingFee);
      if (outstanding > 0) {
        return outstanding;
      }
      const totalAmount = Number(existingFee.total_amount) || 0;
      if (totalAmount > 0) {
        return totalAmount - (Number(existingFee.total_paid) || 0);
      }
      const registration = Number(existingFee.total_registration_fee) || 0;
      const membership = Number(existingFee.total_membership_fee) || 0;
      return registration + membership;
    }

    const registration = Number.parseFloat(form.total_registration_fee.value || 0) || 0;
    const membership = Number.parseFloat(form.total_membership_fee.value || 0) || 0;
    return registration + membership;
  }

  /**
   * Auto-calculates the inline plan amount per payment using the number of installments.
   */
  updateInlinePlanAmount() {
    const form = document.getElementById('participant-fee-form');
    if (!form || !form.enable_plan?.checked) return;

    const paymentsCount = Number.parseInt(form.plan_number_of_payments.value, 10);
    if (!paymentsCount || paymentsCount <= 0) return;

    const participantId = Number.parseInt(form.participant_id.value, 10);
    const feeDefinitionId = Number.parseInt(form.fee_definition_id.value, 10);
    const normalizedParticipantId = Number.isNaN(participantId) ? null : participantId;
    const normalizedDefinitionId = Number.isNaN(feeDefinitionId) ? null : feeDefinitionId;
    const existingFee = this.findExistingParticipantFee(normalizedParticipantId, normalizedDefinitionId);
    const baseAmount = this.getPlanBaseAmount(form, existingFee);

    if (baseAmount <= 0) return;

    const amountPerPayment = baseAmount / paymentsCount;
    form.plan_amount_per_payment.value = amountPerPayment.toFixed(2);
  }

  async handleParticipantFeeSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const planEnabled = form.enable_plan?.checked;
    const existingFeeId = form.dataset.participantFeeId;
    const payload = {
      participant_id: parseInt(form.participant_id.value, 10),
      fee_definition_id: parseInt(form.fee_definition_id.value, 10),
      total_membership_fee: parseFloat(form.total_membership_fee.value || 0),
      notes: form.notes.value || ''
    };

    if (
      planEnabled &&
      (!form.plan_number_of_payments.value || !form.plan_amount_per_payment.value || !form.plan_start_date.value)
    ) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      let targetFeeId = existingFeeId || null;

      if (existingFeeId) {
        await updateParticipantFee(existingFeeId, payload);
      } else {
        const created = await createParticipantFee(payload);
        targetFeeId = created?.data?.id || created?.participant_fee?.id || created?.id;
        if (planEnabled && targetFeeId) {
          const paymentsCount = parseInt(form.plan_number_of_payments.value || 0, 10);
          const amountPerPayment = parseFloat(form.plan_amount_per_payment.value || 0);
          if (!paymentsCount || !amountPerPayment) {
            this.app.showMessage(translate('plan_fields_required'), 'error');
            return;
          }
          const planPayload = {
            number_of_payments: paymentsCount,
            amount_per_payment: amountPerPayment,
            start_date: form.plan_start_date.value,
            frequency: form.plan_frequency.value,
            notes: form.plan_notes.value
          };
          await createPaymentPlan(targetFeeId, planPayload);
        }
      }

      // Clear all finance caches
      await clearFinanceRelatedCaches(targetFeeId);

      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error saving participant fee', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  async openPaymentModal(feeId) {
    // Clean up any existing modal first (prevent accumulation)
    const existingModal = document.getElementById('payment-modal');
    if (existingModal && existingModal.classList.contains('show')) {
      this.closeModal(existingModal);
      // Small delay to allow close animation
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }

    const modal = document.getElementById('payment-modal');
    if (!modal) return;

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('payment_fee_id').value = feeId;
    this.resetPaymentRows();

    const fee = this.participantFees.find((item) => String(item.id) === String(feeId));
    this.updatePaymentSummary(fee);
    this.prefillPaymentRowAmounts(fee);
    await this.renderPaymentHistory(feeId);
  }

  closeModal(modalElement) {
    modalElement.classList.remove('show');
    modalElement.setAttribute('aria-hidden', 'true');
  }

  async renderPaymentHistory(feeId) {
    const historyContainer = document.getElementById('payment-history');
    if (!historyContainer) return;
    try {
      if (!this.paymentsCache.has(feeId)) {
        const payments = await getParticipantPayments(feeId);
        this.paymentsCache.set(feeId, payments?.data || payments?.payments || []);
      }
      const payments = this.paymentsCache.get(feeId);
      setContent(historyContainer, payments.length
        ? payments
          .map(
            (payment) => `
                <div class="finance-list__row" data-payment-id="${payment.id}">
                  <div>
                    <p class="finance-meta">${formatDateShort(payment.payment_date)}</p>
                    <p class="finance-meta">${translate(payment.method || "")}</p>
                  </div>
                  <div class="finance-row-values">
                    <span>${this.formatCurrency(payment.amount)}</span>
                    ${payment.reference_number ? `<span>${escapeHTML(payment.reference_number)}</span>` : ""}
                  </div>
                </div>
              `
          )
          .join("")
        : `<p class="finance-helper">${translate("no_payments")}</p>`);
    } catch (error) {
      debugError('Error loading payments', error);
      setContent(historyContainer, `<p class="finance-helper">${translate("error_loading_data")}</p>`);
    }
  }

  updatePaymentSummary(fee) {
    const labelEl = document.getElementById('payment-total-label');
    const outputEl = document.getElementById('payment-total-output');
    if (!labelEl || !outputEl) return;

    if (!fee) {
      labelEl.textContent = translate('total_amount');
      outputEl.value = '--';
      return;
    }

    const outstanding = this.getOutstanding(fee);
    const totalAmount = Number(fee.total_amount) || 0;
    const hasPartialBalance = outstanding > 0 && outstanding < totalAmount;
    const labelKey = hasPartialBalance ? 'balance_due' : 'total_amount';
    const displayAmount = hasPartialBalance ? outstanding : totalAmount || outstanding;

    labelEl.textContent = translate(labelKey);
    outputEl.value = this.formatCurrency(displayAmount);
  }

  prefillPaymentRowAmounts(fee) {
    const firstAmountInput = document.querySelector('#payment-rows [name="amount_0"]');
    if (!firstAmountInput || !fee) return;

    // Check if there's a cached last payment amount for this fee
    const lastAmount = this.lastPaymentAmounts.get(fee.id);
    if (lastAmount !== undefined && lastAmount > 0) {
      firstAmountInput.value = lastAmount.toFixed(2);
      return;
    }

    // Otherwise use outstanding balance or total amount
    const totalAmount = Number(fee.total_amount) || 0;
    const outstanding = this.getOutstanding(fee);
    const preferredAmount = fee.status === 'paid'
      ? totalAmount || outstanding
      : outstanding || totalAmount;

    if (preferredAmount > 0) {
      firstAmountInput.value = preferredAmount.toFixed(2);
    } else {
      firstAmountInput.value = '';
    }
  }

  async handlePaymentSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const feeId = form.participant_fee_id.value;
    const rows = Array.from(document.querySelectorAll('#payment-rows .payment-row'));

    // Validate and collect payments with improved validation
    const validationErrors = [];
    const payments = rows
      .map((row, rowIndex) => {
        const index = row.dataset.index;
        const amountInput = row.querySelector(`[name="amount_${index}"]`)?.value;
        const dateInput = row.querySelector(`[name="payment_date_${index}"]`)?.value;
        const method = row.querySelector(`[name="method_${index}"]`)?.value || 'cash';
        const reference_number = row.querySelector(`[name="reference_number_${index}"]`)?.value || '';

        // Skip empty rows
        if (!amountInput && !dateInput) {
          return null;
        }

        // Validate amount
        const amountValidation = validateMoney(amountInput, `Amount (Row ${rowIndex + 1})`, { min: 0.01 });
        if (!amountValidation.valid) {
          validationErrors.push(amountValidation.error);
          return null;
        }

        // Validate date
        const dateValidation = validateDateField(dateInput, `Date (Row ${rowIndex + 1})`);
        if (!dateValidation.valid) {
          validationErrors.push(dateValidation.error);
          return null;
        }

        return {
          amount: amountValidation.value,
          payment_date: dateInput,
          method,
          reference_number
        };
      })
      .filter(Boolean);

    // Show validation errors
    if (validationErrors.length > 0) {
      this.app.showMessage(validationErrors[0], 'error');
      return;
    }

    if (!payments.length) {
      this.app.showMessage(translate('enter_payment_before_save'), 'error');
      return;
    }

    // Cache the first payment amount for this fee
    if (payments.length > 0) {
      this.lastPaymentAmounts.set(feeId, payments[0].amount);
    }

    try {
      for (const payment of payments) {
        // eslint-disable-next-line no-await-in-loop
        await createParticipantPayment(feeId, payment);
      }

      // Clear finance caches
      await clearFinanceRelatedCaches(feeId);

      this.resetPaymentRows();
      this.paymentsCache.delete(feeId);
      await this.renderPaymentHistory(feeId);
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('payment_saved'), 'success');
    } catch (error) {
      debugError('Error saving payment', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  async openPlanModal(feeId) {
    // Clean up any existing modal first (prevent accumulation)
    const existingModal = document.getElementById('plan-modal');
    if (existingModal && existingModal.classList.contains('show')) {
      this.closeModal(existingModal);
      // Small delay to allow close animation
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }

    const modal = document.getElementById('plan-modal');
    if (!modal) return;

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('plan_fee_id').value = feeId;
    await this.renderPlanDetails(feeId);
  }

  async renderPlanDetails(feeId) {
    const planContainer = document.getElementById('plan-details');
    if (!planContainer) return;
    try {
      if (!this.paymentPlanCache.has(feeId)) {
        const plans = await getPaymentPlans(feeId);
        this.paymentPlanCache.set(feeId, plans?.data || plans?.plans || []);
      }
      const plans = this.paymentPlanCache.get(feeId);
      const plan = plans[0];
      setContent(planContainer, plans.length
        ? `
            <div class="finance-list__row">
              <div>
                <p class="finance-meta">${translate("number_of_payments")}: ${plan.number_of_payments}</p>
                <p class="finance-meta">${translate("frequency")}: ${translate(plan.frequency || "")}</p>
              </div>
              <div class="finance-row-values">
                <span>${this.formatCurrency(plan.amount_per_payment)}</span>
                <span>${formatDateShort(plan.start_date)}</span>
              </div>
            </div>
          `
        : `<p class="finance-helper">${translate("no_payment_plan")}</p>`);
      const form = document.getElementById('plan-form');
      if (form) {
        if (plan) {
          form.plan_count.value = plan.number_of_payments;
          form.plan_amount.value = plan.amount_per_payment;
          form.plan_start.value = plan.start_date?.split('T')[0] || plan.start_date;
          form.plan_frequency.value = plan.frequency;
          form.plan_notes.value = plan.notes || '';
          form.dataset.planId = plan.id;
        } else {
          form.reset();
          form.dataset.planId = '';
        }
      }
    } catch (error) {
      debugError('Error loading payment plan', error);
      setContent(planContainer, `<p class="finance-helper">${translate("error_loading_data")}</p>`);
    }
  }

  async handlePlanSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const feeId = form.participant_fee_id.value;
    const planId = form.dataset.planId;
    const payload = {
      number_of_payments: parseInt(form.number_of_payments.value, 10),
      amount_per_payment: parseFloat(form.amount_per_payment.value || 0),
      start_date: form.start_date.value,
      frequency: form.frequency.value,
      notes: form.notes.value
    };

    try {
      if (planId) {
        await updatePaymentPlan(planId, payload);
      } else {
        await createPaymentPlan(feeId, payload);
      }

      // Clear finance caches
      await clearFinanceRelatedCaches(feeId);

      this.paymentPlanCache.delete(feeId);
      await this.renderPlanDetails(feeId);
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error saving payment plan', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  async handlePlanDelete() {
    const form = document.getElementById('plan-form');
    const planId = form?.dataset.planId;
    const feeId = form?.participant_fee_id.value;
    if (!planId || !feeId) return;
    if (!confirm(translate('confirm_delete'))) return;
    try {
      await deletePaymentPlan(planId);

      // Clear finance caches
      await clearFinanceRelatedCaches(feeId);

      this.paymentPlanCache.delete(feeId);
      await this.renderPlanDetails(feeId);
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error deleting payment plan', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  /**
   * Clean up resources when navigating away
   * Called automatically by router
   */
  destroy() {
    super.destroy();
    // Clear data references
    this.feeDefinitions = [];
    this.participantFees = [];
    this.participants = [];
    this.financeSummary = null;
    // Clear caches
    this.paymentsCache.clear();
    this.paymentPlanCache.clear();
    this.lastPaymentAmounts.clear();
  }
}
