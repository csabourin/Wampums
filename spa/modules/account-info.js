/**
 * Settings Module (Account Information & Preferences)
 *
 * Handles user settings: viewing and updating name, email, password, language, and push notifications
 * Follows Wampums module patterns with security best practices
 *
 * @module modules/account-info
 */

import accountInfoStylesheetUrl from '../../css/account-info.css?url';
import { makeApiRequest } from '../api/api-core.js';
import { enablePushNotifications, disablePushNotifications, PushSetupError } from './push/PushSubscription.js';
import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';
import { translate } from '../app.js';
import { escapeAttribute, escapeHTML } from '../utils/SecurityUtils.js';
import { nativeLanguageName } from '../utils/InterfaceLanguageUtils.js';
import { apiErrorMessage } from '../utils/ApiErrorUtils.js';
import { canViewActivities, holdsFamilyRole, isDemoUser, isParent } from '../utils/PermissionUtils.js';
import { CALENDAR_FEED_ANCHOR, CalendarFeedPanel } from './calendar-feed/CalendarFeedPanel.js';
import { CERTIFICATIONS_ANCHOR, CertificationsPanel } from './certifications/CertificationsPanel.js';
import { PROFILE_ANCHOR, HEALTH_ANCHOR, ProfilePanel } from './member-profile/ProfilePanel.js';
import { ALLERGY_ANCHOR, AllergyPanel } from './member-allergies/AllergyPanel.js';
import { setContent, loadStylesheet, withFormBusy } from '../utils/DOMUtils.js';
import { updateMyNickname } from '../api/api-members.js';
import { confirm as confirmDialog } from '../utils/DialogUtils.js';
import { getStorage, setStorage } from '../utils/StorageUtils.js';
import { CONFIG, getStorageKey } from '../config.js';
import { ACCOUNT_SECTIONS, accountSectionFor } from '../config/account-sections.js';
import { renderBackLink } from '../utils/BackLinkUtils.js';

/** Longest a nickname may be, matching users.nickname. */
const NICKNAME_MAX_LENGTH = 100;

/**
 * Settings/Account Information Management Class
 */
export class AccountInfoModule {
  constructor(app) {
    this.app = app;
    this.destroyed = false;
    this.activeSection = null;
    this.mountedPanels = new Map();
    this.formDrafts = new Map();
    this.openDetails = new Set();
    this.onHashChange = () => this.showLinkedSection();
    window.addEventListener('hashchange', this.onHashChange);
    this.userData = null;
    this.isLoading = false;
    this.guardianProfile = { guardian: null, participantIds: [] };
    this.guardianError = null;
    this.holdsFamilyRole = false;
    this.pushEnabled = false;
    this.pushSupported = false;
    // The calendar link serves the unit's activities: offered to those who see them.
    this.calendarFeedPanel = canViewActivities() ? new CalendarFeedPanel(app) : null;
    // Certifications are those of the unit's adults (team, volunteers), not of a parent who is only a parent.
    this.certificationsPanel = isParent() ? null : new CertificationsPanel(app);
    this.profilePanel = new ProfilePanel(app, { compact: true });
    this.healthPanel = isParent() ? null : new ProfilePanel(app, { health: true });
    this.allergyPanel = isParent() ? null : new AllergyPanel(app);
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
    window.removeEventListener('hashchange', this.onHashChange);
    this.formDrafts.clear();
    this.mountedPanels.clear();
    this.calendarFeedPanel?.destroy();
    this.certificationsPanel?.destroy();
    this.allergyPanel?.destroy();
    this.profilePanel.destroy();
    this.healthPanel?.destroy();
  }

  /**
   * Initialize the module
   * Loads user data and renders the page
   */
  async init() {
    this.renderLoading();
    debugLog('Initializing Settings Module');

    // Load page-specific CSS
    await loadStylesheet(accountInfoStylesheetUrl);
    if (this.destroyed) { return; }

    try {
      debugLog('Checking permissions and push support');
      this.holdsFamilyRole = holdsFamilyRole();

      // Check push notification support
      this.pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
      debugLog('Push support check:', { supported: this.pushSupported, notification: 'Notification' in window, sw: 'serviceWorker' in navigator, push: 'PushManager' in window });

      debugLog('Loading starting user data');
      // The language picker lists the unit's languages: on a direct load the
      // unit's settings may still be on their way.
      await Promise.all([this.loadUserData(), this.waitForUnitSettings()]);
      if (this.destroyed) { return; }
      debugLog('User data load complete');

      if (this.holdsFamilyRole) {
        debugLog('Loading guardian profile (parent role detected)');
        await this.loadGuardianProfile();
        debugLog('Guardian profile load complete');
      } else {
        debugLog('Skipping guardian profile (not a parent)');
        this.guardianProfile = { guardian: null, participantIds: [] };
        this.guardianError = null;
      }

      if (this.destroyed) { return; }
      debugLog('Proceeding to initial render');
      this.render();
      debugLog('Initial render complete, attaching event listeners');
      this.attachEventListeners();
      debugLog('Initialization complete');
    } catch (error) {
      debugError('Error initializing settings module:', error);
      if (!this.destroyed) { this.renderError(apiErrorMessage(error, 'error_loading_data')); }
    }
  }

  /**
   * Check if user has an active push subscription
   */
  async checkPushSubscription() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        debugLog('ServiceWorker or PushManager not available');
        return false;
      }

      debugLog('Waiting for service worker to be ready (with 2s timeout)');

      // Use a timeout to prevent hanging if the service worker doesn't become ready
      const swReadyPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Service worker ready timeout')), 2000)
      );

      try {
        const registration = await Promise.race([swReadyPromise, timeoutPromise]);
        debugLog('Service worker ready');
        const subscription = await registration.pushManager.getSubscription();
        return subscription !== null;
      } catch (timeoutError) {
        debugWarn('Service worker check timed out or failed, continuing without push status:', timeoutError.message);
        return false;
      }
    } catch (error) {
      debugError('Error checking push subscription:', error);
      return false;
    }
  }

  /**
   * Load guardian profile for the authenticated user
   */
  async loadGuardianProfile() {
    try {
      const response = await makeApiRequest('v1/users/me/guardian-profile', { method: 'GET' });

      if (response.success) {
        this.guardianProfile = response.data || { guardian: null, participantIds: [] };
        this.guardianError = null;
      } else {
        this.guardianError = translate('guardian_load_error');
      }
    } catch (error) {
      debugError('Error loading guardian profile:', error);
      const errorMessage = typeof error.message === 'string' && error.message.toLowerCase().includes('no linked participants')
        ? translate('guardian_no_participants')
        : apiErrorMessage(error, 'guardian_load_error');
      this.guardianError = errorMessage;
      this.guardianProfile = { guardian: null, participantIds: [] };
    }
  }

  /**
   * Load current user data from API
   */
  async loadUserData() {
    try {
      debugLog('Loading user data');
      const response = await makeApiRequest('v1/users/me', {
        method: 'GET',
      });

      if (response.success) {
        this.userData = response.data;
        debugLog('User data loaded:', this.userData);
      } else {
        throw new Error(response.message || 'Failed to load user data');
      }
    } catch (error) {
      debugError('Error loading user data:', error);
      throw error;
    }
  }

  /**
   * Render the settings page
   */
  render() {
    if (this.destroyed) { return; }
    const homeLink = isParent() ? '/parent-dashboard' : '/dashboard';

    const fullName = escapeHTML(this.userData?.full_name || '');
    const email = escapeHTML(this.userData?.email || '');


    // Get current UI language (not just preference)
    const currentLang = this.app.lang || getStorage('lang', false, CONFIG.DEFAULT_LANG);
    const timeFormatKey = getStorageKey('TIME_FORMAT');
    const defaultTimeFormat = CONFIG?.TIME_FORMAT?.DEFAULT || '24h';
    const currentTimeFormat = getStorage(timeFormatKey, false, defaultTimeFormat);

    const guardianData = this.guardianProfile?.guardian || {};
    const nameParts = this.userData?.full_name ? this.userData.full_name.split(' ') : [];
    const defaultGuardianFirstName = guardianData.prenom || nameParts[0] || '';
    const defaultGuardianLastName = guardianData.nom || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');
    const guardianRelationship = guardianData.lien || '';
    const guardianHomePhone = guardianData.telephone_residence || '';
    const guardianWorkPhone = guardianData.telephone_travail || '';
    const guardianMobilePhone = guardianData.telephone_cellulaire || '';
    const guardianPrimary = guardianData.is_primary ?? true;
    const guardianEmergency = guardianData.is_emergency_contact ?? false;
    const hasParticipantLinks = Array.isArray(this.guardianProfile?.participantIds) && this.guardianProfile.participantIds.length > 0;

    const identity = `
<!-- Profile Information Section -->
        <section class="account-section" id="account-identity">
          <h2>${translate('profile_information')}</h2>

          <form id="fullname-form" class="account-form">
            <div class="form-group">
              <label for="fullname-input">${translate('full_name') || translate('account_info_fullname_label')}</label>
              <input
                type="text"
                id="fullname-input"
                name="fullName"
                value="${fullName}"
                placeholder="${translate('enter_full_name') || translate('account_info_fullname_placeholder')}"
                required
                minlength="2"
                maxlength="100"
                autocomplete="name"
              />
            </div>
            <button type="submit" class="button button--primary" id="fullname-submit">
              ${translate('account_identity_save')}
            </button>
          </form>
          ${isParent() ? '' : this.renderNicknameForm()}
        </section>
    `;
    const emailForm = `
<!-- Email Section -->
        <section class="account-section">
          <h2>${translate('email') || translate('account_info_email_title')}</h2>
          <form id="email-form" class="account-form">
            <div class="form-group">
              <label for="email-input">${translate('email') || translate('account_info_email_label')}</label>
              <input
                type="email"
                id="email-input"
                name="email"
                value="${email}"
                placeholder="${translate('enter_email') || translate('account_info_email_placeholder')}" 
                required
                autocomplete="email"
              />
              <small class="form-text">${translate('account_info_email_warning')}</small>
            </div>
            <button type="submit" class="button button--primary" id="email-submit">
              ${translate('account_info_email_button')}
            </button>
          </form>
        </section>
    `;
    const guardian = `
${this.holdsFamilyRole ? `
          <!-- Guardian Information Section (Parents only) -->
          <section class="account-section">
            <h2>${translate('guardian_info_title')}</h2>
            <p class="section-description">${translate('guardian_info_description')}</p>
            <div class="warning-box">
              <p>${translate('account_info_guardian_sync_notice')}</p>
              ${this.guardianError ? `<p>${escapeHTML(this.guardianError)}</p>` : ''}
              ${!hasParticipantLinks ? `<p>${translate('guardian_no_participants')}</p>` : ''}
            </div>
            <form id="guardian-form" class="account-form">
              <div class="form-group">
                <label for="guardian-first-name">${translate('guardian_first_name')}</label>
                <input
                  type="text"
                  id="guardian-first-name"
                  name="guardianFirstName"
                  value="${escapeHTML(defaultGuardianFirstName)}"
                  placeholder="${translate('guardian_first_name')}"
                  required
                  maxlength="120"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-last-name">${translate('guardian_last_name')}</label>
                <input
                  type="text"
                  id="guardian-last-name"
                  name="guardianLastName"
                  value="${escapeHTML(defaultGuardianLastName)}"
                  placeholder="${translate('guardian_last_name')}"
                  required
                  maxlength="120"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-relationship">${translate('guardian_relationship')}</label>
                <input
                  type="text"
                  id="guardian-relationship"
                  name="guardianRelationship"
                  value="${escapeHTML(guardianRelationship)}"
                  placeholder="${translate('guardian_relationship')}"
                  maxlength="120"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-home-phone">${translate('guardian_phone_home')}</label>
                <input
                  type="tel"
                  id="guardian-home-phone"
                  name="guardianHomePhone"
                  value="${escapeHTML(guardianHomePhone)}"
                  placeholder="${translate('guardian_phone_home')}"
                  maxlength="20"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-work-phone">${translate('guardian_phone_work')}</label>
                <input
                  type="tel"
                  id="guardian-work-phone"
                  name="guardianWorkPhone"
                  value="${escapeHTML(guardianWorkPhone)}"
                  placeholder="${translate('guardian_phone_work')}"
                  maxlength="20"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-mobile-phone">${translate('guardian_phone_mobile')}</label>
                <input
                  type="tel"
                  id="guardian-mobile-phone"
                  name="guardianMobilePhone"
                  value="${escapeHTML(guardianMobilePhone)}"
                  placeholder="${translate('guardian_phone_mobile')}"
                  maxlength="20"
                  ${!hasParticipantLinks ? 'disabled' : ''}
                />
              </div>
              <div class="form-group">
                <label for="guardian-primary">
                  <input type="checkbox" id="guardian-primary" name="guardianPrimary" ${guardianPrimary ? 'checked' : ''} ${!hasParticipantLinks ? 'disabled' : ''}>
                  ${translate('guardian_primary_contact')}
                </label>
              </div>
              <div class="form-group">
                <label for="guardian-emergency">
                  <input type="checkbox" id="guardian-emergency" name="guardianEmergency" ${guardianEmergency ? 'checked' : ''} ${!hasParticipantLinks ? 'disabled' : ''}>
                  ${translate('guardian_emergency_contact')}
                </label>
              </div>
              <button type="submit" class="button button--primary" id="guardian-submit" ${!hasParticipantLinks ? 'disabled' : ''}>
                ${translate('guardian_save')}
              </button>
            </form>
          </section>
        ` : ''}
    `;
    const passwordForm = `
<!-- Password Section -->
        <section class="account-section">
          <h2>${translate('change_password') || translate('account_info_password_title')}</h2>
          <form id="password-form" class="account-form">
            <input type="email" name="username" autocomplete="username" value="${email}" hidden readonly />
            <div class="form-group">
              <label for="current-password-input">${translate('current_password') || translate('account_info_password_current_label')}</label>
              <input
                type="password"
                id="current-password-input"
                name="currentPassword"
                placeholder="${translate('enter_current_password')}"
                required
                autocomplete="current-password"
              />
            </div>
            <div class="form-group">
              <label for="new-password-input">${translate('new_password') || translate('account_info_password_new_label')}</label>
              <input
                type="password"
                id="new-password-input"
                name="newPassword"
                placeholder="${translate('enter_new_password')}"
                required
                minlength="8"
                autocomplete="new-password"
              />
              <small class="form-text">${translate('error_password_too_short')}</small>
            </div>
            <div class="form-group">
              <label for="confirm-password-input">${translate('confirm_password') || translate('account_info_password_confirm_label')}</label>
              <input
                type="password"
                id="confirm-password-input"
                name="confirmPassword"
                placeholder="${translate('confirm_new_password')}"
                required
                minlength="8"
                autocomplete="new-password"
              />
            </div>
            <button type="submit" class="button button--primary" id="password-submit">
              ${translate('change_password') || translate('account_info_password_button')}
            </button>
          </form>
        </section>
    `;
    const preferences = `
<!-- Language Section -->
        <section class="account-section" id="account-language">
          <h2>${translate('language')}</h2>
          <p class="section-description">${translate('account_info_language_description')}</p>
          <div class="language-selector" role="group" aria-label="${escapeAttribute(translate('language'))}">
            ${this.renderLanguageOptions(currentLang)}
          </div>
        </section>

        <!-- Time Format Section -->
        <section class="account-section" id="account-time">
          <h2>${translate('time_format')}</h2>
          <p class="section-description">${translate('time_format_description')}</p>
          <div class="setting-row">
            <label for="time-format-select" class="setting-label">
              <span>${translate('time_format')}</span>
            </label>
            <select id="time-format-select" class="settings-select">
              <option value="24h" ${currentTimeFormat === '24h' ? 'selected' : ''}>${translate('time_format_24h')}</option>
              <option value="12h" ${currentTimeFormat === '12h' ? 'selected' : ''}>${translate('time_format_12h')}</option>
            </select>
          </div>
        </section>

        <!-- Notifications Section -->
        ${this.pushSupported ? `
        <section class="account-section" id="account-notifications">
          <h2>${translate('notifications')}</h2>
          <p class="section-description">${translate('receive_notifications_about_activities')}</p>
          <div class="setting-row">
            <label for="push-toggle" class="setting-label">
              <span>${translate('push_notifications')}</span>
            </label>
            <label class="toggle-switch">
              <input type="checkbox" id="push-toggle" ${this.pushEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <small class="form-text" id="push-status-text">
            ${this.pushEnabled ? translate('push_enabled') : translate('push_disabled')}
          </small>
        </section>
        ` : ''}

        ${this.calendarFeedPanel ? this.disclosure('account-calendar', 'account_calendar_summary', `
          <section class="account-section calendar-feed" id="${CALENDAR_FEED_ANCHOR}" aria-labelledby="calendar-feed-heading"></section>`, 'account_calendar_hint') : ''}
    `;
    const profile = `
<section class="account-section" id="${PROFILE_ANCHOR}" aria-labelledby="${PROFILE_ANCHOR}-heading"></section>
    `;
    const certifications = `
${this.certificationsPanel ? `
        <section class="account-section" id="${CERTIFICATIONS_ANCHOR}" aria-labelledby="certifications-heading"></section>
        ` : ''}
    `;
    const health = `
${this.healthPanel ? `<section class="account-section" id="${HEALTH_ANCHOR}" aria-labelledby="${HEALTH_ANCHOR}-heading"></section>` : ''}
    `;
    const allergies = `
${this.allergyPanel ? `
        <section class="account-section" id="${ALLERGY_ANCHOR}" aria-labelledby="allergy-declaration-heading"></section>
        ` : ''}
    `;
    const bodies = {
      profile: `${identity}${profile}${this.holdsFamilyRole ? this.disclosure('account-family', 'account_family_contacts', guardian, 'account_family_contacts_hint') : ''}`,
      health: `${this.disclosure('account-health', 'account_health_summary', `${health}${allergies}`, 'account_health_hint')}${this.disclosure('account-certifications', 'certifications_title', certifications, 'account_certifications_hint')}`,
      preferences,
      security: `${this.disclosure('account-email', 'account_email_summary', emailForm, this.userData?.email || '', false)}${this.disclosure('account-password', 'change_password', passwordForm, 'account_password_hint')}`,
    };
    const sections = this.sections();
    this.activeSection ||= accountSectionFor(window.location, sections);
    if (!sections.some((section) => section.key === this.activeSection)) { this.activeSection = sections[0].key; }
    this.captureDrafts();
    const content = `
      ${renderBackLink(homeLink)}
      <div class="account-page">
        <header class="account-page__header">
          <div><h1>${escapeHTML(translate('account_info_title'))}</h1>
            <p class="account-page__identity"><strong data-account-name>${fullName}</strong><span>${email}</span></p>
          </div>
          <button type="button" class="button button--ghost" id="logout-btn">${escapeHTML(translate('logout'))}</button>
        </header>
        <div class="account-page__layout">
          <nav class="account-nav" aria-label="${escapeAttribute(translate('account_navigation'))}">
            ${sections.map((section) => `<a href="/account-info?section=${section.key}" data-account-section-link="${section.key}"
                ${section.key === this.activeSection ? 'aria-current="page"' : ''}>
              <span class="account-nav__label">${escapeHTML(translate(section.label))}</span>
              <span class="account-nav__hint">${escapeHTML(translate(section.hint))}</span>
            </a>`).join('')}
          </nav>
          <div class="account-page__content">
            ${sections.map((section) => `<section data-account-section="${section.key}" id="account-section-${section.key}"
                aria-labelledby="account-heading-${section.key}" ${section.key !== this.activeSection ? 'hidden' : ''}>
              <h2 id="account-heading-${section.key}" class="account-page__section-heading" tabindex="-1">${escapeHTML(translate(section.label))}</h2>
              <p class="account-page__section-hint">${escapeHTML(translate(section.hint))}</p>
              ${bodies[section.key]}
            </section>`).join('')}
          </div>
        </div>
      </div>
    `;

    const appContainer = document.getElementById('app');
    if (appContainer) {
      setContent(appContainer, content);
      this.restoreDrafts();
      this.bindSectionNavigation();
      this.openLinkedDetails();
      this.mountVisiblePanels();
    } else {
      debugError('App container not found');
    }
  }

  /** Available task areas; parent-only accounts have no adult camp forms. */
  sections() {
    return ACCOUNT_SECTIONS.filter((section) => !section.staffOnly || this.healthPanel || this.certificationsPanel);
  }

  /** An optional task uses native disclosure semantics, keyboard support and no overlay. */
  disclosure(id, label, body, hint, translateHint = true) {
    return `<details class="account-disclosure" id="${id}">
      <summary><span class="account-disclosure__label">${escapeHTML(translate(label))}</span>
        ${hint ? `<span class="account-disclosure__hint">${escapeHTML(translateHint ? translate(hint) : hint)}</span>` : ''}</summary>
      <div class="account-disclosure__body">${body}</div>
    </details>`;
  }

  renderLoading() {
    if (this.destroyed) { return; }
    setContent(document.getElementById('app'), `${renderBackLink(isParent() ? '/parent-dashboard' : '/dashboard')}
      <section class="account-page" aria-busy="true"><h1>${escapeHTML(translate('account_info_title'))}</h1>
        <p role="status">${escapeHTML(translate('loading'))}</p></section>`);
  }

  /** Keep drafts in this page instance only, including while its language changes. */
  captureDrafts() {
    document.querySelectorAll('.account-page input[id], .account-page textarea[id], .account-page select[id]').forEach((field) => {
      this.formDrafts.set(field.id, { value: field.value, checked: field.checked });
    });
    this.openDetails = new Set([...document.querySelectorAll('.account-page details[open][id]')].map((element) => element.id));
  }

  restoreDrafts(root = document) {
    root.querySelectorAll('input[id], textarea[id], select[id]').forEach((field) => {
      const draft = this.formDrafts.get(field.id);
      if (!draft) { return; }
      field.value = draft.value;
      if (field.type === 'checkbox' || field.type === 'radio') { field.checked = draft.checked; }
    });
    this.openDetails.forEach((id) => {
      const element = document.getElementById(id);
      if (element?.tagName === 'DETAILS') { element.open = true; }
    });
  }

  /** Bind only the controls replaced with the page shell; section switches keep every form node. */
  bindSectionNavigation() {
    document.querySelectorAll('[data-account-section-link]').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
        event.preventDefault();
        this.showSection(link.dataset.accountSectionLink, { updateUrl: true, focus: true });
      });
    });
  }

  /** Switch tasks without redrawing or discarding a form in another task. */
  showSection(key, { updateUrl = false, focus = false } = {}) {
    if (this.destroyed || !this.sections().some((section) => section.key === key)) { return; }
    this.activeSection = key;
    document.querySelectorAll('[data-account-section]').forEach((panel) => {
      panel.hidden = panel.dataset.accountSection !== key;
    });
    document.querySelectorAll('[data-account-section-link]').forEach((link) => {
      if (link.dataset.accountSectionLink === key) { link.setAttribute('aria-current', 'page'); }
      else { link.removeAttribute('aria-current'); }
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', key);
      url.hash = '';
      window.history.replaceState(null, '', url);
      if (this.app.router) { this.app.router.currentPath = url.pathname + url.search; }
    }
    this.mountVisiblePanels();
    if (focus) {
      const heading = document.getElementById(`account-heading-${key}`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  /** Old emailed and in-app anchor links open the containing task and disclosure. */
  showLinkedSection() {
    const linked = this.sections().find((section) => section.anchors.includes(window.location.hash.slice(1)));
    if (!linked) { return; }
    this.showSection(linked.key);
    this.openLinkedDetails();
  }

  openLinkedDetails() {
    const anchor = window.location.hash.slice(1);
    const target = anchor ? document.getElementById(anchor) : null;
    if (!target || !target.closest('.account-page')) { return; }
    let detail = target.closest('details');
    while (detail) { detail.open = true; detail = detail.parentElement?.closest('details'); }
  }

  /** Mount only panels of the visible task, once per container. Hidden tasks retain their drafts. */
  mountVisiblePanels() {
    const panels = [
      ['profile', this.profilePanel, PROFILE_ANCHOR],
      ['health', this.healthPanel, HEALTH_ANCHOR],
      ['health', this.allergyPanel, ALLERGY_ANCHOR],
      ['health', this.certificationsPanel, CERTIFICATIONS_ANCHOR],
      ['preferences', this.calendarFeedPanel, CALENDAR_FEED_ANCHOR],
    ];
    const mounts = panels.filter(([section, panel]) => section === this.activeSection && panel).map(async ([_section, panel, anchor]) => {
      const container = document.getElementById(anchor);
      if (!container || this.mountedPanels.get(panel) === container) { return; }
      this.mountedPanels.set(panel, container);
      try {
        await panel.mount(container);
        if (this.destroyed || !container.isConnected) { return; }
        this.restoreDrafts(container);
        if (window.location.hash === `#${anchor}` && !container.closest('[hidden]')) {
          this.openLinkedDetails();
          const heading = container.querySelector('h2');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView?.({ block: 'start' });
        }
      } catch (error) { debugError('Account panel could not load:', error); }
    });
    if (this.activeSection === 'preferences') { this.loadPushStatus(); }
    return Promise.allSettled(mounts);
  }

  /** Checking notification setup must not delay someone opening their contact details. */
  async loadPushStatus() {
    if (!this.pushSupported || this.pushStatusLoaded) { return; }
    this.pushStatusLoaded = true;
    const toggle = document.getElementById('push-toggle');
    if (toggle) { toggle.disabled = true; }
    const enabled = await this.checkPushSubscription();
    if (this.destroyed) { return; }
    this.pushEnabled = enabled;
    const current = document.getElementById('push-toggle');
    if (current) { current.checked = enabled; current.disabled = false; }
    const status = document.getElementById('push-status-text');
    if (status) { status.textContent = translate(enabled ? 'push_enabled' : 'push_disabled'); }
  }

  /** Name changes update the identity and its shared guardian fields, without replacing unrelated drafts. */
  refreshIdentity() {
    if (this.destroyed) { return; }
    const fullName = this.userData?.full_name || '';
    document.querySelector('[data-account-name]')?.replaceChildren(document.createTextNode(fullName));
    const name = document.getElementById('fullname-input');
    if (name) { name.value = fullName; }
    const guardian = this.guardianProfile?.guardian;
    if (!guardian) { return; }
    const first = document.getElementById('guardian-first-name');
    const last = document.getElementById('guardian-last-name');
    if (first) { first.value = guardian.prenom || ''; }
    if (last) { last.value = guardian.nom || ''; }
  }

  /**
   * Render error message
   * @param {string} message - Error message to display
   */
  renderError(message) {
    const appContainer = document.getElementById('app');
    if (!appContainer || this.destroyed) { return; }
    setContent(appContainer, `${renderBackLink(isParent() ? '/parent-dashboard' : '/dashboard')}
      <section class="account-page"><h1>${escapeHTML(translate('account_info_title'))}</h1>
        <p role="alert">${escapeHTML(message)}</p>
        <button type="button" class="button button--primary" id="account-retry">${escapeHTML(translate('retry'))}</button>
      </section>`);
    document.getElementById('account-retry').addEventListener('click', () => this.init());
  }

  /**
   * Attach event listeners to forms and buttons
   */
  attachEventListeners() {
    document.getElementById('account-nickname-form')
      ?.addEventListener('submit', (event) => this.handleNicknameUpdate(event));

    // Full name form
    const fullnameForm = document.getElementById('fullname-form');
    if (fullnameForm) {
      fullnameForm.addEventListener('submit', (e) => this.handleFullNameUpdate(e));
    }

    // Email form
    const emailForm = document.getElementById('email-form');
    if (emailForm) {
      emailForm.addEventListener('submit', (e) => this.handleEmailUpdate(e));
    }

    // Guardian info form
    const guardianForm = document.getElementById('guardian-form');
    if (guardianForm) {
      guardianForm.addEventListener('submit', (e) => this.handleGuardianUpdate(e));
    }

    // Password form
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', (e) => this.handlePasswordChange(e));
    }

    // Language selector buttons
    const languageButtons = document.querySelectorAll('.language-option');
    languageButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleLanguageChange(e));
    });

    // Push notification toggle
    const pushToggle = document.getElementById('push-toggle');
    if (pushToggle) {
      pushToggle.addEventListener('change', (e) => this.handlePushToggle(e));
    }

    const timeFormatSelect = document.getElementById('time-format-select');
    if (timeFormatSelect) {
      timeFormatSelect.addEventListener('change', (e) => this.handleTimeFormatChange(e));
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }
  }

  /**
   * Handle guardian information update
   * @param {Event} event - Form submit event
   */
  async handleGuardianUpdate(event) {
    event.preventDefault();

    if (this.isLoading) {return;}

    const form = event.target;
    const submitButton = form.querySelector('#guardian-submit');

    const firstNameInput = form.querySelector('#guardian-first-name');
    const lastNameInput = form.querySelector('#guardian-last-name');
    const relationshipInput = form.querySelector('#guardian-relationship');
    const homePhoneInput = form.querySelector('#guardian-home-phone');
    const workPhoneInput = form.querySelector('#guardian-work-phone');
    const mobilePhoneInput = form.querySelector('#guardian-mobile-phone');
    const primaryCheckbox = form.querySelector('#guardian-primary');
    const emergencyCheckbox = form.querySelector('#guardian-emergency');

    const firstName = firstNameInput?.value.trim() || '';
    const lastName = lastNameInput?.value.trim() || '';
    const relationship = relationshipInput?.value.trim() || '';
    const homePhone = homePhoneInput?.value.trim() || '';
    const workPhone = workPhoneInput?.value.trim() || '';
    const mobilePhone = mobilePhoneInput?.value.trim() || '';
    const primaryContact = primaryCheckbox?.checked || false;
    const emergencyContact = emergencyCheckbox?.checked || false;

    if (!firstName || !lastName) {
      this.app.showMessage(translate('guardian_validation_error'), 'error');
      return;
    }

    const phonePattern = /^[0-9+().\-\s]{0,20}$/;
    const phoneValues = [homePhone, workPhone, mobilePhone].filter(Boolean);
    const hasInvalidPhone = phoneValues.some((phone) => !phonePattern.test(phone));

    if (hasInvalidPhone) {
      this.app.showMessage(translate('guardian_phone_invalid'), 'error');
      return;
    }


    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate('loading') || 'Loading...';

      const response = await makeApiRequest('v1/users/me/guardian-profile', {
        method: 'PATCH',
        body: {
          firstName,
          lastName,
          relationship,
          homePhone,
          workPhone,
          mobilePhone,
          primaryContact,
          emergencyContact,
        },
      });

      if (response.success) {
        this.guardianProfile = response.data || { guardian: null, participantIds: [] };
        // The guardian record names the account too, so both are reloaded.
        await Promise.all([this.loadGuardianProfile(), this.loadUserData()]);
        this.app.showMessage(translate('guardian_save_success'), 'success');
        this.refreshIdentity();
      } else {
        throw new Error(response.message || translate('guardian_save_error'));
      }
    } catch (error) {
      debugError('Error updating guardian info:', error);
      const errorMessage = typeof error.message === 'string' && error.message.toLowerCase().includes('no linked participants')
        ? translate('guardian_no_participants')
        : apiErrorMessage(error, 'guardian_save_error');
      this.app.showMessage(errorMessage, 'error');
    } finally {
      this.isLoading = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = translate('guardian_save');
      }
    }
  }

  /**
   * The leader's nickname (totem name), shown in place of their full name.
   * @returns {string} Form markup
   */
  renderNicknameForm() {
    return `
          <form id="account-nickname-form" class="account-form" novalidate>
            <div class="form-group">
              <label for="account-nickname-input">${translate('nickname')}</label>
              <input
                type="text"
                id="account-nickname-input"
                value="${escapeAttribute(this.userData?.nickname || '')}"
                maxlength="${NICKNAME_MAX_LENGTH}"
                autocomplete="nickname"
                aria-describedby="account-nickname-hint"
              />
              <p class="form-help" id="account-nickname-hint">${translate('nickname_leader_hint')}</p>
            </div>
            <button type="submit" class="button button--primary">${translate('nickname_save')}</button>
          </form>`;
  }

  /**
   * Save the nickname; an empty field clears it.
   * @param {SubmitEvent} event - Form submit event
   * @returns {Promise<void>}
   */
  async handleNicknameUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('#account-nickname-input');
    await withFormBusy(form, async () => {
      try {
        const response = await updateMyNickname(input.value.trim());
        this.userData.nickname = response?.data?.nickname ?? (input.value.trim() || null);
        this.app.showMessage(translate(response?.queued ? 'nickname_saved_offline' : 'nickname_saved'), response?.queued ? 'info' : 'success');
      } catch (error) {
        debugError('Error updating nickname:', error);
        this.app.showMessage(apiErrorMessage(error, 'nickname_save_failed'), 'error');
      }
    });
  }

  /**
   * Handle full name update
   * @param {Event} event - Form submit event
   */
  async handleFullNameUpdate(event) {
    event.preventDefault();

    if (this.isLoading) {return;}

    const form = event.target;
    const fullNameInput = form.querySelector('#fullname-input');
    const fullName = fullNameInput.value.trim();
    const submitButton = form.querySelector('#fullname-submit');

    // Validate input
    if (!fullName || fullName.length < 2) {
      this.app.showMessage(translate('account_info_fullname_error'), 'error');
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate('loading') || 'Loading...';

      debugLog('Updating full name:', fullName);

      const response = await makeApiRequest('v1/users/me/name', {
        method: 'PATCH',
        body: { fullName },
      });

      if (response.success) {
        this.app.showMessage(translate('success_profile_updated') || translate('account_info_fullname_success'), 'success');
        this.userData.full_name = response.data.full_name;
        if (this.holdsFamilyRole) {
          // A parent's guardian record carries the same name; show it changed.
          await this.loadGuardianProfile();
          this.refreshIdentity();
        }

        this.refreshIdentity();

        // Update stored user name if present
        const storedName = localStorage.getItem('userFullName');
        if (storedName) {
          localStorage.setItem('userFullName', response.data.full_name);
        }
      } else {
        throw new Error(response.message || translate('account_info_fullname_error'));
      }
    } catch (error) {
      debugError('Error updating full name:', error);
      this.app.showMessage(apiErrorMessage(error, 'account_info_fullname_error'), 'error');
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate('save_profile') || translate('account_info_fullname_button');
    }
  }

  /**
   * Handle email update
   * @param {Event} event - Form submit event
   */
  async handleEmailUpdate(event) {
    event.preventDefault();

    if (this.isLoading) {return;}

    const form = event.target;
    const emailInput = form.querySelector('#email-input');
    const email = emailInput.value.trim();
    const submitButton = form.querySelector('#email-submit');

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      this.app.showMessage(translate('error_email_invalid') || translate('account_info_email_invalid'), 'error');
      return;
    }

    // Confirm action since it will log them out
    if (!(await confirmDialog(translate('email_changed_logout_warning') || translate('account_info_email_warning')))) {
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate('loading') || 'Loading...';

      debugLog('Updating email:', email);

      const response = await makeApiRequest('v1/users/me/email', {
        method: 'PATCH',
        body: { email },
      });

      if (response.success) {
        this.app.showMessage(translate('account_info_email_success'), 'success');

        // Clear auth data and redirect to login after a short delay
        setTimeout(() => {
          localStorage.removeItem('jwtToken');
          localStorage.removeItem('userRole');
          localStorage.removeItem('userFullName');
          localStorage.removeItem('userId');
          window.location.href = '/login';
        }, 2000);
      } else {
        throw new Error(response.message || translate('account_info_email_error'));
      }
    } catch (error) {
      debugError('Error updating email:', error);
      const emailTaken = typeof error.message === 'string' && error.message.includes('already in use');
      this.app.showMessage(emailTaken ? translate('email_already_exists') : apiErrorMessage(error, 'account_info_email_error'), 'error');
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate('account_info_email_button');
    }
  }

  /**
   * Handle password change
   * @param {Event} event - Form submit event
   */
  async handlePasswordChange(event) {
    event.preventDefault();

    if (this.isLoading) {return;}

    const form = event.target;
    const currentPasswordInput = form.querySelector('#current-password-input');
    const newPasswordInput = form.querySelector('#new-password-input');
    const confirmPasswordInput = form.querySelector('#confirm-password-input');
    const submitButton = form.querySelector('#password-submit');

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    // Validate passwords
    if (!currentPassword || !newPassword || !confirmPassword) {
      this.app.showMessage(translate('error_password_required') || translate('account_info_password_error'), 'error');
      return;
    }

    if (newPassword.length < 8) {
      this.app.showMessage(translate('error_password_too_short') || translate('account_info_password_minlength'), 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      this.app.showMessage(translate('error_passwords_dont_match') || translate('account_info_password_mismatch'), 'error');
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate('loading') || 'Loading...';

      debugLog('Changing password');

      const response = await makeApiRequest('v1/users/me/password', {
        method: 'PATCH',
        body: {
          currentPassword,
          newPassword,
        },
      });

      if (response.success) {
        this.app.showMessage(translate('success_password_changed') || translate('account_info_password_success'), 'success');

        // Clear the form
        form.reset();
      } else {
        // Check for specific error messages
        if (response.message && response.message.includes('incorrect')) {
          throw new Error(translate('account_info_password_wrong_current'));
        }
        throw new Error(response.message || translate('account_info_password_error'));
      }
    } catch (error) {
      debugError('Error changing password:', error);
      const wrongCurrent = typeof error.message === 'string' && error.message.includes('incorrect');
      this.app.showMessage(wrongCurrent ? translate('account_info_password_wrong_current') : apiErrorMessage(error, 'account_info_password_error'), 'error');
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate('change_password') || translate('account_info_password_button');
    }
  }

  /**
   * Wait for the unit's settings when the app is still fetching them, so the
   * language picker offers the unit's optional languages. A failure leaves
   * French and English, which are always offered.
   *
   * @returns {Promise<void>}
   */
  async waitForUnitSettings() {
    if (this.app?.isOrganizationSettingsFetched || typeof this.app?.fetchOrganizationSettings !== 'function') {
      return;
    }
    try {
      await this.app.fetchOrganizationSettings();
    } catch (error) {
      debugWarn('Unit settings not loaded for the language picker:', error);
    }
  }

  /**
   * One button per language the unit offers, each named in its own language
   * so a reader finds theirs whatever the page's language.
   *
   * @param {string} currentLang - Language shown now
   * @returns {string} HTML
   */
  renderLanguageOptions(currentLang) {
    return this.app.getUnitLanguages().available.map((code) => {
      const active = code === currentLang;
      return `
        <button type="button" class="language-option ${active ? 'active' : ''}" data-lang="${code}"
                lang="${code}" aria-pressed="${active}">
          <span class="language-label">${escapeHTML(nativeLanguageName(code))}</span>
          ${active ? '<span class="checkmark" aria-hidden="true">✓</span>' : ''}
        </button>`;
    }).join('');
  }

  /**
   * Keep the account's language in step, so e-mails and notifications follow
   * the language chosen here. The interface has already switched; a failure
   * only leaves e-mails in the previous language.
   *
   * @param {string} lang - Language code
   * @returns {Promise<void>}
   */
  async saveLanguagePreference(lang) {
    // A demo account is read-only: the interface switches, nothing is saved.
    if (isDemoUser()) {
      return;
    }
    try {
      await makeApiRequest('v1/users/me/language-preference', {
        method: 'PATCH',
        body: { languagePreference: lang },
      });
    } catch (error) {
      debugWarn('Language preference not saved:', error);
    }
  }

  /**
   * Handle language change
   * @param {Event} event - Button click event
   */
  async handleLanguageChange(event) {
    event.preventDefault();

    const button = event.currentTarget;
    const newLang = button.dataset.lang;

    if (!newLang) {return;}

    try {
      debugLog('Changing language to:', newLang);

      // Update app language immediately
      await this.app.setLanguage(newLang);
      await this.saveLanguagePreference(this.app.lang);

      // Show success message
      this.app.showMessage(translate('account_info_language_success'), 'success');

      // Re-render to update UI
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error changing language:', error);
      this.app.showMessage(translate('account_info_language_error'), 'error');
    }
  }

  /**
   * Handle time format change
   * @param {Event} event - Select change event
   */
  handleTimeFormatChange(event) {
    const selected = event.target.value;
    const timeFormatKey = getStorageKey('TIME_FORMAT');
    const normalized = selected === '12h' ? '12h' : '24h';

    setStorage(timeFormatKey, normalized);
    this.app.showMessage(translate('data_saved'), 'success');

  }

  /**
   * Handle push notification toggle
   * @param {Event} event - Toggle change event
   */
  async handlePushToggle(event) {
    const enabled = event.target.checked;
    const statusText = document.getElementById('push-status-text');

    try {
      if (enabled) {
        // Request notification permission
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
          event.target.checked = false;
          this.app.showMessage(translate('notification_permission_denied'), 'error');
          return;
        }

        await enablePushNotifications();
        this.pushEnabled = true;

        if (statusText) {
          statusText.textContent = translate('push_enabled');
        }
        this.app.showMessage(translate('push_notifications_enabled'), 'success');
      } else {
        await disablePushNotifications();
        this.pushEnabled = false;

        if (statusText) {
          statusText.textContent = translate('push_disabled');
        }
        this.app.showMessage(translate('push_notifications_disabled'), 'success');
      }
    } catch (error) {
      debugError('Error toggling push notifications:', error);
      event.target.checked = !enabled; // Revert toggle state
      // Say why: push not set up on the server, refused by this browser, or
      // the API's own reason (offline, no permission)
      const message = error instanceof PushSetupError
        ? translate(error.code)
        : apiErrorMessage(error, 'push_notification_error');
      this.app.showMessage(message, 'error');
    }
  }

  /**
   * Handle logout
   */
  async handleLogout() {
    if (!(await confirmDialog(translate('confirm_logout_message') || translate('confirm_logout') || 'Are you sure you want to log out?'))) {
      return;
    }

    try {
      const { Login } = await import('./session/Login.js');
      await Login.logout();
      // Note: Login.logout() always redirects via window.location.href (never throws)
    } catch (error) {
      // Handle import failure
      debugError('Failed to load logout module:', error);
      window.location.href = '/login';
    }
  }
}
