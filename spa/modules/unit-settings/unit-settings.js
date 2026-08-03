import { BaseModule } from "../../utils/BaseModule.js";
import { translate } from "../../app.js";
import { loadStylesheet, setContent } from "../../utils/DOMUtils.js";
import { debugError } from "../../utils/DebugUtils.js";
import { makeApiRequest } from "../../api/api-core.js";
import {
  fetchEditableOrganizationSettings,
  getLeaders,
  getLocalGroupMemberships,
  getLocalGroups,
  joinLocalGroup,
  leaveLocalGroup,
  updateDashboardConfiguration,
  updateOrganizationInfo,
  updateUnitVocabulary,
} from "../../api/api-endpoints.js";
import { confirmDestructive } from "../../utils/DialogUtils.js";
import { escapeHTML } from "../../utils/SecurityUtils.js";
import { DAYS_OF_WEEK } from "../../utils/MeetingDateUtils.js";
import {
  hasPermission,
  canSendCommunications,
  canAccessAdminPanel,
  canViewRoles,
  canManageForms,
} from "../../utils/PermissionUtils.js";
import { DASHBOARD_TILES, TOOL_GROUP_ORDER } from "../../config/dashboard-tiles.js";
import {
  createVocabularyFromProfile,
  getVocabularyProfile,
  UNIT_CUSTOMIZATION_CONFIG,
} from "../../utils/UnitVocabularyUtils.js";

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
const VOCABULARY_TERM_MAX_LENGTH = 80;
const BASE_SETTINGS_TABS = ["general", "vocabulary", "dashboard"];
const GROUP_TAB = "group";

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
    this.canViewOrg = false;
    this.activeTab = "general";
    this.vocabulary = createVocabularyFromProfile("cubs");
    this.dashboardConfiguration = { version: 1, hidden_tile_keys: [] };
    this.localGroups = [];
    this.localGroupMemberships = [];
    this.localGroupsLoaded = false;
    this.localGroupsLoading = false;
    this.localGroupsError = false;
    this.localGroupPending = false;
    /** @type {Promise<void>|null} In-flight group load shared by all callers */
    this.localGroupsRequest = null;
  }

  /**
   * Tabs available to the current user. The group tab is hidden entirely when
   * the user cannot read organization data, so it never renders an empty panel.
   *
   * @returns {string[]} Ordered tab identifiers
   */
  getSettingsTabs() {
    return this.canViewOrg ? [...BASE_SETTINGS_TABS, GROUP_TAB] : [...BASE_SETTINGS_TABS];
  }

  async init() {
    const container = document.getElementById("app");
    setContent(container, `<div class="page-loading">${translate("loading") || "Loading..."}</div>`);
    await loadStylesheet("/css/unit-settings.css");

    this.canManageOrg = hasPermission("organization.manage");
    this.canEditOrg = hasPermission("org.edit");
    this.canViewOrg = hasPermission("org.view");
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
    const profile = getVocabularyProfile(data);
    this.vocabulary = data.unit_vocabulary
      ? JSON.parse(JSON.stringify(data.unit_vocabulary))
      : createVocabularyFromProfile(profile);
    this.dashboardConfiguration = {
      version: UNIT_CUSTOMIZATION_CONFIG.version,
      hidden_tile_keys: Array.isArray(data.dashboard_configuration?.hidden_tile_keys)
        ? [...data.dashboard_configuration.hidden_tile_keys]
        : [],
    };

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

        ${this.renderTabs()}
        <div class="unit-settings-tab-panel" id="unit-settings-tab-panel" role="tabpanel"
          aria-labelledby="unit-settings-tab-${this.activeTab}">
          ${this.activeTab === "general" ? `
            ${this.renderUnitDetailsSection()}
            ${this.canEditOrg ? this.renderLanguageSection() : ""}
            ${this.canManageOrg ? this.renderSecuritySection() : ""}
            ${this.renderQuickLinks()}
          ` : ""}
          ${this.activeTab === "vocabulary" ? this.renderVocabularySection() : ""}
          ${this.activeTab === "dashboard" ? this.renderDashboardSection() : ""}
          ${this.activeTab === GROUP_TAB ? this.renderGroupSection() : ""}
        </div>
      </div>`
    );
  }

  renderTabs() {
    return `
      <nav class="unit-settings-tabs" role="tablist" aria-label="${escapeHTML(translate("unit_settings_title"))}">
        ${this.getSettingsTabs().map((tab) => {
          const active = this.activeTab === tab;
          return `<button type="button" role="tab" class="unit-settings-tab ${active ? "is-active" : ""}"
            id="unit-settings-tab-${tab}" data-settings-tab="${tab}"
            aria-controls="unit-settings-tab-panel" aria-selected="${active}"
            tabindex="${active ? "0" : "-1"}">
            ${escapeHTML(translate(`unit_settings_tab_${tab}`))}
          </button>`;
        }).join("")}
      </nav>`;
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

  renderVocabularySection() {
    const termKeys = Object.keys(UNIT_CUSTOMIZATION_CONFIG.profiles.generic.locales.en);
    const profileOptions = ["cubs", "beavers", "generic", "custom"]
      .map((profile) => `<option value="${profile}" ${this.vocabulary.profile === profile ? "selected" : ""}>
        ${escapeHTML(translate(`unit_vocabulary_profile_${profile}`))}
      </option>`)
      .join("");

    const localeColumns = ["fr", "en"].map((locale) => `
      <fieldset class="unit-vocabulary-locale">
        <legend>${escapeHTML(translate(`unit_vocabulary_locale_${locale}`))}</legend>
        ${termKeys.map((termKey) => `
          <div class="form-group">
            <label for="vocabulary-${locale}-${termKey}">
              ${escapeHTML(translate(`unit_vocabulary_term_${termKey}`))}
            </label>
            <input type="text" class="form-control unit-vocabulary-input"
              id="vocabulary-${locale}-${termKey}"
              data-locale="${locale}" data-term-key="${termKey}"
              maxlength="${VOCABULARY_TERM_MAX_LENGTH}"
              value="${escapeHTML(this.vocabulary.locales?.[locale]?.[termKey] || "")}" required
              ${this.canEditOrg ? "" : "disabled"}>
          </div>`).join("")}
      </fieldset>`).join("");

    return `
      <section class="account-section">
        <h2>${escapeHTML(translate("unit_vocabulary_title"))}</h2>
        <p class="section-description">${escapeHTML(translate("unit_vocabulary_description"))}</p>
        ${!this.canEditOrg ? `<p class="unit-settings-read-only">${translate("unit_settings_read_only")}</p>` : ""}
        <form id="unit-vocabulary-form" class="unit-settings-form">
          <div class="form-group unit-vocabulary-profile">
            <label for="unit-vocabulary-profile">${escapeHTML(translate("unit_vocabulary_profile"))}</label>
            <select id="unit-vocabulary-profile" class="form-control" ${this.canEditOrg ? "" : "disabled"}>
              ${profileOptions}
            </select>
            <small>${escapeHTML(translate("unit_vocabulary_profile_hint"))}</small>
          </div>
          <div class="unit-vocabulary-grid">${localeColumns}</div>
          ${this.canEditOrg ? `<button type="submit" id="save-vocabulary-btn" class="button button--primary">
            ${escapeHTML(translate("save"))}
          </button>` : ""}
        </form>
      </section>`;
  }

  renderDashboardSection() {
    const hiddenKeys = new Set(this.dashboardConfiguration.hidden_tile_keys || []);
    const tilesByFeature = new Map();
    DASHBOARD_TILES.forEach((tile) => {
      if (tile.featureKey && !tilesByFeature.has(tile.featureKey)) {
        tilesByFeature.set(tile.featureKey, tile);
      }
    });
    const domainOrder = ["attendance", "people", "progression", "safety", ...TOOL_GROUP_ORDER];
    const orderedDomains = Array.from(new Set([
      ...domainOrder,
      ...Array.from(tilesByFeature.values()).map((tile) => tile.domain),
    ]));

    const groups = orderedDomains.map((domain) => {
      const tiles = Array.from(tilesByFeature.values()).filter((tile) => tile.domain === domain);
      if (!tiles.length) return "";
      return `
        <fieldset class="unit-dashboard-group">
          <legend>${escapeHTML(translate(`domain_${domain}`))}</legend>
          ${tiles.map((tile) => {
            const required = UNIT_CUSTOMIZATION_CONFIG.requiredDashboardFeatureKeys.includes(tile.featureKey);
            const checked = required || !hiddenKeys.has(tile.featureKey);
            return `
              <label class="unit-dashboard-toggle" for="dashboard-feature-${tile.featureKey}">
                <span>
                  <strong>${escapeHTML(translate(tile.label))}</strong>
                  ${required ? `<small>${escapeHTML(translate("unit_dashboard_required"))}</small>` : ""}
                </span>
                <input type="checkbox" role="switch" class="unit-dashboard-feature"
                  id="dashboard-feature-${tile.featureKey}" data-feature-key="${tile.featureKey}"
                  ${checked ? "checked" : ""} ${required || !this.canEditOrg ? "disabled" : ""}>
              </label>`;
          }).join("")}
        </fieldset>`;
    }).join("");

    return `
      <section class="account-section">
        <h2>${escapeHTML(translate("unit_dashboard_title"))}</h2>
        <p class="section-description">${escapeHTML(translate("unit_dashboard_description"))}</p>
        <p class="unit-dashboard-note">${escapeHTML(translate("unit_dashboard_visibility_note"))}</p>
        ${!this.canEditOrg ? `<p class="unit-settings-read-only">${translate("unit_settings_read_only")}</p>` : ""}
        <form id="unit-dashboard-form" class="unit-settings-form">
          <div class="unit-dashboard-groups">${groups}</div>
          ${this.canEditOrg ? `<button type="submit" id="save-dashboard-btn" class="button button--primary">
            ${escapeHTML(translate("save"))}
          </button>` : ""}
        </form>
      </section>`;
  }

  /**
   * Render the local group membership panel. Membership is what opens shared
   * resources (equipment inventory today) between units of the same group.
   *
   * @returns {string} Section markup
   */
  renderGroupSection() {
    let body;
    if (this.localGroupsLoading) {
      body = `<p class="unit-group-status">${escapeHTML(translate("loading"))}</p>`;
    } else if (this.localGroupsError) {
      body = `<div class="error-message" role="alert">${escapeHTML(translate("error_loading_data"))}</div>`;
    } else {
      body = `${this.renderGroupMemberships()}${this.canEditOrg ? this.renderGroupJoinForm() : ""}`;
    }

    return `
      <section class="account-section">
        <h2>${escapeHTML(translate("unit_group_title"))}</h2>
        <p class="section-description">${escapeHTML(translate("unit_group_description"))}</p>
        <p class="unit-group-note">${escapeHTML(translate("unit_group_shared_note"))}</p>
        ${!this.canEditOrg ? `<p class="unit-settings-read-only">${translate("unit_settings_read_only")}</p>` : ""}
        ${body}
      </section>`;
  }

  renderGroupMemberships() {
    if (!this.localGroupMemberships.length) {
      return `<p class="unit-group-status">${escapeHTML(translate("unit_group_none"))}</p>`;
    }

    const items = this.localGroupMemberships
      .map((group) => {
        const peers = Array.isArray(group.peer_organizations) ? group.peer_organizations : [];
        const peerText = peers.length
          ? translate("unit_group_shared_with").replace("{units}", peers.join(", "))
          : translate("unit_group_no_peers");

        return `
          <li class="unit-group-item">
            <div class="unit-group-item__info">
              <strong>${escapeHTML(group.name)}</strong>
              <span class="muted-text">${escapeHTML(peerText)}</span>
            </div>
            ${this.canEditOrg ? `
              <button type="button" class="button button--danger unit-group-leave-btn"
                data-local-group-id="${group.id}" ${this.localGroupPending ? "disabled" : ""}>
                ${escapeHTML(translate("unit_group_leave"))}
              </button>` : ""}
          </li>`;
      })
      .join("");

    return `<ul class="unit-group-list">${items}</ul>`;
  }

  renderGroupJoinForm() {
    const joinedIds = new Set(this.localGroupMemberships.map((group) => group.id));
    const available = this.localGroups.filter((group) => !joinedIds.has(group.id));

    if (!available.length) {
      return `<p class="unit-group-status">${escapeHTML(translate("unit_group_no_available"))}</p>`;
    }

    const options = available
      .map((group) => `<option value="${group.id}">${escapeHTML(group.name)}</option>`)
      .join("");

    return `
      <form id="unit-group-join-form" class="unit-settings-form unit-group-join">
        <div class="form-group">
          <label for="unit-group-select">${escapeHTML(translate("unit_group_join_label"))}</label>
          <select id="unit-group-select" class="form-control" ${this.localGroupPending ? "disabled" : ""} required>
            ${options}
          </select>
        </div>
        <button type="submit" id="unit-group-join-btn" class="button button--primary"
          ${this.localGroupPending ? "disabled" : ""}>
          ${escapeHTML(translate("unit_group_join"))}
        </button>
      </form>`;
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
        label: translate("communications_title") || "Communication settings",
        description: translate("unit_settings_link_communications") || "Configure WhatsApp, Google Chat, and messaging.",
      },
      canViewRoles() && {
        href: "/role-management",
        icon: "fa-user-tag",
        label: translate("role_management") || "Role Management",
        description: translate("unit_settings_link_roles") || "Manage roles and permissions for your members.",
      },
      canManageForms() && {
        href: "/form-builder",
        icon: "fa-file-pen",
        label: translate("form_builder_title") || "Form Builder",
        description: translate("unit_settings_link_form_builder"),
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
    const tabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
    const activateTab = (requestedTab, shouldFocus = false) => {
      if (!this.getSettingsTabs().includes(requestedTab)) return;
      if (requestedTab !== this.activeTab) {
        this.activeTab = requestedTab;
        this.render();
        this.attachEventListeners();
      }
      if (shouldFocus) document.getElementById(`unit-settings-tab-${requestedTab}`)?.focus();
      // Group data is only fetched once the panel is opened so the other tabs
      // are not slowed down by requests most visits never need.
      if (requestedTab === GROUP_TAB) this.ensureLocalGroupsLoaded();
    };

    tabButtons.forEach((button, index) => {
      this.addEventListener(button, "click", () => activateTab(button.dataset.settingsTab, true));
      this.addEventListener(button, "keydown", (event) => {
        let targetIndex = null;
        if (event.key === "ArrowRight") targetIndex = (index + 1) % tabButtons.length;
        if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabButtons.length) % tabButtons.length;
        if (event.key === "Home") targetIndex = 0;
        if (event.key === "End") targetIndex = tabButtons.length - 1;
        if (targetIndex === null) return;
        event.preventDefault();
        activateTab(tabButtons[targetIndex].dataset.settingsTab, true);
      });
    });

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

    const vocabularyForm = document.getElementById("unit-vocabulary-form");
    if (vocabularyForm && this.canEditOrg) {
      this.addEventListener(vocabularyForm, "submit", (event) => this.handleSaveVocabulary(event));
    }

    const profileSelect = document.getElementById("unit-vocabulary-profile");
    if (profileSelect && this.canEditOrg) {
      this.addEventListener(profileSelect, "change", () => {
        const selectedProfile = profileSelect.value;
        const nextVocabulary = createVocabularyFromProfile(
          selectedProfile === "custom" ? "generic" : selectedProfile,
        );
        nextVocabulary.profile = selectedProfile;
        this.vocabulary = nextVocabulary;
        this.render();
        this.attachEventListeners();
      });
    }

    const dashboardForm = document.getElementById("unit-dashboard-form");
    if (dashboardForm && this.canEditOrg) {
      this.addEventListener(dashboardForm, "submit", (event) => this.handleSaveDashboard(event));
    }

    const groupJoinForm = document.getElementById("unit-group-join-form");
    if (groupJoinForm && this.canEditOrg) {
      this.addEventListener(groupJoinForm, "submit", (event) => this.handleJoinGroup(event));
    }

    if (this.canEditOrg) {
      document.querySelectorAll(".unit-group-leave-btn").forEach((button) => {
        this.addEventListener(button, "click", () =>
          this.handleLeaveGroup(Number(button.dataset.localGroupId)));
      });
    }
  }

  /**
   * Fetch the local group catalog and this unit's memberships once per visit.
   * Concurrent callers share the in-flight request rather than starting a
   * second one, and awaiting any of them waits for the same load to settle.
   *
   * @returns {Promise<void>} Resolves once the group panel has its data
   */
  ensureLocalGroupsLoaded() {
    if (this.localGroupsLoaded) return Promise.resolve();
    if (this.localGroupsRequest) return this.localGroupsRequest;

    this.localGroupsLoading = true;
    this.localGroupsError = false;
    this.refreshGroupPanel();

    this.localGroupsRequest = (async () => {
      try {
        const [catalogResponse, membershipResponse] = await Promise.all([
          getLocalGroups(),
          getLocalGroupMemberships(),
        ]);
        this.localGroups = catalogResponse?.data || [];
        this.localGroupMemberships = membershipResponse?.data || [];
        this.localGroupsLoaded = true;
      } catch (error) {
        debugError("Failed to load local groups:", error);
        this.localGroupsError = true;
      } finally {
        this.localGroupsLoading = false;
        this.localGroupsRequest = null;
        this.refreshGroupPanel();
      }
    })();

    return this.localGroupsRequest;
  }

  /**
   * Re-render only while the group tab is on screen, so background loads never
   * yank the user out of another tab.
   */
  refreshGroupPanel() {
    if (this.activeTab !== GROUP_TAB || this.isDestroyed) return;
    this.render();
    this.attachEventListeners();
  }

  async handleJoinGroup(event) {
    event.preventDefault();
    const select = document.getElementById("unit-group-select");
    const localGroupId = Number(select?.value);
    if (!Number.isInteger(localGroupId) || localGroupId <= 0) return;

    this.localGroupPending = true;
    this.refreshGroupPanel();

    try {
      const response = await joinLocalGroup(localGroupId);
      this.localGroupMemberships = response?.data?.memberships || this.localGroupMemberships;
      this.app?.showMessage?.(translate("unit_group_joined"), "success");
    } catch (error) {
      debugError("Failed to join local group:", error);
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
    } finally {
      this.localGroupPending = false;
      this.refreshGroupPanel();
    }
  }

  async handleLeaveGroup(localGroupId) {
    if (!Number.isInteger(localGroupId) || localGroupId <= 0) return;

    const group = this.localGroupMemberships.find((entry) => entry.id === localGroupId);
    const confirmed = await confirmDestructive({
      title: translate("unit_group_leave"),
      message: translate("unit_group_leave_confirm").replace("{group}", group?.name || ""),
      confirmLabel: translate("unit_group_leave"),
      cancelLabel: translate("cancel"),
    });
    if (!confirmed) return;

    this.localGroupPending = true;
    this.refreshGroupPanel();

    try {
      await leaveLocalGroup(localGroupId);
      this.localGroupMemberships = this.localGroupMemberships
        .filter((entry) => entry.id !== localGroupId);
      this.app?.showMessage?.(translate("unit_group_left"), "success");
    } catch (error) {
      debugError("Failed to leave local group:", error);
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
    } finally {
      this.localGroupPending = false;
      this.refreshGroupPanel();
    }
  }

  /**
   * Convert API failures into page-language messages. Server details are kept
   * in debug logs and never shown directly because they are not localized.
   *
   * @param {Error & {status?: number}} error - API request failure
   * @returns {string} Localized user-facing message
   */
  getLocalizedSaveError(error) {
    if (error?.status === 400) {
      return translate("unit_settings_invalid_settings");
    }
    if (error?.status === 401) {
      return translate("authentication_required");
    }
    if (error?.status === 403) {
      return translate("insufficient_permissions");
    }
    return translate("error_saving");
  }

  async handleSaveUnitDetails(event) {
    event.preventDefault();
    const form = document.getElementById("unit-details-form");
    const btn = document.getElementById("save-unit-details-btn");
    if (!form || !btn || !form.reportValidity()) return;

    const payload = {
      name: String(document.getElementById("unit-organization-name")?.value || "").trim(),
      unit: String(document.getElementById("unit-name")?.value || "").trim(),
      district: String(document.getElementById("unit-district")?.value || "").trim(),
      animateur_responsable: String(document.getElementById("unit-group-leader")?.value || "").trim(),
      endroit: String(document.getElementById("unit-meeting-location")?.value || "").trim(),
      meeting_day: String(document.getElementById("unit-meeting-day")?.value || ""),
      meeting_time: String(document.getElementById("unit-meeting-time")?.value || ""),
      meeting_duration: Number(document.getElementById("unit-meeting-duration")?.value),
      logo: String(document.getElementById("unit-logo-url")?.value || "").trim(),
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
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
    } finally {
      const saveButton = document.getElementById("save-unit-details-btn");
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = translate("save");
      }
    }
  }

  async handleSaveVocabulary(event) {
    event.preventDefault();
    const form = document.getElementById("unit-vocabulary-form");
    const btn = document.getElementById("save-vocabulary-btn");
    if (!form || !btn || !form.reportValidity()) return;

    const locales = { en: {}, fr: {} };
    document.querySelectorAll(".unit-vocabulary-input").forEach((input) => {
      locales[input.dataset.locale][input.dataset.termKey] = input.value.trim();
    });
    const payload = {
      version: UNIT_CUSTOMIZATION_CONFIG.version,
      profile: document.getElementById("unit-vocabulary-profile")?.value || "custom",
      locales,
    };

    btn.disabled = true;
    btn.textContent = translate("saving");
    try {
      const response = await updateUnitVocabulary(payload);
      this.vocabulary = response?.data?.unit_vocabulary || payload;
      if (this.app) {
        this.app.organizationSettings = {
          ...(this.app.organizationSettings || {}),
          unit_vocabulary: this.vocabulary,
          program_section: response?.data?.program_section
            || this.app.organizationSettings?.program_section,
        };
      }
      this.app?.showMessage?.(translate("unit_vocabulary_saved"), "success");
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Failed to save unit vocabulary:", error);
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
    } finally {
      const saveButton = document.getElementById("save-vocabulary-btn");
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = translate("save");
      }
    }
  }

  async handleSaveDashboard(event) {
    event.preventDefault();
    const btn = document.getElementById("save-dashboard-btn");
    if (!btn) return;

    const hiddenTileKeys = Array.from(document.querySelectorAll(".unit-dashboard-feature"))
      .filter((input) => !input.checked && !input.disabled)
      .map((input) => input.dataset.featureKey);
    const payload = {
      version: UNIT_CUSTOMIZATION_CONFIG.version,
      hidden_tile_keys: hiddenTileKeys,
    };

    btn.disabled = true;
    btn.textContent = translate("saving");
    try {
      const response = await updateDashboardConfiguration(payload);
      this.dashboardConfiguration = response?.data?.dashboard_configuration || payload;
      if (this.app) {
        this.app.organizationSettings = {
          ...(this.app.organizationSettings || {}),
          dashboard_configuration: this.dashboardConfiguration,
        };
      }
      this.app?.showMessage?.(translate("unit_dashboard_saved"), "success");
    } catch (error) {
      debugError("Failed to save dashboard configuration:", error);
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = translate("save");
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
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
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
      this.app?.showMessage?.(this.getLocalizedSaveError(error), "error");
      if (toggle) toggle.checked = !disabled;
    } finally {
      const t = document.getElementById("disable-2fa-toggle");
      if (t) t.disabled = false;
    }
  }
}
