/**
 * Register your children — the step after a parent's account exists.
 *
 * Deliberately short: a name and a birth date per child, nothing more. The
 * full registration paperwork is the existing form, one link away for each
 * child once they exist. Asking for everything here would make the first
 * thing a new parent sees the longest form in the app.
 *
 * A child registered here is linked to this parent, and shared with anyone
 * they share a family with, by the server in the same step. The page never
 * links anything itself.
 *
 * Two answers need the parent's judgement rather than an error:
 * - a child of the same name but another birth date is already in the family.
 *   Siblings can share a name; a mistyped birth date looks identical. The page
 *   shows the match and asks.
 * - a child from last year, or from another unit, is recognised and put on
 *   this year's roster rather than created a second time. The page says so.
 *
 * @module spa/modules/parent-onboarding/ParentOnboarding
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import { loadFamilyAccessStyles } from '../family-access/styles.js';
import {
  getOnboardingContext,
  registerChild,
  completeOnboarding,
} from '../../api/api-family.js';

/**
 * The oldest a participant can plausibly be at registration, matching the
 * server. The Rover section ends at 25.
 */
const MAX_PARTICIPANT_AGE_YEARS = 26;

/** Birth dates as a parent reads them. */
const BIRTH_DATE = { year: 'numeric', month: 'long', day: 'numeric' };

/** What the page says after a child was added, by the server's result. */
const RESULT_MESSAGES = {
  created: 'onboarding_child_created',
  reenrolled: 'onboarding_child_reenrolled',
  enrolled_existing: 'onboarding_child_enrolled_existing',
};

/**
 * Today and the earliest plausible birth date, as ISO dates in local time.
 *
 * @param {Date} [now] - Clock reading, for tests
 * @returns {{today: string, earliest: string}} Date bounds
 */
function birthDateBounds(now = new Date()) {
  const iso = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const earliest = new Date(now);
  earliest.setFullYear(earliest.getFullYear() - MAX_PARTICIPANT_AGE_YEARS);
  return { today: iso(now), earliest: iso(earliest) };
}

/**
 * Check a child's details the way the server will, so the parent hears about a
 * problem before submitting.
 *
 * @param {Object} child - `first_name`, `last_name`, `date_naissance`
 * @param {Date} [now] - Clock reading, for tests
 * @returns {string|null} Translation key of the first problem, or null
 */
export function childProblem(child, now = new Date()) {
  if (!child.first_name || !child.last_name) {
    return 'onboarding_error_name_required';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(child.date_naissance || '')) {
    return 'onboarding_error_dob_required';
  }
  const { today, earliest } = birthDateBounds(now);
  if (child.date_naissance > today) {
    return 'onboarding_error_dob_future';
  }
  if (child.date_naissance < earliest) {
    return 'onboarding_error_dob_too_old';
  }
  return null;
}

export class ParentOnboarding {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.context = null;
  }

  /** @returns {Promise<void>} */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load onboarding context:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getOnboardingContext();
    this.context = response?.data || { children: [] };
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The page language */
  lang() {
    return this.app?.lang || document.documentElement.lang || 'fr';
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page parent-onboarding" aria-busy="true">
        <h1>${translate('onboarding_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page parent-onboarding">
        <h1>${translate('onboarding_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="onboarding-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('onboarding-retry')?.addEventListener('click', () => this.init());
  }

  /**
   * One child the family already has.
   *
   * @param {Object} child - From the context
   * @returns {string} HTML
   */
  renderChild(child) {
    const name = escapeHTML(`${child.first_name} ${child.last_name}`);
    const id = escapeHTML(String(child.id));
    return `
      <li class="onboarding-child">
        <div>
          <strong>${name}</strong>
          <span class="form-hint">${escapeHTML(formatDate(child.date_naissance, this.lang(), BIRTH_DATE))}</span>
        </div>
        ${child.enrolled_this_year ? `
          <span class="badge badge--accepted">${translate('onboarding_enrolled_this_year')}</span>
          <a class="btn btn--secondary" href="/formulaire-inscription/${id}">${translate('onboarding_complete_forms')}</a>
        ` : `
          <button type="button" class="button button--small button--primary" data-reenroll="${id}">
            ${translate('onboarding_register_this_year')}
          </button>
        `}
      </li>
    `;
  }

  /** @returns {void} */
  render() {
    const { today, earliest } = birthDateBounds();
    const children = Array.isArray(this.context.children) ? this.context.children : [];
    const year = this.context.scout_year?.label;
    const support = this.context.support_contact;

    setContent(this.root(), `
      <section class="page parent-onboarding">
        <h1>${translate('onboarding_title')}</h1>
        <p>${translate('onboarding_intro')}</p>
        ${this.context.organization_name ? `
          <p class="form-hint">${escapeHTML(this.context.organization_name)}${year ? ` — ${escapeHTML(year)}` : ''}</p>
        ` : ''}
        <p id="onboarding-status" class="status-message" role="status" hidden></p>

        <h2>${translate('onboarding_your_children')}</h2>
        ${children.length === 0
          ? `<p class="empty-state">${translate('onboarding_no_children')}</p>`
          : `<ul class="onboarding-children">${children.map((child) => this.renderChild(child)).join('')}</ul>`}

        <h2>${translate('onboarding_add_child')}</h2>
        <form id="onboarding-child-form" novalidate>
          <div class="form-group">
            <label for="child-first-name">${translate('first_name')}</label>
            <input type="text" id="child-first-name" name="first_name" maxlength="255" required autocomplete="off" />
          </div>
          <div class="form-group">
            <label for="child-last-name">${translate('last_name')}</label>
            <input type="text" id="child-last-name" name="last_name" maxlength="255" required autocomplete="off" />
          </div>
          <div class="form-group">
            <label for="child-birth-date">${translate('date_naissance')}</label>
            <input type="date" id="child-birth-date" name="date_naissance" min="${earliest}" max="${today}" required />
          </div>
          <p id="onboarding-error" class="status-message error" role="alert" hidden></p>
          <button type="submit" id="onboarding-add" class="button button--primary">${translate('onboarding_add_child_submit')}</button>
        </form>

        <div class="onboarding-footer">
          <a class="btn btn--secondary" href="/family-access">${translate('onboarding_share_family')}</a>
          <button type="button" id="onboarding-done" class="button button--primary">${translate('onboarding_done')}</button>
        </div>

        ${support ? `
          <aside class="info-card">
            <p>${translate('complete_registration_help')}</p>
            <p><strong>${escapeHTML(support.name || '')}</strong><br />
              <a href="mailto:${escapeHTML(support.email)}">${escapeHTML(support.email)}</a></p>
          </aside>
        ` : ''}
      </section>
    `);

    this.attachListeners();
  }

  /** @returns {void} */
  attachListeners() {
    const form = document.getElementById('onboarding-child-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitChild(this.readChild(form));
    });

    this.root()?.querySelectorAll('[data-reenroll]').forEach((button) => {
      button.addEventListener('click', () => {
        const child = (this.context.children || []).find((c) => String(c.id) === button.dataset.reenroll);
        if (child) {
          this.submitChild({
            first_name: child.first_name,
            last_name: child.last_name,
            date_naissance: child.date_naissance,
          });
        }
      });
    });

    document.getElementById('onboarding-done')?.addEventListener('click', () => this.finish());
  }

  /**
   * Read the form.
   *
   * @param {HTMLFormElement} form - The child form
   * @returns {Object} Child details
   */
  readChild(form) {
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
    return {
      first_name: value('first_name'),
      last_name: value('last_name'),
      date_naissance: value('date_naissance'),
    };
  }

  /**
   * Register a child, asking the parent when the family already has one of the
   * same name.
   *
   * @param {Object} child - Child details
   * @param {boolean} [confirmSimilar] - The parent already confirmed a same-name child is different
   * @returns {Promise<void>}
   */
  async submitChild(child, confirmSimilar = false) {
    const problem = childProblem(child);
    if (problem) {
      this.showError(problem);
      return;
    }

    const button = document.getElementById('onboarding-add');
    if (button) button.disabled = true;

    try {
      const response = await registerChild(confirmSimilar ? { ...child, confirm_similar: true } : child);
      await this.load();
      this.render();
      this.showStatus(RESULT_MESSAGES[response?.data?.result] || RESULT_MESSAGES.created, child);
    } catch (error) {
      if (button) button.disabled = false;

      if (error?.code === 'similar_child_exists' && !confirmSimilar) {
        await this.askAboutSimilar(child, error.data?.matches || []);
        return;
      }
      if (error?.code === 'duplicate_child') {
        this.showError('onboarding_error_duplicate');
        return;
      }
      debugError('Failed to register child:', error);
      this.showError('onboarding_error_failed');
    }
  }

  /**
   * Show the same-name child already in the family and ask whether this one is
   * different.
   *
   * @param {Object} child - The child being registered
   * @param {Array<Object>} matches - Same-name children already in the family
   * @returns {Promise<void>}
   */
  async askAboutSimilar(child, matches) {
    const described = matches.map((match) => `${match.first_name} ${match.last_name} — ${
      formatDate(match.date_naissance, this.lang(), BIRTH_DATE)}`).join('\n');

    const different = await confirm({
      title: translate('onboarding_similar_title'),
      message: `${translate('onboarding_similar_message')}\n\n${described}`,
      confirmLabel: translate('onboarding_similar_confirm'),
      cancelLabel: translate('onboarding_similar_cancel'),
    });

    if (different) {
      await this.submitChild(child, true);
    } else {
      this.showError('onboarding_similar_cancelled');
    }
  }

  /**
   * Mark onboarding finished and go to the dashboard.
   *
   * Finishing is never blocked on the server: if the call fails, the parent is
   * still taken to their dashboard, and will simply be offered this step again
   * at their next sign-in.
   *
   * @returns {Promise<void>}
   */
  async finish() {
    try {
      await completeOnboarding();
    } catch (error) {
      debugError('Failed to mark onboarding complete:', error);
    }
    history.pushState(null, '', '/parent-dashboard');
    await this.app?.router?.route('/parent-dashboard');
  }

  /**
   * Put a translated error under the form.
   *
   * @param {string} key - Translation key
   * @returns {void}
   */
  showError(key) {
    const element = document.getElementById('onboarding-error');
    if (!element) return;
    element.textContent = translate(key);
    element.hidden = false;
  }

  /**
   * Say what happened to the child just submitted.
   *
   * @param {string} key - Translation key; `{name}` is replaced with the child's name
   * @param {Object} child - The child submitted
   * @returns {void}
   */
  showStatus(key, child) {
    const element = document.getElementById('onboarding-status');
    if (!element) return;
    element.textContent = translate(key).split('{name}').join(`${child.first_name} ${child.last_name}`);
    element.className = 'status-message success';
    element.hidden = false;
  }
}
