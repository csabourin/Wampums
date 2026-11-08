/**
 * The camp permit's checklist (#1416, first slice of the camp plan document #1320).
 *
 * One line per requirement of the camp permit, grouped as the permit lists
 * them, each saying in words whether Wampums finds it complete, still to
 * complete, or cannot verify it, and leading to the screen that completes it.
 * Above it, the plan's header: unit, scout group, district, branch,
 * coeducation, dates and number of youth.
 *
 * Nothing here says the camp is compliant: a line Wampums cannot check reads
 * "not verified", never "complete". A line whose source the person may not
 * read says so, with no detail and no link.
 *
 * Takes `meetings.view` with a unit-wide scope, as its endpoint does.
 *
 * Below the checklist, the plan's frozen versions (#1418): submitting the plan
 * freezes its content and its PDF; each version can be downloaded, with its
 * SHA-256 digest, and the screen says what changed since the latest. They name
 * the camp's youth, so they are offered with `participants.view`; submitting
 * takes `meetings.manage`, never from a demo account.
 *
 * @module spa/modules/camp-plan/CampPermit
 */
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, canAccessAdminPanel, canViewCarpools, isDemoUser } from '../../utils/PermissionUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import { getCampPermit, getCampPlanVersions, submitCampPlanVersion, getCampPlanVersionPdf } from '../../api/api-camp-plans.js';
import styles from '../../../css/camp-plan.css?url';

/** The count a reason's text names, by reason. */
const REASON_COUNTS = Object.freeze({
  sections_to_write: 'to_write',
  sections_to_review: 'to_review',
  days_without_activity: 'empty_days',
  days_without_title: 'untitled_days',
  consent_pending: 'pending',
  cite_transport: 'offers',
});

/** How long a downloaded file's address stays valid, once the browser has started saving it. */
const DOWNLOAD_URL_LIFETIME_MS = 10000;

/** How many characters of the PDF's fingerprint people compare, in groups of four. */
const CODE_LENGTH = 8;
const CODE_GROUP = 4;

/**
 * A short code people can read aloud or compare by eye: the start of the version's
 * fingerprint, in capitals, in groups of four ("2CEC 53A4"). The same code is printed
 * on the first page of the version's PDF (services/campPlanVersions.js writes it alike).
 *
 * @param {string} digest - The full SHA-256, in hexadecimal
 * @returns {string}
 */
export function verificationCode(digest) {
  const start = String(digest || '').slice(0, CODE_LENGTH).toUpperCase();
  return start.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g'))?.join(' ') || '';
}

/** How each state reads, and the class that repeats it beside the words. */
const STATE_CLASSES = Object.freeze({ complete: 'is-complete', to_complete: 'is-missing', unverified: 'is-unverified' });

export class CampPermit {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The planned camp
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.data = null;
    this.destroyed = false;
    this.request = 0;
    // Frozen versions (#1418): null while loading, an Error when they could not be.
    this.versions = null;
    this.versionsRequest = 0;
    // Versions name youth, and the team with its qualifications (as the camp lists show them).
    this.canReadVersions = hasPermission('participants.view')
      && (hasPermission('meetings.manage') || hasPermission('volunteers.manage'));
    this.canSubmit = this.canReadVersions && hasPermission('meetings.manage') && !isDemoUser();
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
    this.versionsRequest += 1;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @returns {string} A number in the interface's language */
  number(value) {
    return new Intl.NumberFormat(localeForLanguage(this.lang())).format(Number(value) || 0);
  }

  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_permit_title'), backHref: '/camp-plans' };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampPermit(this.meetingId);
      if (this.destroyed || request !== this.request) {
        return;
      }
      if (!response?.data?.camp || !Array.isArray(response.data.lines) || !Array.isArray(response.data.groups)) {
        throw new Error('Missing camp permit');
      }
      this.data = response.data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp permit:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_permit_load_failed'), retryId: 'camp-permit-retry' }));
      this.root().querySelector('#camp-permit-retry')?.addEventListener('click', () => this.init());
    }
  }

  /**
   * Where a line is completed, when the person may open it.
   * @param {string} key - A line key
   * @returns {string|null}
   */
  lineHref(key) {
    const id = this.meetingId;
    const { camp } = this.data;
    const planId = Number(camp.year_plan_id);
    const links = {
      identification: canAccessAdminPanel() ? '/unit-settings' : null,
      site: `/camp-site/${id}`,
      camp_type: `/camp-site/${id}`,
      emergency: `/camp-site/${id}`,
      insurance: `/camp-site/${id}`,
      directions: `/camp-site/${id}`,
      transport: camp.activity_id && canViewCarpools() ? `/carpool/${Number(camp.activity_id)}` : null,
      written_sections: `/camp-plan/${id}`,
      rain_games: `/camp-plan/${id}?part=rain`,
      schedule: Number.isInteger(planId) && planId > 0 ? `/yearly-planner/${planId}` : '/yearly-planner',
      group_material: `/camp-material/${id}`,
      personal_material: hasPermission('personal_equipment.manage') ? `/personal-equipment/${id}/manage` : null,
      youth_list: hasPermission('participants.view') ? `/camp-roster/${id}` : null,
      team_list: hasPermission('participants.view') ? `/camp-roster/${id}` : null,
      health_forms: hasPermission('participants.view') ? `/camp-roster/${id}` : null,
      allergies: hasPermission('participants.view') ? `/camp-roster/${id}` : null,
      evaluation: hasPermission('camp_reviews.view') ? `/camp-review/${id}` : null,
    };
    return links[key] || null;
  }

  /** @returns {string} One reason, in words, with the count it names */
  reasonText(reason, entry) {
    const countKey = REASON_COUNTS[reason];
    const text = translate(`camp_permit_reason_${reason}`);
    return countKey ? text.replace('{count}', this.number(entry.counts?.[countKey])) : text;
  }

  /** @returns {string} One line of the checklist */
  lineMarkup(entry) {
    const label = translate(`camp_permit_line_${entry.key}`);
    const noAccess = entry.reasons.includes('no_access');
    const href = noAccess ? null : this.lineHref(entry.key);
    const reasons = entry.reasons.length
      ? `<ul class="camp-permit__reasons">${entry.reasons.map((reason) => `<li>${escapeHTML(this.reasonText(reason, entry))}</li>`).join('')}</ul>`
      : '';
    return `<li class="camp-permit__line ${STATE_CLASSES[entry.state] || ''}">
        <h3 class="camp-permit__line-name">${escapeHTML(label)}</h3>
        <p class="camp-permit__state">
          ${entry.blocking ? `<strong>${escapeHTML(translate('camp_permit_blocking'))}</strong>` : ''}
          <span class="camp-plan__chip ${STATE_CLASSES[entry.state] || ''}">${escapeHTML(translate(`camp_permit_state_${entry.state}`))}</span>
        </p>
        ${reasons}
        ${href ? `<a class="button button--secondary button--small" href="${href}">${escapeHTML(translate(entry.state === 'to_complete' ? 'camp_permit_open' : 'camp_permit_view'))}<span class="sr-only"> : ${escapeHTML(label)}</span></a>` : ''}
      </li>`;
  }

  /** @returns {string} How many lines stand in each state, in words */
  summaryMarkup() {
    const count = (state) => this.data.lines.filter((entry) => entry?.state === state).length;
    const items = ['to_complete', 'unverified', 'complete']
      .map((state) => `<li>${escapeHTML(translate(`camp_permit_summary_${state}`).replace('{count}', this.number(count(state))))}</li>`)
      .join('');
    return `<ul class="camp-permit__summary">${items}</ul>`;
  }

  /** @returns {string} A value of the header, or "to complete" in words when it is missing */
  headerValue(value) {
    return value ? escapeHTML(value) : `<span class="camp-plan__chip is-missing">${escapeHTML(translate('camp_permit_state_to_complete'))}</span>`;
  }

  /** @returns {string} The plan's header: unit, group, district, branch, coeducation, dates, youth */
  headerMarkup() {
    const { header, camp } = this.data;
    const branch = CONFIG.PROGRAM_SECTIONS.DEFAULT.find((section) => section.key === header.program_section);
    const dates = translate('camp_readiness_upcoming_dates')
      .replace('{from}', formatDate(camp.date_from, this.lang())).replace('{to}', formatDate(camp.date_to, this.lang()));
    const rows = [
      ['organization_name', this.headerValue(header.name)],
      ['unit_settings_unit_name', this.headerValue(header.unit)],
      ['camp_permit_scout_group', this.headerValue(header.scout_groups.join(', '))],
      ['District', this.headerValue(header.district)],
      ['camp_permit_branch', this.headerValue(branch && header.program_section !== 'general' ? translate(branch.labelKey) : '')],
      ['unit_coeducation_label', this.headerValue(header.coeducation ? translate(`unit_coeducation_${header.coeducation}`) : '')],
      ['camp_permit_dates', escapeHTML(dates)],
      ['camp_permit_days', escapeHTML(this.number(header.days))],
      ['camp_permit_youth_count', header.youth_count === null || header.youth_count === undefined
        ? escapeHTML(translate('camp_permit_reason_no_access')) : escapeHTML(this.number(header.youth_count))],
    ];
    const settings = canAccessAdminPanel()
      ? `<a class="button button--secondary button--small" href="/unit-settings">${escapeHTML(translate('camp_permit_edit_unit'))}</a>` : '';
    return `<section class="camp-plan__group" aria-labelledby="camp-permit-header">
        <h2 id="camp-permit-header">${escapeHTML(translate('camp_permit_header_title'))}</h2>
        <dl class="camp-permit__header">
          ${rows.map(([key, value]) => `<div><dt>${escapeHTML(translate(key))}</dt><dd>${value}</dd></div>`).join('')}
        </dl>
        ${settings}
      </section>`;
  }

  /** @returns {string} One group of lines */
  groupMarkup(group) {
    const lines = group.lines.map((key) => this.data.lines.find((entry) => entry?.key === key)).filter(Boolean);
    if (!lines.length) {
      return '';
    }
    return `<section class="camp-plan__group" aria-labelledby="camp-permit-group-${group.key}">
        <h2 id="camp-permit-group-${group.key}">${escapeHTML(translate(`camp_permit_group_${group.key}`))}</h2>
        <ul class="camp-permit__lines">${lines.map((entry) => this.lineMarkup(entry)).join('')}</ul>
      </section>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const { camp, groups } = this.data;
    setContent(this.root(), `<section class="page camp-plan camp-permit">
        ${renderBackLink('/camp-plans')}
        <h1>${escapeHTML(translate('camp_permit_title'))}</h1>
        <p class="camp-plan__camp"><strong>${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</strong></p>
        ${camp.is_cancelled ? `<p role="status">${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
        <p class="camp-plan__intro">${escapeHTML(translate('camp_permit_intro'))}</p>
        ${this.summaryMarkup()}
        ${this.headerMarkup()}
        ${groups.map((group) => this.groupMarkup(group)).join('')}
        ${this.canReadVersions ? `<section class="camp-plan__group camp-permit__versions" aria-labelledby="camp-permit-versions-title">
          <h2 id="camp-permit-versions-title" tabindex="-1">${escapeHTML(translate('camp_plan_versions_title'))}</h2>
          <p>${escapeHTML(translate('camp_plan_versions_intro'))}</p>
          <div id="camp-permit-versions"></div>
        </section>` : ''}
      </section>`);
    if (this.canReadVersions) {
      this.loadVersions();
    }
  }

  /** The versions part, redrawn alone: loading, failed (with a retry), or the list. */
  drawVersions() {
    const container = this.root()?.querySelector('#camp-permit-versions');
    if (!container) {
      return;
    }
    if (this.versions === null) {
      setContent(container, `<p role="status">${escapeHTML(translate('camp_plan_versions_loading'))}</p>`);
      return;
    }
    if (this.versions instanceof Error) {
      setContent(container, `<div role="alert"><p>${escapeHTML(apiErrorMessage(this.versions, 'camp_plan_versions_load_failed'))}</p>
        <button type="button" class="button button--secondary button--small" id="camp-permit-versions-retry">${escapeHTML(translate('retry'))}</button></div>`);
      container.querySelector('#camp-permit-versions-retry').addEventListener('click', () => this.loadVersions());
      return;
    }
    setContent(container, this.versionsMarkup());
    container.querySelector('#camp-permit-submit')?.addEventListener('click', (event) => this.submit(event.currentTarget));
    container.querySelectorAll('[data-version-download]').forEach((button) => {
      button.addEventListener('click', () => this.download(Number(button.dataset.versionDownload), button));
    });
  }

  async loadVersions() {
    const request = ++this.versionsRequest;
    this.versions = null;
    this.drawVersions();
    try {
      const response = await getCampPlanVersions(this.meetingId);
      if (this.destroyed || request !== this.versionsRequest) {
        return;
      }
      if (!Array.isArray(response?.data?.versions)) {
        throw new Error('Missing camp plan versions');
      }
      this.versions = response.data;
    } catch (err) {
      if (this.destroyed || request !== this.versionsRequest) {
        return;
      }
      debugError('Failed to load the camp plan versions:', err);
      this.versions = err instanceof Error ? err : new Error('versions');
    }
    this.drawVersions();
  }

  /** @returns {string} What changed since the latest version, in words */
  changesMarkup() {
    const { versions, changed_since_latest: changed } = this.versions;
    if (!versions.length || !Array.isArray(changed)) {
      return `<p>${escapeHTML(translate('camp_plan_versions_none'))}</p>`;
    }
    const latest = this.number(versions[0].version_number);
    if (!changed.length) {
      return `<p class="camp-permit__unchanged">${escapeHTML(translate('camp_plan_changed_none').replace('{version}', latest))}</p>`;
    }
    return `<div class="camp-permit__changes"><p>${escapeHTML(translate('camp_plan_changed_since').replace('{version}', latest))}</p>
        <ul>${changed.map((part) => `<li>${escapeHTML(translate(`camp_plan_part_${part}`))}</li>`).join('')}</ul></div>`;
  }

  /** @returns {string} The submit button, the changes, and every version with its document */
  versionsMarkup() {
    const { versions } = this.versions;
    const submit = this.canSubmit && !this.data.camp.is_cancelled
      ? `<p><button type="button" class="button button--primary" id="camp-permit-submit">${escapeHTML(translate('camp_plan_submit'))}</button></p>` : '';
    const items = versions.map((version) => {
      const label = translate('camp_plan_version_label').replace('{version}', this.number(version.version_number));
      const date = new Intl.DateTimeFormat(localeForLanguage(this.lang()), { dateStyle: 'long', timeStyle: 'short' })
        .format(new Date(version.submitted_at));
      const meta = version.submitted_by_name
        ? translate('camp_plan_version_meta').replace('{date}', date).replace('{name}', version.submitted_by_name)
        : translate('camp_plan_version_meta_unknown').replace('{date}', date);
      return `<li class="camp-permit__version">
          <h3>${escapeHTML(label)} <span class="camp-plan__chip">${escapeHTML(translate(`camp_plan_version_status_${version.status}`))}</span></h3>
          <p>${escapeHTML(meta)}</p>
          ${version.redacted_at ? `<p class="camp-permit__redacted"><strong>${escapeHTML(translate('camp_plan_version_redacted'))}</strong></p>` : ''}
          <p class="camp-permit__code">${escapeHTML(translate('camp_plan_version_code'))}
            <strong class="camp-permit__code-value">${escapeHTML(verificationCode(version.snapshot_sha256))}</strong></p>
          <p class="field-hint">${escapeHTML(translate('camp_plan_version_code_hint'))}</p>
          <details class="camp-permit__digest">
            <summary>${escapeHTML(translate('camp_plan_version_digest_details'))}</summary>
            <p>${escapeHTML(translate('camp_plan_version_digest'))} <code>${escapeHTML(version.pdf_sha256)}</code></p>
          </details>
          ${version.has_health ? `<p class="field-hint">${escapeHTML(translate('camp_plan_version_health_note'))}</p>` : ''}
          <button type="button" class="button button--secondary button--small" data-version-download="${Number(version.version_number)}">
            ${escapeHTML(translate('camp_plan_version_download'))}<span class="sr-only"> : ${escapeHTML(label)}</span></button>
        </li>`;
    }).join('');
    return `${submit}${this.changesMarkup()}${items ? `<ul class="camp-permit__version-list">${items}</ul>` : ''}`;
  }

  /** Submit the plan once confirmed; declining changes nothing. */
  async submit(button) {
    const confirmed = await confirm({
      title: translate('camp_plan_submit_confirm_title'),
      message: translate('camp_plan_submit_confirm_message'),
      confirmLabel: translate('camp_plan_submit'),
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await submitCampPlanVersion(this.meetingId);
      this.app.showMessage(translate('camp_plan_version_submitted'), 'success');
      await this.loadVersions();
      this.root()?.querySelector('#camp-permit-versions-title')?.focus();
    } catch (err) {
      debugError('Failed to submit the camp plan:', err);
      this.app.showMessage(apiErrorMessage(err, 'camp_plan_version_submit_failed'), 'error');
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  /** Save one version's document on the device. */
  async download(versionNumber, button) {
    button.disabled = true;
    try {
      const file = await getCampPlanVersionPdf(this.meetingId, versionNumber);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename || `camp-plan-v${versionNumber}.pdf`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    } catch (err) {
      debugError('Failed to download the camp plan:', err);
      this.app.showMessage(apiErrorMessage(err, 'camp_plan_version_download_failed'), 'error');
    } finally {
      button.disabled = false;
    }
  }
}
