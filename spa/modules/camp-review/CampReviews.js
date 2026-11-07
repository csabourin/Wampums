/**
 * The unit's camp reviews, year after year (#1257, third slice): every closed
 * review, newest camp first, with what it kept and fixed, to repeat the good
 * moves and correct the weaknesses. A site or a season narrows the list.
 *
 * The reviews belong to the unit, not to a scout year: an archived year shows
 * the same history. Reading takes `camp_reviews.view`.
 *
 * @module spa/modules/camp-review/CampReviews
 */
import { translate } from '../../app.js';
import siteRules from '../../../config/camp_sites.json';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { getCampReviewHistory } from '../../api/api-camp-reviews.js';
import { reviewTitle, lessonsListMarkup } from './CampLessons.js';
import styles from '../../../css/camp-lessons.css?url';

export class CampReviews {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.filters = { site_id: '', season: '' };
    this.data = null;
    this.destroyed = false;
    this.request = 0;
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  async init() {
    loadStylesheet(styles).catch((err) => debugError('Camp lessons stylesheet failed', err));
    setContent(this.root(), pageLoadingMarkup({ title: translate('camp_reviews_title'), backHref: '/camp-plans' }));
    await this.load();
  }

  async load() {
    const request = ++this.request;
    const filters = Object.fromEntries(Object.entries(this.filters).filter(([, value]) => value));
    try {
      const response = await getCampReviewHistory(filters);
      if (this.destroyed || request !== this.request) {
        return;
      }
      this.data = { reviews: response?.data?.reviews || [], sites: response?.data?.sites || [] };
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp reviews:', err);
      setContent(this.root(), pageErrorMarkup({
        title: translate('camp_reviews_title'), backHref: '/camp-plans',
        message: apiErrorMessage(err, 'camp_reviews_load_failed'), retryId: 'camp-reviews-retry',
      }));
      this.root().querySelector('#camp-reviews-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} A filter, browsing only: allowed in an archived year */
  select(id, labelKey, options, current) {
    return `<div class="form-group camp-lessons__filter">
        <label for="${id}">${escapeHTML(translate(labelKey))}</label>
        <select id="${id}" data-archive-safe>
          ${options.map(([value, label]) => `<option value="${escapeAttribute(String(value))}" ${String(value) === String(current) ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}
        </select>
      </div>`;
  }

  /** @returns {string} One closed review */
  reviewMarkup(review) {
    const facts = [
      review.site?.name,
      review.camp.season ? translate(`camp_site_season_${review.camp.season}`) : '',
      translate('camp_reviews_counts').replace('{keep}', String(review.counts.keep)).replace('{fix}', String(review.counts.fix)),
    ].filter(Boolean).join(' · ');
    return `<li class="camp-lessons__review">
        <h2><a href="/camp-review/${Number(review.camp.id)}">${escapeHTML(reviewTitle(review, this.lang()))}</a></h2>
        <p class="camp-lessons__facts">${escapeHTML(facts)}</p>
        ${lessonsListMarkup(review, 'h3')}
      </li>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const { reviews, sites } = this.data;
    const filtered = Boolean(this.filters.site_id || this.filters.season);
    const list = reviews.length
      ? `<ul class="camp-lessons__list">${reviews.map((review) => this.reviewMarkup(review)).join('')}</ul>`
      : `<p class="empty-state">${escapeHTML(translate(filtered ? 'camp_reviews_empty_filtered' : 'camp_reviews_empty'))}</p>`;
    setContent(this.root(), `<section class="page camp-lessons-page">
        ${renderBackLink('/camp-plans')}
        <h1>${escapeHTML(translate('camp_reviews_title'))}</h1>
        <p>${escapeHTML(translate('camp_reviews_intro'))}</p>
        <form class="camp-lessons__filters" id="camp-reviews-filters" role="search" aria-label="${escapeAttribute(translate('camp_reviews_filters'))}">
          ${this.select('camp-reviews-site', 'camp_reviews_site', [['', translate('camp_reviews_all_sites')], ...sites.map((site) => [site.id, site.name])], this.filters.site_id)}
          ${this.select('camp-reviews-season', 'camp_reviews_season', [['', translate('camp_reviews_all_seasons')],
    ...siteRules.SEASONS.map((season) => [season, translate(`camp_site_season_${season}`)])], this.filters.season)}
        </form>
        <p class="sr-only" role="status" id="camp-reviews-count">${escapeHTML(translate('camp_reviews_count').replace('{count}', String(reviews.length)))}</p>
        ${list}
      </section>`);
    const form = this.root().querySelector('#camp-reviews-filters');
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('change', async (event) => {
      const key = event.target.id === 'camp-reviews-site' ? 'site_id' : 'season';
      this.filters[key] = event.target.value;
      await this.load();
      this.root().querySelector(`#${event.target.id}`)?.focus();
    });
  }
}
