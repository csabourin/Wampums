/**
 * Fundraisers, as a family sees them.
 *
 * The campaign screens list every child in the unit, so parents cannot open
 * them. This page answers what a parent actually asks: which campaigns are
 * under way, and for each of my children, what they received, what has been
 * handed in and what is still to hand in.
 *
 * A campaign that has ended stays listed while the family owes money on it.
 * Whether a campaign is under way is judged from the reader's own date, so a
 * sale does not show as "ended" on the evening of its last day.
 *
 * @module spa/modules/fundraising/ParentFundraisers
 */

import parentFundraisersStylesheetUrl from '../../../css/parent-fundraisers.css?url';
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDateShort, getTodayISO } from '../../utils/DateUtils.js';
import { formatCurrency } from '../../utils/NumberUtils.js';
import { canViewFundraisers } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { getFamilyFundraisers } from '../../api/api-family.js';
import { campaignTypeCapabilities } from './campaignModel.js';

/** Order of the campaigns on the page: what needs attention comes first. */
const STATUS_ORDER = Object.freeze({ active: 0, ended: 1, upcoming: 2 });

/**
 * Where a campaign stands on a given day.
 *
 * @param {{start_date: ?string, end_date: ?string}} campaign - Campaign with `YYYY-MM-DD` dates
 * @param {string} [today] - Today as `YYYY-MM-DD`
 * @returns {'upcoming'|'active'|'ended'} Status
 */
export function campaignStatus(campaign, today = getTodayISO()) {
  if (campaign?.start_date && campaign.start_date > today) {
    return 'upcoming';
  }
  if (campaign?.end_date && campaign.end_date < today) {
    return 'ended';
  }
  return 'active';
}

/**
 * Where one child stands in a campaign.
 *
 * @param {{balance: number, amount_due: number, amount_paid: number}} child - Child entry
 * @returns {'owing'|'paid'|'none'} `owing` while money is still to hand in,
 *   `paid` once everything is, `none` when nothing is expected yet
 */
export function childStatus(child) {
  if (Number(child?.balance) > 0) {
    return 'owing';
  }
  if (Number(child?.amount_due) > 0 || Number(child?.amount_paid) > 0) {
    return 'paid';
  }
  return 'none';
}

export class ParentFundraisers {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.campaigns = [];
    this.childrenCount = 0;
  }

  /** @returns {Promise<void>} */
  async init() {
    loadStylesheet(parentFundraisersStylesheetUrl).catch((error) => {
      debugError('Failed to load parent fundraisers styles:', error);
    });
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load family fundraisers:', error);
      this.renderError();
    }
    this.focusTitle();
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getFamilyFundraisers();
    const today = getTodayISO();
    const campaigns = Array.isArray(response?.data?.campaigns) ? response.data.campaigns : [];

    this.childrenCount = Number(response?.data?.children_count) || 0;
    this.campaigns = campaigns
      .map((campaign) => ({
        ...campaign,
        children: Array.isArray(campaign.children) ? campaign.children : [],
        status: campaignStatus(campaign, today),
      }))
      // Array.prototype.sort is stable: the server's order holds within a status.
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The page language */
  lang() {
    return this.app?.lang || document.documentElement.lang || 'fr';
  }

  /**
   * Move focus to the page title once the page has settled. The link that
   * opened the page is gone by then, and without this a keyboard or screen
   * reader user is left at the top of the document with no announcement.
   *
   * @returns {void}
   */
  focusTitle() {
    document.getElementById('parent-fundraisers-title')?.focus();
  }

  /** @returns {string} The page title, shared by every state; `focusTitle` moves focus to it */
  renderTitle() {
    return `<h1 id="parent-fundraisers-title" tabindex="-1">${translate('parent_fundraisers_title')}</h1>`;
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page parent-fundraisers" aria-busy="true">
        ${renderBackLink('/parent-dashboard')}
        ${this.renderTitle()}
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page parent-fundraisers">
        ${renderBackLink('/parent-dashboard')}
        ${this.renderTitle()}
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="parent-fundraisers-retry">${translate('retry')}</button>
      </section>
    `);
    document.getElementById('parent-fundraisers-retry')?.addEventListener('click', () => this.init());
  }

  /**
   * @param {number|string|null} amount - Amount of money
   * @returns {string} Amount in the page language, escaped
   */
  money(amount) {
    return escapeHTML(formatCurrency(amount, this.lang()));
  }

  /**
   * @param {number|null} value - A count or a number of hours
   * @returns {string} Number in the page language
   */
  number(value) {
    return new Intl.NumberFormat(this.lang()).format(Number(value) || 0);
  }

  /**
   * @param {number} ratio - Share of a whole, 1 being all of it
   * @returns {string} Percentage in the page language ("37 %" in French, "37%" in English), escaped
   */
  percent(ratio) {
    return escapeHTML(new Intl.NumberFormat(this.lang(), { style: 'percent', maximumFractionDigits: 0 }).format(ratio));
  }

  /** @returns {number} Money the family still has to hand in, every campaign included */
  totalBalance() {
    return this.campaigns.reduce(
      (total, campaign) => total + campaign.children.reduce((sum, child) => sum + (Number(child.balance) || 0), 0),
      0,
    );
  }

  /** @returns {boolean} True when at least one child has an entry in a listed campaign */
  hasEntries() {
    return this.campaigns.some((campaign) => campaign.children.length > 0);
  }

  /**
   * One figure of a child's standing.
   *
   * @param {string} labelKey - Translation key of the label
   * @param {string} value - Escaped value
   * @param {string} [modifier] - Optional class suffix
   * @returns {string} HTML
   */
  renderFigure(labelKey, value, modifier = '') {
    return `
      <div class="parent-fundraisers__figure${modifier ? ` parent-fundraisers__figure--${modifier}` : ''}">
        <dt>${translate(labelKey)}</dt>
        <dd>${value}</dd>
      </div>`;
  }

  /**
   * One child's standing in a campaign.
   *
   * @param {Object} campaign - Campaign the entry belongs to
   * @param {Object} child - Child entry from the API
   * @returns {string} HTML
   */
  renderChild(campaign, child) {
    const capabilities = campaignTypeCapabilities(campaign.campaign_type);
    const status = childStatus(child);
    const headingId = `parent-fundraisers-child-${escapeHTML(String(campaign.id))}-${escapeHTML(String(child.participant_id))}`;
    const name = escapeHTML(`${child.first_name || ''} ${child.last_name || ''}`.trim());
    const heading = `
        <div class="parent-fundraisers__row">
          <h3 id="${headingId}">${name}</h3>
          <span class="parent-fundraisers__pill parent-fundraisers__pill--${status}">${translate(`parent_fundraisers_child_${status}`)}</span>
        </div>`;

    // Nothing expected and nothing handed in: a column of zeros says no more
    // than the pill already does.
    if (status === 'none') {
      return `<section class="parent-fundraisers__child" aria-labelledby="${headingId}">${heading}</section>`;
    }

    const figures = [];

    if (capabilities.usesQuantity && child.quantity !== null && child.quantity !== undefined) {
      const unitLabel = campaign.unit_label ? ` ${escapeHTML(campaign.unit_label)}` : '';
      figures.push(this.renderFigure('quantity', `${this.number(child.quantity)}${unitLabel}`));
    }
    if (capabilities.usesHours && child.hours !== null && child.hours !== undefined) {
      figures.push(this.renderFigure('hours_worked', this.number(child.hours)));
    }
    figures.push(this.renderFigure('parent_fundraisers_amount_due', this.money(child.amount_due)));
    figures.push(this.renderFigure('parent_fundraisers_amount_paid', this.money(child.amount_paid)));
    figures.push(this.renderFigure('parent_fundraisers_balance', this.money(child.balance), status));

    return `
      <section class="parent-fundraisers__child" aria-labelledby="${headingId}">${heading}
        <dl class="parent-fundraisers__figures">${figures.join('')}</dl>
      </section>`;
  }

  /**
   * The unit's progress toward the objective it set for a campaign.
   *
   * @param {Object} campaign - Campaign from the API
   * @returns {string} HTML, empty when the unit set no objective
   */
  renderUnitProgress(campaign) {
    const objective = Number(campaign.unit_progress?.objective) || 0;
    if (objective <= 0) {
      return '';
    }

    const collected = Number(campaign.unit_progress.collected) || 0;
    const percent = this.percent(collected / objective);
    const progressId = `parent-fundraisers-progress-${escapeHTML(String(campaign.id))}`;
    const summary = translate('parent_fundraisers_unit_progress')
      .replace('{collected}', this.money(collected))
      .replace('{objective}', this.money(objective))
      .replace('{percent}', percent);

    return `
      <div class="parent-fundraisers__progress">
        <label for="${progressId}">${translate('parent_fundraisers_unit_objective')}</label>
        <progress id="${progressId}" max="${objective}" value="${Math.min(collected, objective)}">${percent}</progress>
        <p>${summary}</p>
      </div>`;
  }

  /**
   * One campaign and the family's children in it.
   *
   * @param {Object} campaign - Campaign from the API, with its `status`
   * @returns {string} HTML
   */
  renderCampaign(campaign) {
    const capabilities = campaignTypeCapabilities(campaign.campaign_type);
    const headingId = `parent-fundraisers-campaign-${escapeHTML(String(campaign.id))}`;
    const dates = translate('parent_fundraisers_dates')
      .replace('{start}', escapeHTML(formatDateShort(campaign.start_date, this.lang())))
      .replace('{end}', escapeHTML(formatDateShort(campaign.end_date, this.lang())));
    const showsUnitPrice = capabilities.usesUnitPrice
      && campaign.unit_price !== null && campaign.unit_price !== undefined;

    return `
      <article class="parent-fundraisers__campaign" aria-labelledby="${headingId}">
        <div class="parent-fundraisers__row">
          <h2 id="${headingId}">${escapeHTML(campaign.name || '')}</h2>
          <span class="parent-fundraisers__pill parent-fundraisers__pill--${campaign.status}">${translate(`parent_fundraisers_status_${campaign.status}`)}</span>
        </div>
        ${campaign.start_date && campaign.end_date ? `<p class="parent-fundraisers__meta">${dates}</p>` : ''}
        ${showsUnitPrice ? `<p class="parent-fundraisers__meta">${translate('parent_fundraisers_unit_price').replace('{price}', this.money(campaign.unit_price))}</p>` : ''}
        ${this.renderUnitProgress(campaign)}
        ${campaign.children.map((child) => this.renderChild(campaign, child)).join('')}
        ${campaign.children.length === 0 && this.childrenCount > 0
    ? `<p class="parent-fundraisers__note">${translate('parent_fundraisers_no_entry')}</p>`
    : ''}
      </article>`;
  }

  /** @returns {string} The family's total still to hand in; empty when no child has an entry */
  renderTotal() {
    if (!this.hasEntries()) {
      return '';
    }
    return `
        <p class="parent-fundraisers__total">
          <span>${translate('parent_fundraisers_total_balance')}</span>
          <strong>${this.money(this.totalBalance())}</strong>
        </p>`;
  }

  /** @returns {void} */
  render() {
    // Staff reach this page from "see the app as a parent"; give them the way
    // to the campaign screens their permission opens.
    const staffLink = canViewFundraisers()
      ? `<p><a href="/fundraisers" class="parent-fundraisers__staff-link">${translate('tile_fundraisers')}</a></p>`
      : '';

    // Said once for the page, not under every campaign.
    const noChildrenNote = this.childrenCount === 0 && this.campaigns.length > 0
      ? `<p class="parent-fundraisers__note">${translate('parent_fundraisers_no_children')}</p>`
      : '';

    setContent(this.root(), `
      <section class="page parent-fundraisers">
        ${renderBackLink('/parent-dashboard')}
        ${this.renderTitle()}
        <p>${translate('parent_fundraisers_intro')}</p>
        ${staffLink}
        ${noChildrenNote}
        ${this.campaigns.length === 0
    ? `<p class="empty-state">${translate('parent_fundraisers_empty')}</p>`
    : `${this.renderTotal()}${this.campaigns.map((campaign) => this.renderCampaign(campaign)).join('')}`}
      </section>
    `);
  }
}
