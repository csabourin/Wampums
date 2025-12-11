// Permission Slip Signing Page
// Allows parents/guardians to view and sign permission slips via email link

import { translate } from './utils/Translator.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { API } from './api/api-core.js';

export class PermissionSlipSign {
  constructor(app, slipId) {
    this.app = app;
    this.slipId = slipId;
    this.slip = null;
  }

  async init() {
    debugLog('PermissionSlipSign init with ID:', this.slipId);
    await this.loadPermissionSlip();
    this.render();
    this.attachEventListeners();
  }

  async loadPermissionSlip() {
    try {
      // Public endpoint to view permission slip - no auth required
      const response = await fetch(`/api/v1/resources/permission-slips/${this.slipId}/view`);
      const data = await response.json();

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
      appDiv.innerHTML = `
        <div class="container mt-5">
          <div class="alert alert-danger">
            <h4>${translate('error')}</h4>
            <p>${translate('permission_slip_not_found')}</p>
          </div>
        </div>
      `;
      return;
    }

    const activityDate = new Date(this.slip.meeting_date).toLocaleDateString('fr-CA');
    const deadlineDate = this.slip.deadline_date
      ? new Date(this.slip.deadline_date).toLocaleDateString('fr-CA')
      : null;

    const isSigned = this.slip.status === 'signed';
    const canSign = this.slip.status === 'pending' && (!this.slip.deadline_date || new Date(this.slip.deadline_date) > new Date());

    appDiv.innerHTML = `
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
                <small>${translate('signed_on')}: ${new Date(this.slip.signed_at).toLocaleString('fr-CA')}</small>
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
    `;
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
    signBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ' + translate('signing');

    try {
      const response = await API.patch(`v1/resources/permission-slips/${this.slipId}/sign`, {
        signed_by: guardianName,
        signed_at: new Date().toISOString()
      });

      if (response.success) {
        // Reload to show success state
        await this.loadPermissionSlip();
        this.render();
      } else {
        throw new Error(response.message || 'Failed to sign');
      }
    } catch (error) {
      debugError('Error signing permission slip:', error);
      alert(translate('error_signing_slip'));
      signBtn.disabled = false;
      signBtn.innerHTML = '<i class="fas fa-signature"></i> ' + translate('sign_permission_slip');
    }
  }

  showError(message) {
    const appDiv = document.getElementById('app');
    appDiv.innerHTML = `
      <div class="container mt-5">
        <div class="alert alert-danger">
          <h4>${translate('error')}</h4>
          <p>${message}</p>
        </div>
      </div>
    `;
  }
}
