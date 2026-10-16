/**
 * Time since registration — how long each youth has been with the unit.
 *
 * @module spa/modules/participants/TimeSinceRegistration
 */
import { translate } from '../../app.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
import { getTimeSinceRegistration } from '../../api/api-reports.js';

/** The sorts offered, each with the order it starts in. */
const SORTS = {
  name: { order: 'asc', icon: '👤', labelKey: 'sort_by_name' },
  longevity: { order: 'desc', icon: '📅', labelKey: 'sort_by_longevity' },
};

export class TimeSinceRegistration {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.currentSort = { key: 'longevity', order: SORTS.longevity.order }; // Longest first
    this.destroyed = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {{title: string, className: string}} Shared page-state options */
  pageOptions() {
    return { title: translate('time_since_registration_report'), className: 'time-since-registration' };
  }

  async init() {
    showPageLoading(this.root(), this.pageOptions());
    try {
      await this.fetchData();
    } catch (error) {
      debugError('Error loading time since registration:', error);
      if (!this.destroyed) {
        showPageError(this.root(), this.pageOptions(), () => this.init());
      }
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  async fetchData() {
    const result = await getTimeSinceRegistration();
    this.participants = Array.isArray(result?.data) ? result.data : [];
    debugLog('Fetched time since registration data:', this.participants.length);
  }

  render() {
    const buttons = Object.entries(SORTS).map(([key, sort]) => `
          <button type="button" class="sort-btn${key === this.currentSort.key ? ' active' : ''}" data-sort="${key}"
            aria-pressed="${key === this.currentSort.key}" aria-label="${escapeHTML(translate(sort.labelKey))}">
            <span aria-hidden="true">${sort.icon}</span>
          </button>`).join('');
    setContent(this.root(), `
      <section class="page time-since-registration">
        ${renderBackLink()}
        <h1>${translate('time_since_registration_report')}</h1>
        <div class="controls-container">
          <div class="sort-options">${buttons}</div>
        </div>
        <div id="registration-list" class="registration-list"></div>
      </section>
    `);
    this.renderList();
  }

  /**
   * @param {Object} participant - Row from the report
   * @returns {string} HTML for how long they have been with the unit
   */
  timeWithGroup(participant) {
    if (!participant.inscription_date || participant.years_with_group === null) {
      return `<span class="unavailable">(${translate('date_unavailable')})</span>`;
    }
    const years = Math.floor(participant.years_with_group);
    const months = Math.floor(participant.months_with_group);
    const yearText = years > 0 ? `${years} ${years === 1 ? translate('year') : translate('years')}` : '';
    const monthText = months > 0 ? `${months} ${months === 1 ? translate('month') : translate('months')}` : '';

    if (years > 0 && months > 0) {
      return `${yearText} ${translate('and')} ${monthText}`;
    }
    return yearText || monthText || translate('less_than_one_month');
  }

  renderList() {
    const list = document.getElementById('registration-list');
    if (!list) {
      return;
    }

    if (this.participants.length === 0) {
      setContent(list, `<p class="no-data">${translate('no_participants_found')}</p>`);
      return;
    }

    const tableRows = this.getSortedParticipants().map((participant) => {
      const fullName = `${participant.first_name} ${participant.last_name}`;
      const inscriptionDate = participant.inscription_date
        ? escapeHTML(formatDateShort(participant.inscription_date, this.app.lang))
        : `<span class="unavailable">${translate('date_unavailable')}</span>`;
      const groupName = participant.group_name ? escapeHTML(participant.group_name) : translate('no_group_assigned');

      return `
        <tr>
          <th scope="row">${escapeHTML(fullName)}</th>
          <td>${groupName}</td>
          <td>${inscriptionDate}</td>
          <td>${this.timeWithGroup(participant)}</td>
        </tr>
      `;
    }).join('');

    // A table wider than a phone scrolls inside its own container, never the page.
    setContent(list, `
      <div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHTML(translate('time_since_registration_report'))}">
        <table>
          <thead>
            <tr>
              <th scope="col">${translate('name')}</th>
              <th scope="col">${translate('group')}</th>
              <th scope="col">${translate('inscription_date')}</th>
              <th scope="col">${translate('time_with_group')}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `);
  }

  getSortedParticipants() {
    const sorted = [...this.participants];

    sorted.sort((a, b) => {
      let compareValue = 0;

      if (this.currentSort.key === 'name') {
        const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
        const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
        compareValue = nameA.localeCompare(nameB);
      } else if (this.currentSort.key === 'longevity') {
        // Unknown dates go to the end
        if (!a.inscription_date && !b.inscription_date) {return 0;}
        if (!a.inscription_date) {return 1;}
        if (!b.inscription_date) {return -1;}
        // An earlier date is a longer tenure
        compareValue = new Date(a.inscription_date) - new Date(b.inscription_date);
      }

      return this.currentSort.order === 'asc' ? compareValue : -compareValue;
    });

    return sorted;
  }

  attachEventListeners() {
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sortItems(btn.dataset.sort);
      });
    });
  }

  sortItems(key) {
    debugLog(`Sorting by ${key}`);

    // The same key again flips the order; another key starts in its own order.
    if (this.currentSort.key === key) {
      this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.key = key;
      this.currentSort.order = SORTS[key]?.order || 'asc';
    }

    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const active = btn.dataset.sort === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    this.renderList();
  }
}
