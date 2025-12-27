import {
  getCurrentOrganizationId,
  fetchParticipants,
  getParticipantStatement
} from "./ajax-functions.js";
import { createStripePaymentIntent, getStripePaymentStatus } from "./api/api-endpoints.js";
import { clearFinanceRelatedCaches } from "./indexedDB.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { CONFIG } from './config.js';
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDateShort } from "./utils/DateUtils.js";
import { LoadingStateManager, retryWithBackoff } from "./utils/PerformanceUtils.js";
import { isParent } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

export class ParentFinance {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.participantStatements = new Map();
    this.consolidatedTotals = {
      total_billed: 0,
      total_paid: 0,
      total_outstanding: 0
    };

    // Loading state management
    this.loadingManager = new LoadingStateManager();
    this.isInitializing = false;

    // Stripe integration
    this.stripe = null;
    this.elements = null;
    this.paymentElement = null;
    this.currentPaymentIntentId = null;
    this.currentFeeId = null;
  }

  async init() {
    // Prevent race conditions - only one init at a time
    if (this.isInitializing) {
      debugError("ParentFinance init already in progress, skipping duplicate call");
      return;
    }

    this.isInitializing = true;
    let hasErrors = false;

    try {
      // Initialize Stripe
      await this.initializeStripe();

      // Render loading state immediately
      this.renderLoading();

      try {
        await this.fetchParticipants();
      } catch (error) {
        debugError("Error fetching participants:", error);
        hasErrors = true;
        // Continue with empty participants array
      }

      try {
        await this.fetchAllStatements();
      } catch (error) {
        debugError("Error fetching statements:", error);
        hasErrors = true;
        // Continue with empty statements
      }

      this.calculateConsolidatedTotals();

      // Render with data
      this.render();
      this.attachEventListeners();

      if (hasErrors) {
        this.app.showMessage(translate("error_loading_data"), "warning");
      }
    } catch (error) {
      debugError("Error rendering parent finance page:", error);
      this.render();
      this.attachEventListeners();
      this.app.showMessage(translate("error_loading_data"), "error");
    } finally {
      this.isInitializing = false;
    }
  }

  async initializeStripe() {
    try {
      // Load Stripe.js dynamically
      if (!window.Stripe) {
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.async = true;
        document.head.appendChild(script);

        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
      }

      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        debugError("Stripe publishable key not found in environment");
        return;
      }

      this.stripe = window.Stripe(publishableKey);
      debugLog("Stripe initialized successfully");
    } catch (error) {
      debugError("Error initializing Stripe:", error);
    }
  }

  async fetchParticipants() {
    return this.loadingManager.withLoading('participants', async () => {
      try {
        const response = await retryWithBackoff(
          () => fetchParticipants(getCurrentOrganizationId()),
          {
            maxRetries: 2,
            onRetry: (attempt, max, delay) => {
              debugLog(`Retrying fetchParticipants (${attempt}/${max}) in ${delay}ms`);
            }
          }
        );

        const uniqueParticipants = new Map();

        if (Array.isArray(response)) {
          response.forEach(participant => {
            if (!uniqueParticipants.has(participant.id)) {
              uniqueParticipants.set(participant.id, participant);
            }
          });
        }

        this.participants = Array.from(uniqueParticipants.values());
        debugLog("Fetched participants for finance:", this.participants);
      } catch (error) {
        debugError("Error fetching participants:", error);
        this.participants = [];
        throw error;
      }
    });
  }

  async fetchAllStatements() {
    try {
      // If there are no participants, skip fetching statements
      if (!this.participants || this.participants.length === 0) {
        debugLog("No participants to fetch statements for");
        return;
      }

      const statementPromises = this.participants.map(participant =>
        getParticipantStatement(participant.id)
          .then(response => ({
            participantId: participant.id,
            statement: response?.data || response
          }))
          .catch(error => {
            debugError(`Error fetching statement for participant ${participant.id}:`, error);
            return {
              participantId: participant.id,
              statement: null
            };
          })
      );

      const statements = await Promise.all(statementPromises);
      statements.forEach(({ participantId, statement }) => {
        if (statement) {
          this.participantStatements.set(participantId, statement);
        }
      });

      debugLog("Fetched all statements:", this.participantStatements);
    } catch (error) {
      debugError("Error fetching participant statements:", error);
      // Don't throw - let init continue with empty statements
      throw error;
    }
  }

  calculateConsolidatedTotals() {
    this.consolidatedTotals = {
      total_billed: 0,
      total_paid: 0,
      total_outstanding: 0
    };

    this.participantStatements.forEach(statement => {
      const totals = statement?.totals || {};
      this.consolidatedTotals.total_billed += Number(totals.total_billed) || 0;
      this.consolidatedTotals.total_paid += Number(totals.total_paid) || 0;
      this.consolidatedTotals.total_outstanding += Number(totals.total_outstanding) || 0;
    });

    debugLog("Consolidated totals:", this.consolidatedTotals);
  }

  formatCurrency(amount = 0) {
    const numericValue = Number.parseFloat(amount);
    if (!Number.isFinite(numericValue)) {
      return this.formatCurrency(0);
    }

    const locale = this.app?.language || CONFIG.DEFAULT_LANG || 'en';
    const currency = CONFIG.DEFAULT_CURRENCY || 'CAD';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
  }

  renderLoading() {
    const backLink = isParent()
      ? `<a href="/parent-dashboard" class="back-link">${translate("back_to_dashboard")}</a>`
      : `<a href="/dashboard" class="back-link">${translate("back_to_dashboard")}</a>`;

    const content = `
      <div class="parent-finance-page">
        ${backLink}
        <h1>${translate("participant_finance_statements")}</h1>
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p>${translate("loading")}...</p>
        </div>
      </div>
    `;

    setContent(document.getElementById("app"), content);
  }

  render() {
    const backLink = isParent()
      ? `<a href="/parent-dashboard" class="back-link">${translate("back_to_dashboard")}</a>`
      : `<a href="/dashboard" class="back-link">${translate("back_to_dashboard")}</a>`;

    const content = `
      <section class="parent-finance-page">
        <header class="finance-header">
          <a href="/parent-dashboard" class="button button--ghost">← ${translate("back")}</a>
          <div>
            <h1>${translate("my_finances")}</h1>
            <p class="finance-subtitle">${translate("view_your_financial_summary")}</p>
          </div>
        </header>

        ${this.renderConsolidatedSummary()}

        <div class="finance-section">
          <h2>${translate("by_participant")}</h2>
          ${this.renderParticipantStatements()}
        </div>
      </section>
    `;

    setContent(document.getElementById("app"), content);
  }

  renderConsolidatedSummary() {
    if (this.participants.length === 0) {
      return `<p class="finance-helper">${translate("no_participants")}</p>`;
    }

    return `
      <article class="finance-card finance-card--highlight">
        <h2>${translate("consolidated_balance")}</h2>
        <div class="finance-stats">
          <div>
            <p class="finance-stat__label">${translate("total_billed")}</p>
            <p class="finance-stat__value">${this.formatCurrency(this.consolidatedTotals.total_billed)}</p>
          </div>
          <div>
            <p class="finance-stat__label">${translate("total_paid")}</p>
            <p class="finance-stat__value">${this.formatCurrency(this.consolidatedTotals.total_paid)}</p>
          </div>
          <div>
            <p class="finance-stat__label">${translate("outstanding_balance")}</p>
            <p class="finance-stat__value finance-stat__value--alert">${this.formatCurrency(this.consolidatedTotals.total_outstanding)}</p>
          </div>
        </div>
      </article>
    `;
  }

  renderParticipantStatements() {
    if (this.participants.length === 0) {
      return `<p class="finance-helper">${translate("no_participants")}</p>`;
    }

    return this.participants
      .map(participant => {
        const statement = this.participantStatements.get(participant.id);
        const totals = statement?.totals || {
          total_billed: 0,
          total_paid: 0,
          total_outstanding: 0
        };

        const participantName = escapeHTML(`${participant.first_name} ${participant.last_name}`);
        const fees = statement?.fees || [];

        return `
          <article class="finance-card" data-participant-id="${participant.id}">
            <div class="finance-card__header">
              <h3>${participantName}</h3>
              ${totals.total_outstanding > 0
                ? `<span class="finance-pill finance-pill--warning">${translate("amount_due")}</span>`
                : `<span class="finance-pill finance-pill--success">${translate("paid")}</span>`
              }
            </div>

            <div class="finance-amounts">
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

            ${fees.length > 0 ? `
              <details class="finance-details">
                <summary class="finance-details__summary">${translate("view_details")}</summary>
                <div class="finance-details__content">
                  ${this.renderFeeDetails(fees)}
                </div>
              </details>
            ` : ''}
          </article>
        `;
      })
      .join("");
  }

  renderFeeDetails(fees) {
    return fees
      .map(fee => {
        const yearRange = this.formatYearRange(fee.year_start, fee.year_end);
        const statusLabel = translate(fee.status) || fee.status;
        const hasOutstanding = fee.outstanding > 0;

        return `
          <div class="finance-list__row" data-fee-id="${fee.id}">
            <div>
              <p class="finance-meta"><strong>${yearRange}</strong></p>
              <p class="finance-meta">${translate("status")}: ${statusLabel}</p>
            </div>
            <div class="finance-row-values">
              <div>
                <p class="finance-meta">${translate("total_billed")}</p>
                <span>${this.formatCurrency(fee.total_amount)}</span>
              </div>
              <div>
                <p class="finance-meta">${translate("total_paid")}</p>
                <span>${this.formatCurrency(fee.total_paid)}</span>
              </div>
              <div>
                <p class="finance-meta">${translate("outstanding_balance")}</p>
                <span class="finance-stat__value--alert">${this.formatCurrency(fee.outstanding)}</span>
              </div>
            </div>
            ${hasOutstanding ? `
              <div class="finance-actions">
                <button
                  class="btn btn-primary pay-now-btn"
                  data-fee-id="${fee.id}"
                  data-amount="${fee.outstanding}"
                  data-participant-name="${escapeHTML(fee.participant_name || '')}"
                >
                  💳 ${translate("pay_now")} (${this.formatCurrency(fee.outstanding)})
                </button>
              </div>
            ` : ''}
          </div>
        `;
      })
      .join("");
  }

  formatYearRange(start, end) {
    const startYear = this.extractYear(start);
    const endYear = this.extractYear(end);

    if (startYear && endYear) {
      return startYear === endYear
        ? String(startYear)
        : `${startYear}-${endYear}`;
    }
    if (startYear || endYear) {
      return String(startYear || endYear);
    }
    return translate("unknown");
  }

  extractYear(dateValue) {
    if (!dateValue) return null;
    const parsedDate = new Date(dateValue);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getFullYear();
    }

    const match = String(dateValue).match(/\d{4}/);
    return match ? Number(match[0]) : null;
  }

  attachEventListeners() {
    // Attach pay now button listeners
    const payButtons = document.querySelectorAll('.pay-now-btn');
    payButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const feeId = e.target.dataset.feeId;
        const amount = parseFloat(e.target.dataset.amount);
        const participantName = e.target.dataset.participantName;
        this.openPaymentModal(feeId, amount, participantName);
      });
    });

    debugLog("Parent finance event listeners attached");
  }

  openPaymentModal(feeId, amount, participantName) {
    if (!this.stripe) {
      this.app.showMessage(translate("payment_system_unavailable"), "error");
      return;
    }

    this.currentFeeId = feeId;

    // Render payment modal
    const modalHTML = this.renderPaymentModal(feeId, amount, participantName);
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Attach modal event listeners
    this.attachModalEventListeners(feeId, amount);
  }

  renderPaymentModal(feeId, amount, participantName) {
    return `
      <div class="modal-overlay" id="payment-modal">
        <div class="modal-content payment-modal">
          <div class="modal-header">
            <h2>💳 ${translate("make_payment")}</h2>
            <button class="modal-close" id="close-payment-modal">&times;</button>
          </div>

          <div class="modal-body">
            <div class="payment-info">
              <p><strong>${translate("participant")}:</strong> ${escapeHTML(participantName)}</p>
              <p><strong>${translate("amount_to_pay")}:</strong> ${this.formatCurrency(amount)}</p>
            </div>

            <div class="payment-form-container">
              <div id="payment-element"></div>
              <div id="payment-error-message" class="error-message"></div>
            </div>

            <div class="payment-actions">
              <button class="btn btn-secondary" id="cancel-payment">${translate("cancel")}</button>
              <button class="btn btn-primary" id="submit-payment" disabled>
                <span class="payment-btn-text">${translate("pay")} ${this.formatCurrency(amount)}</span>
                <span class="payment-btn-spinner" style="display: none;">
                  <span class="spinner"></span> ${translate("processing")}...
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  attachModalEventListeners(feeId, amount) {
    const modal = document.getElementById('payment-modal');
    const closeBtn = document.getElementById('close-payment-modal');
    const cancelBtn = document.getElementById('cancel-payment');
    const submitBtn = document.getElementById('submit-payment');

    const closeModal = () => {
      modal.remove();
      this.elements = null;
      this.paymentElement = null;
      this.currentPaymentIntentId = null;
      this.currentFeeId = null;
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Initialize payment
    this.initializePayment(feeId, amount, submitBtn);
  }

  async initializePayment(feeId, amount, submitBtn) {
    try {
      // Create payment intent
      const response = await createStripePaymentIntent(feeId, amount);

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to create payment intent');
      }

      const { clientSecret, paymentIntentId } = response.data;
      this.currentPaymentIntentId = paymentIntentId;

      // Create Stripe Elements
      this.elements = this.stripe.elements({
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#0066cc',
          }
        }
      });

      // Create and mount payment element
      this.paymentElement = this.elements.create('payment');
      this.paymentElement.mount('#payment-element');

      // Enable submit button when ready
      this.paymentElement.on('ready', () => {
        submitBtn.disabled = false;
      });

      // Handle payment submission
      submitBtn.addEventListener('click', () => this.handlePaymentSubmit(submitBtn));

    } catch (error) {
      debugError("Error initializing payment:", error);
      const errorDiv = document.getElementById('payment-error-message');
      if (errorDiv) {
        errorDiv.textContent = error.message || translate("payment_initialization_failed");
      }
      this.app.showMessage(translate("payment_initialization_failed"), "error");
    }
  }

  async handlePaymentSubmit(submitBtn) {
    // Disable submit button and show loading state
    submitBtn.disabled = true;
    const btnText = submitBtn.querySelector('.payment-btn-text');
    const btnSpinner = submitBtn.querySelector('.payment-btn-spinner');
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-block';

    const errorDiv = document.getElementById('payment-error-message');
    errorDiv.textContent = '';

    try {
      // Confirm payment
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.elements,
        confirmParams: {
          return_url: window.location.origin + '/parent-finance',
        },
        redirect: 'if_required'
      });

      if (error) {
        // Payment failed
        errorDiv.textContent = error.message;
        btnText.style.display = 'inline-block';
        btnSpinner.style.display = 'none';
        submitBtn.disabled = false;
        this.app.showMessage(error.message, "error");
        debugError("Payment error:", error);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded
        debugLog("Payment succeeded:", paymentIntent);
        this.app.showMessage(translate("payment_successful"), "success");

        // CRITICAL: Invalidate finance caches immediately
        await clearFinanceRelatedCaches(this.currentFeeId);

        // Close modal
        const modal = document.getElementById('payment-modal');
        if (modal) {
          modal.remove();
        }

        // Refresh data and re-render
        await this.fetchAllStatements();
        this.calculateConsolidatedTotals();
        this.render();
        this.attachEventListeners();
      }
    } catch (err) {
      debugError("Payment submission error:", err);
      errorDiv.textContent = translate("payment_failed");
      btnText.style.display = 'inline-block';
      btnSpinner.style.display = 'none';
      submitBtn.disabled = false;
      this.app.showMessage(translate("payment_failed"), "error");
    }
  }
}
