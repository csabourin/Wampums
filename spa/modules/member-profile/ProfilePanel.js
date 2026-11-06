/** Self-written contacts and health panels, mounted inside the account page (#1359). */
import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { getMyProfile, saveMyProfile, getMyHealth, saveMyHealth } from '../../api/api-member-profile.js';
import rules from '../../../config/member_profile.json';

export const PROFILE_ANCHOR = 'my-profile';
export const HEALTH_ANCHOR = 'my-health';
const CONTACT_FIELDS = ['phone', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship', 'date_of_birth'];
const HEALTH_FIELDS = ['health_conditions', 'medications', 'support_needs'];

export class ProfilePanel {
  /** @param {Object} app @param {{health?: boolean}} options */
  constructor(app, { health = false } = {}) {
    this.app = app;
    this.health = health;
    this.id = health ? HEALTH_ANCHOR : PROFILE_ANCHOR;
    this.fields = health ? HEALTH_FIELDS : CONTACT_FIELDS;
    this.state = 'idle';
    this.data = {};
    this.busy = false;
    this.destroyed = false;
    this.scope = buildScopedCacheKey('');
  }

  destroy() { this.destroyed = true; }
  stale() { return this.destroyed || this.scope !== buildScopedCacheKey(''); }

  async mount(container) {
    this.container = container;
    if (!container) { return; }
    if (this.state === 'idle') { await this.load(); } else { this.render(); }
  }

  async load() {
    this.state = 'loading';
    this.render();
    try {
      const result = await (this.health ? getMyHealth() : getMyProfile());
      if (this.stale()) { return; }
      this.data = result.data || {};
      this.state = 'ready';
    } catch (err) {
      if (this.stale()) { return; }
      this.loadError = err;
      this.state = 'error';
    }
    this.render();
  }

  /** Each field has its own native label; health text is optional, including an explicit 'none'. */
  fieldMarkup(field) {
    const id = `${this.id}-${field}`;
    const max = this.health ? rules.health_text_max_length : field.includes('phone') ? rules.phone_max_length : rules.name_max_length;
    const value = this.data[field] || '';
    const input = this.health
      ? `<textarea id="${id}" name="${field}" rows="3" maxlength="${max}">${escapeHTML(value)}</textarea>`
      : `<input id="${id}" name="${field}" type="${field === 'date_of_birth' ? 'date' : field.includes('phone') ? 'tel' : 'text'}"
          maxlength="${max}" value="${escapeAttribute(value)}" autocomplete="${field === 'phone' ? 'tel' : field === 'date_of_birth' ? 'bday' : 'off'}">`;
    return `<div class="form-group"><label for="${id}">${escapeHTML(translate(`member_profile_${field}`))}</label>${input}</div>`;
  }

  render() {
    if (this.stale() || !this.container?.isConnected) { return; }
    const title = this.health ? 'member_health_title' : 'member_profile_title';
    let body;
    if (this.state === 'loading' || this.state === 'idle') {
      body = `<p role="status">${escapeHTML(translate('loading'))}</p>`;
    } else if (this.state === 'error') {
      body = `<p role="alert">${escapeHTML(apiErrorMessage(this.loadError, 'member_profile_load_failed'))}</p>
        <button type="button" class="button button--secondary" data-profile-retry>${escapeHTML(translate('retry'))}</button>`;
    } else {
      body = `<p>${escapeHTML(translate(this.health ? 'member_health_intro' : 'member_profile_intro'))}</p>
        <form id="${this.id}-form" class="account-form">
          <fieldset class="member-profile__fields" ${isDemoUser() || this.busy ? 'disabled' : ''}>
            <legend class="sr-only">${escapeHTML(translate(title))}</legend>
            ${this.fields.map((field) => this.fieldMarkup(field)).join('')}
            ${this.health ? `<p><a href="#my-allergies">${escapeHTML(translate('member_health_allergies_link'))}</a></p>` : `
            <div class="checkbox-option">
              <input id="${this.id}-share" name="share_camp_contacts" type="checkbox" ${this.data.share_camp_contacts ? 'checked' : ''}
                aria-describedby="${this.id}-share-help">
              <label for="${this.id}-share">${escapeHTML(translate('member_profile_share_camp_contacts'))}</label>
            </div><p id="${this.id}-share-help" class="form-help">${escapeHTML(translate('member_profile_share_help'))}</p>`}
            <button type="submit" class="button button--primary">${escapeHTML(translate('save'))}</button>
          </fieldset>
          <p data-profile-status role="status"></p>
          <p data-profile-error role="alert" tabindex="-1" hidden></p>
        </form>`;
    }
    setContent(this.container, `<h2 id="${this.id}-heading">${escapeHTML(translate(title))}</h2>${body}`);
    this.container.querySelector('[data-profile-retry]')?.addEventListener('click', () => this.load());
    const form = this.container.querySelector('form');
    form?.addEventListener('input', () => { this.data = this.formData(form); });
    form?.addEventListener('submit', (event) => { event.preventDefault(); this.save(form); });
  }

  formData(form) {
    const data = Object.fromEntries(this.fields.map((field) => [field, form.elements[field].value.trim() || null]));
    if (!this.health) { data.share_camp_contacts = form.elements.share_camp_contacts.checked; }
    return data;
  }

  /** One write at a time; a refused or queued write is never announced as saved. */
  async save(form) {
    if (this.busy || this.stale() || isDemoUser()) { return; }
    if (!form.reportValidity()) { return; }
    this.busy = true;
    const data = this.formData(form);
    form.querySelector('fieldset').disabled = true;
    const errorBox = form.querySelector('[data-profile-error]');
    errorBox.hidden = true;
    form.querySelector('[data-profile-status]').textContent = '';
    try {
      const result = await (this.health ? saveMyHealth(data) : saveMyProfile(data));
      if (this.stale()) { return; }
      if (!result.success || result.queued) { throw new Error('unconfirmed'); }
      this.data = result.data;
      this.render();
      const message = translate(this.health ? 'member_health_saved' : 'member_profile_saved');
      this.container.querySelector('[data-profile-status]').textContent = message;
      this.app.showMessage(message, 'success');
    } catch (err) {
      if (this.stale()) { return; }
      errorBox.textContent = apiErrorMessage(err, 'member_profile_save_failed');
      errorBox.hidden = false;
      errorBox.focus();
    } finally {
      this.busy = false;
      if (!this.stale()) { this.container.querySelector('fieldset').disabled = isDemoUser(); }
    }
  }
}
