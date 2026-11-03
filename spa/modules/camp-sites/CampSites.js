/**
 * The unit's camp sites (#1317): the places it camps at, each named once with
 * what the camp permit asks about it and how to reach help from there.
 *
 * Sites are archived rather than deleted: a camp keeps the site it was held
 * at, and an archived site can be restored. Reading takes `meetings.view`;
 * adding, editing and archiving takes `camp_sites.manage`.
 *
 * @module spa/modules/camp-sites/CampSites
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { getCampSites, setCampSiteArchived } from '../../api/api-camp-sites.js';
import { openSiteForm } from './SiteForm.js';
import { emergencyGapLabels } from './siteLabels.js';
import styles from '../../../css/camp-sites.css?url';

export class CampSites {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.sites = [];
    this.showArchived = false;
    this.canManage = hasPermission('camp_sites.manage') && !isDemoUser();
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

  /** Load the sites, showing them or the error. */
  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp sites stylesheet failed', err));
    const options = { title: translate('camp_sites_title') };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampSites({ includeArchived: this.showArchived });
      if (this.destroyed || request !== this.request) {
        return;
      }
      this.sites = Array.isArray(response?.data) ? response.data : [];
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load camp sites:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_sites_load_failed'), retryId: 'camp-sites-retry' }));
      this.root().querySelector('#camp-sites-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} One site, with its emergency information's gaps */
  card(site) {
    const gaps = emergencyGapLabels(site);
    const facts = [
      site.address,
      site.province ? translate(`camp_site_province_${site.province.toLowerCase()}`) : '',
      site.accommodation ? translate(`camp_site_accommodation_${site.accommodation}`) : '',
    ].filter(Boolean);
    return `<li class="camp-sites__card${site.archived ? ' is-archived' : ''}">
      <h2 class="camp-sites__name">${escapeHTML(site.name)}
        ${site.archived ? `<span class="camp-sites__chip">${escapeHTML(translate('camp_site_archived'))}</span>` : ''}</h2>
      ${facts.length ? `<p>${facts.map((fact) => escapeHTML(fact)).join(' · ')}</p>` : ''}
      ${gaps.length
    ? `<p class="camp-sites__gaps"><strong>${escapeHTML(translate('camp_site_emergency_missing'))}</strong> ${escapeHTML(gaps.join(', '))}</p>`
    : `<p class="camp-sites__complete">${escapeHTML(translate('camp_site_emergency_complete'))}</p>`}
      ${this.canManage ? `<div class="camp-sites__actions">
        ${site.archived ? '' : `<button type="button" class="button button--secondary button--small" data-edit-site="${Number(site.id)}">${escapeHTML(translate('edit'))}</button>`}
        <button type="button" class="button button--ghost button--small" data-archive-site="${Number(site.id)}" data-archived="${site.archived}">
          ${escapeHTML(translate(site.archived ? 'camp_site_restore' : 'camp_site_archive'))}
        </button>
      </div>` : ''}
    </li>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const list = this.sites.length
      ? `<ul class="camp-sites__list">${this.sites.map((site) => this.card(site)).join('')}</ul>`
      : `<p class="empty-state">${escapeHTML(translate(this.canManage ? 'camp_sites_empty_manage' : 'camp_sites_empty'))}</p>`;
    setContent(this.root(), `<section class="page camp-sites">
      ${renderBackLink()}
      <h1>${escapeHTML(translate('camp_sites_title'))}</h1>
      <p>${escapeHTML(translate('camp_sites_intro'))}</p>
      <div class="camp-sites__toolbar">
        ${this.canManage ? `<button type="button" class="button button--primary" id="camp-sites-add">${escapeHTML(translate('camp_site_add'))}</button>` : ''}
        <div class="checkbox-option">
          <input type="checkbox" id="camp-sites-archived" data-archive-safe ${this.showArchived ? 'checked' : ''}>
          <label for="camp-sites-archived">${escapeHTML(translate('camp_sites_show_archived'))}</label>
        </div>
      </div>
      ${list}
    </section>`);
    const root = this.root();
    root.querySelector('#camp-sites-add')?.addEventListener('click', () => this.edit(null));
    root.querySelector('#camp-sites-archived').addEventListener('change', (event) => {
      this.showArchived = event.target.checked;
      this.init();
    });
    root.querySelectorAll('[data-edit-site]').forEach((button) => {
      button.addEventListener('click', () => this.edit(this.sites.find((site) => site.id === Number(button.dataset.editSite))));
    });
    root.querySelectorAll('[data-archive-site]').forEach((button) => {
      button.addEventListener('click', () => this.toggleArchived(Number(button.dataset.archiveSite), button.dataset.archived !== 'true'));
    });
  }

  /** @param {Object|null} site - The site to edit, or null to add one */
  edit(site) {
    openSiteForm(this.app, { site, onSaved: () => this.init() });
  }

  /**
   * Archive or restore a site, then reload the list.
   * @param {number} siteId
   * @param {boolean} archived
   */
  async toggleArchived(siteId, archived) {
    try {
      await setCampSiteArchived(siteId, archived);
    } catch (err) {
      debugError('Failed to archive the camp site:', err);
      this.app.showMessage(apiErrorMessage(err, 'camp_site_save_failed'), 'error');
      return;
    }
    this.app.showMessage(translate(archived ? 'camp_site_archived_done' : 'camp_site_restored'), 'success');
    await this.init();
  }
}
