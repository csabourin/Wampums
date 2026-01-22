// Permission Slip Signing Page
// Allows parents/guardians to view and sign permission slips via email link

import { translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { getPublicPermissionSlip, signPublicPermissionSlip } from './api/api-endpoints.js';
import { CONFIG } from './config.js';
import { setContent } from "./utils/DOMUtils.js";

export class PermissionSlipSign {
  constructor(app, token) {
    this.app = app;
    this.token = token;
    this.slip = null;
  }

  getLocale() {
    const lang = this.app?.lang || localStorage.getItem('lang') || localStorage.getItem('language') || CONFIG.DEFAULT_LANG;
    if (lang === 'en') return 'en-CA';
    if (lang === 'uk') return 'uk-UA';
    return 'fr-CA';
  }

  async init() {
    debugLog('PermissionSlipSign init with token:', this.token);
    await this.loadPermissionSlip();
    this.render();
    this.attachEventListeners();
  }

  async loadPermissionSlip() {
    try {
      // Public endpoint to view permission slip - no auth required (uses token)
      const data = await getPublicPermissionSlip(this.token);

      if (!data.success) {
        throw new Error(data.message || 'Failed to load permission slip');
      }

      this.slip = data.data;
      debugLog('Permission slip loaded:', this.slip);
    } catch (error) {
      debugError('Error loading permission slip:', error);
      this.showError(error.message);
    }
  }

  render() {
    const appDiv = document.getElementById('app');

    if (!this.slip) {
      setContent(appDiv, `
        <div class="container mt-5">
          <div class="alert alert-danger">
            <h4>${translate('error')}</h4>
            <p>${translate('permission_slip_not_found')}</p>
          </div>
        </div>
      `);
      return;
    }

    const locale = this.getLocale();
    const activityDate = new Date(this.slip.meeting_date).toLocaleDateString(locale);
    const deadlineDate = this.slip.deadline_date
      ? new Date(this.slip.deadline_date).toLocaleDateString(locale)
      : null;

    const isSigned = this.slip.status === 'signed';
    const canSign = this.slip.status === 'pending' && (!this.slip.deadline_date || new Date(this.slip.deadline_date) > new Date());

    setContent(appDiv, `
      <div class="container mt-5">
        <div class="card">
          <div class="card-header bg-primary text-white">
            <h3>${translate('permission_slip_title')}</h3>
          </div>
          <div class="card-body">
            <h4>${this.slip.activity_title || translate('activity')}</h4>

            <div class="mb-3">
              <strong>${translate('activity_date_label')}:</strong> ${activityDate}
            </div>

            ${this.slip.activity_description ? `
              <div class="mb-3">
                <strong>${translate('activity_description_label')}:</strong>
                <div class="mt-2">${this.slip.activity_description}</div>
              </div>
            ` : ''}

            ${deadlineDate ? `
              <div class="mb-3">
                <strong>${translate('deadline_date')}:</strong> ${deadlineDate}
              </div>
            ` : ''}

            <div class="mb-3">
              <strong>${translate('participant')}:</strong> ${this.slip.participant_name}
            </div>

            ${isSigned ? `
              <div class="alert alert-success">
                <i class="fas fa-check-circle"></i> ${translate('already_signed')}
                <br>
                <small>${translate('signed_on')}: ${new Date(this.slip.signed_at).toLocaleString(locale)}</small>
                ${this.slip.signed_by ? `<br><small>${translate('signed_by')}: ${this.slip.signed_by}</small>` : ''}
              </div>
            ` : canSign ? `
              <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i> ${translate('signature_required')}
              </div>

              <div class="form-group mb-3">
                <label for="guardian-name">${translate('your_name')}:</label>
                <input type="text" class="form-control" id="guardian-name" required>
              </div>

              <div class="form-check mb-3">
                <input type="checkbox" class="form-check-input" id="consent-checkbox" required>
                <label class="form-check-label" for="consent-checkbox">
                  ${translate('permission_consent_text')}
                </label>
              </div>

              <button class="btn btn-success btn-lg" id="sign-btn" disabled>
                <i class="fas fa-signature"></i> ${translate('sign_permission_slip')}
              </button>
            ` : `
              <div class="alert alert-danger">
                <i class="fas fa-times-circle"></i> ${translate('deadline_passed')}
              </div>
            `}
          </div>
        </div>
      </div>
    `);
  }

  attachEventListeners() {
    const signBtn = document.getElementById('sign-btn');
    const guardianNameInput = document.getElementById('guardian-name');
    const consentCheckbox = document.getElementById('consent-checkbox');

    if (!signBtn) return;

    // Enable sign button only when both name and checkbox are filled
    const checkForm = () => {
      const isValid = guardianNameInput.value.trim() && consentCheckbox.checked;
      signBtn.disabled = !isValid;
    };

    guardianNameInput?.addEventListener('input', checkForm);
    consentCheckbox?.addEventListener('change', checkForm);

    signBtn.addEventListener('click', async () => {
      await this.signPermissionSlip();
    });
  }

  async signPermissionSlip() {
    const guardianName = document.getElementById('guardian-name').value.trim();
    const signBtn = document.getElementById('sign-btn');

    if (!guardianName) {
      alert(translate('please_enter_name'));
      return;
    }

    signBtn.disabled = true;
    setContent(signBtn, '<span class="spinner-border spinner-border-sm"></span> ' + translate('signing'));
    try {
      const response = await signPublicPermissionSlip(this.token, {
        signed_by: guardianName,
        signed_at: new Date().toISOString()
      });

      if (response.success) {
        // Show immediate success feedback
        this.showSuccessMessage(guardianName);
      } else {
        throw new Error(response.message || 'Failed to sign');
      }
    } catch (error) {
      debugError('Error signing permission slip:', error);
      alert(translate('error_signing_slip'));
      signBtn.disabled = false;
      setContent(signBtn, '<i class="fas fa-signature"></i> ' + translate('sign_permission_slip'));
    }
  }

  showSuccessMessage(guardianName) {
    const appDiv = document.getElementById('app');
    const locale = this.getLocale();
    const activityDate = new Date(this.slip.meeting_date).toLocaleDateString(locale);

    setContent(appDiv, `
      <div class="container mt-5">
        <div class="card">
          <div class="card-header bg-success text-white">
            <h3><i class="fas fa-check-circle"></i> ${translate('permission_slip_title')}</h3>
          </div>
          <div class="card-body">
            <div class="alert alert-success text-center" style="font-size: 1.1rem;">
              <h4 style="color: #0f7a5a; margin-bottom: 1rem;">
                <i class="fas fa-check-circle" style="font-size: 2rem;"></i>
              </h4>
              <p style="font-size: 1.2rem; font-weight: 600; margin-bottom: 1rem;">
                ${translate('signature_registered_success')}
              </p>
              <p style="margin-bottom: 0;">
                ${translate('thank_you_signature')}
              </p>
            </div>

            <div class="mt-4">
              <h5>${this.slip.activity_title || translate('activity')}</h5>
              <div class="mb-2">
                <strong>${translate('activity_date_label')}:</strong> ${activityDate}
              </div>
              <div class="mb-2">
                <strong>${translate('participant')}:</strong> ${this.slip.participant_name}
              </div>
              <div class="mb-2">
                <strong>${translate('signed_by')}:</strong> ${guardianName}
              </div>
              <div class="mb-2">
                <strong>${translate('signed_on')}:</strong> ${new Date().toLocaleString(locale)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  showError(message) {
    const appDiv = document.getElementById('app');
    setContent(appDiv, `
      <div class="container mt-5">
        <div class="alert alert-danger">
          <h4>${translate('error')}</h4>
          <p>${message}</p>
        </div>
      </div>
    `);
  }
}
