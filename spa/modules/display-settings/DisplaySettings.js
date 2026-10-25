/**
 * Display — how the dashboard looks on this device: its colour theme (among
 * them high contrast and colorblind-safe), and a way back to the defaults.
 *
 * Reached from the "Display" tile beside "My account" under Administration.
 * The choice is stored on the device; nothing is sent to the server.
 *
 * @module spa/modules/display-settings/DisplaySettings
 */

import dashboardV2StylesheetUrl from '../../../css/dashboard-v2.css?url';
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { PALETTES } from '../../config/dashboard-customization.js';
import {
  getDashboardPrefs,
  setPaletteId,
  resetDashboardPrefs,
} from '../../utils/DashboardPreferences.js';

export class DisplaySettings {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
  }

  /** Nothing to fetch: the choice lives on this device. @returns {void} */
  init() {
    // The theme cards share the dashboard's styles.
    loadStylesheet(dashboardV2StylesheetUrl)
      .catch((error) => debugError('Failed to load display settings styles:', error));
    this.render();
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /**
   * One theme to choose, as a native radio button inside its card.
   *
   * @param {Object} palette - From PALETTES
   * @param {string} currentId - The theme in use
   * @returns {string} HTML
   */
  renderPalette(palette, currentId) {
    const id = `display-palette-${palette.id}`;
    const isActive = palette.id === currentId;
    const swatches = palette.swatches
      .map((colour) => `<span class="dash-settings__swatch" style="background:${escapeAttribute(colour)}"></span>`)
      .join('');
    return `
      <label class="dash-settings__palette ${isActive ? 'is-active' : ''}" for="${id}">
        <span class="dash-settings__palette-head">
          <input type="radio" name="display_palette" id="${id}" value="${escapeAttribute(palette.id)}"
            aria-describedby="${id}-desc" ${isActive ? 'checked' : ''}>
          <span class="dash-settings__palette-label">${escapeHTML(translate(palette.label))}</span>
        </span>
        <span class="dash-settings__swatches" aria-hidden="true">${swatches}</span>
        <span class="dash-settings__palette-desc" id="${id}-desc">${escapeHTML(translate(palette.description))}</span>
      </label>`;
  }

  /** @returns {void} */
  render() {
    const currentId = getDashboardPrefs().paletteId;
    const cards = Object.values(PALETTES).map((palette) => this.renderPalette(palette, currentId)).join('');
    setContent(this.root(), `
      <section class="page display-settings">
        ${renderBackLink()}
        <h1>${translate('display_settings_title')}</h1>
        <p>${translate('display_settings_intro')}</p>
        <p id="display-settings-status" class="sr-only" role="status"></p>
        <fieldset class="dash-settings__section">
          <legend><h2>${translate('dashboard_palette')}</h2></legend>
          <p class="dash-settings__hint">${translate('dashboard_palette_hint')}</p>
          <div class="dash-settings__palettes">${cards}</div>
        </fieldset>
        <button type="button" class="button button--secondary" id="display-settings-reset">
          ${translate('reset_to_defaults')}
        </button>
      </section>
    `);
    this.attachEventListeners();
  }

  /** @returns {void} */
  attachEventListeners() {
    const root = this.root();
    // The markup was just replaced, so these listeners never stack.
    root.querySelectorAll('input[name="display_palette"]').forEach((input) => {
      input.addEventListener('change', () => this.choose(input.value));
    });
    document.getElementById('display-settings-reset')?.addEventListener('click', () => this.reset());
  }

  /**
   * Apply a theme at once and say so to screen readers.
   *
   * @param {string} paletteId - Chosen theme
   * @returns {void}
   */
  choose(paletteId) {
    const applied = setPaletteId(paletteId);
    this.markActive(applied);
    const palette = PALETTES[applied];
    this.announce(translate('display_settings_palette_applied').replace('{name}', translate(palette.label)));
  }

  /** @returns {void} */
  reset() {
    resetDashboardPrefs();
    const current = getDashboardPrefs().paletteId;
    this.markActive(current);
    const input = document.getElementById(`display-palette-${current}`);
    if (input) {
      input.checked = true;
    }
    this.announce(translate('display_settings_reset_done'));
  }

  /** @param {string} paletteId - The theme now in use */
  markActive(paletteId) {
    this.root().querySelectorAll('.dash-settings__palette').forEach((card) => {
      card.classList.toggle('is-active', card.getAttribute('for') === `display-palette-${paletteId}`);
    });
  }

  /** @param {string} message - Said by the status region */
  announce(message) {
    const status = document.getElementById('display-settings-status');
    if (status) {
      status.textContent = message;
    }
  }
}
