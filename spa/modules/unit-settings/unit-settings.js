import { BaseModule } from "../../utils/BaseModule.js";
import { translate } from "../../app.js";
import { setContent } from "../../utils/DOMUtils.js";
import { debugError } from "../../utils/DebugUtils.js";
import { makeApiRequest } from "../../api/api-core.js";
import { escapeHTML } from "../../utils/SecurityUtils.js";
import {
  hasPermission,
  canSendCommunications,
  canAccessAdminPanel,
  canViewRoles,
  canManageForms,
} from "../../utils/PermissionUtils.js";

const SUPPORTED_LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
  { code: "it", label: "Italiano" },
];

export class UnitSettings extends BaseModule {
  constructor(app) {
    super(app);
    this.isLoading = true;
    this.orgName = "";
    this.emailLanguage = "fr";
    this.twoFactorDisabled = false;
    this.canManageOrg = false;
    this.canEditOrg = false;
  }

  async init() {
    const container = document.getElementById("app");
    setContent(container, `<div class="page-loading">${translate("loading") || "Loading..."}</div>`);

    this.canManageOrg = hasPermission("organization.manage");
    this.canEditOrg = hasPermission("org.edit") || this.canManageOrg;

    try {
      await this.loadSettings();
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Failed to load unit settings:", error);
      this.isLoading = false;
      this.render();
    }
  }

  async loadSettings() {
    const response = await makeApiRequest("v1/organizations/settings", { method: "GET" });
    const data = response?.data || {};

    this.orgName = data.organization_info?.name || "";
    this.emailLanguage = data.default_email_language || "fr";

    const security = data.security || {};
    this.twoFactorDisabled = security.two_factor_disabled === true;
  }

  render() {
    const container = document.getElementById("app");

    setContent(
      container,
      `<div class="page unit-settings-page">
        <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
        <h1>${translate("unit_settings_title") || "Unit Settings"}</h1>
        <p class="page-description">${translate("unit_settings_description") || "Manage settings specific to your organization."}</p>

        ${this.orgName ? `<p class="unit-settings-org-name">${escapeHTML(this.orgName)}</p>` : ""}

        ${this.canEditOrg ? this.renderLanguageSection() : ""}
        ${this.canManageOrg ? this.renderSecuritySection() : ""}
        ${this.renderQuickLinks()}
      </div>`
    );
  }

  renderLanguageSection() {
    const options = SUPPORTED_LANGUAGES.map(
      ({ code, label }) =>
        `<option value="${code}" ${this.emailLanguage === code ? "selected" : ""}>${escapeHTML(label)}</option>`
    ).join("");

    return `
      <section class="account-section">
        <h2>${translate("unit_settings_language_title") || "Language"}</h2>
        <p class="section-description">${translate("unit_settings_language_description") || "Default language used for emails and notifications sent by the organization."}</p>
        <div class="form-group">
          <label for="email-language-select">${translate("default_email_language") || "Default email language"}</label>
          <select id="email-language-select" class="form-control">
            ${options}
          </select>
          <button id="save-language-btn" class="button button--primary" style="margin-top:0.75rem">
            ${translate("save") || "Save"}
          </button>
        </div>
      </section>`;
  }

  renderSecuritySection() {
    const checked = this.twoFactorDisabled ? "checked" : "";
    return `
      <section class="account-section">
        <h2>${translate("security_settings_title") || "Security"}</h2>
        <p class="section-description">${translate("security_settings_description") || "Configure organization-wide security policies."}</p>

        <div class="setting-row">
          <label class="toggle-label" for="disable-2fa-toggle">
            <div class="toggle-label__text">
              <strong>${translate("two_factor_disable_label") || "Disable Two-Factor Authentication"}</strong>
              <span class="muted-text">${translate("two_factor_disable_description") || "When disabled, users log in with password only. Not recommended for organizations with sensitive data."}</span>
            </div>
            <input type="checkbox" id="disable-2fa-toggle" role="switch" ${checked} />
          </label>
          ${this.twoFactorDisabled
            ? `<p class="warning-text">${translate("two_factor_disabled_warning") || "Warning: Two-factor authentication is currently disabled for this organization."}</p>`
            : ""}
        </div>
      </section>`;
  }

  renderQuickLinks() {
    const links = [
      (canSendCommunications() || canAccessAdminPanel()) && {
        href: "/communications",
        icon: "fa-comments",
        label: translate("communications_title") || "Communications & Chat",
        description: translate("unit_settings_link_communications") || "Configure WhatsApp, Google Chat, and messaging.",
      },
      canViewRoles() && {
        href: "/role-management",
        icon: "fa-user-tag",
        label: translate("role_management") || "Role Management",
        description: translate("unit_settings_link_roles") || "Manage roles and permissions for your members.",
      },
      canManageForms() && {
        href: "/form-permissions",
        icon: "fa-clipboard-check",
        label: translate("form_permissions") || "Form Permissions",
        description: translate("unit_settings_link_forms") || "Control which roles can access each form.",
      },
    ].filter(Boolean);

    if (!links.length) return "";

    return `
      <section class="account-section">
        <h2>${translate("unit_settings_more_title") || "More Settings"}</h2>
        <div class="manage-items manage-items--cards">
          ${links
            .map(
              ({ href, icon, label, description }) => `
            <a href="${href}" class="settings-link-card">
              <i class="fa-solid ${icon}"></i>
              <div>
                <strong>${escapeHTML(label)}</strong>
                <span class="muted-text">${escapeHTML(description)}</span>
              </div>
            </a>`
            )
            .join("")}
        </div>
      </section>`;
  }

  attachEventListeners() {
    const saveLanguageBtn = document.getElementById("save-language-btn");
    if (saveLanguageBtn) {
      this.addEventListener(saveLanguageBtn, "click", () => this.handleSaveLanguage());
    }

    const twoFaToggle = document.getElementById("disable-2fa-toggle");
    if (twoFaToggle) {
      this.addEventListener(twoFaToggle, "change", (e) => this.handleTwoFactorToggle(e.target.checked));
    }
  }

  async handleSaveLanguage() {
    const select = document.getElementById("email-language-select");
    const btn = document.getElementById("save-language-btn");
    if (!select || !btn) return;

    const language = select.value;
    btn.disabled = true;
    btn.textContent = translate("saving") || "Saving...";

    try {
      await makeApiRequest("v1/organizations/settings/email-language", {
        method: "PATCH",
        body: { language },
      });
      this.emailLanguage = language;
      this.app?.showMessage?.(translate("unit_settings_language_saved") || "Language saved.", "success");
    } catch (error) {
      debugError("Failed to save email language:", error);
      this.app?.showMessage?.(error.message || translate("error_saving") || "Failed to save.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = translate("save") || "Save";
    }
  }

  async handleTwoFactorToggle(disabled) {
    const toggle = document.getElementById("disable-2fa-toggle");
    if (toggle) toggle.disabled = true;

    try {
      await makeApiRequest("v1/organizations/settings", {
        method: "PUT",
        body: { setting_key: "security", setting_value: { two_factor_disabled: disabled } },
      });
      this.twoFactorDisabled = disabled;
      this.app?.showMessage?.(translate("two_factor_setting_saved") || "Security setting saved.", "success");
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Failed to save 2FA setting:", error);
      this.app?.showMessage?.(error.message || translate("error_saving") || "Failed to save setting.", "error");
      if (toggle) toggle.checked = !disabled;
    } finally {
      const t = document.getElementById("disable-2fa-toggle");
      if (t) t.disabled = false;
    }
  }
}
