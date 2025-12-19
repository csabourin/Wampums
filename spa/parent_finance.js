import {
  getCurrentOrganizationId,
  fetchParticipants,
  getParticipantStatement
} from "./ajax-functions.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { CONFIG } from './config.js';
import { escapeHTML } from "./utils/SecurityUtils.js";
import { formatDateShort } from "./utils/DateUtils.js";
import { LoadingStateManager, retryWithBackoff } from "./utils/PerformanceUtils.js";
import { isParent } from "./utils/PermissionUtils.js";

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

    document.getElementById("app").innerHTML = content;
  }

  render() {
    const backLink = isParent()
      ? `<a href="/parent-dashboard" class="back-link">${translate("back_to_dashboard")}</a>`
      : `<a href="/dashboard" class="back-link">${translate("back_to_dashboard")}</a>`;

    const content = `
      <section class="parent-finance-page">
        <header class="finance-header">
          <a href="/parent-dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
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

    document.getElementById("app").innerHTML = content;
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

        return `
          <div class="finance-list__row">
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
    // Add any interactive elements here if needed
    debugLog("Parent finance event listeners attached");
  }
}
