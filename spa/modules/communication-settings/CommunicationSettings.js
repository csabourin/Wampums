/**
 * Communication settings — WhatsApp connection and Google Chat setup.
 *
 * @module spa/modules/communication-settings/CommunicationSettings
 */
import { BaseModule } from '../../utils/BaseModule.js';
import { translate } from '../../app.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import {
  getGoogleChatConfig,
  getGoogleChatSpaces,
  saveGoogleChatCredentials,
  saveGoogleChatSpace,
  sendGoogleChatTestMessage,
} from '../../api/api-google-chat.js';
import { WhatsAppConnectionModule } from '../whatsapp-connection.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { canSendCommunications, canAccessAdminPanel } from '../../utils/PermissionUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

/** Where this page is reached from, and returns to. */
const BACK_HREF = '/unit-settings';

export class CommunicationSettings extends BaseModule {
  constructor(app) {
    super(app);
    this.whatsappModule = new WhatsAppConnectionModule(app);
    this.googleChatConfig = null;
    this.googleChatSpaces = [];
    this.spacesFailed = false;
    this.configError = null;
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('communications_title'), className: 'communications-page', backHref: BACK_HREF };
  }

  async init() {
    const container = document.getElementById('app');
    showPageLoading(container, this.pageOptions());

    try {
      await this.whatsappModule.init();
      await this.loadGoogleChatData();
    } catch (error) {
      debugError('Error loading communication settings:', error);
      if (!this.isDestroyed) {
        showPageError(container, {
          ...this.pageOptions(),
          message: apiErrorMessage(error, 'error_loading_data'),
        }, () => this.init());
      }
      return;
    }
    this.refresh();
  }

  /** Draw the page and wire its forms. */
  refresh() {
    if (this.isDestroyed) {
      return;
    }
    this.render();
    this.whatsappModule.attachEventListeners();
    this.attachGoogleChatListeners();
  }

  /**
   * Load the Google Chat setup. A failure only fails the Google Chat part
   * (WhatsApp stays usable): its status says why, with a retry, instead of
   * claiming Chat is not set up.
   *
   * @returns {Promise<void>}
   */
  async loadGoogleChatData() {
    const [configResponse, spacesResponse] = await Promise.all([
      getGoogleChatConfig().catch((error) => {
        debugError('Error loading Google Chat configuration:', error?.status);
        return { error };
      }),
      getGoogleChatSpaces().catch((error) => {
        debugError('Error loading Google Chat spaces:', error?.status);
        return null;
      }),
    ]);

    this.configError = configResponse?.error
      || (configResponse?.success ? null : new Error('google_chat_config_unavailable'));
    this.googleChatConfig = configResponse?.data?.configured ? configResponse.data.config || null : null;
    this.spacesFailed = !spacesResponse?.success;
    this.googleChatSpaces = Array.isArray(spacesResponse?.data) ? spacesResponse.data : [];
  }

  render() {
    const container = document.getElementById('app');

    const hasCommsAccess = canSendCommunications() || canAccessAdminPanel();
    const whatsappSection = this.whatsappModule.connectionStatus
      ? this.whatsappModule.render()
      : `<p class="muted-text" role="status">${translate('loading')}</p>`;

    const googleChatSection = hasCommsAccess
      ? this.renderGoogleChatSection()
      : `<div class="info-box">${translate('communications_permissions_error')}</div>`;

    setContent(
      container,
      `
      <section class="page communications-page">
        ${renderBackLink(BACK_HREF)}
        <h1>${translate('communications_title')}</h1>
        <p class="page-description">${translate('communications_description')}</p>

        <div class="card-grid">
          <div class="card">
            ${whatsappSection}
          </div>
          <div class="card">
            ${googleChatSection}
          </div>
        </div>
      </section>
      `,
    );
  }

  renderGoogleChatSection() {
    const configuredEmail = escapeHTML(this.googleChatConfig?.service_account_email || '');
    const projectId = escapeHTML(this.googleChatConfig?.project_id || '');
    const lastUpdated = this.googleChatConfig?.updated_at
      ? new Intl.DateTimeFormat(this.app.lang || 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(this.googleChatConfig.updated_at))
      : null;

    const spacesOptions = this.googleChatSpaces.map((space) => {
      const name = escapeHTML(space.space_name || space.space_id);
      const value = escapeAttribute(space.space_id);
      const badge = space.is_broadcast_space ? ` (${translate('google_chat_broadcast_space')})` : '';
      return `<option value="${value}">${name}${badge}</option>`;
    }).join('');

    // Spaces that did not load are not "no spaces yet".
    let spaceNotice = '';
    if (this.spacesFailed) {
      spaceNotice = `<p class="status-message error" role="alert">${translate('google_chat_spaces_unavailable')}</p>`;
    } else if (this.googleChatSpaces.length === 0) {
      spaceNotice = `<p class="muted-text">${translate('google_chat_spaces_empty')}</p>`;
    }
    const noSpaces = this.googleChatSpaces.length === 0;

    return `
      <section class="account-section">
        <h2>${translate('google_chat_title')}</h2>
        <p class="section-description">${translate('google_chat_description')}</p>

        ${this.configError ? `
        <div class="status-box warning">
          <p class="status-message error" role="alert">${escapeHTML(apiErrorMessage(this.configError, 'error_loading_data'))}</p>
          <button type="button" class="button button--secondary" id="google-chat-retry">${translate('retry')}</button>
        </div>` : `
        <div class="status-box ${this.googleChatConfig ? 'success' : 'warning'}">
          <p><strong>${translate('status')}:</strong> ${this.googleChatConfig
  ? `${translate('google_chat_configured_as')} ${configuredEmail}`
  : translate('google_chat_not_configured')}</p>
          ${projectId ? `<p><strong>${translate('project')}:</strong> ${projectId}</p>` : ''}
          ${lastUpdated ? `<p><strong>${translate('last_updated')}:</strong> ${escapeHTML(lastUpdated)}</p>` : ''}
        </div>`}

        <form id="google-chat-credentials-form" class="account-form" novalidate>
          <h3>${translate('google_chat_credentials_title')}</h3>
          <label for="google-chat-credentials">${translate('google_chat_credentials_label')}</label>
          <textarea id="google-chat-credentials" name="credentials" rows="6" required
                    aria-describedby="google-chat-credentials-help google-chat-credentials-error"
                    placeholder="{\n  &quot;type&quot;: &quot;service_account&quot;,\n  ...\n}"></textarea>
          <p class="muted-text" id="google-chat-credentials-help">${translate('google_chat_credentials_help')}</p>
          <p class="status-message error" role="alert" id="google-chat-credentials-error"></p>
          <button type="submit" class="button button--primary">${translate('save')}</button>
        </form>

        <form id="google-chat-space-form" class="account-form">
          <h3>${translate('google_chat_space_title')}</h3>
          <label for="google-chat-space-id">${translate('google_chat_space_id_label')}</label>
          <input id="google-chat-space-id" name="spaceId" type="text" required placeholder="spaces/AAAA..." />

          <label for="google-chat-space-name">${translate('google_chat_space_name_label')}</label>
          <input id="google-chat-space-name" name="spaceName" type="text" />

          <div class="form-group form-group--single-checkbox">
            <input type="checkbox" id="google-chat-broadcast" name="isBroadcastSpace" />
            <label for="google-chat-broadcast">${translate('google_chat_broadcast_label')}</label>
          </div>

          <label for="google-chat-space-description">${translate('description')}</label>
          <textarea id="google-chat-space-description" name="description" rows="2"></textarea>

          <button type="submit" class="button button--primary">${translate('save')}</button>
        </form>

        <form id="google-chat-test-form" class="account-form">
          <h3>${translate('google_chat_test_title')}</h3>
          <label for="google-chat-space-select">${translate('google_chat_test_space_label')}</label>
          <select id="google-chat-space-select" name="spaceId" required ${noSpaces ? 'disabled' : ''}>
            ${spacesOptions}
          </select>
          ${spaceNotice}

          <label for="google-chat-test-message">${translate('google_chat_test_message_label')}</label>
          <textarea id="google-chat-test-message" name="message" rows="3" required></textarea>

          <button type="submit" class="button button--secondary" ${noSpaces ? 'disabled' : ''}>
            ${translate('google_chat_send_test')}
          </button>
        </form>
      </section>
    `;
  }

  attachGoogleChatListeners() {
    const handlers = {
      'google-chat-credentials-form': (form) => this.handleCredentialsSubmit(form),
      'google-chat-space-form': (form) => this.handleSpaceSubmit(form),
      'google-chat-test-form': (form) => this.handleTestMessage(form),
    };
    Object.entries(handlers).forEach(([id, handler]) => {
      const form = document.getElementById(id);
      if (form) {
        this.addEventListener(form, 'submit', (event) => {
          event.preventDefault();
          withFormBusy(form, () => handler(form));
        });
      }
    });

    const retry = document.getElementById('google-chat-retry');
    if (retry) {
      this.addEventListener(retry, 'click', () => this.reload());
    }

    const credentials = document.getElementById('google-chat-credentials');
    if (credentials) {
      // The message goes as soon as the key changes.
      this.addEventListener(credentials, 'input', () => this.setCredentialsError(''));
    }
  }

  /**
   * Show (or clear) the message tied to the credentials field.
   *
   * @param {string} message - Translated message; empty clears it
   * @returns {void}
   */
  setCredentialsError(message) {
    const textarea = document.getElementById('google-chat-credentials');
    const errorElement = document.getElementById('google-chat-credentials-error');
    if (errorElement) {
      errorElement.textContent = message;
    }
    if (textarea) {
      if (message) {
        textarea.setAttribute('aria-invalid', 'true');
      } else {
        textarea.removeAttribute('aria-invalid');
      }
    }
  }

  /**
   * Load the Google Chat part again and redraw (after a write, or on retry).
   * A write stands even if this fails: the section then says it did not load.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    await this.loadGoogleChatData();
    this.refresh();
  }

  /** @param {HTMLFormElement} form */
  async handleCredentialsSubmit(form) {
    const raw = form.elements.namedItem('credentials').value.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.setCredentialsError(translate('google_chat_credentials_invalid_json'));
      form.elements.namedItem('credentials').focus();
      return;
    }

    let result;
    try {
      result = await saveGoogleChatCredentials(parsed);
    } catch (error) {
      debugError('Failed to save Google Chat credentials:', error?.status);
      this.app.showMessage(apiErrorMessage(error, 'google_chat_credentials_error'), 'error');
      return;
    }
    // Offline, the request is only queued: say so rather than claim it is done.
    if (result?.queued) {
      this.app.showMessage('offline.savedLocally', 'info');
      return;
    }
    this.app.showMessage(translate('google_chat_credentials_saved'), 'success');
    await this.reload();
  }

  /** @param {HTMLFormElement} form */
  async handleSpaceSubmit(form) {
    const field = (name) => form.elements.namedItem(name);
    let result;
    try {
      result = await saveGoogleChatSpace({
        spaceId: field('spaceId').value.trim(),
        spaceName: field('spaceName').value.trim() || null,
        description: field('description').value.trim() || null,
        isBroadcastSpace: Boolean(field('isBroadcastSpace').checked),
      });
    } catch (error) {
      debugError('Failed to save Google Chat space:', error);
      this.app.showMessage(apiErrorMessage(error, 'google_chat_space_error'), 'error');
      return;
    }
    // Offline, the request is only queued: say so rather than claim it is done.
    if (result?.queued) {
      this.app.showMessage('offline.savedLocally', 'info');
      return;
    }
    this.app.showMessage(translate('google_chat_space_saved'), 'success');
    await this.reload();
  }

  /** @param {HTMLFormElement} form */
  async handleTestMessage(form) {
    let result;
    try {
      result = await sendGoogleChatTestMessage({
        spaceId: form.elements.namedItem('spaceId').value,
        message: form.elements.namedItem('message').value.trim(),
        subject: translate('google_chat_test_subject'),
      });
    } catch (error) {
      debugError('Failed to send Google Chat test:', error);
      this.app.showMessage(apiErrorMessage(error, 'google_chat_test_error'), 'error');
      return;
    }
    // Offline, the request is only queued: say so rather than claim it is done.
    if (result?.queued) {
      this.app.showMessage('offline.savedLocally', 'info');
      return;
    }
    this.app.showMessage(translate('google_chat_test_sent'), 'success');
    form.reset();
  }

  destroy() {
    this.whatsappModule?.destroy?.();
    super.destroy();
  }
}
