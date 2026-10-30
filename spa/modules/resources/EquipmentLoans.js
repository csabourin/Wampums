/**
 * Who has the equipment — record who takes which equipment home, and what has
 * come back.
 *
 * Built for the end of a camp: the camp's reserved equipment is already
 * listed, so handing out tents and tarps is choosing a person and a count for
 * each item; whatever nobody takes stays in storage. It works without a
 * network: the handout and the returns are queued and sent later.
 *
 * Below, everything still out, grouped by the person who has it, with overdue
 * loans first and one button to record a return.
 *
 * @module spa/modules/resources/EquipmentLoans
 */

import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import { hasAllPermissions, hasPermission } from '../../utils/PermissionUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirm, confirmDestructive } from '../../utils/DialogUtils.js';
import {
  getEquipmentLoans,
  getEquipmentHandout,
  createEquipmentLoans,
  updateEquipmentLoan,
  deleteEquipmentLoan,
} from '../../api/api-equipment-loans.js';
import equipmentLoansStylesheetUrl from '../../../css/equipment-loans.css?url';

const SHORT_DATE = { year: 'numeric', month: 'short', day: 'numeric' };
/** Holder values in the person picker: a youth or an adult account. */
const YOUTH_PREFIX = 'p:';
const ADULT_PREFIX = 'u:';

/**
 * Text as a search compares it: lower case, without accents, so "lea" finds "Léa".
 * @param {string} text
 * @returns {string}
 */
function searchable(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * The date a number of days after today, as YYYY-MM-DD in local time.
 * @param {number} days
 * @returns {string}
 */
function daysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

export class EquipmentLoans {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.destroyed = false;
    this.listeners = new AbortController();
    // The handout lists the unit's youths and leaders, which its endpoint
    // guards with participants.view as well as the right to lend. Checking
    // loans back in takes only the right to lend, as its endpoints do.
    this.canLend = hasAllPermissions('inventory.reserve', 'participants.view');
    this.canReturn = hasPermission('inventory.reserve');
    this.loans = [];
    this.status = 'open';
    this.handout = null;
    this.activityId = null;
    this.reason = 'drying';
    this.dueDate = daysFromToday(CONFIG.EQUIPMENT_LOANS.DEFAULT_LOAN_DAYS);
    this.notes = '';
    /** @type {Map<number, Array<{holder: string, quantity: number}>>} */
    this.assignments = new Map();
    /** Youths marked present at the chosen activity; null when not known. */
    this.presentIds = null;
    /** The item whose person picker is open, and what was typed in its search. */
    this.openPicker = null;
    this.pickerQuery = '';
    /** Name typed to filter the loans still out. */
    this.loanFilter = '';
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
    this.listeners.abort();
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('equipment_loans_title'), className: 'equipment-loans' };
  }

  async init() {
    loadStylesheet(equipmentLoansStylesheetUrl).catch((error) => {
      debugError('Failed to load equipment loans styles:', error);
    });
    const requested = Number(new URLSearchParams(window.location.search).get('activity_id'));
    this.activityId = Number.isInteger(requested) && requested > 0 ? requested : null;
    this.handout = null;
    this.listeners.abort();
    this.listeners = new AbortController();
    this.listenForReplays();

    setContent(this.root(), pageLoadingMarkup(this.pageOptions()));
    try {
      await this.load();
    } catch (error) {
      debugError('Failed to load equipment loans:', error);
      this.renderError();
      return;
    }
    this.render();
  }

  /**
   * Load the loans and, for someone who may lend, the handout. On first
   * opening without an activity in the address, the handout opens on the
   * latest activity that reserved equipment and has started: the camp just
   * over. Later reloads keep the activity chosen, "No activity" included.
   *
   * @param {{forceRefresh?: boolean}} [options]
   * @returns {Promise<void>}
   */
  async load(options = {}) {
    const [loansResponse] = await Promise.all([
      getEquipmentLoans({ status: this.status }, options),
      this.canLend ? this.loadHandout(options, this.activityId === null && this.handout === null) : Promise.resolve(),
    ]);
    this.loans = Array.isArray(loansResponse?.data?.loans) ? loansResponse.data.loans : [];
  }

  /**
   * @param {{forceRefresh?: boolean}} options
   * @param {boolean} pickDefault - Choose the activity to open on
   * @returns {Promise<void>}
   */
  async loadHandout(options = {}, pickDefault = false) {
    let response = await getEquipmentHandout(this.activityId, options);
    if (pickDefault) {
      const today = getTodayISO();
      const latest = (response?.data?.activities || [])
        .find((activity) => activity.has_reservations && activity.start_date <= today);
      if (latest) {
        this.activityId = Number(latest.id);
        response = await getEquipmentHandout(this.activityId, options);
      }
    }
    const data = response?.data || {};
    this.handout = {
      activities: Array.isArray(data.activities) ? data.activities : [],
      items: Array.isArray(data.items) ? data.items : [],
      participants: Array.isArray(data.holders?.participants) ? data.holders.participants : [],
      adults: Array.isArray(data.holders?.adults) ? data.holders.adults : [],
      reasons: Array.isArray(data.reasons) && data.reasons.length ? data.reasons : ['drying'],
    };
    const present = data.holders?.present_participant_ids;
    this.presentIds = Array.isArray(present) ? new Set(present.map(Number)) : null;
    // A reload (after a return, or once the outbox sends something) keeps the
    // handout under way; only items no longer offered lose their people.
    const offered = new Set(this.handout.items.map((item) => Number(item.equipment_id)));
    [...this.assignments.keys()].forEach((equipmentId) => {
      if (!offered.has(equipmentId)) {
        this.assignments.delete(equipmentId);
      }
    });
  }

  /**
   * A queued handout or return was sent, or refused, from the outbox: show
   * what the server now holds.
   */
  listenForReplays() {
    const reload = (event) => {
      if (!String(event.detail?.url || '').includes('/equipment-loans')) {
        return;
      }
      if (event.type === 'offlineMutationRejected' && !this.destroyed) {
        this.app.showMessage(translate('equipment_loans_replay_rejected'), 'error');
      }
      this.reload();
    };
    window.addEventListener('offlineMutationReplayed', reload, { signal: this.listeners.signal });
    window.addEventListener('offlineMutationRejected', reload, { signal: this.listeners.signal });
  }

  /**
   * Reload after a write the server accepted. The write stands even if the
   * reload fails: the page says it could not refresh and offers a retry.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    try {
      await this.load({ forceRefresh: true });
    } catch (error) {
      debugError('Failed to reload equipment loans:', error);
      if (!this.destroyed) {
        this.renderError('equipment_loans_saved_reload_failed');
      }
      return;
    }
    this.render();
  }

  /** @param {string} [messageKey] - What to say instead of the generic failure */
  renderError(messageKey = 'error_loading_data') {
    if (this.destroyed) {
      return;
    }
    setContent(this.root(), pageErrorMarkup({
      ...this.pageOptions(),
      message: translate(messageKey),
      retryId: 'equipment-loans-retry',
    }));
    document.getElementById('equipment-loans-retry')
      ?.addEventListener('click', () => this.init(), { signal: this.listeners.signal });
  }

  /** @returns {string} The reader's language, for dates */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @param {string|null} date @returns {string} */
  formatDay(date) {
    return date ? formatDate(date, this.lang(), SHORT_DATE) : '';
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const root = this.root();
    setContent(root, `
      <section class="page equipment-loans">
        ${renderBackLink('/inventory')}
        <h1>${escapeHTML(translate('equipment_loans_title'))}</h1>
        <p class="subtitle">${escapeHTML(translate('equipment_loans_intro'))}</p>
        ${this.canLend ? this.handoutMarkup() : ''}
        ${this.loansMarkup()}
      </section>
    `);
    this.attachEvents();
  }

  // ---------------------------------------------------------------------------
  // Handout
  // ---------------------------------------------------------------------------

  handoutMarkup() {
    const { activities, items, reasons } = this.handout;
    const activityOptions = activities.map((activity) => `
      <option value="${Number(activity.id)}" ${Number(activity.id) === this.activityId ? 'selected' : ''}>
        ${escapeHTML(activity.name)} (${escapeHTML(this.formatDay(activity.start_date))})
      </option>`).join('');
    const reasonOptions = reasons.map((reason) => `
      <option value="${escapeAttribute(reason)}" ${reason === this.reason ? 'selected' : ''}>
        ${escapeHTML(translate(`equipment_loan_reason_${reason}`))}
      </option>`).join('');
    const emptyMessage = this.activityId
      ? 'equipment_loans_activity_no_equipment'
      : 'equipment_loans_no_equipment';

    return `
      <section class="card equipment-loans__handout" aria-labelledby="equipment-loans-handout-title">
        <h2 id="equipment-loans-handout-title">${escapeHTML(translate('equipment_loans_handout_title'))}</h2>
        <form id="equipment-loans-handout-form" novalidate>
          <details class="equipment-loans__settings-box" ${this.activityId ? '' : 'open'}>
            <summary><span id="equipment-loans-settings-summary">${escapeHTML(this.settingsSummary())}</span>
              <span class="equipment-loans__settings-edit">${escapeHTML(translate('equipment_loans_settings_edit'))}</span></summary>
            <div class="equipment-loans__settings">
              <div class="form-group">
                <label for="equipment-loans-activity">${escapeHTML(translate('equipment_loans_activity_label'))}</label>
                <select id="equipment-loans-activity">
                  <option value="" ${this.activityId ? '' : 'selected'}>${escapeHTML(translate('equipment_loans_no_activity'))}</option>
                  ${activityOptions}
                </select>
              </div>
              <div class="form-group">
                <label for="equipment-loans-reason">${escapeHTML(translate('equipment_loans_reason_label'))}</label>
                <select id="equipment-loans-reason">${reasonOptions}</select>
              </div>
              <div class="form-group">
                <label for="equipment-loans-due">${escapeHTML(translate('equipment_loans_due_label'))}</label>
                <input type="date" id="equipment-loans-due" min="${escapeAttribute(getTodayISO())}"
                  value="${escapeAttribute(this.dueDate)}" aria-describedby="equipment-loans-due-error" />
                <p class="field-error" id="equipment-loans-due-error" role="alert"></p>
              </div>
              <div class="form-group">
                <label for="equipment-loans-notes">${escapeHTML(translate('equipment_loans_notes_label'))}</label>
                <input type="text" id="equipment-loans-notes" maxlength="${CONFIG.EQUIPMENT_LOANS.MAX_NOTE_LENGTH}"
                  value="${escapeAttribute(this.notes)}" />
              </div>
            </div>
          </details>
          ${items.length
    ? `<div class="equipment-loans__items">${items.map((item) => this.itemMarkup(item)).join('')}</div>`
    : `<p class="equipment-loans__empty">${escapeHTML(translate(emptyMessage))}</p>`}
          <p class="field-error" id="equipment-loans-form-error" role="alert"></p>
          ${items.length ? `
            <div class="equipment-loans__submit-bar">
              <button type="submit" class="button button--primary" id="equipment-loans-submit">${escapeHTML(this.submitLabel())}</button>
            </div>` : ''}
        </form>
      </section>`;
  }

  /** @returns {string} The activity, reason and return date on one line, for the folded settings */
  settingsSummary() {
    const activity = this.handout.activities.find((entry) => Number(entry.id) === this.activityId);
    const parts = [
      activity ? activity.name : translate('equipment_loans_no_activity'),
      translate(`equipment_loan_reason_${this.reason}`),
      this.dueDate ? translate('equipment_loans_due_on').replace('{date}', this.formatDay(this.dueDate)) : translate('equipment_loans_no_due'),
    ];
    return parts.join(' · ');
  }

  /** @returns {number} Loans the handout would record */
  pendingCount() {
    return [...this.assignments.values()].reduce((total, rows) => total + rows.filter((row) => row.holder).length, 0);
  }

  /** @returns {string} The submit button's text, naming how many loans it records */
  submitLabel() {
    const count = this.pendingCount();
    return count ? translate('equipment_loans_submit_count').replace('{count}', String(count)) : translate('equipment_loans_submit');
  }

  updateSubmit() {
    const button = document.getElementById('equipment-loans-submit');
    if (button) {
      button.textContent = this.submitLabel();
    }
  }

  /**
   * Units of an item that may still be lent: what the unit owns less what is
   * already out with someone.
   * @param {Object} item
   * @returns {number}
   */
  availableOf(item) {
    return Math.max(0, Number(item.quantity_total) - Number(item.out_quantity || 0));
  }

  /** @param {Object} item @returns {number} Units assigned on this screen */
  assignedOf(item) {
    return (this.assignments.get(Number(item.equipment_id)) || [])
      .reduce((total, row) => total + (Number(row.quantity) || 0), 0);
  }

  /** @param {Object} item @returns {string} What stays in storage, as a sentence */
  remainingText(item) {
    const available = this.availableOf(item);
    const assigned = this.assignedOf(item);
    if (assigned > available) {
      return translate('equipment_loans_too_many').replace('{available}', String(available));
    }
    return translate('equipment_loans_stays_in_storage').replace('{count}', String(available - assigned));
  }

  itemMarkup(item) {
    const id = Number(item.equipment_id);
    const facts = [];
    if (item.reserved_quantity !== null && item.reserved_quantity !== undefined) {
      facts.push(translate('equipment_loans_reserved_count').replace('{count}', String(item.reserved_quantity)));
    }
    if (Number(item.out_quantity) > 0) {
      facts.push(translate('equipment_loans_out_count').replace('{count}', String(item.out_quantity)));
    }
    facts.push(translate('equipment_loans_owned_count').replace('{count}', String(item.quantity_total)));
    const assigned = this.assignedOf(item);
    const over = assigned > this.availableOf(item);

    return `
      <fieldset class="equipment-loans__item" data-equipment-id="${id}">
        <legend>${escapeHTML(item.name)}</legend>
        <p class="equipment-loans__facts">${escapeHTML(facts.join(' · '))}</p>
        <div class="equipment-loans__rows" id="equipment-loans-rows-${id}">
          ${this.rowsMarkup(item)}
        </div>
        <p class="equipment-loans__remaining ${over ? 'is-over' : ''}" id="equipment-loans-remaining-${id}"
          role="status">${over ? '<span aria-hidden="true">⚠ </span>' : ''}${escapeHTML(this.remainingText(item))}</p>
        <button type="button" class="button button--secondary button--small" data-add-holder="${id}"
          aria-expanded="${this.openPicker === id}" aria-controls="equipment-loans-picker-${id}">
          ${escapeHTML(translate('equipment_loans_add_person'))}
          <span class="visually-hidden">${escapeHTML(translate('equipment_loans_for_item').replace('{item}', item.name))}</span>
        </button>
        <div class="equipment-loans__picker" id="equipment-loans-picker-${id}" ${this.openPicker === id ? '' : 'hidden'}>
          ${this.openPicker === id ? this.pickerMarkup(item) : ''}
        </div>
      </fieldset>`;
  }

  rowsMarkup(item) {
    const id = Number(item.equipment_id);
    return (this.assignments.get(id) || []).map((row, index) => {
      const quantityId = `equipment-loans-quantity-${id}-${index}`;
      const name = this.holderName(row.holder);
      return `
        <div class="equipment-loans__row" data-row="${index}">
          <p class="equipment-loans__holder" id="equipment-loans-holder-${id}-${index}">${escapeHTML(name)}</p>
          <div class="form-group equipment-loans__quantity-field">
            <label class="visually-hidden" for="${quantityId}">${escapeHTML(translate('equipment_loans_quantity_for').replace('{person}', name))}</label>
            <div class="equipment-loans__stepper">
              <button type="button" class="button button--secondary" data-step="-1" data-equipment="${id}" data-index="${index}"
                aria-label="${escapeAttribute(translate('equipment_loans_decrease').replace('{item}', item.name))}">−</button>
              <input type="number" inputmode="numeric" id="${quantityId}" min="1" max="${this.availableOf(item)}"
                value="${Number(row.quantity) || 1}" data-quantity="${id}" data-index="${index}"
                aria-describedby="equipment-loans-remaining-${id}" />
              <button type="button" class="button button--secondary" data-step="1" data-equipment="${id}" data-index="${index}"
                aria-label="${escapeAttribute(translate('equipment_loans_increase').replace('{item}', item.name))}">+</button>
            </div>
          </div>
          <button type="button" class="button button--ghost button--small" data-remove-row="${id}" data-index="${index}">
            ${escapeHTML(translate('equipment_loans_remove_person'))}<span class="visually-hidden"> ${escapeHTML(name)}</span>
          </button>
        </div>`;
    }).join('');
  }

  /** @returns {Array<{key: string, name: string, group: string}>} Everyone who may take equipment, present youths first */
  people() {
    const { participants, adults } = this.handout;
    const presentKnown = this.presentIds && this.presentIds.size > 0;
    const youths = participants.map((youth) => ({
      key: `${YOUTH_PREFIX}${Number(youth.id)}`,
      name: `${youth.first_name} ${youth.last_name}`,
      group: presentKnown && this.presentIds.has(Number(youth.id)) ? 'present' : 'youths',
    }));
    return [
      ...youths.filter((person) => person.group === 'present'),
      ...youths.filter((person) => person.group === 'youths'),
      ...adults.map((adult) => ({ key: `${ADULT_PREFIX}${adult.id}`, name: adult.full_name || '', group: 'adults' })),
    ];
  }

  /** @param {string} key @returns {string} The name of a youth or leader chosen on the handout */
  holderName(key) {
    return this.people().find((person) => person.key === key)?.name || translate('equipment_loans_former_member');
  }

  /** @param {string} query @returns {Array<Object>} People whose name contains every typed word */
  matchingPeople(query) {
    const words = searchable(query).split(/\s+/).filter(Boolean);
    return this.people().filter((person) => words.every((word) => searchable(person.name).includes(word)));
  }

  /**
   * Search and tick: each ticked person takes one of this item, so handing a tent to
   * each of six youths is six taps. Present youths come first when attendance says who came.
   * @param {Object} item
   * @returns {string} HTML
   */
  pickerMarkup(item) {
    const id = Number(item.equipment_id);
    return `
      <label for="equipment-loans-search-${id}">${escapeHTML(translate('equipment_loans_search_label'))}</label>
      <input type="search" id="equipment-loans-search-${id}" data-search="${id}" autocomplete="off"
        value="${escapeAttribute(this.pickerQuery)}" aria-describedby="equipment-loans-search-count-${id}" />
      <p class="equipment-loans__search-count" id="equipment-loans-search-count-${id}" role="status"></p>
      <div class="equipment-loans__people" data-people="${id}">${this.peopleMarkup(item)}</div>
      <button type="button" class="button button--secondary button--small" data-picker-done="${id}">
        ${escapeHTML(translate('equipment_loans_picker_done'))}
      </button>`;
  }

  /** @param {Object} item @returns {string} HTML: the matching people, grouped, each with a checkbox */
  peopleMarkup(item) {
    const id = Number(item.equipment_id);
    const chosen = new Set((this.assignments.get(id) || []).map((row) => row.holder));
    const matches = this.matchingPeople(this.pickerQuery);
    if (!matches.length) {
      return `<p class="equipment-loans__empty">${escapeHTML(translate('equipment_loans_search_none'))}</p>`;
    }
    const titles = {
      present: translate('equipment_loans_present_group'),
      youths: translate(this.presentIds?.size ? 'equipment_loans_other_youths' : 'equipment_loans_youths'),
      adults: translate('equipment_loans_adults'),
    };
    return ['present', 'youths', 'adults'].map((group) => {
      const members = matches.filter((person) => person.group === group);
      if (!members.length) {
        return '';
      }
      return `<fieldset class="equipment-loans__people-group"><legend>${escapeHTML(titles[group])}</legend>
        ${members.map((person, index) => {
    const inputId = `equipment-loans-pick-${id}-${group}-${index}`;
    return `<label class="equipment-loans__person" for="${inputId}">
          <input type="checkbox" id="${inputId}" data-pick="${id}" value="${escapeAttribute(person.key)}" ${chosen.has(person.key) ? 'checked' : ''} />
          <span>${escapeHTML(person.name)}</span></label>`;
  }).join('')}</fieldset>`;
    }).join('');
  }

  /** Redraw the people list of an open picker, leaving focus in its search field. */
  filterPeople(equipmentId) {
    const item = this.itemById(equipmentId);
    const list = document.querySelector(`[data-people="${equipmentId}"]`);
    if (!item || !list) {
      return;
    }
    setContent(list, this.peopleMarkup(item));
    const count = this.matchingPeople(this.pickerQuery).length;
    document.getElementById(`equipment-loans-search-count-${equipmentId}`).textContent =
      translate('equipment_loans_search_count').replace('{count}', String(count));
  }

  /** @param {number} equipmentId */
  togglePicker(equipmentId) {
    const opening = this.openPicker !== equipmentId;
    const previous = this.openPicker;
    this.openPicker = opening ? equipmentId : null;
    this.pickerQuery = '';
    [previous, equipmentId].filter((id) => id !== null).forEach((id) => {
      const item = this.itemById(id);
      const picker = document.getElementById(`equipment-loans-picker-${id}`);
      const button = document.querySelector(`[data-add-holder="${id}"]`);
      if (!item || !picker || !button) {
        return;
      }
      const open = this.openPicker === id;
      picker.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      setContent(picker, open ? this.pickerMarkup(item) : '');
    });
    if (opening) {
      document.getElementById(`equipment-loans-search-${equipmentId}`)?.focus();
    } else {
      document.querySelector(`[data-add-holder="${equipmentId}"]`)?.focus();
    }
  }

  /**
   * A ticked person takes one of the item; untick removes their line.
   * @param {number} equipmentId
   * @param {string} holder
   * @param {boolean} checked
   */
  pick(equipmentId, holder, checked) {
    const rows = (this.assignments.get(equipmentId) || []).filter((row) => row.holder !== holder);
    if (checked) {
      rows.push({ holder, quantity: 1 });
    }
    this.assignments.set(equipmentId, rows);
    document.getElementById('equipment-loans-form-error').textContent = '';
    this.redrawItem(equipmentId);
    this.updateSubmit();
  }

  /** @param {number} equipmentId @returns {Object|undefined} */
  itemById(equipmentId) {
    return this.handout.items.find((item) => Number(item.equipment_id) === equipmentId);
  }

  /**
   * Redraw one item's people after a row was added or removed, keeping the
   * rest of the form (and what was typed in it) as it is.
   *
   * @param {number} equipmentId
   * @param {string|null} focusSelector - Element to focus afterwards
   */
  redrawItem(equipmentId, focusSelector = null) {
    const item = this.itemById(equipmentId);
    const container = document.getElementById(`equipment-loans-rows-${equipmentId}`);
    if (!item || !container) {
      return;
    }
    setContent(container, this.rowsMarkup(item));
    this.updateRemaining(equipmentId);
    if (focusSelector) {
      document.querySelector(focusSelector)?.focus();
    }
  }

  /** @param {number} equipmentId */
  updateRemaining(equipmentId) {
    const item = this.itemById(equipmentId);
    const remaining = document.getElementById(`equipment-loans-remaining-${equipmentId}`);
    if (!item || !remaining) {
      return;
    }
    const over = this.assignedOf(item) > this.availableOf(item);
    remaining.classList.toggle('is-over', over);
    document.querySelectorAll(`[data-quantity="${equipmentId}"]`).forEach((input) => {
      if (over) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    });
    setContent(remaining, `${over ? '<span aria-hidden="true">⚠ </span>' : ''}${escapeHTML(this.remainingText(item))}`);
  }

  /** @param {number} equipmentId @param {number} index */
  removeRow(equipmentId, index) {
    const rows = this.assignments.get(equipmentId) || [];
    const [removed] = rows.splice(index, 1);
    this.assignments.set(equipmentId, rows);
    const ticked = document.querySelector(`[data-pick="${equipmentId}"][value="${removed?.holder}"]`);
    if (ticked) {
      ticked.checked = false;
    }
    this.redrawItem(equipmentId, `[data-add-holder="${equipmentId}"]`);
    this.updateSubmit();
  }

  /** @param {number} equipmentId @param {number} index @param {number} delta */
  step(equipmentId, index, delta) {
    const row = (this.assignments.get(equipmentId) || [])[index];
    if (!row) {
      return;
    }
    row.quantity = Math.max(1, (Number(row.quantity) || 1) + delta);
    const input = document.getElementById(`equipment-loans-quantity-${equipmentId}-${index}`);
    if (input) {
      input.value = String(row.quantity);
    }
    this.updateRemaining(equipmentId);
  }

  /** @returns {boolean} Whether a person was chosen anywhere on the handout */
  hasPendingHandout() {
    return [...this.assignments.values()].some((rows) => rows.some((row) => row.holder));
  }

  async changeActivity(value) {
    const previous = this.activityId;
    if (this.hasPendingHandout()) {
      const abandon = await confirm({
        title: translate('equipment_loans_change_activity_title'),
        message: translate('equipment_loans_change_activity_confirm'),
      });
      if (!abandon) {
        const select = document.getElementById('equipment-loans-activity');
        if (select) {
          select.value = previous ? String(previous) : '';
        }
        return;
      }
    }
    this.activityId = value ? Number(value) : null;
    const abandoned = this.assignments;
    this.assignments = new Map();
    this.openPicker = null;
    try {
      await this.loadHandout();
    } catch (error) {
      debugError('Failed to load handout:', error);
      this.activityId = previous;
      this.assignments = abandoned;
      this.app.showMessage(apiErrorMessage(error, 'error_loading_data'), 'error');
      return;
    }
    this.render();
    document.getElementById('equipment-loans-activity')?.focus();
  }

  /**
   * Check the handout before sending it: every row names a person, no item
   * is lent beyond what is in storage, and the due date is not past.
   *
   * @returns {Array<Object>|null} The loans to send, or null when a field needs fixing
   */
  collectLoans() {
    const form = document.getElementById('equipment-loans-handout-form');
    form.querySelectorAll('.field-error').forEach((element) => {
      element.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));

    let firstInvalid = null;
    const flag = (field, errorId, messageKey) => {
      const message = document.getElementById(errorId);
      if (message) {
        message.textContent = translate(messageKey);
      }
      field?.setAttribute('aria-invalid', 'true');
      firstInvalid ||= field;
    };

    const loans = [];
    this.handout.items.forEach((item) => {
      const id = Number(item.equipment_id);
      (this.assignments.get(id) || []).forEach((row) => {
        if (!row.holder) {
          return;
        }
        const loan = { equipment_id: id, quantity: Math.max(1, Number(row.quantity) || 1) };
        if (row.holder.startsWith(YOUTH_PREFIX)) {
          loan.participant_id = Number(row.holder.slice(YOUTH_PREFIX.length));
        } else {
          loan.user_id = row.holder.slice(ADULT_PREFIX.length);
        }
        loans.push(loan);
      });
      if (this.assignedOf(item) > this.availableOf(item)) {
        this.updateRemaining(id);
        firstInvalid ||= document.getElementById(`equipment-loans-quantity-${id}-0`);
      }
    });

    const due = document.getElementById('equipment-loans-due');
    if (this.dueDate && this.dueDate < getTodayISO()) {
      flag(due, 'equipment-loans-due-error', 'equipment_loan_due_date_past');
    }
    if (!firstInvalid && loans.length === 0) {
      const formError = document.getElementById('equipment-loans-form-error');
      formError.textContent = translate('equipment_loans_nothing_to_record');
      firstInvalid = document.querySelector('[data-add-holder]');
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    return loans;
  }

  async submitHandout(form) {
    const loans = this.collectLoans();
    if (!loans) {
      return;
    }
    await withFormBusy(form, async () => {
      let result;
      try {
        result = await createEquipmentLoans({
          activity_id: this.activityId,
          reason: this.reason,
          due_date: this.dueDate || null,
          notes: this.notes.trim() || null,
          loans,
        });
      } catch (error) {
        debugError('Failed to record equipment loans:', error);
        const formError = document.getElementById('equipment-loans-form-error');
        if (formError) {
          formError.textContent = apiErrorMessage(error, 'equipment_loans_save_failed');
        }
        return;
      }
      this.assignments = new Map();
      this.openPicker = null;
      this.notes = '';
      if (result?.queued) {
        // Not sent yet: say so, and draw the cleared form; the list fills
        // once the outbox sends it.
        this.app.showMessage(translate('equipment_loans_queued'), 'info');
        this.render();
        return;
      }
      this.app.showMessage(translate('equipment_loans_saved'), 'success');
      await this.reload();
    });
  }

  // ---------------------------------------------------------------------------
  // Loans out
  // ---------------------------------------------------------------------------

  /**
   * Loans grouped by the person who has them, in the server's order (overdue
   * first). A holder erased since keeps the loan, as "former member".
   *
   * @returns {Array<{key: string, name: string, loans: Array<Object>}>}
   */
  groupedLoans() {
    const groups = new Map();
    this.loans.forEach((loan) => {
      const key = loan.holder_type === 'participant'
        ? `${YOUTH_PREFIX}${loan.holder_participant_id}`
        : loan.holder_type === 'user' ? `${ADULT_PREFIX}${loan.holder_user_id}` : 'former';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: loan.holder_name || translate('equipment_loans_former_member'),
          loans: [],
        });
      }
      groups.get(key).loans.push(loan);
    });
    return [...groups.values()];
  }

  loansMarkup() {
    const groups = this.groupedLoans();
    const emptyKey = this.status === 'open' ? 'equipment_loans_none_out' : 'equipment_loans_none_returned';
    return `
      <section class="card equipment-loans__out" aria-labelledby="equipment-loans-out-title">
        <h2 id="equipment-loans-out-title">${escapeHTML(translate('equipment_loans_out_title'))}</h2>
        <div class="form-group equipment-loans__filter">
          <label for="equipment-loans-status">${escapeHTML(translate('equipment_loans_status_label'))}</label>
          <select id="equipment-loans-status" data-archive-safe>
            <option value="open" ${this.status === 'open' ? 'selected' : ''}>${escapeHTML(translate('equipment_loans_status_open'))}</option>
            <option value="returned" ${this.status === 'returned' ? 'selected' : ''}>${escapeHTML(translate('equipment_loans_status_returned'))}</option>
          </select>
        </div>
        ${groups.length > 1 || this.loanFilter ? `<div class="form-group equipment-loans__filter">
          <label for="equipment-loans-filter">${escapeHTML(translate('equipment_loans_filter_label'))}</label>
          <input type="search" id="equipment-loans-filter" autocomplete="off" data-archive-safe value="${escapeAttribute(this.loanFilter)}"
            aria-describedby="equipment-loans-filter-count" />
          <p class="equipment-loans__search-count" id="equipment-loans-filter-count" role="status"></p>
        </div>` : ''}
        ${groups.length
    ? `<div class="equipment-loans__groups" id="equipment-loans-groups">${this.groupsMarkup(groups)}</div>`
    : `<p class="equipment-loans__empty">${escapeHTML(translate(emptyKey))}</p>`}
      </section>`;
  }

  /** @param {Array<Object>} groups @returns {string} HTML: the people whose name matches the filter */
  groupsMarkup(groups) {
    const words = searchable(this.loanFilter).split(/\s+/).filter(Boolean);
    const shown = groups.filter((group) => words.every((word) => searchable(group.name).includes(word)));
    return shown.length ? shown.map((group) => this.groupMarkup(group)).join('')
      : `<p class="equipment-loans__empty">${escapeHTML(translate('equipment_loans_search_none'))}</p>`;
  }

  groupMarkup(group) {
    const open = group.loans.filter((loan) => !loan.returned_at);
    const returnAll = this.canReturn && open.length > 1 ? `
      <button type="button" class="button button--secondary button--small" data-return-all="${escapeAttribute(group.key)}">
        ${escapeHTML(translate('equipment_loans_return_all'))}
        <span class="visually-hidden">${escapeHTML(group.name)}</span>
      </button>` : '';
    return `
      <section class="equipment-loans__group">
        <div class="equipment-loans__group-header">
          <h3>${escapeHTML(group.name)}</h3>
          ${returnAll}
        </div>
        <ul class="equipment-loans__list">${group.loans.map((loan) => this.loanMarkup(loan, group.name)).join('')}</ul>
      </section>`;
  }

  loanMarkup(loan, holderName) {
    const outstanding = Number(loan.outstanding_quantity);
    const details = [translate(`equipment_loan_reason_${loan.reason}`)];
    if (loan.returned_at) {
      details.push(translate('equipment_loans_returned_on').replace('{date}', this.formatDay(loan.returned_on)));
    } else {
      if (Number(loan.returned_quantity) > 0) {
        details.push(translate('equipment_loans_partly_back').replace('{count}', String(loan.returned_quantity)));
      }
      if (loan.due_date) {
        details.push(translate('equipment_loans_due_on').replace('{date}', this.formatDay(loan.due_date)));
      }
    }
    if (loan.activity_name) {
      details.push(loan.activity_name);
    }
    const label = `${loan.equipment_name}, ${holderName}`;
    const count = loan.returned_at ? Number(loan.quantity) : outstanding;
    const actions = !this.canReturn ? '' : loan.returned_at ? `
        <button type="button" class="button button--ghost button--small" data-reopen="${Number(loan.id)}"
          aria-label="${escapeAttribute(translate('equipment_loans_reopen_for').replace('{item}', label))}">
          ${escapeHTML(translate('equipment_loans_reopen'))}
        </button>` : `
        <button type="button" class="button button--primary button--small" data-return="${Number(loan.id)}"
          aria-label="${escapeAttribute(translate('equipment_loans_return_for').replace('{item}', label))}">
          ${escapeHTML(translate('equipment_loans_return'))}
        </button>
        ${outstanding > 1 ? `
        <button type="button" class="button button--secondary button--small" data-partial="${Number(loan.id)}"
          aria-label="${escapeAttribute(translate('equipment_loans_partial_for').replace('{item}', label))}">
          ${escapeHTML(translate('equipment_loans_partial'))}
        </button>` : ''}
        <button type="button" class="button button--danger button--small" data-delete="${Number(loan.id)}"
          aria-label="${escapeAttribute(translate('equipment_loans_delete_for').replace('{item}', label))}">
          ${escapeHTML(translate('delete'))}
        </button>`;

    return `
      <li class="equipment-loans__loan ${loan.overdue ? 'is-overdue' : ''}">
        <div class="equipment-loans__loan-text">
          <p class="equipment-loans__loan-name">
            ${escapeHTML(loan.equipment_name)} <span class="equipment-loans__count">× ${count}</span>
            ${loan.overdue ? `<span class="equipment-loans__overdue">${escapeHTML(translate('equipment_loans_overdue'))}</span>` : ''}
          </p>
          <p class="equipment-loans__loan-details">${escapeHTML(details.join(' · '))}</p>
          ${loan.notes ? `<p class="equipment-loans__loan-details">${escapeHTML(loan.notes)}</p>` : ''}
          ${loan.return_note ? `<p class="equipment-loans__loan-details">${escapeHTML(loan.return_note)}</p>` : ''}
        </div>
        ${actions ? `<div class="equipment-loans__actions">${actions}</div>` : ''}
      </li>`;
  }

  /** @param {number} loanId @returns {Object|undefined} */
  loanById(loanId) {
    return this.loans.find((loan) => Number(loan.id) === loanId);
  }

  /**
   * Send returns (or a reopening) one loan after another, then reload once.
   *
   * @param {Array<{loan: Object, changes: Object}>} updates
   * @param {string} savedKey - What to say once sent
   * @returns {Promise<boolean>} Whether every update was accepted or queued
   */
  async sendUpdates(updates, savedKey) {
    let queued = false;
    try {
      const results = await Promise.all(updates.map(({ loan, changes }) => updateEquipmentLoan(loan.id, changes)));
      queued = results.some((result) => result?.queued);
    } catch (error) {
      debugError('Failed to update equipment loan:', error);
      this.app.showMessage(apiErrorMessage(error, 'equipment_loans_return_failed'), 'error');
      await this.reload();
      return false;
    }
    if (queued) {
      // Not sent yet: show the loans as they will be once it is, so a second
      // return entered offline counts from the first rather than over it.
      updates.forEach(({ loan, changes }) => this.applyLocally(loan, changes));
      this.app.showMessage(translate('equipment_loans_return_queued'), 'info');
      this.render();
      return true;
    }
    this.app.showMessage(translate(savedKey), 'success');
    await this.reload();
    return true;
  }

  /**
   * Apply a queued change to the loan as shown. A return sends a count, so
   * the next one entered here starts from this one.
   *
   * @param {Object} loan - Loan as listed
   * @param {Object} changes - What was queued
   */
  applyLocally(loan, changes) {
    if (changes.returned_quantity !== undefined) {
      loan.returned_quantity = changes.returned_quantity;
      loan.outstanding_quantity = Number(loan.quantity) - Number(changes.returned_quantity);
      if (loan.outstanding_quantity === 0) {
        loan.returned_at ||= new Date().toISOString();
        loan.returned_on ||= getTodayISO();
        loan.overdue = false;
      } else {
        loan.returned_at = null;
      }
    }
    if (changes.return_note !== undefined) {
      loan.return_note = changes.return_note;
    }
  }

  async returnLoans(loans) {
    await this.sendUpdates(
      loans.map((loan) => ({ loan, changes: { returned_quantity: Number(loan.quantity) } })),
      'equipment_loans_returned',
    );
  }

  async reopenLoan(loan) {
    await this.sendUpdates([{ loan, changes: { returned_quantity: 0 } }], 'equipment_loans_reopened');
  }

  async deleteLoan(loan) {
    const confirmed = await confirmDestructive({
      title: translate('equipment_loans_delete_title'),
      message: translate('equipment_loans_delete_confirm')
        .replace('{item}', loan.equipment_name)
        .replace('{person}', loan.holder_name || translate('equipment_loans_former_member')),
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteEquipmentLoan(loan.id);
    } catch (error) {
      debugError('Failed to delete equipment loan:', error);
      this.app.showMessage(apiErrorMessage(error, 'equipment_loans_delete_failed'), 'error');
      return;
    }
    this.app.showMessage(translate('equipment_loans_deleted'), 'success');
    await this.reload();
  }

  openPartialReturn(loan) {
    const outstanding = Number(loan.outstanding_quantity);
    const modal = openModal({
      id: 'equipment-loans-partial-modal',
      title: escapeHTML(translate('equipment_loans_partial_title').replace('{item}', loan.equipment_name)),
      size: 'small',
      closeOnBackdrop: false,
      body: `
        <form id="equipment-loans-partial-form" novalidate>
          <p>${escapeHTML(translate('equipment_loans_partial_still_out')
    .replace('{count}', String(outstanding))
    .replace('{person}', loan.holder_name || translate('equipment_loans_former_member')))}</p>
          <div class="form-group">
            <label for="equipment-loans-partial-count">${escapeHTML(translate('equipment_loans_partial_count_label'))}</label>
            <input type="number" inputmode="numeric" id="equipment-loans-partial-count" min="1" max="${outstanding}"
              value="1" required aria-describedby="equipment-loans-partial-error" />
            <p class="field-error" id="equipment-loans-partial-error" role="alert"></p>
          </div>
          <div class="form-group">
            <label for="equipment-loans-partial-note">${escapeHTML(translate('equipment_loans_return_note_label'))}</label>
            <input type="text" id="equipment-loans-partial-note" maxlength="${CONFIG.EQUIPMENT_LOANS.MAX_NOTE_LENGTH}"
              value="${escapeAttribute(loan.return_note || '')}" />
          </div>
        </form>`,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="submit" class="button button--primary" form="equipment-loans-partial-form">
          ${escapeHTML(translate('equipment_loans_partial_submit'))}
        </button>`,
      initialFocus: '#equipment-loans-partial-count',
    });

    const form = modal.dialog.querySelector('#equipment-loans-partial-form');
    const countInput = modal.dialog.querySelector('#equipment-loans-partial-count');
    const errorMessage = modal.dialog.querySelector('#equipment-loans-partial-error');
    countInput.addEventListener('input', () => {
      errorMessage.textContent = '';
      countInput.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const count = Number(countInput.value);
      if (!Number.isInteger(count) || count < 1 || count > outstanding) {
        errorMessage.textContent = translate('equipment_loans_partial_invalid').replace('{count}', String(outstanding));
        countInput.setAttribute('aria-invalid', 'true');
        countInput.focus();
        return;
      }
      const note = modal.dialog.querySelector('#equipment-loans-partial-note').value.trim();
      await withFormBusy(form, async () => {
        const changes = { returned_quantity: Number(loan.returned_quantity) + count, return_note: note || null };
        modal.close();
        await this.sendUpdates([{ loan, changes }], 'equipment_loans_returned');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  updateSettingsSummary() {
    const summary = document.getElementById('equipment-loans-settings-summary');
    if (summary) {
      summary.textContent = this.settingsSummary();
    }
  }

  attachEvents() {
    const root = this.root();
    // The markup was just replaced, so these listeners never stack.
    root.querySelector('#equipment-loans-status')?.addEventListener('change', async (event) => {
      this.status = event.target.value === 'returned' ? 'returned' : 'open';
      try {
        const response = await getEquipmentLoans({ status: this.status });
        this.loans = Array.isArray(response?.data?.loans) ? response.data.loans : [];
      } catch (error) {
        debugError('Failed to load equipment loans:', error);
        this.app.showMessage(apiErrorMessage(error, 'error_loading_data'), 'error');
        return;
      }
      this.render();
      document.getElementById('equipment-loans-status')?.focus();
    });

    root.querySelector('#equipment-loans-filter')?.addEventListener('input', (event) => {
      this.loanFilter = event.target.value;
      const groups = this.groupedLoans();
      setContent(document.getElementById('equipment-loans-groups'), this.groupsMarkup(groups));
      const words = searchable(this.loanFilter).split(/\s+/).filter(Boolean);
      const count = groups.filter((group) => words.every((word) => searchable(group.name).includes(word))).length;
      document.getElementById('equipment-loans-filter-count').textContent =
        translate('equipment_loans_search_count').replace('{count}', String(count));
    });

    // One listener on the list, so the buttons work after the name filter redraws them.
    root.querySelector('.equipment-loans__out')?.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }
      const loan = (key) => this.loanById(Number(button.dataset[key]));
      if (button.dataset.return) {
        const found = loan('return');
        if (found) { this.returnLoans([found]); }
      } else if (button.dataset.returnAll) {
        const group = this.groupedLoans().find((candidate) => candidate.key === button.dataset.returnAll);
        if (group) { this.returnLoans(group.loans.filter((entry) => !entry.returned_at)); }
      } else if (button.dataset.partial) {
        const found = loan('partial');
        if (found) { this.openPartialReturn(found); }
      } else if (button.dataset.reopen) {
        const found = loan('reopen');
        if (found) { this.reopenLoan(found); }
      } else if (button.dataset.delete) {
        const found = loan('delete');
        if (found) { this.deleteLoan(found); }
      }
    });

    const form = root.querySelector('#equipment-loans-handout-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitHandout(form);
    });
    form.querySelector('#equipment-loans-activity')?.addEventListener('change', (event) => {
      this.changeActivity(event.target.value);
    });
    form.querySelector('#equipment-loans-reason')?.addEventListener('change', (event) => {
      this.reason = event.target.value;
      this.updateSettingsSummary();
    });
    form.querySelector('#equipment-loans-due')?.addEventListener('change', (event) => {
      this.dueDate = event.target.value;
      this.updateSettingsSummary();
      document.getElementById('equipment-loans-due-error').textContent = '';
      event.target.removeAttribute('aria-invalid');
    });
    form.querySelector('#equipment-loans-notes')?.addEventListener('input', (event) => {
      this.notes = event.target.value;
    });

    // Rows come and go inside each item, so their controls are handled by delegation.
    form.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !form.contains(button)) {
        return;
      }
      if (button.dataset.addHolder) {
        document.getElementById('equipment-loans-form-error').textContent = '';
        this.togglePicker(Number(button.dataset.addHolder));
      } else if (button.dataset.pickerDone) {
        this.togglePicker(Number(button.dataset.pickerDone));
      } else if (button.dataset.removeRow) {
        this.removeRow(Number(button.dataset.removeRow), Number(button.dataset.index));
      } else if (button.dataset.step) {
        this.step(Number(button.dataset.equipment), Number(button.dataset.index), Number(button.dataset.step));
      }
    });
    form.addEventListener('change', (event) => {
      const { target } = event;
      if (target.dataset.pick) {
        this.pick(Number(target.dataset.pick), target.value, target.checked);
      }
    });
    form.addEventListener('keydown', (event) => {
      const searchId = event.target.dataset?.search;
      if (!searchId) {
        return;
      }
      // Escape in the search closes the picker and returns to its button.
      if (event.key === 'Escape') {
        event.preventDefault();
        this.togglePicker(Number(searchId));
      }
      // Enter never records the handout from the search: it moves to the first person found.
      if (event.key === 'Enter') {
        event.preventDefault();
        document.querySelector(`[data-pick="${Number(searchId)}"]`)?.focus();
      }
    });
    form.addEventListener('input', (event) => {
      const { target } = event;
      if (target.dataset.search) {
        this.pickerQuery = target.value;
        this.filterPeople(Number(target.dataset.search));
        return;
      }
      if (target.dataset.quantity) {
        const equipmentId = Number(target.dataset.quantity);
        const row = (this.assignments.get(equipmentId) || [])[Number(target.dataset.index)];
        if (row) {
          row.quantity = Math.max(1, Math.trunc(Number(target.value)) || 1);
        }
        this.updateRemaining(equipmentId);
      }
    });
  }
}
