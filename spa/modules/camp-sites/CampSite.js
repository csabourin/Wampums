/**
 * Where a camp is held (#1317): the site chosen from the unit's sites, the
 * camp's season and accommodation, who leads on site, and the number families
 * call. Below, everything the camp permit asks about the site and how to reach
 * help from it, with what is still missing.
 *
 * Reading takes `meetings.view`; choosing takes `meetings.manage`; adding or
 * editing a site from here also takes `camp_sites.manage`.
 *
 * @module spa/modules/camp-sites/CampSite
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_sites.json';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute, sanitizeURL } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { getCampSite, getCampSites, saveCampSite } from '../../api/api-camp-sites.js';
import { openSiteForm } from './SiteForm.js';
import { emergencyGapLabels } from './siteLabels.js';
import styles from '../../../css/camp-sites.css?url';

const FORM_ID = 'camp-site-camp-form';

export class CampSite {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The planned camp
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.data = null;
    this.draft = null;
    this.draftVersion = null;
    this.sites = [];
    this.canManage = hasPermission('meetings.manage') && !isDemoUser();
    this.canManageSites = hasPermission('camp_sites.manage') && !isDemoUser();
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

  /** @returns {string} Back to the camp's overview */
  backHref() {
    return `/camp-readiness/${this.meetingId}`;
  }

  /**
   * Load the camp's site, and the sites it may choose from.
   * @param {{selectSiteId?: number}} [options] - A site just added, to select
   */
  async init({ selectSiteId = null } = {}) {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp sites stylesheet failed', err));
    const options = { title: translate('camp_site_title'), backHref: this.backHref() };
    if (!this.data) {
      setContent(this.root(), pageLoadingMarkup(options));
    }
    try {
      const [response, sites] = await Promise.all([
        getCampSite(this.meetingId),
        this.canManage ? getCampSites() : Promise.resolve(null),
      ]);
      if (this.destroyed || request !== this.request) {
        return;
      }
      if (!response?.data?.camp) {
        throw new Error('Missing camp site');
      }
      this.data = response.data;
      this.sites = Array.isArray(sites?.data) ? sites.data : [];
      this.render(selectSiteId);
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp site:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_site_load_failed'), retryId: 'camp-site-retry' }));
      this.root().querySelector('#camp-site-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} A select of allowed values, with an empty first choice */
  choice(id, labelKey, values, prefix, current, emptyKey) {
    return `<div class="form-group">
        <label for="${id}">${escapeHTML(translate(labelKey))}</label>
        <select id="${id}">
          <option value="">${escapeHTML(translate(emptyKey))}</option>
          ${values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHTML(translate(`${prefix}${value}`))}</option>`).join('')}
        </select>
      </div>`;
  }

  /** @returns {string} The choices a manager makes for this camp */
  formMarkup(selectSiteId) {
    // Choices not yet saved, kept while a site dialog saved and the screen reloaded.
    const { version, ...draft } = this.draft || {};
    const details = { ...(this.data.details || {}), ...draft };
    this.draftVersion = this.draft ? version : null;
    this.draft = null;
    const chosen = selectSiteId ?? details.camp_site_id ?? null;
    const sites = [...this.sites];
    if (this.data.site && !sites.some((site) => site.id === this.data.site.id)) {
      sites.push(this.data.site);
    }
    const members = this.data.members || [];
    const lead = details.on_site_lead_id || '';
    const leadOptions = members.map((member) => `<option value="${escapeAttribute(member.id)}" ${member.id === lead ? 'selected' : ''}>${escapeHTML(member.full_name || '')}</option>`);
    if (lead && !members.some((member) => member.id === lead)) {
      leadOptions.push(`<option value="${escapeAttribute(lead)}" selected>${escapeHTML(translate('camp_site_lead_inactive_option').replace('{name}', details.on_site_lead_name || ''))}</option>`);
    }
    return `<form id="${FORM_ID}" class="camp-site__form" novalidate>
        <h2>${escapeHTML(translate('camp_site_choices'))}</h2>
        <p class="status-message error" id="camp-site-camp-error" role="alert" hidden></p>
        <div class="form-group">
          <label for="camp-site-choice">${escapeHTML(translate('camp_site_chosen'))}</label>
          <select id="camp-site-choice" aria-describedby="camp-site-choice-error">
            <option value="">${escapeHTML(translate('camp_site_none_chosen'))}</option>
            ${sites.map((site) => `<option value="${Number(site.id)}" ${site.id === chosen ? 'selected' : ''}>${escapeHTML(site.name)}${site.archived ? ` (${escapeHTML(translate('camp_site_archived'))})` : ''}</option>`).join('')}
          </select>
          <p class="field-error" id="camp-site-choice-error" hidden></p>
        </div>
        ${this.canManageSites ? `<button type="button" class="button button--secondary button--small" id="camp-site-add">${escapeHTML(translate('camp_site_add'))}</button>` : ''}
        ${this.choice('camp-site-season', 'camp_site_season', rules.SEASONS, 'camp_site_season_', details.season, 'camp_site_not_specified')}
        ${this.choice('camp-site-stay', 'camp_site_camp_accommodation', rules.ACCOMMODATIONS, 'camp_site_accommodation_', details.accommodation, 'camp_site_same_as_site')}
        <div class="form-group">
          <label for="camp-site-lead">${escapeHTML(translate('camp_site_lead'))}</label>
          <select id="camp-site-lead" aria-describedby="camp-site-lead-error">
            <option value="">${escapeHTML(translate('camp_site_not_specified'))}</option>
            ${leadOptions.join('')}
          </select>
          <p class="field-error" id="camp-site-lead-error" hidden></p>
        </div>
        <div class="form-group">
          <label for="camp-site-contact">${escapeHTML(translate('camp_site_contact_phone'))}</label>
          <input type="tel" id="camp-site-contact" maxlength="${rules.PHONE_MAX}" value="${escapeAttribute(details.contact_phone || '')}"
            aria-describedby="camp-site-contact-hint camp-site-contact-error">
          <p class="field-hint" id="camp-site-contact-hint">${escapeHTML(translate('camp_site_contact_hint'))}</p>
          <p class="field-error" id="camp-site-contact-error" hidden></p>
        </div>
        <button type="submit" class="button button--primary">${escapeHTML(translate('save'))}</button>
      </form>`;
  }

  /** @returns {string} One fact of the site, or nothing when it is unknown */
  fact(labelKey, value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    return `<div class="camp-site__fact"><dt>${escapeHTML(translate(labelKey))}</dt><dd>${escapeHTML(String(value))}</dd></div>`;
  }

  /** @returns {string} A directions link, opening elsewhere, or nothing */
  link(labelKey, url) {
    const safe = url ? sanitizeURL(url) : '';
    if (!safe) {
      return '';
    }
    return `<li><a href="${escapeAttribute(safe)}" target="_blank" rel="noopener noreferrer">${escapeHTML(translate(labelKey))}
      <span class="sr-only">${escapeHTML(translate('camp_site_opens_new_tab'))}</span></a></li>`;
  }

  /** @returns {string} Everything the permit asks about the chosen site */
  siteMarkup() {
    const { site, details } = this.data;
    const gaps = emergencyGapLabels(this.data.gaps);
    const gapNotice = gaps.length
      ? `<div class="status-message warning camp-site__gaps"><p><strong>${escapeHTML(translate('camp_site_emergency_missing'))}</strong></p>
          <ul>${gaps.map((gap) => `<li>${escapeHTML(gap)}</li>`).join('')}</ul></div>`
      : `<p class="camp-site__complete">${escapeHTML(translate('camp_site_emergency_complete'))}</p>`;
    if (!site) {
      // What the camp records for itself (the lead, the number families call) holds without a site.
      const contact = this.fact('camp_site_contact_phone', details?.contact_phone) + this.fact('camp_site_lead', details?.on_site_lead_name);
      return `<section class="camp-site__site" aria-labelledby="camp-site-site-title">
          <h2 id="camp-site-site-title">${escapeHTML(translate('camp_site_where'))}</h2>
          <p class="empty-state">${escapeHTML(translate(this.canManage ? 'camp_site_empty_manage' : 'camp_site_empty'))}</p>
          ${gapNotice}
          ${contact ? `<h3>${escapeHTML(translate('camp_site_section_emergency'))}</h3><dl class="camp-site__facts">${contact}</dl>` : ''}
        </section>`;
    }
    const number = new Intl.NumberFormat(localeForLanguage(this.lang()));
    const yesNo = site.has_own_insurance === true ? translate('yes') : site.has_own_insurance === false ? translate('no') : '';
    const accommodation = details?.accommodation || site.accommodation;
    const travel = [
      site.hospital_travel_minutes !== null && site.hospital_travel_minutes !== undefined
        ? translate('camp_site_minutes_value').replace('{count}', number.format(site.hospital_travel_minutes)) : '',
      site.hospital_distance_km !== null && site.hospital_distance_km !== undefined
        ? translate('camp_site_km_value').replace('{count}', number.format(site.hospital_distance_km)) : '',
    ].filter(Boolean).join(' · ');
    const links = this.link('camp_site_directions', site.directions_url) + this.link('camp_site_hospital_directions', site.hospital_directions_url);
    return `<section class="camp-site__site" aria-labelledby="camp-site-site-title">
        <h2 id="camp-site-site-title">${escapeHTML(site.name)}${site.archived ? ` <span class="camp-sites__chip">${escapeHTML(translate('camp_site_archived'))}</span>` : ''}</h2>
        ${gapNotice}
        <h3>${escapeHTML(translate('camp_site_section_place'))}</h3>
        <dl class="camp-site__facts">
          ${this.fact('camp_site_owner', site.owner_name)}
          ${this.fact('camp_site_address', site.address)}
          ${this.fact('camp_site_province', site.province ? translate(`camp_site_province_${site.province.toLowerCase()}`) : '')}
          ${this.fact('camp_site_phone', site.phone)}
          ${this.fact('camp_site_type', site.site_type)}
          ${this.fact('camp_site_description', site.description)}
        </dl>
        <h3>${escapeHTML(translate('camp_site_section_stay'))}</h3>
        <dl class="camp-site__facts">
          ${this.fact('camp_site_accommodation', accommodation ? translate(`camp_site_accommodation_${accommodation}`) : '')}
          ${this.fact('camp_site_accommodation_note', site.accommodation_note)}
          ${this.fact('camp_site_heating', site.heating ? translate(`camp_site_heating_${site.heating}`) : '')}
          ${this.fact('camp_site_heating_note', site.heating_note)}
          ${this.fact('camp_site_own_insurance', yesNo)}
          ${this.fact('camp_site_insurance_note', site.insurance_note)}
        </dl>
        <h3>${escapeHTML(translate('camp_site_section_emergency'))}</h3>
        <dl class="camp-site__facts">
          ${this.fact('camp_site_contact_phone', details?.contact_phone || site.phone)}
          ${this.fact('camp_site_lead', details?.on_site_lead_name)}
          ${this.fact('camp_site_hospital_name', site.hospital_name)}
          ${this.fact('camp_site_hospital_address', site.hospital_address)}
          ${this.fact('camp_site_hospital_phone', site.hospital_phone)}
          ${this.fact('camp_site_hospital_travel', travel)}
          ${this.fact('camp_site_poison_centre', site.poison_centre_phone)}
          ${this.fact('camp_site_other_numbers', site.other_emergency_numbers)}
        </dl>
        ${links ? `<h3>${escapeHTML(translate('camp_site_section_directions'))}</h3><ul class="camp-site__links">${links}</ul>` : ''}
        ${this.canManageSites ? `<button type="button" class="button button--secondary" id="camp-site-edit">${escapeHTML(translate('camp_site_edit'))}</button>` : ''}
      </section>`;
  }

  /** @param {number|null} [selectSiteId] - A site just added, to select */
  render(selectSiteId = null) {
    if (this.destroyed) {
      return;
    }
    const { camp } = this.data;
    const dates = `${formatDate(camp.date_from, this.lang())} – ${formatDate(camp.date_to, this.lang())}`;
    setContent(this.root(), `<section class="page camp-site">
        ${renderBackLink(this.backHref())}
        <h1>${escapeHTML(translate('camp_site_title'))}</h1>
        <p class="camp-site__camp"><strong>${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</strong> <span>${escapeHTML(dates)}</span></p>
        ${camp.is_cancelled ? `<p role="status">${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
        ${this.canManage && !camp.is_cancelled ? this.formMarkup(selectSiteId) : ''}
        ${this.siteMarkup()}
      </section>`);
    this.wire();
  }

  wire() {
    const root = this.root();
    root.querySelector('#camp-site-add')?.addEventListener('click', () => {
      openSiteForm(this.app, { onSaved: (site) => this.reloadKeepingDraft({ selectSiteId: site?.id ?? null }) });
    });
    root.querySelector('#camp-site-edit')?.addEventListener('click', () => {
      openSiteForm(this.app, { site: this.data.site, onSaved: () => this.reloadKeepingDraft() });
    });
    const form = root.querySelector(`#${FORM_ID}`);
    if (!form) {
      return;
    }
    form.addEventListener('change', (event) => this.clearError(event.target));
    form.addEventListener('input', (event) => this.clearError(event.target));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.save(form));
    });
  }

  /**
   * What the camp form holds now, saved or not.
   * @returns {Object|null} The form's choices, or null without a form
   */
  readDraft() {
    const form = this.root().querySelector(`#${FORM_ID}`);
    if (!form) {
      return null;
    }
    const value = (id) => form.querySelector(`#${id}`)?.value.trim() || '';
    return {
      // The version these choices were made against: saving them later must still detect another manager's change.
      version: this.draftVersion ?? Number(this.data?.details?.version || 0),
      camp_site_id: value('camp-site-choice') ? Number(value('camp-site-choice')) : null,
      season: value('camp-site-season') || null,
      accommodation: value('camp-site-stay') || null,
      on_site_lead_id: value('camp-site-lead') || null,
      contact_phone: value('camp-site-contact') || null,
    };
  }

  /**
   * Reload after a site was saved in its dialog, keeping the camp choices not yet saved.
   * @param {{selectSiteId?: number|null}} [options] - A site just added, to select
   */
  reloadKeepingDraft(options = {}) {
    this.draft = this.readDraft();
    return this.init(options);
  }

  /** Clear the message tied to a field as soon as it changes. */
  clearError(input) {
    const error = input?.id ? this.root().querySelector(`#${input.id}-error`) : null;
    if (error) {
      error.hidden = true;
      error.textContent = '';
      error.removeAttribute('role');
    }
    input?.removeAttribute?.('aria-invalid');
  }

  /** @param {HTMLFormElement} form */
  async save(form) {
    const value = (id) => form.querySelector(`#${id}`)?.value.trim() || '';
    const failure = form.querySelector('#camp-site-camp-error');
    failure.hidden = true;
    const siteId = value('camp-site-choice');
    const payload = {
      camp_site_id: siteId ? Number(siteId) : null,
      season: value('camp-site-season') || null,
      accommodation: value('camp-site-stay') || null,
      on_site_lead_id: value('camp-site-lead') || null,
      contact_phone: value('camp-site-contact') || null,
      expected_version: this.draftVersion ?? Number(this.data.details?.version || 0),
    };
    try {
      const response = await saveCampSite(this.meetingId, payload);
      this.draftVersion = null;
      this.app.showMessage(translate('camp_site_saved'), 'success');
      if (response?.data?.camp) {
        this.data = response.data;
        this.render();
        this.root().querySelector('#camp-site-site-title')?.setAttribute('tabindex', '-1');
        this.root().querySelector('#camp-site-site-title')?.focus();
      } else {
        await this.init();
      }
    } catch (err) {
      debugError('Failed to save the camp site:', err);
      const field = { camp_site_id: 'camp-site-choice', on_site_lead_id: 'camp-site-lead', contact_phone: 'camp-site-contact' }[err?.errors?.[0]?.path];
      const message = apiErrorMessage(err, 'camp_site_save_failed');
      const error = field ? form.querySelector(`#${field}-error`) : null;
      if (error) {
        error.textContent = message;
        error.hidden = false;
        error.setAttribute('role', 'alert');
        form.querySelector(`#${field}`).setAttribute('aria-invalid', 'true');
        form.querySelector(`#${field}`).focus();
        return;
      }
      failure.textContent = message;
      failure.hidden = false;
    }
  }
}
