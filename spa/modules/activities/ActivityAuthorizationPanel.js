import { debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { getActivityAuthorizations, sendActivityAuthorizations } from '../../api/api-activity-authorizations.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { authorizationResultHTML } from './AuthorizationResult.js';

/** The persistent next action and sending result, above the activity description. */
export class ActivityAuthorizationPanel {
  constructor(app, root, activity, onChange) {
    this.app = app;
    this.root = root;
    this.activity = activity;
    this.onChange = onChange;
    this.destroyed = false;
    this.busy = false;
    this.result = null;
  }

  destroy() {this.destroyed = true;}

  async load() {
    setContent(this.root, `<p role="status">${escapeHTML(translate('loading'))}</p>`);
    try {
      this.result = await getActivityAuthorizations(this.activity.id);
      this.render();
    } catch (error) {
      if (this.destroyed || !this.root.isConnected) {return;}
      setContent(this.root, `<p role="alert">${escapeHTML(apiErrorMessage(error, 'authorization_result_failed'))}</p>
        <button type="button" class="button button--secondary" data-authorization-reload>${escapeHTML(translate('retry'))}</button>`);
      this.root.querySelector('[data-authorization-reload]').addEventListener('click', () => this.load());
    }
  }

  render() {
    if (this.destroyed || !this.root.isConnected || !this.result) {return;}
    const result = this.result;
    const canSend = hasPermission('activities.edit') && hasPermission('communications.send');
    const needsAction = result.to_create || result.unsent || result.failed || result.missing.length;
    const action = result.to_create ? 'authorization_create_send' : result.failed ? 'authorization_retry_failed' : 'authorization_send';
    setContent(this.root, `<h2>${escapeHTML(translate('activity_permission_slip_section'))}</h2>
      <div data-authorization-result tabindex="-1" role="status">${authorizationResultHTML(result, this.app.lang)}</div>
      ${needsAction && canSend ? `<button type="button" class="button button--primary" data-authorization-send>${escapeHTML(translate(action))}</button>` : ''}
      ${needsAction && !canSend ? `<p>${escapeHTML(translate('authorization_sender_required'))}</p>` : ''}
      ${result.unknown ? `<button type="button" class="button button--secondary" data-authorization-reload>${escapeHTML(translate('authorization_check_status'))}</button>` : ''}
      <p>${escapeHTML(translate('authorization_responses'))}: ${result.signed} / ${result.participants} ${escapeHTML(translate('signed'))}, ${result.declined} ${escapeHTML(translate('permission_slip_status_declined'))}, ${result.pending} ${escapeHTML(translate('pending'))}</p>`);
    this.root.querySelector('[data-authorization-send]')?.addEventListener('click', () => this.send());
    this.root.querySelector('[data-authorization-reload]')?.addEventListener('click', () => this.load());
  }

  async send() {
    if (this.busy) {return;}
    this.busy = true;
    const button = this.root.querySelector('[data-authorization-send]');
    button.disabled = true;
    this.root.setAttribute('aria-busy', 'true');
    const feedback = this.root.querySelector('[data-authorization-result]');
    setContent(feedback, escapeHTML(translate('authorization_sending')));
    try {
      this.result = await sendActivityAuthorizations(this.activity.id, this.activity.authorization_deadline_date);
      this.render();
    } catch (error) {
      if (this.destroyed || !this.root.isConnected) {return;}
      // Re-check the durable result before allowing a retry after a lost response.
      setContent(feedback, `${escapeHTML(error.code === 'operation_unconfirmed' ? translate('authorization_saved_send_unconfirmed') : apiErrorMessage(error, 'authorization_unconfirmed'))}
        <p>${escapeHTML(translate('authorization_uncertain_help'))}</p>
        <button type="button" class="button button--secondary" data-authorization-reload>${escapeHTML(translate('authorization_check_status'))}</button>`);
      this.root.querySelector('[data-authorization-reload]')?.addEventListener('click', () => this.load());
    } finally {
      this.busy = false;
      if (!this.destroyed && this.root.isConnected) {
        this.root.removeAttribute('aria-busy');
        const result = this.root.querySelector('[data-authorization-result]');
        result?.focus();
        result?.scrollIntoView?.({ block: 'center' });
        try {await this.onChange?.();}
        catch (error) {debugError('Authorization list refresh failed', error);}
      }
    }
  }
}
