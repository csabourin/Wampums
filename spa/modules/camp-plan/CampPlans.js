/**
 * The unit's camp plans: every planned camp, coming ones first, each saying
 * what its written plan still lacks and leading to its plan, its site and its
 * team overview. Camps are planned in the year planner; a camp with nothing to
 * write still says so in words.
 *
 * Takes `meetings.view`, as each camp's plan does.
 *
 * @module spa/modules/camp-plan/CampPlans
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, hasOrganizationScope } from '../../utils/PermissionUtils.js';
import { getCampPlans } from '../../api/api-camp-plans.js';
import styles from '../../../css/camp-plan.css?url';

export class CampPlans {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.data = { coming: [], past: [] };
    // The team overview is offered as its route guard allows: meetings.view with a unit-wide scope.
    this.canSeeReadiness = hasPermission('meetings.view') && hasOrganizationScope();
    this.canSeeReview = hasPermission('camp_reviews.view');
    // The camp lists name its youth, as their route guard says.
    this.canSeeRoster = this.canSeeReadiness && hasPermission('participants.view');
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
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_plans_title') };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampPlans();
      if (this.destroyed || request !== this.request) {
        return;
      }
      const data = response?.data;
      if (!Array.isArray(data?.coming) || !Array.isArray(data?.past)) {
        throw new Error('Missing camp plans');
      }
      this.data = data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp plans:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_plans_load_failed'), retryId: 'camp-plans-retry' }));
      this.root().querySelector('#camp-plans-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} What a camp's plan still lacks, in words */
  leftText(camp) {
    const number = new Intl.NumberFormat(localeForLanguage(this.lang()));
    const parts = [];
    if (camp.to_write) {
      parts.push(translate('camp_readiness_left_plan').replace('{count}', number.format(camp.to_write)));
    }
    if (camp.to_review) {
      parts.push(translate('camp_readiness_left_plan_review').replace('{count}', number.format(camp.to_review)));
    }
    return parts.length ? parts.join(' · ') : translate('camp_plan_all_written');
  }

  /** @returns {string} One camp, with the screens that prepare it */
  campMarkup(camp) {
    const id = Number(camp.id);
    const name = camp.theme || translate('camp_readiness_camp');
    const dates = translate('camp_readiness_upcoming_dates')
      .replace('{from}', formatDate(camp.date_from, this.lang())).replace('{to}', formatDate(camp.date_to, this.lang()));
    const left = camp.to_write || camp.to_review;
    return `<li class="camp-plans__camp${left ? ' is-attention' : ''}">
        <h3 class="camp-plans__name">${escapeHTML(name)}</h3>
        <p>${escapeHTML(dates)}</p>
        <p class="camp-plans__left"><strong>${escapeHTML(translate('camp_plan_left'))}</strong> ${escapeHTML(this.leftText(camp))}</p>
        <div class="camp-plan__actions">
          <a class="button button--primary button--small" href="/camp-plan/${id}">${escapeHTML(translate('camp_plans_open_plan'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>
          <a class="button button--secondary button--small" href="/camp-site/${id}">${escapeHTML(translate('camp_site_title'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>
          ${this.canSeeReadiness ? `<a class="button button--secondary button--small" href="/camp-permit/${id}">${escapeHTML(translate('camp_permit_title'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>` : ''}
          ${this.canSeeRoster ? `<a class="button button--secondary button--small" href="/camp-roster/${id}">${escapeHTML(translate('camp_plans_open_roster'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>` : ''}
          ${this.canSeeReadiness ? `<a class="button button--secondary button--small" href="/camp-readiness/${id}">${escapeHTML(translate('camp_readiness_title'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>` : ''}
          ${this.canSeeReview ? `<a class="button button--secondary button--small" href="/camp-review/${id}">${escapeHTML(translate('camp_review_title'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>` : ''}
        </div>
      </li>`;
  }

  /**
   * @param {string} key - The group's id suffix
   * @param {string} title - Its heading, already translated
   * @param {Object[]} camps
   * @returns {string} A group of camps, or nothing when it has none
   */
  groupMarkup(key, title, camps) {
    if (!camps.length) {
      return '';
    }
    return `<section class="camp-plans__group" aria-labelledby="camp-plans-${key}">
        <h2 id="camp-plans-${key}">${escapeHTML(title)}</h2>
        <ul class="camp-plans__list">${camps.map((camp) => this.campMarkup(camp)).join('')}</ul>
      </section>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const { coming, past } = this.data;
    const planner = hasPermission('meetings.view')
      ? `<a class="button button--secondary" href="/yearly-planner">${escapeHTML(translate('tile_yearly_planner'))}</a>` : '';
    const templates = hasPermission('camp_plan_templates.manage')
      ? `<a class="button button--secondary" href="/camp-plan-templates">${escapeHTML(translate('camp_plan_templates_open'))}</a>` : '';
    const reviews = this.canSeeReview
      ? `<a class="button button--secondary" href="/camp-reviews">${escapeHTML(translate('camp_plans_open_reviews'))}</a>` : '';
    const body = coming.length || past.length
      ? `${this.groupMarkup('coming', translate('camp_plans_coming'), coming)}${this.groupMarkup('past', translate('camp_plans_past'), past)}`
      : `<p class="camp-plan__empty">${escapeHTML(translate('camp_plans_empty'))}</p>`;
    setContent(this.root(), `<section class="page camp-plan camp-plans">
        ${renderBackLink()}
        <h1>${escapeHTML(translate('camp_plans_title'))}</h1>
        <p class="camp-plan__intro">${escapeHTML(translate('camp_plans_intro'))}</p>
        <div class="camp-plan__actions">${planner}${templates}${reviews}</div>
        ${body}
      </section>`);
  }
}
