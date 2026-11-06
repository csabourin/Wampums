/** Independent, read-only lessons panel shared by camp preparation and the copy dialog. */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { debugError } from '../../utils/DebugUtils.js';
import { getCampReview, getCampReviewLessons } from '../../api/api-camp-reviews.js';
import styles from '../../../css/camp-review-history.css?url';

/** The same accessible observation markup in every preparation entry point. */
export function lessonGroups(notes, lang) {
  const number = new Intl.NumberFormat(localeForLanguage(lang));
  return ['keep', 'fix'].map((outcome) => {
    const selected = notes.filter((note) => note.outcome === outcome);
    return selected.length ? `<section class="camp-lessons__group"><h3>${escapeHTML(translate(outcome === 'keep' ? 'camp_review_outcome_keep' : 'camp_review_outcome_fix'))}</h3>
      <ul class="camp-lessons__list">${selected.map((note) => `<li>
        <p><strong>${escapeHTML(note.text)}</strong> <span>${escapeHTML(translate('camp_history_weight').replace('{count}', number.format(note.weight)))}</span></p>
        ${note.action_text ? `<p>${escapeHTML(note.action_text)}</p>` : ''}
        ${note.same_site || note.same_profile ? `<p class="field-hint">${escapeHTML(translate(note.same_site && note.same_profile
    ? 'camp_history_match_both' : note.same_site ? 'camp_history_match_site' : 'camp_history_match_profile'))}</p>` : ''}
        <a href="/camp-review/${Number(note.source_meeting_id)}">${escapeHTML(note.source_name || translate('camp_review_title'))} — ${escapeHTML(formatDate(note.source_date, lang))}</a>
      </li>`).join('')}</ul></section>` : '';
  }).join('');
}

export class CampReviewLessons {
  /** @param {Object} app @param {{element: HTMLElement, meetingId: number, source?: boolean}} options */
  constructor(app, { element, meetingId, source = false }) {
    this.app = app;
    this.element = element;
    this.meetingId = Number(meetingId);
    this.source = source;
    this.scope = buildScopedCacheKey('');
    this.request = 0;
    this.destroyed = false;
    this.notes = [];
    this.page = 0;
  }

  destroy() { this.destroyed = true; this.request += 1; }

  /** Ignore changes of source, account, unit, year and screens while a request is in flight. */
  stale(request) {
    return this.destroyed || request !== this.request || !this.element?.isConnected
      || this.scope !== buildScopedCacheKey('') || !hasPermission('camp_reviews.view');
  }

  async init() {
    if (!hasPermission('camp_reviews.view') || !this.element) { return; }
    loadStylesheet(styles).catch((err) => debugError('Camp history styles failed', err));
    await this.load();
  }

  /** Each page replaces only this panel, never the surrounding form or copy choices. */
  async load(more = false) {
    const request = ++this.request;
    if (this.stale(request)) { return; }
    const page = more ? this.page + 1 : 1;
    if (!more) { this.notes = []; }
    this.render(true);
    try {
      const response = await (this.source ? getCampReview(this.meetingId) : getCampReviewLessons(this.meetingId, { page }));
      if (this.stale(request)) { return; }
      if (!Array.isArray(response?.data?.notes)) { throw new Error('Missing previous camp observations'); }
      let notes = response.data.notes;
      if (this.source) {
        notes = response.data.review?.status === 'closed' ? notes.filter((note) => note.outcome === 'keep' || note.outcome === 'fix')
          .map((note) => ({ ...note, source_meeting_id: this.meetingId, source_name: response.data.camp.theme, source_date: response.data.camp.date_from })) : [];
      }
      this.notes = more ? [...this.notes, ...notes] : notes;
      this.page = page;
      this.hasNext = !this.source && response.pagination?.hasNext === true;
      this.render();
      if (more) { this.element.querySelector('[data-lessons-heading]')?.focus(); }
    } catch (err) {
      if (this.stale(request)) { return; }
      debugError('Previous camp observations failed', err);
      this.render(false, apiErrorMessage(err, 'camp_history_load_failed'), more);
    }
  }

  render(loading = false, error = null, retryMore = false) {
    if (!this.element?.isConnected) { return; }
    const lang = this.app.lang || 'fr';
    const expanded = this.element.querySelector('details')?.open ?? this.source;
    setContent(this.element, `<details class="camp-lessons" ${expanded ? 'open' : ''}>
      <summary><h2 data-lessons-heading tabindex="-1">${escapeHTML(translate(this.source ? 'camp_history_source_title' : 'camp_history_lessons_title'))}</h2></summary>
      ${lessonGroups(this.notes, lang)}
      ${loading ? `<p role="status">${escapeHTML(translate('loading'))}</p>` : ''}
      ${error ? `<p role="alert">${escapeHTML(error)}</p><button type="button" class="button button--secondary" data-lessons-retry data-archive-safe>${escapeHTML(translate('retry'))}</button>` : ''}
      ${!loading && !error && !this.notes.length ? `<p>${escapeHTML(translate(this.source ? 'camp_history_source_empty' : 'camp_history_lessons_empty'))}</p>` : ''}
      ${!loading && !error && this.hasNext ? `<button type="button" class="button button--secondary" data-lessons-more data-archive-safe>${escapeHTML(translate('camp_history_more'))}</button>` : ''}
      <p><a href="/camp-reviews">${escapeHTML(translate('camp_history_all'))}</a></p>
    </details>`);
    this.element.querySelector('[data-lessons-retry]')?.addEventListener('click', () => this.load(retryMore));
    this.element.querySelector('[data-lessons-more]')?.addEventListener('click', () => this.load(true));
  }
}
