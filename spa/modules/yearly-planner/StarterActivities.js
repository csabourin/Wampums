/**
 * Starter activities: browse the reviewed bilingual catalogue and add
 * activities to the unit's own library, one at a time or several at once.
 *
 * The server decides what each entry is to the unit (already there, hidden,
 * matching an older copy by name, or ambiguous) and reports what an import
 * did. Adding requires a connection: an import is never queued offline and
 * never reported as done before the server confirms it.
 *
 * @module spa/modules/yearly-planner/StarterActivities
 */

import yearlyPlannerStylesheetUrl from '../../../css/yearly-planner.css?url';
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { openModal } from '../../utils/ModalUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import {
  STARTER_BRANCHES,
  STARTER_CATEGORIES,
  STARTER_SETTINGS,
  activityCategoryLabel,
  starterBranchLabel,
  starterSeasonLabel,
  starterSettingLabel,
} from '../../utils/ActivityLibraryUtils.js';
import { getStarterActivities, importStarterActivities } from '../../api/api-yearly-planner.js';

/** Duration filter choices: activities that can fit in this many minutes. */
const DURATION_LIMITS_MINUTES = CONFIG.STARTER_ACTIVITIES.DURATION_LIMITS_MINUTES;

/** Value of a filter that keeps everything. */
const ALL = 'all';

/** Statuses (from the server) for which adding does something. */
const ADDABLE_STATUSES = new Set(['available', 'hidden', 'legacy_match']);

/** What the add button says, by status. */
const ADD_LABEL_KEYS = Object.freeze({
  available: 'starter_add',
  hidden: 'starter_restore',
  legacy_match: 'starter_link',
});

/** What the card says about the unit's copy, by status. */
const STATUS_KEYS = Object.freeze({
  present: 'starter_status_present',
  hidden: 'starter_status_hidden',
  legacy_match: 'starter_status_legacy_match',
  ambiguous: 'starter_status_ambiguous',
});

/** Outcome lists returned by the import, and how each is summarized. */
const OUTCOME_KEYS = Object.freeze([
  ['created', 'starter_result_created'],
  ['reconciled', 'starter_result_reconciled'],
  ['restored', 'starter_result_restored'],
  ['already_present', 'starter_result_already_present'],
  ['ambiguous', 'starter_result_ambiguous'],
]);

const BACK_HREF = '/yearly-planner';

export class StarterActivities extends BaseModule {
  /** @param {Object} app - Application instance */
  constructor(app) {
    super(app);
    this.catalogue = null;
    this.loadError = null;
    this.filters = { branch: ALL, category: ALL, duration: ALL, setting: ALL };
    this.selected = new Set();
    this.outcome = null;
    this.busy = false;
    this.listening = false;
  }

  /** @returns {Promise<void>} */
  async init() {
    await loadStylesheet(yearlyPlannerStylesheetUrl);
    this.listen();
    this.renderLoading();
    await this.load();
  }

  /**
   * Fetch the catalogue and draw the page, or its error state.
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const response = await getStarterActivities();
      const data = response?.data || {};
      this.catalogue = {
        ...data,
        activities: Array.isArray(data.activities) ? data.activities : [],
      };
      this.loadError = null;
      if (this.filters.branch === ALL && STARTER_BRANCHES.includes(data.branch)) {
        this.filters.branch = data.branch;
      }
      this.pruneSelection();
      this.render();
    } catch (error) {
      debugError('Failed to load starter activities:', error);
      this.loadError = error;
      this.renderError();
    }
  }

  /** @returns {HTMLElement|null} Page container */
  root() {
    return document.getElementById('app');
  }

  /** @returns {boolean} Whether this screen still owns #app */
  isCurrent() {
    return !this.isDestroyed && Boolean(document.getElementById('starter-activities'));
  }

  /** One delegated listener set on #app, released by destroy(). */
  listen() {
    const root = this.root();
    if (this.listening || !root) {
      return;
    }
    this.listening = true;
    this.addEventListener(root, 'change', (event) => this.handleChange(event));
    this.addEventListener(root, 'click', (event) => this.handleClick(event));
  }

  // ===========================================================================
  // STATES
  // ===========================================================================

  /**
   * @param {string} content - Page body markup
   * @param {Object} [options]
   * @param {boolean} [options.busy] - Mark the page busy (loading)
   * @returns {string} Page markup
   */
  page(content, { busy = false } = {}) {
    return `
      <section class="page yearly-planner starter-activities" id="starter-activities"${busy ? ' aria-busy="true"' : ''}>
        ${renderBackLink(BACK_HREF)}
        <h1>${escapeHTML(translate('starter_activities_title'))}</h1>
        ${content}
      </section>
    `;
  }

  renderLoading() {
    setContent(this.root(), this.page(
      `<p role="status">${escapeHTML(translate('loading'))}</p>`,
      { busy: true },
    ));
  }

  renderError() {
    if (this.isDestroyed) {
      return;
    }
    setContent(this.root(), this.page(`
      <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(this.loadError, 'starter_load_failed'))}</p>
      <button type="button" class="button button--primary" id="starter-retry">${escapeHTML(translate('retry'))}</button>
    `));
  }

  render() {
    if (this.isDestroyed) {
      return;
    }
    const activities = this.catalogue?.activities || [];
    if (activities.length === 0) {
      setContent(this.root(), this.page(`
        <p class="starter-activities__intro">${escapeHTML(translate('starter_activities_intro'))}</p>
        <div class="empty-state"><p>${escapeHTML(translate('starter_catalogue_empty'))}</p></div>
      `));
      return;
    }
    setContent(this.root(), this.page(`
      <p class="starter-activities__intro">${escapeHTML(translate('starter_activities_intro'))}</p>
      ${this.renderFilters()}
      <div id="starter-result" class="starter-result" role="status" tabindex="-1">${this.renderOutcome()}</div>
      <div id="starter-listing">${this.renderListing()}</div>
    `));
  }

  // ===========================================================================
  // FILTERS
  // ===========================================================================

  /**
   * @param {string} id - Select id (also the filter name after the prefix)
   * @param {string} labelKey - Label translation key
   * @param {Array<{value: string, label: string}>} options - Choices besides "All"
   * @param {string} current - Selected value
   * @returns {string} Markup
   */
  renderSelect(id, labelKey, options, current) {
    const choices = [{ value: ALL, label: translate('starter_filter_all') }, ...options];
    return `
      <div class="form-group starter-filters__field">
        <label for="${id}">${escapeHTML(translate(labelKey))}</label>
        <select id="${id}" data-starter-filter="${id.replace('starter-filter-', '')}" data-archive-safe>
          ${choices.map(({ value, label }) => `
            <option value="${escapeAttribute(value)}" ${value === current ? 'selected' : ''}>${escapeHTML(label)}</option>
          `).join('')}
        </select>
      </div>
    `;
  }

  renderFilters() {
    const { branch, category, duration, setting } = this.filters;
    return `
      <form class="starter-filters" id="starter-filters" aria-label="${escapeAttribute(translate('starter_filters_label'))}">
        ${this.renderSelect('starter-filter-branch', 'starter_filter_branch',
    STARTER_BRANCHES.map((key) => ({ value: key, label: starterBranchLabel(key) })), branch)}
        ${this.renderSelect('starter-filter-category', 'starter_filter_category',
    STARTER_CATEGORIES.map((key) => ({ value: key, label: activityCategoryLabel(key) })), category)}
        ${this.renderSelect('starter-filter-duration', 'starter_filter_duration',
    DURATION_LIMITS_MINUTES.map((minutes) => ({
      value: String(minutes),
      label: translate('starter_duration_up_to').replace('{minutes}', String(minutes)),
    })), duration)}
        ${this.renderSelect('starter-filter-setting', 'starter_filter_setting',
    STARTER_SETTINGS.map((key) => ({ value: key, label: starterSettingLabel(key) })), setting)}
        <button type="button" class="button button--ghost" id="starter-filters-reset" data-archive-safe>
          ${escapeHTML(translate('starter_filters_reset'))}
        </button>
      </form>
    `;
  }

  /** @returns {Object[]} Catalogue entries matching the filters */
  filteredActivities() {
    const { branch, category, duration, setting } = this.filters;
    const limit = duration === ALL ? null : Number(duration);
    return (this.catalogue?.activities || []).filter((activity) =>
      (branch === ALL || activity.branches?.includes(branch))
      && (category === ALL || activity.category === category)
      && (limit === null || Number(activity.duration?.min) <= limit)
      && (setting === ALL || activity.tags?.includes(setting)));
  }

  /** Forget selections the unit no longer needs (already added, or ambiguous). */
  pruneSelection() {
    const addable = new Set((this.catalogue?.activities || [])
      .filter((activity) => ADDABLE_STATUSES.has(activity.status))
      .map((activity) => activity.key));
    this.selected = new Set([...this.selected].filter((key) => addable.has(key)));
  }

  // ===========================================================================
  // LISTING
  // ===========================================================================

  renderListing() {
    const shown = this.filteredActivities();
    if (shown.length === 0) {
      return `
        <div class="empty-state">
          <p>${escapeHTML(translate('starter_no_match'))}</p>
          <button type="button" class="button button--secondary" id="starter-no-match-reset" data-archive-safe>
            ${escapeHTML(translate('starter_filters_reset'))}
          </button>
        </div>
      `;
    }
    const addableShown = shown.filter((activity) => ADDABLE_STATUSES.has(activity.status));
    const allShownSelected = addableShown.length > 0 && addableShown.every((activity) => this.selected.has(activity.key));
    return `
      <div class="starter-toolbar">
        <p class="starter-toolbar__count">${escapeHTML(translate('starter_shown_count').replace('{count}', String(shown.length)))}</p>
        ${addableShown.length > 0 ? `
          <div class="checkbox-option">
            <input type="checkbox" id="starter-select-all" ${allShownSelected ? 'checked' : ''} ${this.busy ? 'disabled' : ''}>
            <label for="starter-select-all">${escapeHTML(translate('starter_select_all_shown'))}</label>
          </div>
        ` : ''}
        <button type="button" class="button button--primary" id="starter-add-selected" ${this.selected.size === 0 || this.busy ? 'disabled' : ''}>
          ${escapeHTML(translate('starter_add_selected').replace('{count}', String(this.selected.size)))}
        </button>
      </div>
      <ul class="starter-list" role="list">
        ${shown.map((activity) => this.renderCard(activity)).join('')}
      </ul>
    `;
  }

  /**
   * @param {Object} activity - Catalogue entry
   * @returns {string} Duration, e.g. "10–20 min"
   */
  durationText(activity) {
    const min = Number(activity.duration?.min);
    const max = Number(activity.duration?.max);
    if (!Number.isFinite(min)) {
      return '';
    }
    return translate('starter_duration_range')
      .replace('{min}', String(min))
      .replace('{max}', String(Number.isFinite(max) ? max : min));
  }

  /**
   * Short facts shown on a card and in its details.
   * @param {Object} activity - Catalogue entry
   * @returns {string} Markup of <li> items
   */
  renderFacts(activity) {
    const settings = STARTER_SETTINGS.filter((key) => activity.tags?.includes(key)).map(starterSettingLabel);
    const facts = [
      activityCategoryLabel(activity.category),
      this.durationText(activity),
      settings.join(' / '),
      (activity.branches || []).map(starterBranchLabel).filter(Boolean).join(', '),
    ].filter(Boolean);
    const close = activity.supervision === 'close'
      ? `<li class="starter-fact starter-fact--close">${escapeHTML(translate('starter_close_supervision'))}</li>`
      : '';
    return facts.map((fact) => `<li class="starter-fact">${escapeHTML(fact)}</li>`).join('') + close;
  }

  /**
   * @param {Object} activity - Catalogue entry
   * @returns {string} Add button markup, or '' when adding does nothing
   */
  renderAddButton(activity, { inDialog = false } = {}) {
    const labelKey = ADD_LABEL_KEYS[activity.status];
    if (!labelKey) {
      return '';
    }
    return `
      <button type="button" class="button button--primary${inDialog ? '' : ' button--small'}" data-starter-add="${escapeAttribute(activity.key)}" ${this.busy ? 'disabled' : ''}>
        ${escapeHTML(translate(labelKey))}${inDialog ? '' : `<span class="visually-hidden"> — ${escapeHTML(activity.name)}</span>`}
      </button>
    `;
  }

  /**
   * @param {Object} activity - Catalogue entry
   * @returns {string} Card markup
   */
  renderCard(activity) {
    const id = `starter-select-${activity.key}`;
    const addable = ADDABLE_STATUSES.has(activity.status);
    const statusKey = STATUS_KEYS[activity.status];
    return `
      <li class="starter-card starter-card--${escapeAttribute(activity.status)}" data-starter-key="${escapeAttribute(activity.key)}">
        <h2 class="starter-card__name">${escapeHTML(activity.name)}</h2>
        <p class="starter-card__summary">${escapeHTML(activity.summary)}</p>
        <ul class="starter-card__facts" role="list">${this.renderFacts(activity)}</ul>
        ${statusKey ? `<p class="starter-card__status">${escapeHTML(translate(statusKey))}</p>` : ''}
        <div class="starter-card__actions">
          ${addable ? `
            <div class="checkbox-option">
              <input type="checkbox" id="${escapeAttribute(id)}" data-starter-select="${escapeAttribute(activity.key)}" ${this.selected.has(activity.key) ? 'checked' : ''} ${this.busy ? 'disabled' : ''}>
              <label for="${escapeAttribute(id)}">${escapeHTML(translate('starter_select'))}<span class="visually-hidden"> — ${escapeHTML(activity.name)}</span></label>
            </div>
          ` : ''}
          <button type="button" class="button button--secondary button--small" data-starter-details="${escapeAttribute(activity.key)}">
            ${escapeHTML(translate('starter_details'))}<span class="visually-hidden"> — ${escapeHTML(activity.name)}</span>
          </button>
          ${this.renderAddButton(activity)}
        </div>
      </li>
    `;
  }

  /** Redraw the listing only, keeping focus where it is (the filters). */
  renderListingOnly() {
    const listing = document.getElementById('starter-listing');
    if (listing && this.isCurrent()) {
      setContent(listing, this.renderListing());
    }
  }

  // ===========================================================================
  // DETAILS
  // ===========================================================================

  /**
   * @param {string} titleKey - Section heading key
   * @param {string[]} items - Lines
   * @param {'ol'|'ul'} [tag] - List element
   * @returns {string} Section markup, or '' when empty
   */
  renderSection(titleKey, items, tag = 'ul') {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    return `
      <h3>${escapeHTML(translate(titleKey))}</h3>
      <${tag}>${items.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</${tag}>
    `;
  }

  /** @param {string} key - Catalogue key */
  showDetails(key) {
    const activity = this.catalogue?.activities?.find((entry) => entry.key === key);
    if (!activity) {
      return;
    }
    const statusKey = STATUS_KEYS[activity.status];
    const seasons = (activity.seasons || []).map(starterSeasonLabel).filter(Boolean).join(', ');
    // A minimum of one says nothing, and would read "at least 1 participants".
    const players = Number(activity.players_min);
    const modal = openModal({
      id: 'starter-details',
      title: escapeHTML(activity.name),
      size: 'large',
      body: `
        <div class="starter-details">
          <p>${escapeHTML(activity.summary)}</p>
          <ul class="starter-card__facts" role="list">${this.renderFacts(activity)}</ul>
          ${seasons ? `<p><strong>${escapeHTML(translate('starter_seasons'))}</strong> ${escapeHTML(seasons)}</p>` : ''}
          ${Number.isFinite(players) && players > 1
    ? `<p>${escapeHTML(translate('starter_players_min').replace('{count}', String(players)))}</p>`
    : ''}
          ${this.renderSection('starter_steps', activity.steps, 'ol')}
          ${this.renderSection('starter_precautions', activity.safety)}
          <h3>${escapeHTML(translate('starter_material'))}</h3>
          ${activity.material?.length
    ? `<ul>${activity.material.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
    : `<p>${escapeHTML(translate('starter_no_material'))}</p>`}
          ${this.renderSection('starter_variants', activity.variants)}
          ${statusKey ? `<p class="starter-card__status">${escapeHTML(translate(statusKey))}</p>` : ''}
        </div>
      `,
      footer: `
        <button type="button" class="button button--ghost" data-modal-close>${escapeHTML(translate('close'))}</button>
        ${this.renderAddButton(activity, { inDialog: true })}
      `,
      initialFocus: false,
      canClose: () => !this.busy,
    });
    modal.overlay.querySelector('[data-starter-add]')?.addEventListener('click', async () => {
      await this.importKeys([key], { modal });
    });
  }

  // ===========================================================================
  // IMPORT
  // ===========================================================================

  /**
   * Add activities to the unit, then reload the catalogue from the server.
   *
   * @param {string[]} keys - Catalogue keys
   * @param {Object} [options]
   * @param {Object} [options.modal] - Details dialog to close once confirmed
   * @returns {Promise<void>}
   */
  async importKeys(keys, { modal = null } = {}) {
    if (this.busy || keys.length === 0) {
      return;
    }
    this.setBusy(true, modal);
    let outcome;
    try {
      const response = await importStarterActivities(keys);
      outcome = response?.data;
      if (!outcome || response?.queued) {
        throw Object.assign(new Error('operation_unconfirmed'), { code: 'operation_unconfirmed' });
      }
    } catch (error) {
      debugError('Failed to add starter activities:', error);
      this.setBusy(false, modal);
      this.app.showMessage(apiErrorMessage(error, 'starter_import_failed'), 'error');
      return;
    }

    this.busy = false;
    modal?.close(true);
    this.outcome = outcome;
    keys.forEach((key) => this.selected.delete(key));
    if (!this.isCurrent()) {
      return;
    }
    try {
      const response = await getStarterActivities();
      const data = response?.data || {};
      this.catalogue = { ...data, activities: Array.isArray(data.activities) ? data.activities : [] };
      this.pruneSelection();
    } catch (error) {
      // The import stands: say what was added, and that the list may be stale.
      debugError('Failed to reload starter activities:', error);
      this.app.showMessage(translate('starter_reload_failed'), 'error');
    }
    if (!this.isCurrent()) {
      return;
    }
    this.render();
    document.getElementById('starter-result')?.focus();
  }

  /**
   * Disable the page's actions (and the dialog's) while an import runs.
   * @param {boolean} busy - Whether an import is running
   * @param {Object|null} modal - Open details dialog
   */
  setBusy(busy, modal) {
    this.busy = busy;
    const scope = [document.getElementById('starter-activities'), modal?.overlay].filter(Boolean);
    scope.forEach((element) => {
      element.querySelectorAll('[data-starter-add], [data-starter-select], #starter-select-all, #starter-add-selected')
        .forEach((control) => {
          control.disabled = busy || (control.id === 'starter-add-selected' && this.selected.size === 0);
        });
      if (element.id === 'starter-activities') {
        if (busy) {
          element.setAttribute('aria-busy', 'true');
        } else {
          element.removeAttribute('aria-busy');
        }
      }
    });
  }

  /** @returns {string} Summary of the last import */
  renderOutcome() {
    if (!this.outcome) {
      return '';
    }
    const lines = OUTCOME_KEYS
      .filter(([list]) => Array.isArray(this.outcome[list]) && this.outcome[list].length > 0)
      .map(([list, key]) => {
        const entries = this.outcome[list];
        const names = entries.map((entry) => escapeHTML(entry.name)).join(', ');
        return `<li>${escapeHTML(translate(key).replace('{count}', String(entries.length)))} <span class="starter-result__names">${names}</span></li>`;
      });
    return `
      <h2 class="starter-result__title">${escapeHTML(translate('starter_result_title'))}</h2>
      <ul class="starter-result__list">${lines.join('')}</ul>
    `;
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  /** @param {Event} event - Delegated change */
  handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !this.isCurrent()) {
      return;
    }
    if (target.dataset.starterFilter) {
      this.filters[target.dataset.starterFilter] = target.value;
      this.renderListingOnly();
      return;
    }
    if (target.dataset.starterSelect) {
      if (target.checked) {
        this.selected.add(target.dataset.starterSelect);
      } else {
        this.selected.delete(target.dataset.starterSelect);
      }
      this.updateSelectionControls();
      return;
    }
    if (target.id === 'starter-select-all') {
      this.filteredActivities()
        .filter((activity) => ADDABLE_STATUSES.has(activity.status))
        .forEach((activity) => {
          if (target.checked) {
            this.selected.add(activity.key);
          } else {
            this.selected.delete(activity.key);
          }
        });
      document.querySelectorAll('[data-starter-select]').forEach((checkbox) => {
        checkbox.checked = this.selected.has(checkbox.dataset.starterSelect);
      });
      this.updateSelectionControls();
    }
  }

  /** Keep the bulk button and "select all" in step with the checkboxes. */
  updateSelectionControls() {
    const addButton = document.getElementById('starter-add-selected');
    if (addButton) {
      addButton.disabled = this.busy || this.selected.size === 0;
      addButton.textContent = translate('starter_add_selected').replace('{count}', String(this.selected.size));
    }
    const selectAll = document.getElementById('starter-select-all');
    if (selectAll) {
      const addableShown = this.filteredActivities().filter((activity) => ADDABLE_STATUSES.has(activity.status));
      selectAll.checked = addableShown.length > 0 && addableShown.every((activity) => this.selected.has(activity.key));
    }
  }

  /** Put every filter back to "All". */
  resetFilters() {
    this.filters = { branch: ALL, category: ALL, duration: ALL, setting: ALL };
    document.querySelectorAll('[data-starter-filter]').forEach((select) => {
      select.value = ALL;
    });
    this.renderListingOnly();
    document.getElementById('starter-filter-branch')?.focus();
  }

  /** @param {Event} event - Delegated click */
  handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !this.isCurrent()) {
      return;
    }
    if (target.id === 'starter-retry') {
      this.renderLoading();
      this.load();
    } else if (target.id === 'starter-filters-reset' || target.id === 'starter-no-match-reset') {
      this.resetFilters();
    } else if (target.id === 'starter-add-selected') {
      const order = (this.catalogue?.activities || []).map((activity) => activity.key);
      this.importKeys(order.filter((key) => this.selected.has(key)));
    } else if (target.dataset.starterDetails) {
      this.showDetails(target.dataset.starterDetails);
    } else if (target.dataset.starterAdd && document.getElementById('starter-activities')?.contains(target)) {
      this.importKeys([target.dataset.starterAdd]);
    }
  }
}
