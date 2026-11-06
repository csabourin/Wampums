/** The unit's closed camp reviews, independent of the scout year being consulted. */
import { translate } from '../../app.js';
import rules from '../../../config/camp_sites.json';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { getCampReviewHistory } from '../../api/api-camp-reviews.js';
import styles from '../../../css/camp-review-history.css?url';

export class CampReviews {
  constructor(app) {
    this.app = app;
    this.filters = {};
    this.page = 1;
    this.request = 0;
    this.scope = buildScopedCacheKey('');
    this.destroyed = false;
  }

  destroy() { this.destroyed = true; this.request += 1; }
  root() { return document.getElementById('app'); }

  /** Render the filters once; fetching and pagination never replace a field being used. */
  async init() {
    loadStylesheet(styles).catch((err) => debugError('Camp history styles failed', err));
    const choices = (values, prefix) => values.map((value) => `<option value="${value}">${escapeHTML(translate(`${prefix}_${value}`))}</option>`).join('');
    setContent(this.root(), `<section class="page camp-history">${renderBackLink('/camp-plans')}
      <h1>${escapeHTML(translate('camp_history_title'))}</h1>
      <p>${escapeHTML(translate('camp_history_intro'))}</p>
      <form id="camp-history-filters" class="camp-history__filters">
        <div class="form-group"><label for="camp-history-site">${escapeHTML(translate('camp_history_site'))}</label>
          <select id="camp-history-site" name="site_id" data-archive-safe><option value="">${escapeHTML(translate('camp_history_all_sites'))}</option></select></div>
        <div class="form-group"><label for="camp-history-season">${escapeHTML(translate('camp_site_season'))}</label>
          <select id="camp-history-season" name="season" data-archive-safe><option value="">${escapeHTML(translate('camp_history_all_seasons'))}</option>${choices(rules.SEASONS, 'camp_site_season')}</select></div>
        <div class="form-group"><label for="camp-history-accommodation">${escapeHTML(translate('camp_site_accommodation'))}</label>
          <select id="camp-history-accommodation" name="accommodation" data-archive-safe><option value="">${escapeHTML(translate('camp_history_all_accommodations'))}</option>${choices(rules.ACCOMMODATIONS, 'camp_site_accommodation')}</select></div>
        <button type="submit" class="button button--primary" data-archive-safe>${escapeHTML(translate('camp_history_filter'))}</button>
        <button type="reset" class="button button--secondary" data-archive-safe>${escapeHTML(translate('camp_history_reset'))}</button>
      </form><div id="camp-history-results"></div></section>`);
    const form = this.root().querySelector('#camp-history-filters');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.filters = Object.fromEntries([...new FormData(form)].filter(([, value]) => value));
      this.page = 1;
      void this.load();
    });
    form.addEventListener('reset', () => { this.filters = {}; this.page = 1; void this.load(); });
    await this.load();
  }

  async load(focus = false) {
    const request = ++this.request;
    const root = this.root();
    const results = root.querySelector('#camp-history-results');
    setContent(results, `<p role="status">${escapeHTML(translate('loading'))}</p>`);
    const stale = () => this.destroyed || request !== this.request || !results.isConnected || this.scope !== buildScopedCacheKey('');
    try {
      const response = await getCampReviewHistory({ ...this.filters, page: this.page });
      if (stale()) { return; }
      if (!Array.isArray(response?.data?.camps) || !response.pagination) { throw new Error('Missing review history'); }
      const select = root.querySelector('#camp-history-site');
      const selected = select.value;
      setContent(select, `<option value="">${escapeHTML(translate('camp_history_all_sites'))}</option>${(response.data.sites || []).map((site) =>
        `<option value="${Number(site.id)}">${escapeHTML(site.name)}${site.archived ? ` (${escapeHTML(translate('camp_site_archived'))})` : ''}</option>`).join('')}`);
      select.value = selected;
      this.renderResults(results, response);
      if (focus) { results.querySelector('h2')?.focus(); }
    } catch (err) {
      if (stale()) { return; }
      debugError('Camp review history failed', err);
      setContent(results, `<p role="alert">${escapeHTML(apiErrorMessage(err, 'camp_history_load_failed'))}</p>
        <button type="button" class="button button--secondary" data-history-retry data-archive-safe>${escapeHTML(translate('retry'))}</button>`);
      results.querySelector('[data-history-retry]').addEventListener('click', () => this.load());
    }
  }

  renderResults(element, { data, pagination }) {
    const lang = this.app.lang || 'fr';
    const number = new Intl.NumberFormat(localeForLanguage(lang));
    const count = (key, value) => translate(key).replace('{count}', number.format(value));
    setContent(element, `<h2 tabindex="-1">${escapeHTML(count(pagination.total === 1 ? 'camp_history_count_one' : 'camp_history_count_many', pagination.total))}</h2>
      ${!data.camps.length ? `<p>${escapeHTML(translate(Object.keys(this.filters).length ? 'camp_history_no_matches' : 'camp_history_empty'))}</p>` : `
      <ul class="camp-history__list">${data.camps.map((camp) => `<li>
        <h3>${escapeHTML(camp.theme || translate('camp_review_title'))}</h3>
        <p>${escapeHTML(formatDate(camp.date_from, lang))}${camp.date_to !== camp.date_from ? ` — ${escapeHTML(formatDate(camp.date_to, lang))}` : ''}</p>
        <p>${escapeHTML(camp.site_name || translate('camp_history_no_site'))}</p>
        <p>${escapeHTML(count('camp_history_keep_count', camp.keep_count))} · ${escapeHTML(count('camp_history_fix_count', camp.fix_count))}</p>
        <p>${escapeHTML(translate('camp_history_closed').replace('{date}', formatDate(camp.closed_at, lang)))}</p>
        ${camp.is_cancelled ? `<p>${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
        <a href="/camp-review/${Number(camp.id)}" aria-label="${escapeAttribute(`${translate('camp_history_open')} : ${camp.theme || translate('camp_review_title')}`)}">${escapeHTML(translate('camp_history_open'))}</a>
      </li>`).join('')}</ul>`}
      <nav class="camp-history__pager" aria-label="${escapeAttribute(translate('camp_history_pages'))}">
        ${pagination.hasPrev ? `<button type="button" class="button button--secondary" data-history-page="${this.page - 1}" data-archive-safe>${escapeHTML(translate('previous'))}</button>` : ''}
        ${pagination.hasNext ? `<button type="button" class="button button--secondary" data-history-page="${this.page + 1}" data-archive-safe>${escapeHTML(translate('next'))}</button>` : ''}
      </nav>`);
    element.querySelectorAll('[data-history-page]').forEach((button) => button.addEventListener('click', () => {
      this.page = Number(button.dataset.historyPage);
      void this.load(true);
    }));
  }
}
