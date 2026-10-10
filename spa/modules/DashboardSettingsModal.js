/**
 * Lightweight settings modal for dashboard customization.
 * - Pick a color palette (live preview on accept)
 * - Reset all dashboard prefs
 *
 * Triggered from the dashboard header gear button.
 */

import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { openModal } from "../utils/ModalUtils.js";
import { PALETTES } from "../config/dashboard-customization.js";
import {
  getDashboardPrefs,
  setPaletteId,
  resetDashboardPrefs,
} from "../utils/DashboardPreferences.js";

export class DashboardSettingsModal {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.modal = null;
  }

  open() {
    if (this.modal) return;
    const prefs = getDashboardPrefs();
    const { body, footer } = this._render(prefs.paletteId);

    const { overlay, close } = openModal({
      id: "dash-settings",
      title: escapeHTML(translate("dashboard_settings")),
      className: "dash-settings__panel",
      body,
      footer,
      initialFocus: ".dash-settings__palette.is-active",
      onClose: () => { this.modal = null; },
    });
    this.modal = overlay;
    this.closeModal = close;

    this._wireEvents();
  }

  close() {
    if (!this.modal) return;
    this.closeModal(true);
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

    return {
      body: `
        <section class="dash-settings__section">
          <h3>${escapeHTML(translate("dashboard_palette"))}</h3>
          <p class="dash-settings__hint">${escapeHTML(translate("dashboard_palette_hint"))}</p>
          <div class="dash-settings__palettes" role="group" aria-label="${escapeHTML(translate("dashboard_palette"))}">
            ${cards}
          </div>
        </section>
      `,
      footer: `
        <button type="button" class="button button--ghost" data-action="reset">
          ${escapeHTML(translate("reset_to_defaults"))}
        </button>
        <button type="button" class="button button--primary" data-modal-close>
          ${escapeHTML(translate("done"))}
        </button>
      `,
    };
  }

  _wireEvents() {
    this.modal.addEventListener("click", (e) => {
      const palette = e.target.closest("[data-palette]");
      if (palette) {
        const id = palette.dataset.palette;
        setPaletteId(id);
        this.modal.querySelectorAll(".dash-settings__palette").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.palette === id);
          el.setAttribute("aria-pressed", String(el.dataset.palette === id));
        });
        this.onChange({ paletteId: id });
        return;
      }
      if (e.target.closest('[data-action="reset"]')) {
        resetDashboardPrefs();
        const current = getDashboardPrefs().paletteId;
        this.modal.querySelectorAll(".dash-settings__palette").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.palette === current);
          el.setAttribute("aria-pressed", String(el.dataset.palette === current));
        });
        this.onChange({ paletteId: current, reset: true });
      }
    });
  }
}
