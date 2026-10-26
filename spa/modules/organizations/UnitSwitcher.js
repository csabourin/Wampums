/**
 * My units — a district administrator's way between the units they belong to,
 * the ones they created included.
 *
 * @module spa/modules/organizations/UnitSwitcher
 */
import { translate } from '../../app.js';
import { getUserOrganizations } from '../../api/api-endpoints.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
import { switchActiveUnit } from '../session/UnitSwitch.js';

/** Where a unit opens once it is the active one. */
const UNIT_HOME_HREF = '/dashboard';

export class UnitSwitcher {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.units = [];
    this.destroyed = false;
    this.switching = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('unit_switcher_title'), className: 'unit-switcher' };
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {Promise<void>} */
  async init() {
    showPageLoading(this.root(), this.pageOptions());
    try {
      // A unit created a moment ago must be on the list.
      const response = await getUserOrganizations({ forceRefresh: true });
      this.units = Array.isArray(response?.data) ? response.data : [];
    } catch (error) {
      debugError('Failed to load the units:', error);
      if (!this.destroyed) {
        showPageError(this.root(), { ...this.pageOptions(), message: translate('unit_switcher_load_failed') }, () => this.init());
      }
      return;
    }
    this.render();
  }

  /** @returns {number} The unit the session is in */
  currentUnitId() {
    return Number(this.app.organizationId);
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const current = this.currentUnitId();
    const items = this.units.map((unit) => {
      const isCurrent = Number(unit.id) === current;
      return `
        <li class="unit-switcher__item"${isCurrent ? ' aria-current="true"' : ''}>
          <span class="unit-switcher__name">${escapeHTML(unit.name || '')}</span>
          ${isCurrent
    ? `<span>${translate('unit_switcher_current')}</span>`
    : `<button type="button" class="button button--secondary button--small" data-unit-id="${Number(unit.id)}"
                aria-label="${escapeAttribute(translate('unit_switcher_open_named').replace('{name}', unit.name || ''))}">
                ${translate('unit_switcher_open')}
              </button>`}
        </li>`;
    }).join('');

    setContent(this.root(), `
      <section class="page unit-switcher">
        ${renderBackLink()}
        <h1>${translate('unit_switcher_title')}</h1>
        <p>${translate('unit_switcher_intro')}</p>
        ${items
    ? `<ul class="unit-switcher__list">${items}</ul>`
    : `<p>${translate('unit_switcher_empty')}</p>`}
      </section>
    `);
    this.root().querySelectorAll('[data-unit-id]').forEach((button) => {
      button.addEventListener('click', () => this.open(button));
    });
  }

  /**
   * Make a unit the active one and go to its dashboard.
   *
   * @param {HTMLButtonElement} button - The unit's button
   */
  async open(button) {
    if (this.switching) {
      return;
    }
    this.switching = true;
    button.disabled = true;
    try {
      await switchActiveUnit(this.app, Number(button.dataset.unitId));
    } catch (error) {
      debugError('Failed to switch unit:', error);
      this.switching = false;
      if (!this.destroyed) {
        button.disabled = false;
        this.app.showMessage(apiErrorMessage(error, 'unit_switcher_switch_failed'), 'error');
      }
      return;
    }
    this.switching = false;
    if (!this.destroyed) {
      this.app.router.navigate(UNIT_HOME_HREF);
    }
  }
}
