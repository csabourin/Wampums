import { BaseModule } from "../../utils/BaseModule.js";
import { translate } from "../../app.js";
import { loadStylesheet, setContent } from "../../utils/DOMUtils.js";
import { debugError } from "../../utils/DebugUtils.js";
import { makeApiRequest } from "../../api/api-core.js";
import {
  fetchEditableOrganizationSettings,
  getLeaders,
  updateOrganizationInfo,
} from "../../api/api-endpoints.js";
import { escapeHTML } from "../../utils/SecurityUtils.js";
import { DAYS_OF_WEEK } from "../../utils/MeetingDateUtils.js";
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

const DEFAULT_MEETING_DAY = "Wednesday";
const DEFAULT_MEETING_TIME = "19:00";
const DEFAULT_MEETING_DURATION_MINUTES = 90;
const MINIMUM_MEETING_DURATION_MINUTES = 15;
const MAXIMUM_MEETING_DURATION_MINUTES = 720;
const SHORT_TEXT_MAX_LENGTH = 255;
const LOCATION_MAX_LENGTH = 500;
const LOGO_URL_MAX_LENGTH = 2048;

export class UnitSettings extends BaseModule {
  constructor(app) {
    super(app);
    this.isLoading = true;
    this.loadError = null;
    this.orgName = "";
    this.organizationInfo = {};
    this.leaders = [];
    this.emailLanguage = "fr";
    this.twoFactorDisabled = false;
    this.canManageOrg = false;
    this.canEditOrg = false;
  }

  async init() {
    const container = document.getElementById("app");
    setContent(container, `<div class="page-loading">${translate("loading") || "Loading..."}</div>`);
    await loadStylesheet("/css/unit-settings.css");

    this.canManageOrg = hasPermission("organization.manage");
    this.canEditOrg = hasPermission("org.edit");

    try {
      await this.loadSettings();
      await this.loadLeaders();
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Failed to load unit settings:", error);
      this.isLoading = false;
      this.loadError = error;
      this.render();
    }
  }

  async loadSettings() {
    const response = await fetchEditableOrganizationSettings();
    const data = response?.data || {};
    const organizationInfo = data.organization_info || {};
    const configuredDuration = data.meeting_length?.duration_minutes
      ?? organizationInfo.meeting_duration
      ?? DEFAULT_MEETING_DURATION_MINUTES;

    this.organizationInfo = {
      ...organizationInfo,
      meeting_day: organizationInfo.meeting_day || DEFAULT_MEETING_DAY,
      meeting_time: organizationInfo.meeting_time || DEFAULT_MEETING_TIME,
      meeting_duration: configuredDuration,
    };
    this.orgName = this.organizationInfo.name || "";
    this.emailLanguage = data.default_email_language || "fr";

    const security = data.security || {};
    this.twoFactorDisabled = security.two_factor_disabled === true;
  }

  /**
   * Load eligible leaders for suggestions while retaining support for a custom
   * section leader name such as a traditional Scouting role name.
   */
  async loadLeaders() {
    try {
      const response = await getLeaders();
      const users = response?.data?.users || [];
      const uniqueNames = new Map();
      users.forEach((user) => {
        if (user?.full_name) uniqueNames.set(user.full_name, user);
      });
      this.leaders = Array.from(uniqueNames.values());
    } catch (error) {
      debugError("Failed to load unit leader suggestions:", error);
      this.leaders = [];
    }
  }

  render() {
    const container = document.getElementById("app");

    if (this.loadError) {
      setContent(
        container,
        `<div class="page unit-settings-page">
          <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
          <h1>${translate("unit_settings_title")}</h1>
          <div class="error-message" role="alert">${escapeHTML(translate("error_loading_data"))}</div>
        </div>`
      );
      return;
    }

    setContent(
      container,
      `<div class="page unit-settings-page">
        <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
        <h1>${translate("unit_settings_title") || "Unit Settings"}</h1>
        <p class="page-description">${translate("unit_settings_description") || "Manage settings specific to your organization."}</p>

        ${this.orgName ? `<p class="unit-settings-org-name">${escapeHTML(this.orgName)}</p>` : ""}

        ${this.renderUnitDetailsSection()}
        ${this.canEditOrg ? this.renderLanguageSection() : ""}
        ${this.canManageOrg ? this.renderSecuritySection() : ""}
        ${this.renderQuickLinks()}
      </div>`
    );
  }

  renderUnitDetailsSection() {
    const info = this.organizationInfo;
    const disabled = this.canEditOrg ? "" : "disabled";
    const meetingDay = DAYS_OF_WEEK.includes(info.meeting_day)
      ? info.meeting_day
      : DEFAULT_MEETING_DAY;
    const dayOptions = DAYS_OF_WEEK.map(
      (day) => `<option value="${day}" ${meetingDay === day ? "selected" : ""}>${escapeHTML(translate(day) || day)}</option>`
    ).join("");
    const leaderOptions = this.leaders
      .map((leader) => `<option value="${escapeHTML(leader.full_name)}"></option>`)
      .join("");

    return `
      <section class="account-section">
        <h2>${translate("unit_settings_details_title")}</h2>
        <p class="section-description">${translate("unit_settings_details_description")}</p>
        ${!this.canEditOrg ? `<p class="unit-settings-read-only">${translate("unit_settings_read_only")}</p>` : ""}

        <form id="unit-details-form" class="unit-settings-form">
          <div class="unit-settings-form__grid">
            <div class="form-group">
              <label for="unit-organization-name">${translate("organization_name")}</label>
              <input type="text" id="unit-organization-name" name="name" class="form-control"
                value="${escapeHTML(info.name || "")}" maxlength="${SHORT_TEXT_MAX_LENGTH}" required ${disabled}>
            </div>

            <div class="form-group">
              <label for="unit-name">${translate("unit_settings_unit_name")}</label>
              <input type="text" id="unit-name" name="unit" class="form-control"
                value="${escapeHTML(info.unit || "")}" maxlength="${SHORT_TEXT_MAX_LENGTH}" ${disabled}>
            </div>

            <div class="form-group">
              <label for="unit-district">${translate("District")}</label>
              <input type="text" id="unit-district" name="district" class="form-control"
                value="${escapeHTML(info.district || "")}" maxlength="${SHORT_TEXT_MAX_LENGTH}" ${disabled}>
            </div>

            <div class="form-group">
              <label for="unit-group-leader">${translate("unit_settings_group_leader")}</label>
              <input type="text" id="unit-group-leader" name="animateur_responsable" class="form-control"
                value="${escapeHTML(info.animateur_responsable || "")}" list="unit-leader-options"
                maxlength="${SHORT_TEXT_MAX_LENGTH}" ${disabled}>
              <datalist id="unit-leader-options">${leaderOptions}</datalist>
            </div>

            <div class="form-group unit-settings-form__wide">
              <label for="unit-meeting-location">${translate("unit_settings_meeting_location")}</label>
              <input type="text" id="unit-meeting-location" name="endroit" class="form-control"
                value="${escapeHTML(info.endroit || "")}" maxlength="${LOCATION_MAX_LENGTH}" ${disabled}>
            </div>

            <div class="form-group">
              <label for="unit-meeting-day">${translate("unit_settings_meeting_day")}</label>
              <select id="unit-meeting-day" name="meeting_day" class="form-control" required ${disabled}>
                ${dayOptions}
              </select>
            </div>

            <div class="form-group">
              <label for="unit-meeting-time">${translate("unit_settings_meeting_time")}</label>
              <input type="time" id="unit-meeting-time" name="meeting_time" class="form-control"
                value="${escapeHTML(String(info.meeting_time || DEFAULT_MEETING_TIME).slice(0, 5))}" required ${disabled}>
            </div>

            <div class="form-group">
              <label for="unit-meeting-duration">${translate("unit_settings_meeting_duration")}</label>
              <input type="number" id="unit-meeting-duration" name="meeting_duration" class="form-control"
                value="${escapeHTML(String(info.meeting_duration || DEFAULT_MEETING_DURATION_MINUTES))}"
                min="${MINIMUM_MEETING_DURATION_MINUTES}" max="${MAXIMUM_MEETING_DURATION_MINUTES}" step="1" required ${disabled}>
            </div>

            <div class="form-group unit-settings-form__wide">
              <label for="unit-logo-url">${translate("unit_settings_logo_url")}</label>
              <input type="text" inputmode="url" id="unit-logo-url" name="logo" class="form-control"
                value="${escapeHTML(info.logo || "")}" maxlength="${LOGO_URL_MAX_LENGTH}" ${disabled}>
            </div>
          </div>

          ${this.canEditOrg ? `
            <button id="save-unit-details-btn" type="submit" class="button button--primary">
              ${translate("save")}
            </button>` : ""}
        </form>
      </section>`;
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
          <button id="save-language-btn" class="button button--primary unit-settings-save-button">
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
      hasPermission("scout_year.view") && {
        href: "/scout-year",
        icon: "fa-calendar-days",
        label: translate("scout_year_title") || "Scout Year",
        description: translate("unit_settings_link_scout_year") || "Start a new scout year and consult past ones.",
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
    const unitDetailsForm = document.getElementById("unit-details-form");
    if (unitDetailsForm && this.canEditOrg) {
      this.addEventListener(unitDetailsForm, "submit", (event) => this.handleSaveUnitDetails(event));
    }

    const saveLanguageBtn = document.getElementById("save-language-btn");
    if (saveLanguageBtn) {
      this.addEventListener(saveLanguageBtn, "click", () => this.handleSaveLanguage());
    }

    const twoFaToggle = document.getElementById("disable-2fa-toggle");
    if (twoFaToggle) {
      this.addEventListener(twoFaToggle, "change", (e) => this.handleTwoFactorToggle(e.target.checked));
    }
  }

  async handleSaveUnitDetails(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const btn = document.getElementById("save-unit-details-btn");
    if (!form.reportValidity() || !btn) return;

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      unit: String(formData.get("unit") || "").trim(),
      district: String(formData.get("district") || "").trim(),
      animateur_responsable: String(formData.get("animateur_responsable") || "").trim(),
      endroit: String(formData.get("endroit") || "").trim(),
      meeting_day: String(formData.get("meeting_day") || ""),
      meeting_time: String(formData.get("meeting_time") || ""),
      meeting_duration: Number(formData.get("meeting_duration")),
      logo: String(formData.get("logo") || "").trim(),
    };

    btn.disabled = true;
    btn.textContent = translate("saving");

    try {
      const response = await updateOrganizationInfo(payload);
      const savedInfo = response?.data?.organization_info || payload;
      this.organizationInfo = { ...this.organizationInfo, ...savedInfo };
      this.orgName = this.organizationInfo.name;

      if (this.app) {
        this.app.organizationSettings = {
          ...(this.app.organizationSettings || {}),
          organization_info: this.organizationInfo,
          meeting_length: {
            ...(this.app.organizationSettings?.meeting_length || {}),
            duration_minutes: this.organizationInfo.meeting_duration,
          },
        };
      }

      this.app?.showMessage?.(translate("unit_settings_details_saved"), "success");
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Failed to save unit details:", error);
      this.app?.showMessage?.(error.message || translate("error_saving"), "error");
    } finally {
      const saveButton = document.getElementById("save-unit-details-btn");
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = translate("save");
      }
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
