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
import { debugError } from "./utils/DebugUtils.js";
import { formatDateShort, getTodayISO } from "./utils/DateUtils.js";

const DEFAULT_CURRENCY = "CAD";

export class Finance {
  constructor(app) {
    this.app = app;
    this.feeDefinitions = [];
    this.participantFees = [];
    this.participants = [];
    this.financeSummary = null;
    this.activeTab = "memberships";
    this.paymentsCache = new Map();
    this.paymentPlanCache = new Map();
  }

  async init() {
    this.setActiveTabFromQuery();
    try {
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Unable to initialize finance page", error);
      this.app.showMessage(translate("error_loading_data"), "error");
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
    const [fees, feeDefs, participants, summary] = await Promise.all([
      getParticipantFees(),
      getFeeDefinitions(),
      getParticipants(),
      getFinanceReport()
    ]);

    this.participantFees = fees?.data || fees?.participant_fees || [];
    this.feeDefinitions = feeDefs?.data || feeDefs?.fee_definitions || [];
    this.participants = participants?.data || participants?.participants || [];
    this.financeSummary = summary?.data || null;
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

  render() {
    const content = `
      <section class="finance-page">
        <header class="finance-header">
          <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <div>
            <p class="finance-kicker">${translate("dashboard_day_to_day_section")}</p>
            <h1>${translate("finance_center_title")}</h1>
            <p class="finance-subtitle">${translate("finance_center_subtitle")}</p>
          </div>
        </header>
        <div class="finance-tabs" role="tablist">
          ${this.renderTabButton("memberships", translate("finance_memberships_tab"))}
          ${this.app.userRole === "admin" ? this.renderTabButton("definitions", translate("finance_definitions_tab")) : ""}
          ${["admin", "animation"].includes(this.app.userRole) ? this.renderTabButton("reports", translate("financial_report")) : ""}
        </div>
        <div id="finance-content" class="finance-content" aria-live="polite">
          ${this.renderActiveTab()}
        </div>
      </section>
      ${this.renderPaymentModal()}
      ${this.renderPlanModal()}
    `;

    document.getElementById("app").innerHTML = content;
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
    if (this.app.userRole !== "admin") {
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
    const defaultDefinitionId = this.getDefaultFeeDefinitionId();
    return `
      <div class="finance-grid">
        <section class="finance-card">
          <h2>${translate("assign_membership_fee")}</h2>
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
                    <option value="${def.id}" ${defaultDefinitionId === Number(def.id) ? "selected" : ""}>${this.formatYearRange(def.year_start, def.year_end)}</option>
                  `
                )
                .join("")}
            </select>
            <label for="registration_total">${translate("registration_fee_label")}</label>
            <input type="number" step="0.01" min="0" id="registration_total" name="total_registration_fee" required>
            <label for="membership_total">${translate("membership_fee_label")}</label>
            <input type="number" step="0.01" min="0" id="membership_total" name="total_membership_fee" required>
            <label for="fee_status">${translate("status")}</label>
            <select id="fee_status" name="status">
              <option value="unpaid">${translate("unpaid")}</option>
              <option value="partial">${translate("partial")}</option>
              <option value="paid">${translate("paid")}</option>
            </select>
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
        </section>
      </div>
      <section class="finance-list">
        ${this.participantFees.length ? this.participantFees.map((fee) => this.renderParticipantFeeCard(fee)).join("") : `<p class="finance-helper">${translate("no_participant_fees")}</p>`}
      </section>
    `;
  }

  renderParticipantFeeCard(fee) {
    const participantName = `${escapeHTML(fee.first_name || "")} ${escapeHTML(fee.last_name || "")}`;
    const plan = (this.paymentPlanCache.get(fee.id) || [])[0];
    const statusLabel = translate(fee.status) || fee.status;
    const planSummaryLabel = translate("payment_plan_summary");
    return `
      <article class="finance-card" data-fee-id="${fee.id}">
        <div class="finance-card__header">
          <div>
            <h3>${participantName}</h3>
            <p class="finance-meta">${translate("billing_period")}: ${formatDateShort(fee.year_start)} → ${formatDateShort(fee.year_end)}</p>
          </div>
          <span class="finance-pill">${statusLabel}</span>
        </div>
        <div class="finance-amounts">
          <div>
            <p class="finance-stat__label">${translate("total_billed")}</p>
            <p class="finance-stat__value">${this.formatCurrency(fee.total_amount)}</p>
          </div>
          <div>
            <p class="finance-stat__label">${translate("total_paid")}</p>
            <p class="finance-stat__value">${this.formatCurrency(fee.total_paid)}</p>
          </div>
          <div>
            <p class="finance-stat__label">${translate("outstanding_balance")}</p>
            <p class="finance-stat__value finance-stat__value--alert">${this.formatCurrency(fee.outstanding)}</p>
          </div>
        </div>
        <div class="finance-inline-form">
          <div>
            <label for="status-${fee.id}">${translate("status")}</label>
            <select id="status-${fee.id}" data-field="status">
              <option value="unpaid" ${fee.status === "unpaid" ? "selected" : ""}>${translate("unpaid")}</option>
              <option value="partial" ${fee.status === "partial" ? "selected" : ""}>${translate("partial")}</option>
              <option value="paid" ${fee.status === "paid" ? "selected" : ""}>${translate("paid")}</option>
            </select>
          </div>
          <div>
            <label for="notes-${fee.id}">${translate("notes")}</label>
            <textarea id="notes-${fee.id}" data-field="notes" rows="2">${escapeHTML(fee.notes || "")}</textarea>
          </div>
          <button class="secondary-button" data-action="save-fee" data-id="${fee.id}">${translate("save")}</button>
        </div>
        ${plan ? `<p class="finance-meta">${planSummaryLabel}: ${plan.number_of_payments} × ${this.formatCurrency(plan.amount_per_payment)} • ${translate(plan.frequency || "")}</p>` : ""}
        <div class="finance-actions">
          <button class="primary-button" data-action="open-payment" data-id="${fee.id}">${translate("view_payments")}</button>
          <button class="ghost-button" data-action="open-plan" data-id="${fee.id}">${translate("manage_installments")}</button>
        </div>
      </article>
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
      container.innerHTML = this.renderPaymentRow(0);
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

    const feeDefinitionSelect = document.getElementById('fee_definition');
    if (feeDefinitionSelect) {
      feeDefinitionSelect.addEventListener('change', (e) => this.populateFeesFromDefinition(e.target.value));
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

    const planToggle = document.getElementById('enable_plan');
    const inlinePlanFields = document.getElementById('inline-plan-fields');
    if (planToggle && inlinePlanFields) {
      const syncVisibility = () => inlinePlanFields.classList.toggle('hidden', !planToggle.checked);
      planToggle.addEventListener('change', syncVisibility);
      syncVisibility();
    }

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

    document.querySelectorAll('[data-action="save-fee"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this.saveFeeUpdates(e.currentTarget.dataset.id));
    });

    const paymentModal = document.getElementById('payment-modal');
    if (paymentModal) {
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

  async handleParticipantFeeSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const planEnabled = form.enable_plan?.checked;
    const payload = {
      participant_id: parseInt(form.participant_id.value, 10),
      fee_definition_id: parseInt(form.fee_definition_id.value, 10),
      total_registration_fee: parseFloat(form.total_registration_fee.value || 0),
      total_membership_fee: parseFloat(form.total_membership_fee.value || 0),
      status: form.status.value,
      notes: form.notes.value
    };

    if (
      planEnabled &&
      (!form.plan_number_of_payments.value || !form.plan_amount_per_payment.value || !form.plan_start_date.value)
    ) {
      this.app.showMessage(translate('plan_fields_required'), 'error');
      return;
    }

    try {
      const created = await createParticipantFee(payload);
      const createdFeeId = created?.data?.id || created?.participant_fee?.id || created?.id;
      if (planEnabled && createdFeeId) {
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
        await createPaymentPlan(createdFeeId, planPayload);
      }
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error creating participant fee', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  async saveFeeUpdates(feeId) {
    const statusField = document.getElementById(`status-${feeId}`);
    const notesField = document.getElementById(`notes-${feeId}`);
    try {
      await updateParticipantFee(feeId, {
        status: statusField?.value,
        notes: notesField?.value
      });
      await this.loadCoreData();
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate('data_saved'), 'success');
    } catch (error) {
      debugError('Error updating participant fee', error);
      this.app.showMessage(translate('error_saving_changes'), 'error');
    }
  }

  async openPaymentModal(feeId) {
    const modal = document.getElementById('payment-modal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('payment_fee_id').value = feeId;
    this.resetPaymentRows();
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
      historyContainer.innerHTML = payments.length
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
        : `<p class="finance-helper">${translate("no_payments")}</p>`;
    } catch (error) {
      debugError('Error loading payments', error);
      historyContainer.innerHTML = `<p class="finance-helper">${translate("error_loading_data")}</p>`;
    }
  }

  async handlePaymentSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const feeId = form.participant_fee_id.value;
    const rows = Array.from(document.querySelectorAll('#payment-rows .payment-row'));
    const payments = rows
      .map((row) => {
        const index = row.dataset.index;
        const amount = parseFloat(row.querySelector(`[name="amount_${index}"]`)?.value || 0);
        const payment_date = row.querySelector(`[name="payment_date_${index}"]`)?.value;
        const method = row.querySelector(`[name="method_${index}"]`)?.value || 'cash';
        const reference_number = row.querySelector(`[name="reference_number_${index}"]`)?.value || '';
        if (!amount || amount <= 0 || !payment_date) {
          return null;
        }
        return { amount, payment_date, method, reference_number };
      })
      .filter(Boolean);

    if (!payments.length) {
      this.app.showMessage(translate('enter_payment_before_save'), 'error');
      return;
    }

    try {
      for (const payment of payments) {
        // eslint-disable-next-line no-await-in-loop
        await createParticipantPayment(feeId, payment);
      }
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
      planContainer.innerHTML = plans.length
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
        : `<p class="finance-helper">${translate("no_payment_plan")}</p>`;

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
      planContainer.innerHTML = `<p class="finance-helper">${translate("error_loading_data")}</p>`;
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
}
