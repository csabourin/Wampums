/**
 * The profile-and-password fields a new parent fills in when an emailed link
 * creates their account.
 *
 * Two pages use it — completing an admin's invitation, and accepting another
 * parent's family-link request — and they must ask the same questions and
 * apply the same rules, or a parent would be told a password was fine on one
 * page and refused on the other.
 *
 * The address is shown but never editable. It is the invitation's identity,
 * and the server takes it from the stored invitation rather than from the form;
 * the disabled field is there so the reader can see which address they are
 * claiming, not as the thing that enforces it.
 *
 * @module spa/modules/family-access/AccountFields
 */

import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';

/** Password bounds, matching the server's registration rules. */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 255;

/**
 * Render the fields.
 *
 * @param {Object} options - What to show
 * @param {string} options.email - The locked address
 * @param {Object} [options.prefill] - Values an admin supplied, to confirm or correct
 * @param {boolean} [options.askNames] - Ask for first and last name
 * @param {boolean} [options.askPhones] - Ask for the two phone numbers
 * @returns {string} Form fields HTML
 */
export function renderAccountFields({ email, prefill = {}, askNames = true, askPhones = true }) {
  const value = (field) => escapeHTML(prefill[field] || '');

  return `
    <div class="form-group">
      <label for="account-email">${translate('email')}</label>
      <input type="email" id="account-email" value="${escapeHTML(email || '')}" disabled aria-describedby="account-email-hint" />
      <p id="account-email-hint" class="form-hint">${translate('account_email_locked_hint')}</p>
    </div>
    ${askNames ? `
      <div class="form-group">
        <label for="account-first-name">${translate('first_name')}</label>
        <input type="text" id="account-first-name" name="first_name" autocomplete="given-name" maxlength="255" required value="${value('first_name')}" />
      </div>
      <div class="form-group">
        <label for="account-last-name">${translate('last_name')}</label>
        <input type="text" id="account-last-name" name="last_name" autocomplete="family-name" maxlength="255" required value="${value('last_name')}" />
      </div>
    ` : ''}
    ${askPhones ? `
      <div class="form-group">
        <label for="account-phone-cell">${translate('telephone_cellulaire')}</label>
        <input type="tel" id="account-phone-cell" name="telephone_cellulaire" autocomplete="tel" maxlength="20" value="${value('telephone_cellulaire')}" />
      </div>
      <div class="form-group">
        <label for="account-phone-home">${translate('telephone_residence')}</label>
        <input type="tel" id="account-phone-home" name="telephone_residence" autocomplete="tel" maxlength="20" value="${value('telephone_residence')}" />
      </div>
    ` : ''}
    <div class="form-group">
      <label for="account-password">${translate('password')}</label>
      <input type="password" id="account-password" name="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required aria-describedby="account-password-hint" />
      <p id="account-password-hint" class="form-hint">${translate('account_password_rules')}</p>
    </div>
    <div class="form-group">
      <label for="account-password-confirm">${translate('confirm_password')}</label>
      <input type="password" id="account-password-confirm" autocomplete="new-password" maxlength="${PASSWORD_MAX_LENGTH}" required />
    </div>
  `;
}

/**
 * Read the fields back.
 *
 * @param {ParentNode} root - Element containing the fields
 * @returns {Object} Trimmed values; empty optional fields come back as null
 */
export function readAccountFields(root) {
  const read = (id) => {
    const input = root.querySelector(`#${id}`);
    return input ? input.value.trim() : '';
  };
  const optional = (id) => read(id) || null;

  return {
    first_name: optional('account-first-name'),
    last_name: optional('account-last-name'),
    telephone_cellulaire: optional('account-phone-cell'),
    telephone_residence: optional('account-phone-home'),
    // Not trimmed: a password is exactly what was typed.
    password: root.querySelector('#account-password')?.value || '',
    password_confirm: root.querySelector('#account-password-confirm')?.value || '',
  };
}

/**
 * Check a password against the server's rules, so the reader hears about a
 * problem before submitting rather than after.
 *
 * "Special character" means anything that is not a letter or digit, which is
 * what the server enforces. A narrower list here would refuse passwords the
 * server accepts.
 *
 * @param {string} password - Candidate password
 * @returns {string|null} Translation key of the first failed rule, or null
 */
export function passwordProblem(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_min_length';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_max_length';
  if (!/[A-Z]/.test(password)) return 'password_needs_uppercase';
  if (!/[a-z]/.test(password)) return 'password_needs_lowercase';
  if (!/[0-9]/.test(password)) return 'password_needs_number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'password_needs_special';
  return null;
}

/**
 * Check everything a new account needs.
 *
 * @param {Object} values - From {@link readAccountFields}
 * @param {Object} [options] - Which fields were asked
 * @param {boolean} [options.askNames] - Names were asked, so they are required
 * @returns {string|null} Translation key of the first problem, or null
 */
export function accountProblem(values, { askNames = true } = {}) {
  if (askNames && (!values.first_name || !values.last_name)) {
    return 'account_name_required';
  }
  const password = passwordProblem(values.password);
  if (password) return password;
  if (values.password !== values.password_confirm) return 'passwords_do_not_match';
  return null;
}
