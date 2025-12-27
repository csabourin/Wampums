import { getPendingBadges, updateBadgeStatus } from "./ajax-functions.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { clearBadgeRelatedCaches } from "./indexedDB.js";
import { canApproveBadges } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ApproveBadges {
  constructor(app) {
    this.app = app;
    this.pendingBadges = [];
  }

  async init() {
    if (!canApproveBadges()) {
      this.app.router.navigate("/dashboard");
      return;
    }

    try {
      await this.fetchPendingBadges();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing approve badges:", error);
      this.renderError();
    }
  }

  async fetchPendingBadges() {
    try {
      const response = await getPendingBadges();
      this.pendingBadges = response?.data || response || [];
      if (!Array.isArray(this.pendingBadges)) {
        debugError("Pending badges is not an array:", this.pendingBadges);
        this.pendingBadges = [];
      }
    } catch (error) {
      debugError("Error fetching pending badges:", error);
      this.pendingBadges = [];
    }
  }

  render() {
    const content = `
            <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
            <h1>${translate("approve_badges")}</h1>
            <div id="message"></div>
            ${this.renderPendingBadges()}
            <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
        `;
    setContent(document.getElementById("app"), content);
  }

  renderPendingBadges() {
    if (this.pendingBadges.length === 0) {
      return `<p>${translate("no_pending_badges")}</p>`;
    }

    return this.pendingBadges
      .map(
        (badge) => {
          const badgeLabel = this.getBadgeLabel(badge);
          const levelLabel = translate("badge_level_label") || translate("badge_star_label") || translate("stars");
          return `
            <div class="badge-request">
                <h2>${badge.first_name} ${badge.last_name}</h2>
                <p>${translate("badge_select_badge") || translate("badge")}: ${badgeLabel}</p>
                ${badge.badge_section ? `<p>${translate("badge_section_label") || translate("section") || "Section"}: ${badge.badge_section}</p>` : ""}
                <p>${levelLabel}: ${badge.etoiles}</p>
                <p>${translate("objectif")}: ${badge.objectif}</p>
                <p>${translate("description")}: ${badge.description}</p>
                <p>${translate("date")}: ${badge.date_obtention}</p>
                <button class="approve-btn" data-badge-id="${
                  badge.id
                }" data-action="approved">${translate("approve")}</button>
                <button class="reject-btn" data-badge-id="${
                  badge.id
                }" data-action="rejected">${translate("reject")}</button>
            </div>
        `;
        }
      )
      .join("");
  }

  getBadgeLabel(badge) {
    return (
      translate(badge.translation_key) ||
      badge.badge_name ||
      badge.territoire_chasse ||
      translate("badge_unknown_label")
    );
  }

  attachEventListeners() {
    document.querySelectorAll(".approve-btn, .reject-btn").forEach((button) => {
      button.addEventListener("click", (e) => this.handleBadgeAction(e));
    });
  }

  async handleBadgeAction(e) {
    const badgeId = e.target.dataset.badgeId;
    const action = e.target.dataset.action;

    try {
      const result = await updateBadgeStatus(badgeId, action);
      if (result.success) {
        // Clear badge-related caches to ensure fresh data on next load
        await clearBadgeRelatedCaches();
        this.showMessage(translate("badge_status_updated"));
        await this.fetchPendingBadges();
        this.render();
        this.attachEventListeners();
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      debugError("Error updating badge status:", error);
      this.showMessage(translate("error_updating_badge_status"), "error");
    }
  }

  showMessage(message, type = "success") {
    const messageElement = document.getElementById("message");
    messageElement.textContent = message;
    messageElement.className = type;
    setTimeout(() => {
      messageElement.textContent = "";
      messageElement.className = "";
    }, 3000);
  }

  renderError() {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${translate("error_loading_approve_badges")}</p>
        `;
    setContent(document.getElementById("app"), errorMessage);
  }
}
