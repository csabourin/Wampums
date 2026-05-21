/**
 * Lightweight settings modal for dashboard customization.
 * - Pick a color palette (live preview on accept)
 * - Reset all dashboard prefs
 *
 * Triggered from the dashboard header gear button.
 */

import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { setContent } from "../utils/DOMUtils.js";
import { PALETTES } from "../config/dashboard-customization.js";
import {
  getDashboardPrefs,
  setPaletteId,
  applyPalette,
  resetDashboardPrefs,
} from "../utils/DashboardPreferences.js";

export class DashboardSettingsModal {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.modal = null;
    this._previousPalette = null;
  }

  open() {
    if (this.modal) return;
    const prefs = getDashboardPrefs();
    this._previousPalette = prefs.paletteId;

    const overlay = document.createElement("div");
    overlay.className = "dash-settings";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "dash-settings-title");
    overlay.innerHTML = this._render(prefs.paletteId);
    document.body.appendChild(overlay);
    this.modal = overlay;
    document.body.classList.add("dash-settings-open");

    this._wireEvents();
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    document.body.classList.remove("dash-settings-open");
  }

  _render(currentPaletteId) {
    const cards = Object.values(PALETTES)
      .map((palette) => {
        const swatches = palette.swatches
          .map((c) => `<span class="dash-settings__swatch" style="background:${c}"></span>`)
          .join("");
        const isActive = palette.id === currentPaletteId;
        return `
          <button type="button"
                  class="dash-settings__palette ${isActive ? "is-active" : ""}"
                  data-palette="${escapeHTML(palette.id)}"
                  aria-pressed="${isActive}">
            <span class="dash-settings__swatches" aria-hidden="true">${swatches}</span>
            <span class="dash-settings__palette-label">${escapeHTML(translate(palette.label))}</span>
            <span class="dash-settings__palette-desc">${escapeHTML(translate(palette.description))}</span>
          </button>
        `;
      })
      .join("");

    return `
      <div class="dash-settings__backdrop" data-close="true"></div>
      <div class="dash-settings__panel" role="document">
        <header class="dash-settings__header">
          <h2 id="dash-settings-title">${escapeHTML(translate("dashboard_settings"))}</h2>
          <button type="button" class="dash-settings__close" data-close="true" aria-label="${escapeHTML(translate("close"))}">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>
        <section class="dash-settings__section">
          <h3>${escapeHTML(translate("dashboard_palette"))}</h3>
          <p class="dash-settings__hint">${escapeHTML(translate("dashboard_palette_hint"))}</p>
          <div class="dash-settings__palettes" role="radiogroup" aria-label="${escapeHTML(translate("dashboard_palette"))}">
            ${cards}
          </div>
        </section>
        <footer class="dash-settings__footer">
          <button type="button" class="button button--ghost" data-action="reset">
            ${escapeHTML(translate("reset_to_defaults"))}
          </button>
          <button type="button" class="button button--primary" data-close="true">
            ${escapeHTML(translate("done"))}
          </button>
        </footer>
      </div>
    `;
  }

  _wireEvents() {
    this.modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) {
        this.close();
        return;
      }
      const palette = e.target.closest("[data-palette]");
      if (palette) {
        const id = palette.dataset.palette;
        setPaletteId(id);
        this.modal.querySelectorAll(".dash-settings__palette").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.palette === id);
          el.setAttribute("aria-pressed", el.dataset.palette === id);
        });
        this.onChange({ paletteId: id });
        return;
      }
      if (e.target.closest('[data-action="reset"]')) {
        resetDashboardPrefs();
        const current = getDashboardPrefs().paletteId;
        this.modal.querySelectorAll(".dash-settings__palette").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.palette === current);
          el.setAttribute("aria-pressed", el.dataset.palette === current);
        });
        this.onChange({ paletteId: current, reset: true });
      }
    });

    document.addEventListener("keydown", this._escClose);
  }

  _escClose = (e) => {
    if (e.key === "Escape" && this.modal) {
      this.close();
    }
  };
}
