import { BaseModule } from "./utils/BaseModule.js";
import { translate } from "./app.js";
import { setContent } from "./utils/DOMUtils.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { makeApiRequest } from "./api/api-core.js";
import { WhatsAppConnectionModule } from "./modules/whatsapp-connection.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { canSendCommunications, canAccessAdminPanel } from "./utils/PermissionUtils.js";

export class CommunicationSettings extends BaseModule {
  constructor(app) {
    super(app);
    this.whatsappModule = new WhatsAppConnectionModule(app);
    this.googleChatConfig = null;
    this.googleChatSpaces = [];
    this.isLoading = true;
    this.googleChatError = null;
  }

  async init() {
    const container = document.getElementById("app");
    setContent(container, `<div class="page-loading">${translate("loading") || "Loading..."}</div>`);

    try {
      await this.whatsappModule.init();
      await this.loadGoogleChatData();
      this.isLoading = false;
      this.render();
      this.whatsappModule.attachEventListeners();
      this.attachGoogleChatListeners();
    } catch (error) {
      debugError("Error loading communication settings:", error);
      this.googleChatError = error.message;
      this.isLoading = false;
      this.render();
    }
  }

  async loadGoogleChatData() {
    try {
      const [configResponse, spacesResponse] = await Promise.all([
        makeApiRequest("google-chat/config", { method: "GET" }),
        makeApiRequest("google-chat/spaces", { method: "GET" }).catch((error) => {
          debugError("Error loading Google Chat spaces:", error);
          return { success: false, data: [] };
        }),
      ]);

      if (configResponse?.configured) {
        this.googleChatConfig = configResponse.data || null;
      } else {
        this.googleChatConfig = null;
      }

      this.googleChatSpaces = spacesResponse?.data || [];
    } catch (error) {
      this.googleChatError = error.message;
      throw error;
    }
  }

  render() {
    const container = document.getElementById("app");

    if (this.isLoading) {
      setContent(container, `<div class="page-loading">${translate("loading") || "Loading..."}</div>`);
      return;
    }

    const hasCommsAccess = canSendCommunications() || canAccessAdminPanel();
    const whatsappSection = this.whatsappModule.connectionStatus
      ? this.whatsappModule.render()
      : `<p class="muted-text">${translate("loading") || "Loading..."}</p>`;

    const googleChatSection = hasCommsAccess
      ? this.renderGoogleChatSection()
      : `<div class="info-box">${translate("communications_permissions_error") || "You do not have permission to configure Google Chat."}</div>`;

    setContent(
      container,
      `
      <div class="page communications-page">
        <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
        <h1>${translate("communications_title") || "Communications & Chat"}</h1>
        <p class="page-description">${translate("communications_description") || "Configure WhatsApp and Google Chat to send announcements."}</p>

        <div class="card-grid">
          <div class="card">
            ${whatsappSection}
          </div>
          <div class="card">
            ${googleChatSection}
          </div>
        </div>
      </div>
      `,
    );
  }

  renderGoogleChatSection() {
    const configuredEmail = escapeHTML(this.googleChatConfig?.service_account_email || "");
    const projectId = escapeHTML(this.googleChatConfig?.project_id || "");
    const lastUpdated = this.googleChatConfig?.updated_at
      ? new Intl.DateTimeFormat(this.app.lang || "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(this.googleChatConfig.updated_at))
      : null;

    const spacesOptions = this.googleChatSpaces.map((space) => {
      const name = escapeHTML(space.space_name || space.space_id);
      const value = escapeHTML(space.space_id);
      const badge = space.is_broadcast_space ? ` (${translate("google_chat_broadcast_space") || "Broadcast"})` : "";
      return `<option value="${value}">${name}${badge}</option>`;
    }).join("");

    const spaceNotice = this.googleChatSpaces.length === 0
      ? `<p class="muted-text">${translate("google_chat_spaces_empty") || "No spaces registered yet."}</p>`
      : "";

    return `
      <section class="account-section">
        <h2>${translate("google_chat_title") || "Google Chat"}</h2>
        <p class="section-description">${translate("google_chat_description") || "Upload your Google Chat service account, register a space, and send a test message."}</p>

        <div class="status-box ${this.googleChatConfig ? "success" : "warning"}">
          <p><strong>${translate("status") || "Status"}:</strong> ${this.googleChatConfig
            ? `${translate("google_chat_configured_as") || "Configured as"} ${configuredEmail}`
            : translate("google_chat_not_configured") || "Not configured"}</p>
          ${projectId ? `<p><strong>${translate("project") || "Project"}:</strong> ${projectId}</p>` : ""}
          ${lastUpdated ? `<p><strong>${translate("last_updated") || "Last updated"}:</strong> ${lastUpdated}</p>` : ""}
          ${this.googleChatError ? `<p class="error-text">${escapeHTML(this.googleChatError)}</p>` : ""}
        </div>

        <form id="google-chat-credentials-form" class="account-form">
          <h3>${translate("google_chat_credentials_title") || "Service account credentials"}</h3>
          <label for="google-chat-credentials">${translate("google_chat_credentials_label") || "Paste service account JSON"}</label>
          <textarea id="google-chat-credentials" name="credentials" rows="6" required placeholder="{\n  \"type\": \"service_account\",\n  ...\n}"></textarea>
          <p class="muted-text">${translate("google_chat_credentials_help") || "Use the JSON key file from your Google Chat service account."}</p>
          <button type="submit" class="btn btn-primary">${translate("save") || "Save"}</button>
        </form>

        <form id="google-chat-space-form" class="account-form">
          <h3>${translate("google_chat_space_title") || "Register a space"}</h3>
          <label for="google-chat-space-id">${translate("google_chat_space_id_label") || "Space ID"}</label>
          <input id="google-chat-space-id" name="spaceId" type="text" required placeholder="spaces/AAAA..." />

          <label for="google-chat-space-name">${translate("google_chat_space_name_label") || "Display name (optional)"}</label>
          <input id="google-chat-space-name" name="spaceName" type="text" />

          <label class="checkbox-row">
            <input type="checkbox" id="google-chat-broadcast" name="isBroadcastSpace" />
            <span>${translate("google_chat_broadcast_label") || "Use as broadcast space"}</span>
          </label>

          <label for="google-chat-space-description">${translate("description") || "Description"}</label>
          <textarea id="google-chat-space-description" name="description" rows="2"></textarea>

          <button type="submit" class="btn btn-primary">${translate("save") || "Save"}</button>
        </form>

        <form id="google-chat-test-form" class="account-form">
          <h3>${translate("google_chat_test_title") || "Send test message"}</h3>
          <label for="google-chat-space-select">${translate("google_chat_test_space_label") || "Choose a space"}</label>
          <select id="google-chat-space-select" name="spaceId" required ${this.googleChatSpaces.length === 0 ? "disabled" : ""}>
            ${spacesOptions}
          </select>
          ${spaceNotice}

          <label for="google-chat-test-message">${translate("google_chat_test_message_label") || "Message"}</label>
          <textarea id="google-chat-test-message" name="message" rows="3" required></textarea>

          <button type="submit" class="btn btn-secondary" ${this.googleChatSpaces.length === 0 ? "disabled" : ""}>
            ${translate("google_chat_send_test") || "Send test"}
          </button>
        </form>
      </section>
    `;
  }

  attachGoogleChatListeners() {
    const credentialsForm = document.getElementById("google-chat-credentials-form");
    if (credentialsForm) {
      this.addEventListener(credentialsForm, "submit", (event) => this.handleCredentialsSubmit(event));
    }

    const spaceForm = document.getElementById("google-chat-space-form");
    if (spaceForm) {
      this.addEventListener(spaceForm, "submit", (event) => this.handleSpaceSubmit(event));
    }

    const testForm = document.getElementById("google-chat-test-form");
    if (testForm) {
      this.addEventListener(testForm, "submit", (event) => this.handleTestMessage(event));
    }
  }

  async handleCredentialsSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const textarea = form.querySelector("#google-chat-credentials");
    const button = form.querySelector("button[type='submit']");

    if (!textarea) return;

    try {
      button.disabled = true;
      button.textContent = translate("saving") || "Saving...";

      const raw = textarea.value.trim();
      const parsed = JSON.parse(raw);

      await makeApiRequest("google-chat/config", {
        method: "POST",
        body: { credentials: parsed },
      });

      this.app?.showMessage?.(translate("google_chat_credentials_saved") || "Credentials saved", "success");
      await this.loadGoogleChatData();
      this.render();
      this.attachGoogleChatListeners();
    } catch (error) {
      debugError("Failed to save Google Chat credentials:", error);
      this.app?.showMessage?.(error.message || translate("google_chat_credentials_error") || "Failed to save credentials", "error");
    } finally {
      button.disabled = false;
      button.textContent = translate("save") || "Save";
    }
  }

  async handleSpaceSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector("button[type='submit']");
    const spaceIdInput = form.querySelector("#google-chat-space-id");
    const spaceNameInput = form.querySelector("#google-chat-space-name");
    const descriptionInput = form.querySelector("#google-chat-space-description");
    const broadcastInput = form.querySelector("#google-chat-broadcast");

    try {
      submitButton.disabled = true;
      submitButton.textContent = translate("saving") || "Saving...";

      await makeApiRequest("google-chat/spaces", {
        method: "POST",
        body: {
          spaceId: spaceIdInput.value.trim(),
          spaceName: spaceNameInput.value.trim() || null,
          description: descriptionInput.value.trim() || null,
          isBroadcastSpace: !!broadcastInput.checked,
        },
      });

      this.app?.showMessage?.(translate("google_chat_space_saved") || "Space saved", "success");
      form.reset();
      await this.loadGoogleChatData();
      this.render();
      this.attachGoogleChatListeners();
    } catch (error) {
      debugError("Failed to save Google Chat space:", error);
      this.app?.showMessage?.(error.message || translate("google_chat_space_error") || "Failed to save space", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = translate("save") || "Save";
    }
  }

  async handleTestMessage(event) {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector("button[type='submit']");
    const spaceSelect = form.querySelector("#google-chat-space-select");
    const messageInput = form.querySelector("#google-chat-test-message");

    if (!spaceSelect || !messageInput) return;

    try {
      submitButton.disabled = true;
      submitButton.textContent = translate("sending") || "Sending...";

      await makeApiRequest("google-chat/send-message", {
        method: "POST",
        body: {
          spaceId: spaceSelect.value,
          message: messageInput.value.trim(),
          subject: translate("google_chat_test_subject") || "Test message",
        },
      });

      this.app?.showMessage?.(translate("google_chat_test_sent") || "Test message sent", "success");
      form.reset();
    } catch (error) {
      debugError("Failed to send Google Chat test:", error);
      this.app?.showMessage?.(error.message || translate("google_chat_test_error") || "Failed to send test", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = translate("google_chat_send_test") || "Send test";
    }
  }

  destroy() {
    this.whatsappModule?.destroy?.();
    super.destroy();
  }
}
