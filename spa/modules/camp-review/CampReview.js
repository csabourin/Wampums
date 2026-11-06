/**
 * A camp's review (#1257): what was liked, less liked and what to improve,
 * noted at the speed of speech, often without a network.
 *
 * - One field and Enter adds a note; the field empties and keeps the focus,
 *   and the category stays chosen, so notes follow one another without
 *   touching the screen.
 * - While a note is typed, the notes of the same category that share its
 *   words are offered: "+1" on one gives it a vote instead of a new note.
 *   There is no vote against: a disagreement is another note.
 * - A vote given by mistake is undone from the message that follows it, which
 *   stays while it holds the focus.
 * - Every write names the id this device chose, so it may wait in the offline
 *   outbox and be replayed; waiting changes are shown at once and marked as
 *   such, never as saved (CampReviewOffline.js).
 *
 * Reading takes `camp_reviews.view`; writing takes `camp_reviews.manage`.
 *
 * @module spa/modules/camp-review/CampReview
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_reviews.json';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { confirm, confirmDestructive } from '../../utils/DialogUtils.js';
import {
  getCampReview, saveCampReviewNote, deleteCampReviewNote, addCampReviewVote, removeCampReviewVote, setCampReviewStatus,
} from '../../api/api-camp-reviews.js';
import { openSortDialog } from './CampReviewSorting.js';
import {
  currentCampReviewScope, getCampReviewSnapshot, storeCampReviewSnapshot, pendingCampReviewChanges,
  overlayPending, applyAnswer, applyCampReviewWrite, storeCampReviewState,
} from './CampReviewOffline.js';
import { similarNotes } from './CampReviewMatching.js';
import { MAX_EVENT_DAYS } from '../../utils/ActivityDateUtils.js';
import styles from '../../../css/camp-review.css?url';

const FORM_ID = 'camp-review-form';
const TEXT_ID = 'camp-review-text';
/** Icons beside each category's name; the name always says it in words. */
const CATEGORY_ICONS = { liked: 'fa-thumbs-up', disliked: 'fa-thumbs-down', improve: 'fa-lightbulb' };
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/** @returns {string} Today on this device, as YYYY-MM-DD */
const today = () => new Date().toLocaleDateString('en-CA').slice(0, ISO_DATE_LENGTH);

export class CampReview {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The planned camp
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.canManage = hasPermission('camp_reviews.manage') && !isDemoUser();
    this.camp = null;
    // Open until closed; a camp whose review was never closed is at version 0.
    this.review = { status: 'open', version: 0, closed_at: null, closed_by: null };
    // The notes the server confirmed, and the changes not yet confirmed.
    this.confirmed = [];
    this.pending = [];
    this.inflight = [];
    // When the screen shows the copy kept on this device: when that copy was made. `false` without any copy.
    this.offlineSince = null;
    this.category = rules.CATEGORIES[0];
    this.moment = null;
    this.day = null;
    this.theme = '';
    this.destroyed = false;
    this.request = 0;
    // The read from the server still in flight, if any: a write confirmed meanwhile makes it stale.
    this.reading = null;
    this.sending = Promise.resolve();
    this.undo = null;
    this.undoTimer = null;
    this.onOutbox = (event) => {
      if (event.detail?.kind === 'camp_review') {
        void this.refresh();
      }
    };
    window.addEventListener('offlineMutationReplayed', this.onOutbox);
    window.addEventListener('offlineMutationRejected', this.onOutbox);
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
    clearTimeout(this.undoTimer);
    window.removeEventListener('offlineMutationReplayed', this.onOutbox);
    window.removeEventListener('offlineMutationRejected', this.onOutbox);
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @returns {string} Back to the camp's overview */
  backHref() {
    return `/camp-readiness/${this.meetingId}`;
  }

  /**
   * @param {Error} err - A failed read
   * @returns {boolean} Whether it failed for want of a network, not because the server refused
   */
  static isUnreachable(err) {
    return navigator.onLine === false || err?.isNetworkError === true || err?.data?.offline === true;
  }

  /**
   * @param {number} request - The load an answer belongs to
   * @param {string} scope - The scope captured when it started
   * @returns {boolean} Whether the answer must be dropped
   */
  isStale(request, scope) {
    return this.destroyed || request !== this.request || scope !== currentCampReviewScope();
  }

  /** Load the review: from the server when reachable, else the copy kept on this device. */
  async init() {
    loadStylesheet(styles).catch((err) => debugError('Camp review stylesheet failed', err));
    setContent(this.root(), pageLoadingMarkup({ title: translate('camp_review_title'), backHref: this.backHref() }));
    await this.load();
  }

  /** Reload in place, keeping the field and the focus. */
  async refresh() {
    await this.load({ quiet: true });
  }

  /** @param {{quiet?: boolean}} [options] - Quiet: the page is already shown */
  async load({ quiet = false } = {}) {
    const request = ++this.request;
    const scope = currentCampReviewScope();
    if (navigator.onLine === false) {
      await this.showOfflineCopy(request, scope, quiet);
      return;
    }
    this.reading = request;
    try {
      const response = await getCampReview(this.meetingId);
      if (this.isStale(request, scope)) {
        return;
      }
      if (!response?.data?.camp) {
        throw new Error('Missing camp review');
      }
      this.camp = response.data.camp;
      this.review = response.data.review || this.review;
      this.confirmed = Array.isArray(response.data.notes) ? response.data.notes : [];
      this.offlineSince = null;
      await this.readPending(request, scope);
      if (this.isStale(request, scope)) {
        return;
      }
      this.show(quiet);
      // Kept for the days without a network; a failure here never hides what was read.
      storeCampReviewSnapshot(this.meetingId, response.data, undefined, scope)
        .catch((err) => debugError('The camp review could not be kept on this device', err));
    } catch (err) {
      if (this.isStale(request, scope)) {
        return;
      }
      if (CampReview.isUnreachable(err)) {
        await this.showOfflineCopy(request, scope, quiet);
        return;
      }
      debugError('Failed to load the camp review:', err);
      if (quiet && this.camp) {
        return;
      }
      this.showError(apiErrorMessage(err, 'camp_review_load_failed'));
    } finally {
      if (this.reading === request) {
        this.reading = null;
      }
    }
  }

  /**
   * Without a network: the copy kept on this device, with the changes waiting
   * to be sent. Without a copy, notes can still be added; they are sent once
   * the network is back.
   */
  async showOfflineCopy(request, scope, quiet) {
    let snapshot = null;
    try {
      snapshot = await getCampReviewSnapshot(this.meetingId, scope);
    } catch (err) {
      debugError('The camp review kept on this device could not be read', err);
    }
    if (this.isStale(request, scope)) {
      return;
    }
    if (snapshot) {
      this.camp = snapshot.data.camp;
      this.review = snapshot.data.review || this.review;
      this.confirmed = snapshot.data.notes;
      this.offlineSince = snapshot.preparedAt;
    } else if (!this.camp) {
      this.confirmed = [];
      this.offlineSince = false;
    }
    await this.readPending(request, scope);
    if (!this.isStale(request, scope)) {
      this.show(quiet);
    }
  }

  async readPending(request, scope) {
    try {
      const pending = await pendingCampReviewChanges(this.meetingId, scope);
      if (!this.isStale(request, scope)) {
        this.pending = pending;
      }
    } catch (err) {
      debugError('Changes waiting to be sent could not be read', err);
      this.pending = [];
    }
  }

  /** @param {string} message - What went wrong, translated */
  showError(message) {
    setContent(this.root(), pageErrorMarkup({
      title: translate('camp_review_title'), backHref: this.backHref(), message, retryId: 'camp-review-retry',
    }));
    this.root().querySelector('#camp-review-retry')?.addEventListener('click', () => this.init());
  }

  /** @returns {boolean} Whether the review was closed: it is then read only */
  isClosed() {
    return this.review?.status === 'closed';
  }

  /** @returns {boolean} Whether notes may be added and weighed now */
  canNote() {
    return this.canManage && !this.isClosed();
  }

  /** @returns {boolean} Whether the review may be sorted, merged, closed or reopened now: online, on the server's own copy */
  canDecide() {
    return this.canManage && this.offlineSince === null && navigator.onLine !== false;
  }

  /** @returns {Object[]} The notes as they will be once every waiting change is sent */
  notes() {
    return overlayPending(this.confirmed, [...this.pending, ...this.inflight]);
  }

  /** @returns {{moment: string, day: ?string}} The moment preselected from the camp's dates */
  defaultMoment() {
    const day = today();
    if (!this.camp?.date_from || day > this.camp.date_to) {
      return { moment: 'team_after', day: null };
    }
    if (day === this.camp.date_to) {
      return { moment: 'youth_council', day: null };
    }
    return { moment: 'team_daily', day: day >= this.camp.date_from ? day : this.camp.date_from };
  }

  /** @returns {string[]} The camp's days, YYYY-MM-DD */
  campDays() {
    if (!this.camp?.date_from || !this.camp?.date_to) {
      return [];
    }
    const days = [];
    const cursor = new Date(`${this.camp.date_from}T12:00:00Z`);
    const last = new Date(`${this.camp.date_to}T12:00:00Z`);
    // Every day of the camp, up to the longest event a unit records (not the offline preparation window).
    while (cursor <= last && days.length < MAX_EVENT_DAYS) {
      days.push(cursor.toISOString().slice(0, ISO_DATE_LENGTH));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  /** @param {boolean} quiet - Keep the form as it is: only the notes change */
  show(quiet) {
    if (this.destroyed) {
      return;
    }
    const shown = this.root().querySelector('.camp-review');
    if (quiet && shown && this.renderedStatus === this.review?.status) {
      this.renderNotes();
      this.renderSuggestions();
      return;
    }
    if (quiet && shown) {
      // Closed or reopened elsewhere: the form and the status controls change, keeping what was typed.
      const typed = this.root().querySelector('#camp-review-text')?.value || '';
      const focusedId = document.activeElement?.id;
      this.render();
      const field = this.root().querySelector('#camp-review-text');
      if (field) {
        field.value = typed;
      }
      if (focusedId) {
        this.root().querySelector(`#${focusedId}`)?.focus();
      }
      return;
    }
    if (this.moment === null) {
      Object.assign(this, this.defaultMoment());
    }
    this.render();
  }

  /** @returns {string} The camp's name and dates, when known */
  campMarkup() {
    if (!this.camp) {
      return '';
    }
    const dates = this.camp.date_from
      ? `${formatDate(this.camp.date_from, this.lang())} – ${formatDate(this.camp.date_to, this.lang())}` : '';
    return `<p class="camp-review__camp"><strong>${escapeHTML(this.camp.theme || translate('camp_readiness_camp'))}</strong>
      <span>${escapeHTML(dates)}</span></p>`;
  }

  /** @returns {string} Says the page is the copy kept on this device, or that there is none */
  offlineNotice() {
    if (this.offlineSince === null) {
      return '';
    }
    if (this.offlineSince === false) {
      return `<p class="status-message info camp-review__offline" role="status">${escapeHTML(translate('camp_review_not_on_device'))}</p>`;
    }
    const since = new Intl.DateTimeFormat(localeForLanguage(this.lang()), { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(this.offlineSince));
    return `<p class="status-message info camp-review__offline" role="status">${escapeHTML(
      translate('camp_review_offline_copy').replace('{when}', () => since),
    )}</p>`;
  }

  /** @returns {string} A select of allowed values */
  select(id, labelKey, options, current) {
    return `<div class="form-group camp-review__choice">
        <label for="${id}">${escapeHTML(translate(labelKey))}</label>
        <select id="${id}">
          ${options.map(([value, label]) => `<option value="${escapeAttribute(value)}" ${value === (current || '') ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}
        </select>
      </div>`;
  }

  /** @returns {string} The day select, shown for the team's evening review */
  dayMarkup() {
    const days = this.campDays();
    if (this.moment !== 'team_daily' || !days.length) {
      return '';
    }
    return this.select('camp-review-day', 'camp_review_day',
      days.map((day) => [day, formatDate(day, this.lang())]), this.day || days[0]);
  }

  /** @returns {string} The entry form */
  formMarkup() {
    if (!this.canNote()) {
      return '';
    }
    const categories = rules.CATEGORIES.map((category) => `<label class="camp-review__category camp-review__category--${category}">
        <input type="radio" name="camp-review-category" value="${category}" ${category === this.category ? 'checked' : ''}>
        <i class="fa-solid ${CATEGORY_ICONS[category]}" aria-hidden="true"></i>
        <span>${escapeHTML(translate(`camp_review_category_${category}`))}</span>
      </label>`).join('');
    return `<form id="${FORM_ID}" class="camp-review__form" novalidate>
        <fieldset class="camp-review__categories">
          <legend>${escapeHTML(translate('camp_review_category'))}</legend>
          <div class="camp-review__category-options">${categories}</div>
        </fieldset>
        <div class="camp-review__context">
          ${this.select('camp-review-moment', 'camp_review_moment',
    rules.MOMENTS.map((moment) => [moment, translate(`camp_review_moment_${moment}`)]), this.moment)}
          <div id="camp-review-day-slot">${this.dayMarkup()}</div>
          ${this.select('camp-review-theme', 'camp_review_theme',
    [['', translate('camp_review_theme_none')], ...rules.THEMES.map((theme) => [theme, translate(`camp_review_theme_${theme}`)])], this.theme)}
        </div>
        <div class="form-group">
          <label for="${TEXT_ID}">${escapeHTML(translate('camp_review_text'))}</label>
          <div class="camp-review__entry">
            <input type="text" id="${TEXT_ID}" maxlength="${rules.TEXT_MAX}" autocomplete="off" enterkeyhint="send"
              aria-describedby="${TEXT_ID}-hint ${TEXT_ID}-error">
            <button type="submit" class="button button--primary">${escapeHTML(translate('camp_review_add'))}</button>
          </div>
          <p class="field-hint" id="${TEXT_ID}-hint">${escapeHTML(translate('camp_review_text_hint'))}</p>
          <p class="field-error" id="${TEXT_ID}-error" hidden></p>
        </div>
        <div id="camp-review-suggestions" class="camp-review__suggestions"></div>
      </form>
      <div class="camp-review__feedback">
        <p id="camp-review-status" role="status"></p>
        <button type="button" class="button button--secondary button--small" id="camp-review-undo" hidden>${escapeHTML(translate('camp_review_undo'))}</button>
      </div>`;
  }

  render() {
    this.renderedStatus = this.review?.status;
    setContent(this.root(), `<section class="page camp-review">
        ${renderBackLink(this.backHref())}
        <h1>${escapeHTML(translate('camp_review_title'))}</h1>
        ${this.campMarkup()}
        ${this.offlineNotice()}
        ${this.statusMarkup()}
        ${this.isClosed() ? '' : `<p class="camp-review__explanation">${escapeHTML(translate('camp_review_explanation'))}</p>`}
        ${this.formMarkup()}
        <div id="camp-review-summary"></div>
        <div id="camp-review-notes" class="camp-review__notes"></div>
      </section>`);
    this.renderNotes();
    this.wire();
  }

  /** @returns {string} Whether the review is closed, and the way to close or reopen it */
  statusMarkup() {
    const button = (id, key) => (this.canDecide()
      ? `<button type="button" class="button button--secondary button--small" id="${id}">${escapeHTML(translate(key))}</button>` : '');
    if (this.isClosed()) {
      const since = this.review.closed_at
        ? new Intl.DateTimeFormat(localeForLanguage(this.lang()), { dateStyle: 'long' }).format(new Date(this.review.closed_at)) : '';
      const text = translate(this.review.closed_by ? 'camp_review_closed_by' : 'camp_review_closed_on')
        .replace('{when}', () => since).replace('{name}', () => this.review.closed_by || '');
      return `<div class="camp-review__state"><p class="status-message info">${escapeHTML(text)}</p>
        ${button('camp-review-reopen', 'camp_review_reopen')}</div>`;
    }
    const close = button('camp-review-close', 'camp_review_close');
    return close ? `<div class="camp-review__state"><p>${escapeHTML(translate('camp_review_close_hint'))}</p>${close}</div>` : '';
  }

  /** @returns {string} What the review keeps and fixes, heaviest first, once notes are sorted */
  summaryMarkup(notes) {
    const sorted = (outcome) => notes.filter((note) => note.outcome === outcome)
      .sort((a, b) => (b.weight || 1) - (a.weight || 1));
    const keep = sorted('keep');
    const fix = sorted('fix');
    if (!keep.length && !fix.length) {
      return '';
    }
    const list = (key, items) => `<div class="camp-review__summary-part">
        <h3>${escapeHTML(translate(`camp_review_outcome_${key}`))}</h3>
        ${items.length ? `<ul>${items.map((note) => `<li>${this.weightMarkup(note)} <span>${escapeHTML(note.text)}</span>${note.action_text
    ? `<p class="camp-review__action">${escapeHTML(translate('camp_review_action_value').replace('{action}', () => note.action_text))}</p>` : ''}</li>`).join('')}</ul>`
    : `<p class="empty-state">${escapeHTML(translate('camp_review_summary_none'))}</p>`}
      </div>`;
    return `<section class="camp-review__summary" aria-labelledby="camp-review-summary-title">
        <h2 id="camp-review-summary-title">${escapeHTML(translate('camp_review_summary'))}</h2>
        ${list('keep', keep)}${list('fix', fix)}
      </section>`;
  }

  /** @returns {string} Where and when a note was said */
  metaOf(note) {
    const parts = [translate(`camp_review_moment_${note.moment}`)];
    if (note.day) {
      parts.push(formatDate(note.day, this.lang()));
    }
    if (note.theme) {
      parts.push(translate(`camp_review_theme_${note.theme}`));
    }
    return parts.join(' · ');
  }

  /** @returns {string} The weight, in words for screen readers */
  weightMarkup(note) {
    const weight = Number(note.weight) || 1;
    const words = translate('camp_review_weight').replace('{count}', String(weight));
    return `<span class="camp-review__weight" aria-hidden="true">×${weight}</span><span class="sr-only">${escapeHTML(words)}</span>`;
  }

  /** @returns {string} One note, with its actions */
  noteMarkup(note) {
    return `<li class="camp-review__note${note.pending ? ' is-pending' : ''}">
        <div class="camp-review__note-head">
          ${this.weightMarkup(note)}
          <p class="camp-review__note-text">${escapeHTML(note.text)}</p>
        </div>
        <p class="camp-review__note-meta">${escapeHTML(this.metaOf(note))}${note.pending
  ? ` <span class="camp-review__chip">${escapeHTML(translate('camp_review_pending'))}</span>` : ''}${note.outcome
  ? ` <span class="camp-review__chip camp-review__chip--${escapeAttribute(note.outcome)}">${escapeHTML(translate(`camp_review_outcome_${note.outcome}`))}</span>` : ''}</p>
        ${note.action_text ? `<p class="camp-review__action">${escapeHTML(translate('camp_review_action_value').replace('{action}', () => note.action_text))}</p>` : ''}
        ${(note.merged || []).length ? `<p class="camp-review__merged">${escapeHTML(translate('camp_review_also_said'))}
          ${note.merged.map((child) => `<span>${escapeHTML(child.text)}</span>`).join(' · ')}</p>` : ''}
        ${this.actionsMarkup(note)}
      </li>`;
  }

  /** @returns {string} What may be done with a note now, or nothing */
  actionsMarkup(note) {
    const id = escapeAttribute(note.id);
    const buttons = [];
    if (this.canDecide() && !this.isClosed() && !note.pending) {
      buttons.push(`<button type="button" class="button button--secondary button--small" data-review-sort="${id}"
        aria-label="${escapeAttribute(translate('camp_review_sort_label').replace('{text}', () => note.text))}">${escapeHTML(translate('camp_review_sort'))}</button>`);
    }
    if (this.canNote()) {
      buttons.push(`<button type="button" class="button button--secondary button--small" data-review-vote="${id}"
        aria-label="${escapeAttribute(translate('camp_review_vote_label').replace('{text}', () => note.text))}">+1</button>`,
      `<button type="button" class="button button--ghost button--small" data-review-delete="${id}"
        aria-label="${escapeAttribute(translate('camp_review_delete_label').replace('{text}', () => note.text))}">${escapeHTML(translate('camp_review_delete'))}</button>`);
    }
    return buttons.length ? `<div class="camp-review__note-actions">${buttons.join('')}</div>` : '';
  }

  /** Draw the notes by category, heaviest first. */
  renderNotes() {
    const container = this.root().querySelector('#camp-review-notes');
    if (!container) {
      return;
    }
    // A redraw keeps the focus on the button that held it.
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = ['reviewVote', 'reviewDelete', 'reviewSort'].find((key) => focused?.dataset?.[key]);
    const notes = this.notes();
    const sections = rules.CATEGORIES.map((category) => {
      const inCategory = notes.filter((note) => note.category === category)
        .sort((a, b) => (b.weight || 1) - (a.weight || 1));
      const total = inCategory.reduce((sum, note) => sum + (Number(note.weight) || 1), 0);
      return `<section class="camp-review__group camp-review__group--${category}" aria-labelledby="camp-review-${category}-title">
          <h2 id="camp-review-${category}-title"><i class="fa-solid ${CATEGORY_ICONS[category]}" aria-hidden="true"></i>
            ${escapeHTML(translate(`camp_review_category_${category}`))}
            <span class="camp-review__count">${escapeHTML(translate('camp_review_group_count')
    .replace('{notes}', String(inCategory.length)).replace('{votes}', String(total)))}</span></h2>
          ${inCategory.length
    ? `<ul class="camp-review__list">${inCategory.map((note) => this.noteMarkup(note)).join('')}</ul>`
    : `<p class="empty-state">${escapeHTML(translate(this.canNote() ? 'camp_review_empty_manage' : 'camp_review_empty'))}</p>`}
        </section>`;
    }).join('');
    setContent(container, sections);
    const summary = this.root().querySelector('#camp-review-summary');
    if (summary) {
      setContent(summary, this.summaryMarkup(notes));
    }
    if (focusKey) {
      const attribute = { reviewVote: 'data-review-vote', reviewDelete: 'data-review-delete', reviewSort: 'data-review-sort' }[focusKey];
      [...container.querySelectorAll(`[${attribute}]`)]
        .find((button) => button.getAttribute(attribute) === focused.dataset[focusKey])?.focus();
    }
  }

  /** Offer the notes that seem to say what is being typed. */
  renderSuggestions() {
    const container = this.root().querySelector('#camp-review-suggestions');
    const input = this.root().querySelector(`#${TEXT_ID}`);
    if (!container || !input) {
      return;
    }
    const matches = similarNotes(input.value, this.notes(), this.category);
    if (!matches.length) {
      setContent(container, '');
      return;
    }
    setContent(container, `<p class="camp-review__suggestions-title" id="camp-review-suggestions-title">${escapeHTML(translate('camp_review_suggestions'))}</p>
      <ul class="camp-review__suggestion-list" aria-labelledby="camp-review-suggestions-title">
        ${matches.map((note) => `<li>
          <span class="camp-review__suggestion-text">${escapeHTML(note.text)}</span>
          ${this.weightMarkup(note)}
          <button type="button" class="button button--secondary button--small" data-review-suggestion="${escapeAttribute(note.id)}"
            aria-label="${escapeAttribute(translate('camp_review_vote_label').replace('{text}', () => note.text))}">+1</button>
        </li>`).join('')}
      </ul>`);
  }

  wire() {
    const root = this.root();
    const form = root.querySelector(`#${FORM_ID}`);
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.addNote();
      });
      form.addEventListener('change', (event) => this.onChoice(event.target));
      root.querySelector(`#${TEXT_ID}`).addEventListener('input', () => {
        this.clearError();
        this.renderSuggestions();
      });
      form.addEventListener('click', (event) => {
        const button = event.target.closest('[data-review-suggestion]');
        if (button) {
          this.vote(button.dataset.reviewSuggestion, { fromSuggestion: true });
        }
      });
    }
    root.querySelector('#camp-review-notes')?.addEventListener('click', (event) => {
      const vote = event.target.closest('[data-review-vote]');
      if (vote) {
        this.vote(vote.dataset.reviewVote);
        return;
      }
      const remove = event.target.closest('[data-review-delete]');
      if (remove) {
        this.removeNote(remove.dataset.reviewDelete);
        return;
      }
      const sort = event.target.closest('[data-review-sort]');
      if (sort) {
        this.openSort(sort.dataset.reviewSort);
      }
    });
    root.querySelector('#camp-review-close')?.addEventListener('click', () => this.setStatus('closed'));
    root.querySelector('#camp-review-reopen')?.addEventListener('click', () => this.setStatus('open'));
    const undo = root.querySelector('#camp-review-undo');
    if (undo) {
      undo.addEventListener('click', () => this.undoVote());
      // The message stays while it holds the focus, and its time starts again when it leaves.
      undo.addEventListener('focus', () => clearTimeout(this.undoTimer));
      undo.addEventListener('blur', () => this.scheduleUndoEnd());
    }
  }

  /** Keep the category, moment, day and theme chosen for the next notes. */
  onChoice(target) {
    if (target.name === 'camp-review-category') {
      this.category = target.value;
      this.renderSuggestions();
    } else if (target.id === 'camp-review-moment') {
      this.moment = target.value;
      if (this.moment === 'team_daily' && !this.day) {
        this.day = this.defaultMoment().day || this.campDays()[0] || null;
      }
      setContent(this.root().querySelector('#camp-review-day-slot'), this.dayMarkup());
    } else if (target.id === 'camp-review-day') {
      this.day = target.value;
    } else if (target.id === 'camp-review-theme') {
      this.theme = target.value;
    }
  }

  clearError() {
    const error = this.root().querySelector(`#${TEXT_ID}-error`);
    if (error && !error.hidden) {
      error.hidden = true;
      error.textContent = '';
      error.removeAttribute('role');
      this.root().querySelector(`#${TEXT_ID}`)?.removeAttribute('aria-invalid');
    }
  }

  /** @param {string} message - Shown under the field, and announced */
  fieldError(message) {
    const error = this.root().querySelector(`#${TEXT_ID}-error`);
    const input = this.root().querySelector(`#${TEXT_ID}`);
    if (!error || !input) {
      this.app.showMessage(message, 'error');
      return;
    }
    error.textContent = message;
    error.hidden = false;
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  /** @param {string} message - Announced in the page's status region */
  announce(message, { undo = null } = {}) {
    const status = this.root().querySelector('#camp-review-status');
    const button = this.root().querySelector('#camp-review-undo');
    clearTimeout(this.undoTimer);
    if (status) {
      status.textContent = message;
    }
    this.undo = undo;
    if (button) {
      button.hidden = !undo;
    }
    if (undo) {
      this.scheduleUndoEnd();
    }
  }

  /** The undo offer ends after a while, unless it holds the focus. */
  scheduleUndoEnd() {
    clearTimeout(this.undoTimer);
    if (!this.undo) {
      return;
    }
    this.undoTimer = setTimeout(() => {
      const button = this.root()?.querySelector('#camp-review-undo');
      if (button && document.activeElement === button) {
        return;
      }
      this.undo = null;
      if (button) {
        button.hidden = true;
      }
    }, rules.UNDO_MS);
  }

  /**
   * Send one change, after those already sent from this screen, so a vote never
   * reaches the server before its note.
   *
   * @param {{method: string, noteId: string, voteId?: ?string, body?: Object}} change - Shown as waiting meanwhile
   * @param {Function} send - Sends it; resolves to the API's answer
   * @returns {Promise<{ok: boolean, queued?: boolean, error?: Error}>}
   */
  submit(change, send) {
    const entry = { voteId: null, body: {}, ...change };
    this.inflight.push(entry);
    this.renderNotes();
    // The account, unit and year the change was made in: it waits behind earlier ones, and must
    // never be sent under another session's credentials if the session changes meanwhile.
    const scope = currentCampReviewScope();
    const run = this.sending.then(async () => {
      try {
        if (this.destroyed || scope !== currentCampReviewScope()) {
          return { ok: false, error: Object.assign(new Error('Session changed'), { name: 'AbortError' }) };
        }
        const response = await send();
        if (scope !== currentCampReviewScope()) {
          return { ok: true };
        }
        if (this.destroyed) {
          // Left meanwhile: the server accepted the change, so the copy on the device must show it.
          if (!response?.queued) {
            await applyCampReviewWrite(this.meetingId, entry, response?.data, scope)
              .catch((err) => debugError('The camp review kept on this device could not be updated', err));
          }
          return { ok: true };
        }
        if (response?.queued) {
          await this.readPending(this.request, scope);
          return { ok: true, queued: true };
        }
        this.confirmed = applyAnswer(this.confirmed, entry, response?.data);
        if (this.reading === this.request) {
          // A read started before this write would bring back the list without it: drop it, read again.
          void this.refresh();
        }
        // Kept on the device whenever this screen holds a whole confirmed copy, read online or from
        // the device: a page opened offline and then reconnected must not leave an older copy behind.
        if (this.camp && this.offlineSince !== false) {
          storeCampReviewSnapshot(this.meetingId, { camp: this.camp, review: this.review, notes: this.confirmed }, undefined, scope)
            .catch((err) => debugError('The camp review could not be kept on this device', err));
        }
        return { ok: true };
      } catch (error) {
        debugError('Camp review change failed:', error);
        return { ok: false, error };
      } finally {
        this.inflight = this.inflight.filter((item) => item !== entry);
        if (!this.destroyed) {
          this.renderNotes();
          this.renderSuggestions();
        }
      }
    });
    this.sending = run;
    return run;
  }

  /** Add what was typed as a new note; the field empties and keeps the focus. */
  async addNote() {
    const input = this.root().querySelector(`#${TEXT_ID}`);
    const text = input.value.trim();
    if (!text) {
      this.fieldError(translate('camp_review_text_required'));
      return;
    }
    if (text.length > rules.TEXT_MAX) {
      this.fieldError(translate('camp_review_text_too_long'));
      return;
    }
    const body = {
      category: this.category, moment: this.moment, text,
      day: this.moment === 'team_daily' && this.campDays().length ? this.day : null,
      theme: this.theme || null,
    };
    input.value = '';
    input.focus();
    this.renderSuggestions();
    this.announce(translate('camp_review_note_added').replace('{text}', () => text));
    const noteId = crypto.randomUUID();
    const result = await this.submit({ method: 'PUT', noteId, body },
      () => saveCampReviewNote(this.meetingId, noteId, body));
    if (this.destroyed) {
      return;
    }
    if (!result.ok) {
      // Nothing was saved: give the text back, unless something else was typed meanwhile.
      const field = this.root().querySelector(`#${TEXT_ID}`);
      if (field && !field.value) {
        field.value = text;
      }
      this.announce('');
      this.fieldError(apiErrorMessage(result.error, 'camp_review_save_failed'));
    } else if (result.queued) {
      this.announce(translate('camp_review_note_queued').replace('{text}', () => text));
    }
  }

  /**
   * Give a "+1" to a note, then offer to undo it.
   *
   * @param {string} noteId - The note
   * @param {{fromSuggestion?: boolean}} [options] - From a suggestion: what was typed was the same idea
   */
  async vote(noteId, { fromSuggestion = false } = {}) {
    const note = this.notes().find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    if (fromSuggestion) {
      const input = this.root().querySelector(`#${TEXT_ID}`);
      if (input) {
        input.value = '';
        input.focus();
      }
    }
    const voteId = crypto.randomUUID();
    const undo = { noteId, voteId, text: note.text };
    this.announce(translate('camp_review_vote_added').replace('{text}', () => note.text), { undo });
    const result = await this.submit({ method: 'PUT', noteId, voteId },
      () => addCampReviewVote(this.meetingId, noteId, voteId));
    if (this.destroyed) {
      return;
    }
    if (!result.ok) {
      if (this.undo === undo) {
        this.announce('');
      }
      this.app.showMessage(apiErrorMessage(result.error, 'camp_review_save_failed'), 'error');
    }
  }

  /** Undo the vote just given. */
  async undoVote() {
    const undo = this.undo;
    if (!undo) {
      return;
    }
    this.announce(translate('camp_review_vote_undone').replace('{text}', () => undo.text));
    this.root().querySelector(`#${TEXT_ID}`)?.focus();
    const result = await this.submit({ method: 'DELETE', noteId: undo.noteId, voteId: undo.voteId },
      () => removeCampReviewVote(this.meetingId, undo.noteId, undo.voteId));
    if (!this.destroyed && !result.ok) {
      this.app.showMessage(apiErrorMessage(result.error, 'camp_review_save_failed'), 'error');
    }
  }

  /** Remove a note, once confirmed. */
  async removeNote(noteId) {
    const note = this.notes().find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    const confirmed = await confirmDestructive({
      title: translate('camp_review_delete_title'),
      message: translate('camp_review_delete_confirm').replace('{text}', () => note.text),
      confirmLabel: translate('camp_review_delete'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    const result = await this.submit({ method: 'DELETE', noteId },
      () => deleteCampReviewNote(this.meetingId, noteId));
    if (this.destroyed) {
      return;
    }
    if (result.ok) {
      this.announce(translate('camp_review_note_deleted').replace('{text}', () => note.text));
      this.root().querySelector(`#${TEXT_ID}`)?.focus();
    } else {
      this.app.showMessage(apiErrorMessage(result.error, 'camp_review_delete_failed'), 'error');
    }
  }

  /** Open the dialog that sorts a note, offering the notes of its category it may join. */
  openSort(noteId) {
    const notes = this.notes();
    const note = notes.find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    const candidates = notes.filter((other) => other.id !== note.id && other.category === note.category && !other.pending);
    openSortDialog({ app: this.app, meetingId: this.meetingId, note, candidates, onChanged: () => this.reload() });
  }

  /**
   * Reload after a change decided online. The quiet load redraws the notes and the summary,
   * and the whole page only when the review was closed or reopened, keeping what was typed.
   */
  async reload() {
    await this.load({ quiet: true });
  }

  /**
   * Close the review, freezing it, or reopen it, once confirmed.
   * @param {'open'|'closed'} status - The new state
   */
  async setStatus(status) {
    const closing = status === 'closed';
    const confirmed = await confirm({
      title: translate(closing ? 'camp_review_close_title' : 'camp_review_reopen_title'),
      message: translate(closing ? 'camp_review_close_confirm' : 'camp_review_reopen_confirm'),
      confirmLabel: translate(closing ? 'camp_review_close' : 'camp_review_reopen'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    try {
      const scope = currentCampReviewScope();
      const response = await setCampReviewStatus(this.meetingId, { status, expected_version: this.review.version });
      const review = response?.data?.review || { ...this.review, status };
      // The copy on the device follows, so an offline visit reads the review as it now is.
      await storeCampReviewState(this.meetingId, review, scope)
        .catch((err) => debugError('The camp review kept on this device could not be updated', err));
      if (this.destroyed) {
        return;
      }
      this.review = review;
      this.app.showMessage(translate(closing ? 'camp_review_closed_done' : 'camp_review_reopened_done'), 'success');
      this.render();
      this.root().querySelector('h1')?.setAttribute('tabindex', '-1');
      this.root().querySelector(closing ? '#camp-review-reopen' : '#camp-review-close')?.focus();
    } catch (error) {
      debugError('Closing or reopening the camp review failed:', error);
      this.app.showMessage(apiErrorMessage(error, 'camp_review_status_failed'), 'error');
    }
  }
}
