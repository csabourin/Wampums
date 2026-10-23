// Permission Slip Signing Page
// Allows parents/guardians to view and sign permission slips via email link

import { translate } from '../../app.js';
import { debugError } from '../../utils/DebugUtils.js';
import {
  declinePublicPermissionSlip,
  getPublicPermissionSlip,
  signPublicPermissionSlip,
} from '../../api/api-endpoints.js';
import { CONFIG } from '../../config.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { buildNotFoundMarkup } from '../../utils/NotFoundUtils.js';
import { formatDateShort, getTodayISO } from '../../utils/DateUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { confirm as confirmDialog } from '../../utils/DialogUtils.js';
import { richTextOrPlain } from '../../utils/RichTextUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
/** Answers meaning the link names no slip (or no longer does). */
const NOT_FOUND_STATUSES = new Set([HTTP_NOT_FOUND, HTTP_GONE]);
/** Length of the date part of an ISO timestamp (YYYY-MM-DD). */
const ISO_DATE_LENGTH = 10;

export class PermissionSlipSign {
  constructor(app, token) {
    this.app = app;
    this.token = token;
    this.slip = null;
    this.loadError = null;
    this.destroyed = false;
  }

  /** Called by the router when the person leaves: a late answer draws nothing. */
  destroy() {
    this.destroyed = true;
  }

  getLocale() {
    const lang = this.app?.lang || localStorage.getItem('lang') || localStorage.getItem('language') || CONFIG.DEFAULT_LANG;
    return localeForLanguage(lang);
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('permission_slip_title'), className: 'permission-slip-sign' };
  }

  async init() {
    showPageLoading(document.getElementById('app'), this.pageOptions());
    await this.loadPermissionSlip();
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  async loadPermissionSlip() {
    try {
      // Public endpoint to view permission slip - no auth required (uses token)
      const data = await getPublicPermissionSlip(this.token);

      if (!data?.success) {
        throw Object.assign(new Error('permission_slip_not_found'), { status: data?.status ?? HTTP_NOT_FOUND });
      }

      this.slip = data.data;
      this.loadError = null;
    } catch (error) {
      debugError('Error loading permission slip:', error?.status);
      this.loadError = error;
      this.slip = null;
    }
  }

  render() {
    const appDiv = document.getElementById('app');

    if (!this.slip) {
      // Only an answer that the slip does not exist says so; anything else
      // (offline, server down) is an error the person can retry.
      if (this.loadError && !NOT_FOUND_STATUSES.has(this.loadError.status)) {
        showPageError(appDiv, {
          ...this.pageOptions(),
          message: apiErrorMessage(this.loadError, 'permission_slip_load_failed'),
        }, () => this.init());
        return;
      }
      setContent(appDiv, buildNotFoundMarkup({
        messageKey: 'permission_slip_not_found',
        resourceLabel: translate('permission_slip_title')
      }));
      return;
    }

    const locale = this.getLocale();
    const activityDate = escapeHTML(formatDateShort(this.slip.meeting_date, locale));
    const deadlineDate = this.slip.deadline_date
      ? escapeHTML(formatDateShort(this.slip.deadline_date, locale))
      : null;

    const isSigned = this.slip.status === 'signed';
    const isDeclined = this.slip.status === 'declined';
    const canSign = this.slip.status === 'pending' &&
      (!this.slip.deadline_date || this.slip.deadline_date.substring(0, ISO_DATE_LENGTH) >= getTodayISO());
    const activityTitle = escapeHTML(this.slip.activity_title || translate('activity'));
    const activityDescription = richTextOrPlain(this.slip.activity_description_html, this.slip.activity_description);
    const participantName = escapeHTML(this.slip.participant_name || '');

    setContent(appDiv, `
      <section class="page permission-slip-sign">
        ${renderBackLink()}
        <h1>${translate('permission_slip_title')}</h1>
        <div class="card">
          <div class="card-body">
            <h2>${activityTitle}</h2>

            <div class="mb-3">
              <strong>${translate('activity_date_label')}:</strong> ${activityDate}
            </div>

            ${this.slip.activity_description ? `
              <div class="mb-3">
                <strong>${translate('activity_description_label')}:</strong>
                <div class="mt-2 rich-text">${activityDescription}</div>
              </div>
            ` : ''}

            ${this.slip.authorization_text ? `
              <div class="mb-3 permission-slip-authorization">
                <strong>${translate('activity_authorization_text_label')}:</strong>
                <div class="mt-2 permission-slip-authorization__text">${escapeHTML(this.slip.authorization_text)}</div>
              </div>
            ` : ''}

            ${deadlineDate ? `
              <div class="mb-3">
                <strong>${translate('deadline_date')}:</strong> ${deadlineDate}
              </div>
            ` : ''}

            <div class="mb-3">
              <strong>${translate('participant')}:</strong> ${participantName}
            </div>

            ${isSigned ? `
              <div class="alert alert-success">
                <i class="fas fa-check-circle" aria-hidden="true"></i> ${translate('already_signed')}
                <br>
                <small>${translate('signed_on')}: ${escapeHTML(new Date(this.slip.signed_at).toLocaleString(locale))}</small>
                ${this.slip.signed_by ? `<br><small>${translate('signed_by')}: ${escapeHTML(this.slip.signed_by)}</small>` : ''}
              </div>
            ` : isDeclined ? `
              <div class="alert alert-danger">
                <i class="fas fa-times-circle" aria-hidden="true"></i> ${translate('permission_slip_declined')}
                ${this.slip.declined_at ? `<br><small>${translate('permission_slip_declined_at')}: ${escapeHTML(new Date(this.slip.declined_at).toLocaleString(locale))}</small>` : ''}
                ${this.slip.declined_by ? `<br><small>${translate('permission_slip_declined_by')}: ${escapeHTML(this.slip.declined_by)}</small>` : ''}
              </div>
            ` : canSign ? `
              <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle" aria-hidden="true"></i> ${translate('permission_slip_response_required')}
              </div>

              <div class="form-group mb-3">
                <label for="guardian-name">${translate('your_name')}</label>
                <input type="text" class="form-control" id="guardian-name" autocomplete="name" required>
              </div>

              <div class="form-group form-group--single-checkbox mb-3">
                <input type="checkbox" id="consent-checkbox" required>
                <label for="consent-checkbox">${translate('permission_consent_text')}</label>
              </div>

              <div class="permission-slip-response-actions">
                <button type="button" class="button button--primary button--large" id="sign-btn" disabled>
                  <i class="fas fa-signature" aria-hidden="true"></i> ${translate('sign_permission_slip')}
                </button>
                <button type="button" class="button button--danger button--large" id="decline-btn" disabled>
                  <i class="fas fa-times-circle" aria-hidden="true"></i> ${translate('permission_slip_decline')}
                </button>
              </div>
            ` : `
              <div class="alert alert-danger">
                <i class="fas fa-times-circle" aria-hidden="true"></i> ${translate('deadline_passed')}
              </div>
            `}
          </div>
        </div>
      </section>
    `);
  }

  attachEventListeners() {
    const signBtn = document.getElementById('sign-btn');
    const guardianNameInput = document.getElementById('guardian-name');
    const consentCheckbox = document.getElementById('consent-checkbox');
    const declineBtn = document.getElementById('decline-btn');

    if (!signBtn) {return;}

    // Signing requires consent; declining requires only the guardian's name.
    const checkForm = () => {
      const hasName = Boolean(guardianNameInput.value.trim());
      signBtn.disabled = !(hasName && consentCheckbox.checked);
      if (declineBtn) {declineBtn.disabled = !hasName;}
    };

    guardianNameInput?.addEventListener('input', checkForm);
    consentCheckbox?.addEventListener('change', checkForm);

    signBtn.addEventListener('click', async () => {
      await this.signPermissionSlip();
    });
    declineBtn?.addEventListener('click', async () => {
      await this.declinePermissionSlip();
    });
  }

  async signPermissionSlip() {
    const guardianName = document.getElementById('guardian-name').value.trim();
    const signBtn = document.getElementById('sign-btn');

    if (!guardianName) {
      this.app.showMessage(translate('please_enter_name'), 'error');
      return;
    }

    signBtn.disabled = true;
    setContent(signBtn, `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> ${translate('signing')}`);
    try {
      const response = await signPublicPermissionSlip(this.token, {
        signed_by: guardianName,
      });

      if (!response?.success) {
        throw Object.assign(new Error('permission_slip_not_signed'), { status: response?.status });
      }
    } catch (error) {
      debugError('Error signing permission slip:', error?.status);
      this.app.showMessage(apiErrorMessage(error, 'error_signing_slip'), 'error');
      signBtn.disabled = false;
      setContent(signBtn, `<i class="fas fa-signature" aria-hidden="true"></i> ${translate('sign_permission_slip')}`);
      return;
    }
    this.showSuccessMessage(guardianName);
  }

  async declinePermissionSlip() {
    const guardianName = document.getElementById('guardian-name')?.value.trim();
    const declineBtn = document.getElementById('decline-btn');

    if (!guardianName || !declineBtn) {
      this.app.showMessage(translate('please_enter_name'), 'error');
      return;
    }
    if (!(await confirmDialog(translate('permission_slip_decline_confirm')))) {
      return;
    }

    declineBtn.disabled = true;
    setContent(
      declineBtn,
      `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> ${escapeHTML(translate('permission_slip_decline'))}`,
    );
    try {
      const response = await declinePublicPermissionSlip(this.token, {
        declined_by: guardianName,
      });
      if (!response?.success) {
        throw Object.assign(new Error('permission_slip_not_declined'), { status: response?.status });
      }

      this.slip = response.data?.permission_slip || {
        ...this.slip,
        status: 'declined',
        declined_by: guardianName,
        declined_at: new Date().toISOString(),
      };
      this.app.showMessage(translate('permission_slip_declined'), 'success');
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error declining permission slip:', error?.status);
      this.app.showMessage(apiErrorMessage(error, 'permission_slip_error_declining'), 'error');
      declineBtn.disabled = false;
      setContent(
        declineBtn,
        `<i class="fas fa-times-circle" aria-hidden="true"></i> ${escapeHTML(translate('permission_slip_decline'))}`,
      );
    }
  }

  showSuccessMessage(guardianName) {
    const appDiv = document.getElementById('app');
    const locale = this.getLocale();
    const activityDate = formatDateShort(this.slip.meeting_date, locale);

    setContent(appDiv, `
      <section class="page permission-slip-sign">
        ${renderBackLink()}
        <h1>${translate('permission_slip_title')}</h1>
        <div class="card">
          <div class="card-body">
            <div class="alert alert-success text-center" role="status">
              <p><strong>${translate('signature_registered_success')}</strong></p>
              <p>${translate('thank_you_signature')}</p>
            </div>

            <h2>${escapeHTML(this.slip.activity_title || translate('activity'))}</h2>
            <div class="mb-2">
              <strong>${translate('activity_date_label')}:</strong> ${escapeHTML(activityDate)}
            </div>
            <div class="mb-2">
              <strong>${translate('participant')}:</strong> ${escapeHTML(this.slip.participant_name || '')}
            </div>
            <div class="mb-2">
              <strong>${translate('signed_by')}:</strong> ${escapeHTML(guardianName)}
            </div>
            <div class="mb-2">
              <strong>${translate('signed_on')}:</strong> ${escapeHTML(new Date().toLocaleString(locale))}
            </div>
          </div>
        </div>
      </section>
    `);
  }
}
