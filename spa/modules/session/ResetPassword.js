import { translate } from '../../app.js';
import { debugLog, debugError, debugWarn, debugInfo } from '../../utils/DebugUtils.js';
import { getApiUrl } from '../../ajax-functions.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
/** Status the server answers with when a reset token is invalid or expired. */
const HTTP_BAD_REQUEST = 400;
/** How long the reset form waits to learn which account a link belongs to. */
const RESET_LINK_LOOKUP_TIMEOUT_MS = 8000;
/** How long the success message stays before the sign-in page opens. */
const REDIRECT_DELAY_MS = 2000;
/** The fields a password error is about. */
const PASSWORD_FIELDS = ['new-password', 'confirm-password'];

export class ResetPassword {
  constructor(app) {
    this.app = app;
    this.redirectTimer = null;
  }

  /** Called by the router when the person leaves: no redirect fires after that. */
  destroy() {
    clearTimeout(this.redirectTimer);
  }

  /**
	 * Render the page. With a token, the form is shown at once; the account the
	 * link belongs to is then looked up and its address added as the username,
	 * so password managers save the new password against it instead of guessing.
	 * That lookup is an enhancement: a slow or failed one never holds up the form.
	 *
	 * @param {string|null} token - Reset token from the emailed link
	 * @param {string|null} error - Translation key of an error to show
	 * @returns {Promise<void>} Settles once the address lookup is done
	 */
  async render(token = null, error = null) {
    this.renderPage(token, error);
    if (token) {
      await this.showLinkAccount(token);
    }
  }

  /**
	 * Replace the page content.
	 *
	 * @param {string|null} token - Reset token, or null for the email step
	 * @param {string|null} error - Translation key of an error to show
	 * @returns {void}
	 */
  renderPage(token, error) {
    const content = `
												${renderBackLink('/login')}
												<h1>${translate('reset_password')}</h1>
												<form id="reset-password-form">
																${token ? this.renderResetStep(token) : this.renderEmailStep()}
												</form>
												<div id="reset-status" class="success-message" role="status" aria-live="polite"></div>
												<div id="reset-error" class="error-message" role="alert">${error ? escapeHTML(translate(error)) : ''}</div>
								`;
    setContent(document.getElementById('app'), content);
    this.attachEventListeners();
  }

  /**
   * Show progress or success politely, and an error at once, clearing the other.
   *
   * @param {string} message - Text to show (set as text, never markup)
   * @param {boolean} [isError=false] - Whether it is an error
   * @returns {void}
   */
  showMessage(message, isError = false) {
    const status = document.getElementById('reset-status');
    const error = document.getElementById('reset-error');
    if (status) {
      status.textContent = isError ? '' : message;
    }
    if (error) {
      error.textContent = isError ? message : '';
    }
  }

  /**
   * Tie the error message to the password fields, or release them.
   *
   * @param {boolean} invalid - Whether the error is about the password
   * @returns {void}
   */
  markPasswordInvalid(invalid) {
    PASSWORD_FIELDS.forEach((id) => {
      const field = document.getElementById(id);
      if (!field) {
        return;
      }
      field.setAttribute('aria-invalid', String(invalid));
      if (invalid) {
        field.setAttribute('aria-describedby', 'reset-error');
      } else {
        field.removeAttribute('aria-describedby');
      }
    });
  }

  /**
	 * Add the link's account address to the reset form, or return to the email
	 * step if the link is no longer valid. Does nothing if the reader has already
	 * left this page by the time the answer arrives.
	 *
	 * @param {string} token - Reset token from the emailed link
	 * @returns {Promise<void>}
	 */
  async showLinkAccount(token) {
    const form = document.getElementById('reset-password-form');
    const link = await this.describeLink(token);
    if (!form?.isConnected || this.resetSubmitted) {
      return;
    }

    if (link.invalid) {
      this.renderPage(null, 'invalid_or_expired_token');
      return;
    }
    if (!link.email) {
      return;
    }

    const label = document.createElement('label');
    label.htmlFor = 'reset-email';
    label.textContent = `${translate('email')}:`;

    const input = document.createElement('input');
    input.type = 'email';
    input.id = 'reset-email';
    input.name = 'username';
    input.autocomplete = 'username';
    input.value = link.email;
    input.readOnly = true;

    const passwordLabel = form.querySelector('label[for="new-password"]');
    passwordLabel.before(label, input);
  }

  renderEmailStep() {
    return `
												<div id="email-step">
																<label for="email">${translate('email')}:</label>
																<input type="email" id="email" name="email" autocomplete="username" required>
																<button type="submit">${translate('send_reset_link')}</button>
												</div>
								`;
  }

  /**
	 * Look up the address a reset token belongs to.
	 *
	 * @param {string} token - Reset token from the emailed link
	 * @returns {Promise<{email: (string|null), invalid: boolean}>} The address, or
	 *   invalid when the server refused the token. A network failure or timeout is neither:
	 *   the reset can still be attempted without showing the address.
	 */
  async describeLink(token) {
    try {
      const response = await fetch(getApiUrl('v1/auth/reset-password/describe'), {
        method: 'POST',
        signal: AbortSignal.timeout(RESET_LINK_LOOKUP_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const result = await response.json();
      if (result.success) {
        return { email: result.data?.email || null, invalid: false };
      }
      return { email: null, invalid: response.status === HTTP_BAD_REQUEST };
    } catch (error) {
      debugError('Could not describe reset link:', error);
      return { email: null, invalid: false };
    }
  }

  renderResetStep(token) {
    return `
												<div id="reset-step">
																<input type="hidden" id="token" name="token" value="${escapeHTML(token)}" required>
																<label for="new-password">${translate('new_password')}:</label>
																<input type="password" id="new-password" name="new-password" autocomplete="new-password" required minlength="8" maxlength="255">
																<small class="password-hint">${translate('password_requirements')}</small>
																<label for="confirm-password">${translate('confirm_password')}:</label>
																<input type="password" id="confirm-password" name="confirm-password" autocomplete="new-password" required>
																<button type="submit">${translate('reset_password')}</button>
												</div>
								`;
  }

  attachEventListeners() {
    const form = document.getElementById('reset-password-form');
    form.addEventListener('submit', (e) => this.handleSubmit(e));
    // An error about the password clears as soon as either field changes.
    PASSWORD_FIELDS.forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.markPasswordInvalid(false);
        this.showMessage('');
      });
    });
  }

  async handleSubmit(e) {
    e.preventDefault();
    const submitButton = e.currentTarget.querySelector('button[type="submit"]');
    if (submitButton?.disabled) {return;}
    if (submitButton) {submitButton.disabled = true;}
    const token = document.getElementById('token')?.value;

    try {
      if (token) {
        // Handle password reset
        this.resetSubmitted = true;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (!newPassword || !confirmPassword) {
          this.showMessage(translate('please_fill_all_fields'), true);
          this.markPasswordInvalid(true);
          return;
        }

        if (newPassword !== confirmPassword) {
          this.showMessage(translate('passwords_do_not_match'), true);
          this.markPasswordInvalid(true);
          return;
        }

        // Client-side validation for better UX
        const validationError = this.validatePassword(newPassword);
        if (validationError) {
          this.showMessage(validationError, true);
          this.markPasswordInvalid(true);
          return;
        }
        this.markPasswordInvalid(false);

        try {
          const response = await fetch(getApiUrl('v1/auth/reset-password'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPassword })
          });

          const result = await response.json();
          debugLog('Server response:', result);

          if (result.success) {
            if (submitButton) {submitButton.dataset.completed = 'true';}
            this.showMessage(translate('password_reset_successful'));
            this.redirectTimer = setTimeout(() => this.app.router.navigate('/login'), REDIRECT_DELAY_MS);
          } else if (result.errors && result.errors.length > 0) {
            // Validation errors from the server are about the password.
            const errorMessages = [...new Set(result.errors.map(err => this.translateValidationError(err.msg)))].join('. ');
            this.showMessage(errorMessages, true);
            this.markPasswordInvalid(true);
          } else {
            this.showMessage(apiErrorMessage({ message: result.message, status: response.status }, 'error_resetting_password'), true);
          }
        } catch (error) {
          debugError('Error:', error);
          this.showMessage(translate('error_resetting_password'), true);
        }
      } else {
        // Handle email submission
        const email = document.getElementById('email').value;
        if (!email) {
          this.showMessage(translate('please_enter_email'), true);
          return;
        }
        try {
          const response = await fetch(getApiUrl('v1/auth/request-reset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const result = await response.json();
          if (result.success) {
            this.showMessage(translate('reset_link_sent'));
          } else {
            this.showMessage(apiErrorMessage({ message: result.message, status: response.status }, 'error_sending_reset_link'), true);
          }
        } catch (error) {
          debugError('Error:', error);
          this.showMessage(translate('error_sending_reset_link'), true);
        }
      }
    } finally {
      if (submitButton && submitButton.dataset.completed !== 'true') {
        submitButton.disabled = false;
      }
    }
  }

  validatePassword(password) {
    if (password.length < 8) {
      return translate('password_min_length');
    }
    if (password.length > 255) {
      return translate('password_max_length');
    }
    if (!/[A-Z]/.test(password)) {
      return translate('password_needs_uppercase');
    }
    if (!/[a-z]/.test(password)) {
      return translate('password_needs_lowercase');
    }
    if (!/[0-9]/.test(password)) {
      return translate('password_needs_number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return translate('password_needs_special');
    }
    return null;
  }

  translateValidationError(errorMsg) {
    const errorMap = {
      'Password must be between 8 and 255 characters': translate('password_min_length'),
      'Password must contain at least one uppercase letter': translate('password_needs_uppercase'),
      'Password must contain at least one lowercase letter': translate('password_needs_lowercase'),
      'Password must contain at least one number': translate('password_needs_number'),
      'Password must contain at least one special character': translate('password_needs_special')
    };
    // The server's own wording is English: an unknown rule gets the general message.
    return errorMap[errorMsg] || translate('error_resetting_password');
  }
}
