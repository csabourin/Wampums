import { translate } from "./app.js";
import { debugError } from "./utils/DebugUtils.js";
import { setContent, loadStylesheet } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

/**
 * Landing view for the /carpool route.
 * Provides a skeleton layout and clear navigation without requiring
 * an activity identifier.
 */
export class CarpoolLanding {
  /**
   * @param {object} app - Main application instance for navigation and toasts.
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Initialize the landing page by rendering the skeleton layout
   * and wiring up navigation actions.
   * @returns {Promise<void>}
   */
  async init() {
    // Load page-specific CSS
    await loadStylesheet("/css/carpool.css");
    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the carpool landing skeleton state.
   */
  render() {
    const container = document.getElementById("app");

    if (!container) {
      debugError("Carpool landing container not found");
      return;
    }

    setContent(container, `
      <section class="page carpool-page carpool-landing">
        <header class="page__header">
          <div class="page__header-top">
            <a href="/dashboard" class="button button--ghost">
              ← ${translate("back")}
            </a>
            <h1>${translate("carpool_coordination")}</h1>
          </div>
          <p class="page__subtitle">${translate("carpool_landing_intro")}</p>
        </header>

        <div class="carpool-landing__actions">
          <button class="button button--primary button--large" id="carpool-open-selector">
            <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M3 13h18"></path>
              <path d="M3 6h18"></path>
              <path d="M3 19h18"></path>
              <path d="M6 5v4"></path>
              <path d="M10 13v6"></path>
              <path d="M14 5v4"></path>
              <path d="M18 13v6"></path>
            </svg>
            ${translate("carpool_landing_open_selector")}
          </button>
          <a href="/activities" class="button button--ghost button--large carpool-landing__link">
            <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <path d="M16 2v4"></path>
              <path d="M8 2v4"></path>
              <path d="M3 10h18"></path>
            </svg>
            ${translate("carpool_landing_view_activities")}
          </a>
        </div>

        <div class="carpool-landing__skeletons">
          ${this.renderSkeletonCard(translate("select_activity_for_carpool"), 3)}
          ${this.renderSkeletonCard(translate("available_rides"), 2)}
          ${this.renderSkeletonCard(translate("current_assignments"), 2)}
        </div>
      </section>
    `);
  }

  /**
   * Render a single skeleton card with placeholder lines.
   * @param {string} title - Section title for accessibility context.
   * @param {number} lines - Number of placeholder rows to render.
   * @returns {string} HTML string for the skeleton card.
   */
  renderSkeletonCard(title, lines = 2) {
    const skeletonLines = Array.from({ length: lines })
      .map(() => '<span class="carpool-landing__line skeleton-text"></span>')
      .join("");

    return `
      <article class="carpool-landing__card skeleton" aria-busy="true" aria-label="${title}">
        <div class="carpool-landing__card-header">
          <h2>${title}</h2>
          <span class="carpool-landing__pill skeleton-text"></span>
        </div>
        <div class="carpool-landing__skeleton-lines">
          ${skeletonLines}
        </div>
      </article>
    `;
  }

  /**
   * Wire up CTA interactions.
   */
  attachEventListeners() {
    const selectorButton = document.getElementById("carpool-open-selector");

    if (selectorButton) {
      selectorButton.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.openActivityPicker();
      });
    }
  }

  /**
   * Open the existing carpool quick access selector so users can pick an activity.
   * Reuses the dashboard implementation to avoid duplicate logic.
   * @returns {Promise<void>}
   */
  async openActivityPicker() {
    try {
      const { Dashboard } = await import("./dashboard.js");
      const dashboard = new Dashboard(this.app);
      await dashboard.showCarpoolQuickAccess();
    } catch (error) {
      debugError("Error opening carpool selector:", error);
      if (typeof this.app?.showMessage === "function") {
        this.app.showMessage("error_loading_activities", "error");
      }
    }
  }
}
