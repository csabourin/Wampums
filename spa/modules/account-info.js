/**
 * Settings Module (Account Information & Preferences)
 *
 * Handles user settings: viewing and updating name, email, password, language, and push notifications
 * Follows Wampums module patterns with security best practices
 *
 * @module modules/account-info
 */

import { makeApiRequest } from "../api/api-core.js";
import { debugLog, debugError, debugWarn } from "../utils/DebugUtils.js";
import { translate, app as appInstance } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { isParent } from "../utils/PermissionUtils.js";
import { setContent, loadStylesheet } from "../utils/DOMUtils.js";
import { getStorage, setStorage } from "../utils/StorageUtils.js";
import { CONFIG, getStorageKey } from "../config.js";

/**
 * Settings/Account Information Management Class
 */
export class AccountInfoModule {
  constructor(app) {
    this.app = app;
    this.userData = null;
    this.isLoading = false;
    this.guardianProfile = { guardian: null, participantIds: [] };
    this.guardianError = null;
    this.isParent = false;
    this.pushEnabled = false;
    this.pushSupported = false;
  }

  /**
   * Initialize the module
   * Loads user data and renders the page
   */
  async init() {
    debugLog("Initializing Settings Module");

    // Load page-specific CSS
    await loadStylesheet("/css/account-info.css");

    try {
      debugLog("Checking permissions and push support");
      this.isParent = isParent();

      // Check push notification support
      this.pushSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
      debugLog("Push support check:", { supported: this.pushSupported, notification: 'Notification' in window, sw: 'serviceWorker' in navigator, push: 'PushManager' in window });

      if (this.pushSupported) {
        debugLog("Checking push subscription status");
        this.pushEnabled = await this.checkPushSubscription();
        debugLog("Push subscription check complete:", { enabled: this.pushEnabled });
      }

      debugLog("Loading starting user data");
      await this.loadUserData();
      debugLog("User data load complete");

      if (this.isParent) {
        debugLog("Loading guardian profile (parent role detected)");
        await this.loadGuardianProfile();
        debugLog("Guardian profile load complete");
      } else {
        debugLog("Skipping guardian profile (not a parent)");
        this.guardianProfile = { guardian: null, participantIds: [] };
        this.guardianError = null;
      }

      debugLog("Proceeding to initial render");
      this.render();
      debugLog("Initial render complete, attaching event listeners");
      this.attachEventListeners();
      debugLog("Initialization complete");
    } catch (error) {
      debugError("Error initializing settings module:", error);
      this.renderError(translate("error_loading_data"));
    }
  }

  /**
   * Check if user has an active push subscription
   */
  async checkPushSubscription() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        debugLog("ServiceWorker or PushManager not available");
        return false;
      }

      debugLog("Waiting for service worker to be ready (with 2s timeout)");

      // Use a timeout to prevent hanging if the service worker doesn't become ready
      const swReadyPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Service worker ready timeout")), 2000)
      );

      try {
        const registration = await Promise.race([swReadyPromise, timeoutPromise]);
        debugLog("Service worker ready");
        const subscription = await registration.pushManager.getSubscription();
        return subscription !== null;
      } catch (timeoutError) {
        debugWarn("Service worker check timed out or failed, continuing without push status:", timeoutError.message);
        return false;
      }
    } catch (error) {
      debugError("Error checking push subscription:", error);
      return false;
    }
  }

  /**
   * Load guardian profile for the authenticated user
   */
  async loadGuardianProfile() {
    try {
      const response = await makeApiRequest("v1/users/me/guardian-profile", { method: "GET" });

      if (response.success) {
        this.guardianProfile = response.data || { guardian: null, participantIds: [] };
        this.guardianError = null;
      } else {
        this.guardianError = response.message || translate("guardian_load_error");
      }
    } catch (error) {
      debugError("Error loading guardian profile:", error);
      const errorMessage = typeof error.message === "string" && error.message.toLowerCase().includes("no linked participants")
        ? translate("guardian_no_participants")
        : error.message;
      this.guardianError = errorMessage || translate("guardian_load_error");
      this.guardianProfile = { guardian: null, participantIds: [] };
    }
  }

  /**
   * Load current user data from API
   */
  async loadUserData() {
    try {
      debugLog("Loading user data");
      const response = await makeApiRequest("v1/users/me", {
        method: "GET",
      });

      if (response.success) {
        this.userData = response.data;
        debugLog("User data loaded:", this.userData);
      } else {
        throw new Error(response.message || "Failed to load user data");
      }
    } catch (error) {
      debugError("Error loading user data:", error);
      throw error;
    }
  }

  /**
   * Render the settings page
   */
  render() {
    const homeLink = this.isParent ? "/parent-dashboard" : "/dashboard";

    const fullName = escapeHTML(this.userData?.full_name || "");
    const email = escapeHTML(this.userData?.email || "");
    const roles = Array.isArray(this.userData?.roles) ? this.userData.roles.join(", ") : "";

    // Get current UI language (not just preference)
    const currentLang = this.app.lang || getStorage('lang', false, CONFIG.DEFAULT_LANG);
    const timeFormatKey = getStorageKey("TIME_FORMAT");
    const defaultTimeFormat = CONFIG?.TIME_FORMAT?.DEFAULT || "24h";
    const currentTimeFormat = getStorage(timeFormatKey, false, defaultTimeFormat);

    const guardianData = this.guardianProfile?.guardian || {};
    const nameParts = fullName ? fullName.split(" ") : [];
    const defaultGuardianFirstName = guardianData.prenom || nameParts[0] || "";
    const defaultGuardianLastName = guardianData.nom || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");
    const guardianRelationship = guardianData.lien || "";
    const guardianHomePhone = guardianData.telephone_residence || "";
    const guardianWorkPhone = guardianData.telephone_travail || "";
    const guardianMobilePhone = guardianData.telephone_cellulaire || "";
    const guardianPrimary = guardianData.is_primary ?? true;
    const guardianEmergency = guardianData.is_emergency_contact ?? false;
    const hasParticipantLinks = Array.isArray(this.guardianProfile?.participantIds) && this.guardianProfile.participantIds.length > 0;

    const content = `
      <div class="settings-page">
        <header class="settings-header">
          <a href="${homeLink}" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
          <h1>${translate("settings") || translate("account_settings") || translate("account_info_title")}</h1>
        </header>

        <!-- Profile Summary Section -->
        <section class="account-section profile-summary">
          <div class="profile-card">
            <div class="profile-name">${fullName}</div>
            <div class="profile-role">${escapeHTML(roles)}</div>
          </div>
        </section>

        <!-- Profile Information Section -->
        <section class="account-section">
          <h2>${translate("profile_information") || translate("profile")}</h2>

          <form id="fullname-form" class="account-form">
            <div class="form-group">
              <label for="fullname-input">${translate("full_name") || translate("account_info_fullname_label")}</label>
              <input
                type="text"
                id="fullname-input"
                name="fullName"
                value="${fullName}"
                placeholder="${translate("enter_full_name") || translate("account_info_fullname_placeholder")}"
                required
                minlength="2"
                maxlength="100"
                autocomplete="name"
              />
            </div>
            <button type="submit" class="btn btn-primary" id="fullname-submit">
              ${translate("save_profile") || translate("account_info_fullname_button")}
            </button>
          </form>
        </section>

        <!-- Email Section -->
        <section class="account-section">
          <h2>${translate("email") || translate("account_info_email_title")}</h2>
          <div class="warning-box">
            <p>${translate("account_info_email_warning")}</p>
          </div>
          <form id="email-form" class="account-form">
            <div class="form-group">
              <label for="email-input">${translate("email") || translate("account_info_email_label")}</label>
              <input
                type="email"
                id="email-input"
                name="email"
                value="${email}"
                placeholder="${translate("enter_email") || translate("account_info_email_placeholder")}"
                required
                autocomplete="email"
              />
              <small class="form-text">${translate("account_info_email_warning")}</small>
            </div>
            <button type="submit" class="btn btn-primary" id="email-submit">
              ${translate("account_info_email_button")}
            </button>
          </form>
        </section>

        ${this.isParent ? `
          <!-- Guardian Information Section (Parents only) -->
          <section class="account-section">
            <h2>${translate("guardian_info_title")}</h2>
            <p class="section-description">${translate("guardian_info_description")}</p>
            <div class="warning-box">
              <p>${translate("account_info_guardian_sync_notice")}</p>
              ${this.guardianError ? `<p>${escapeHTML(this.guardianError)}</p>` : ""}
              ${!hasParticipantLinks ? `<p>${translate("guardian_no_participants")}</p>` : ""}
            </div>
            <form id="guardian-form" class="account-form">
              <div class="form-group">
                <label for="guardian-first-name">${translate("guardian_first_name")}</label>
                <input
                  type="text"
                  id="guardian-first-name"
                  name="guardianFirstName"
                  value="${escapeHTML(defaultGuardianFirstName)}"
                  placeholder="${translate("guardian_first_name")}"
                  required
                  maxlength="120"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-last-name">${translate("guardian_last_name")}</label>
                <input
                  type="text"
                  id="guardian-last-name"
                  name="guardianLastName"
                  value="${escapeHTML(defaultGuardianLastName)}"
                  placeholder="${translate("guardian_last_name")}"
                  required
                  maxlength="120"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-relationship">${translate("guardian_relationship")}</label>
                <input
                  type="text"
                  id="guardian-relationship"
                  name="guardianRelationship"
                  value="${escapeHTML(guardianRelationship)}"
                  placeholder="${translate("guardian_relationship")}"
                  maxlength="120"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-home-phone">${translate("guardian_phone_home")}</label>
                <input
                  type="tel"
                  id="guardian-home-phone"
                  name="guardianHomePhone"
                  value="${escapeHTML(guardianHomePhone)}"
                  placeholder="${translate("guardian_phone_home")}"
                  maxlength="20"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-work-phone">${translate("guardian_phone_work")}</label>
                <input
                  type="tel"
                  id="guardian-work-phone"
                  name="guardianWorkPhone"
                  value="${escapeHTML(guardianWorkPhone)}"
                  placeholder="${translate("guardian_phone_work")}"
                  maxlength="20"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-mobile-phone">${translate("guardian_phone_mobile")}</label>
                <input
                  type="tel"
                  id="guardian-mobile-phone"
                  name="guardianMobilePhone"
                  value="${escapeHTML(guardianMobilePhone)}"
                  placeholder="${translate("guardian_phone_mobile")}"
                  maxlength="20"
                  ${!hasParticipantLinks ? "disabled" : ""}
                />
              </div>
              <div class="form-group">
                <label for="guardian-primary">
                  <input type="checkbox" id="guardian-primary" name="guardianPrimary" ${guardianPrimary ? "checked" : ""} ${!hasParticipantLinks ? "disabled" : ""}>
                  ${translate("guardian_primary_contact")}
                </label>
              </div>
              <div class="form-group">
                <label for="guardian-emergency">
                  <input type="checkbox" id="guardian-emergency" name="guardianEmergency" ${guardianEmergency ? "checked" : ""} ${!hasParticipantLinks ? "disabled" : ""}>
                  ${translate("guardian_emergency_contact")}
                </label>
              </div>
              <button type="submit" class="btn btn-primary" id="guardian-submit" ${!hasParticipantLinks ? "disabled" : ""}>
                ${translate("guardian_save")}
              </button>
            </form>
          </section>
        ` : ""}

        <!-- Password Section -->
        <section class="account-section">
          <h2>${translate("change_password") || translate("account_info_password_title")}</h2>
          <form id="password-form" class="account-form">
            <div class="form-group">
              <label for="current-password-input">${translate("current_password") || translate("account_info_password_current_label")}</label>
              <input
                type="password"
                id="current-password-input"
                name="currentPassword"
                placeholder="${translate("enter_current_password") || ""}"
                required
                autocomplete="current-password"
              />
            </div>
            <div class="form-group">
              <label for="new-password-input">${translate("new_password") || translate("account_info_password_new_label")}</label>
              <input
                type="password"
                id="new-password-input"
                name="newPassword"
                placeholder="${translate("enter_new_password") || ""}"
                required
                minlength="8"
                autocomplete="new-password"
              />
              <small class="form-text">${translate("error_password_too_short") || "Minimum 8 characters"}</small>
            </div>
            <div class="form-group">
              <label for="confirm-password-input">${translate("confirm_password") || translate("account_info_password_confirm_label")}</label>
              <input
                type="password"
                id="confirm-password-input"
                name="confirmPassword"
                placeholder="${translate("confirm_new_password") || ""}"
                required
                minlength="8"
                autocomplete="new-password"
              />
            </div>
            <button type="submit" class="btn btn-primary" id="password-submit">
              ${translate("change_password") || translate("account_info_password_button")}
            </button>
          </form>
        </section>

        <!-- Language Section -->
        <section class="account-section">
          <h2>${translate("language")}</h2>
          <p class="section-description">${translate("account_info_language_description") || "Select your preferred language"}</p>
          <div class="language-selector">
            <button class="language-option ${currentLang === 'en' ? 'active' : ''}" data-lang="en">
              <span class="language-label">English</span>
              ${currentLang === 'en' ? '<span class="checkmark">✓</span>' : ''}
            </button>
            <button class="language-option ${currentLang === 'fr' ? 'active' : ''}" data-lang="fr">
              <span class="language-label">Français</span>
              ${currentLang === 'fr' ? '<span class="checkmark">✓</span>' : ''}
            </button>
            <button class="language-option ${currentLang === 'uk' ? 'active' : ''}" data-lang="uk">
              <span class="language-label">Українська</span>
              ${currentLang === 'uk' ? '<span class="checkmark">✓</span>' : ''}
            </button>
            <button class="language-option ${currentLang === 'it' ? 'active' : ''}" data-lang="it">
              <span class="language-label">Italiano</span>
              ${currentLang === 'it' ? '<span class="checkmark">✓</span>' : ''}
            </button>
          </div>
        </section>

        <!-- Time Format Section -->
        <section class="account-section">
          <h2>${translate("time_format")}</h2>
          <p class="section-description">${translate("time_format_description")}</p>
          <div class="setting-row">
            <label for="time-format-select" class="setting-label">
              <span>${translate("time_format")}</span>
            </label>
            <select id="time-format-select" class="settings-select">
              <option value="24h" ${currentTimeFormat === "24h" ? "selected" : ""}>${translate("time_format_24h")}</option>
              <option value="12h" ${currentTimeFormat === "12h" ? "selected" : ""}>${translate("time_format_12h")}</option>
            </select>
          </div>
        </section>

        <!-- Notifications Section -->
        ${this.pushSupported ? `
        <section class="account-section">
          <h2>${translate("notifications")}</h2>
          <p class="section-description">${translate("receive_notifications_about_activities") || "Receive push notifications about activities and updates"}</p>
          <div class="setting-row">
            <label for="push-toggle" class="setting-label">
              <span>${translate("push_notifications")}</span>
            </label>
            <label class="toggle-switch">
              <input type="checkbox" id="push-toggle" ${this.pushEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <small class="form-text" id="push-status-text">
            ${this.pushEnabled ? (translate("push_enabled") || "Push notifications enabled") : (translate("push_disabled") || "Push notifications disabled")}
          </small>
        </section>
        ` : ''}

        <!-- Account Actions -->
        <section class="account-section">
          <button class="btn btn-danger" id="logout-btn">
            ${translate("logout")}
          </button>
        </section>

        <div class="settings-footer">
          <p>${translate("Made with")} ❤️ ${translate("for Scouts")}</p>
        </div>
      </div>
    `;

    const appContainer = document.getElementById("app");
    if (appContainer) {
      setContent(appContainer, content);
    } else {
      debugError("App container not found");
    }
  }

  /**
   * Render error message
   * @param {string} message - Error message to display
   */
  renderError(message) {
    const content = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <div class="error-container">
        <h1>${translate("error")}</h1>
        <p>${escapeHTML(message)}</p>
        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      </div>
    `;

    const appContainer = document.getElementById("app");
    if (appContainer) {
      setContent(appContainer, content);
    }
  }

  /**
   * Attach event listeners to forms and buttons
   */
  attachEventListeners() {
    // Full name form
    const fullnameForm = document.getElementById("fullname-form");
    if (fullnameForm) {
      fullnameForm.addEventListener("submit", (e) => this.handleFullNameUpdate(e));
    }

    // Email form
    const emailForm = document.getElementById("email-form");
    if (emailForm) {
      emailForm.addEventListener("submit", (e) => this.handleEmailUpdate(e));
    }

    // Guardian info form
    const guardianForm = document.getElementById("guardian-form");
    if (guardianForm) {
      guardianForm.addEventListener("submit", (e) => this.handleGuardianUpdate(e));
    }

    // Password form
    const passwordForm = document.getElementById("password-form");
    if (passwordForm) {
      passwordForm.addEventListener("submit", (e) => this.handlePasswordChange(e));
    }

    // Language selector buttons
    const languageButtons = document.querySelectorAll(".language-option");
    languageButtons.forEach(btn => {
      btn.addEventListener("click", (e) => this.handleLanguageChange(e));
    });

    // Push notification toggle
    const pushToggle = document.getElementById("push-toggle");
    if (pushToggle) {
      pushToggle.addEventListener("change", (e) => this.handlePushToggle(e));
    }

    const timeFormatSelect = document.getElementById("time-format-select");
    if (timeFormatSelect) {
      timeFormatSelect.addEventListener("change", (e) => this.handleTimeFormatChange(e));
    }

    // Logout button
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => this.handleLogout());
    }
  }

  /**
   * Handle guardian information update
   * @param {Event} event - Form submit event
   */
  async handleGuardianUpdate(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const submitButton = form.querySelector("#guardian-submit");

    const firstNameInput = form.querySelector("#guardian-first-name");
    const lastNameInput = form.querySelector("#guardian-last-name");
    const relationshipInput = form.querySelector("#guardian-relationship");
    const homePhoneInput = form.querySelector("#guardian-home-phone");
    const workPhoneInput = form.querySelector("#guardian-work-phone");
    const mobilePhoneInput = form.querySelector("#guardian-mobile-phone");
    const primaryCheckbox = form.querySelector("#guardian-primary");
    const emergencyCheckbox = form.querySelector("#guardian-emergency");

    const firstName = firstNameInput?.value.trim() || "";
    const lastName = lastNameInput?.value.trim() || "";
    const relationship = relationshipInput?.value.trim() || "";
    const homePhone = homePhoneInput?.value.trim() || "";
    const workPhone = workPhoneInput?.value.trim() || "";
    const mobilePhone = mobilePhoneInput?.value.trim() || "";
    const primaryContact = primaryCheckbox?.checked || false;
    const emergencyContact = emergencyCheckbox?.checked || false;

    if (!firstName || !lastName) {
      this.app.showMessage(translate("guardian_validation_error"), "error");
      return;
    }

    const phonePattern = /^[0-9+().\-\s]{0,20}$/;
    const phoneValues = [homePhone, workPhone, mobilePhone].filter(Boolean);
    const hasInvalidPhone = phoneValues.some((phone) => !phonePattern.test(phone));

    if (hasInvalidPhone) {
      this.app.showMessage(translate("guardian_phone_invalid"), "error");
      return;
    }

    let rerendered = false;

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      const response = await makeApiRequest("v1/users/me/guardian-profile", {
        method: "PATCH",
        body: {
          firstName,
          lastName,
          relationship,
          homePhone,
          workPhone,
          mobilePhone,
          primaryContact,
          emergencyContact,
        },
      });

      if (response.success) {
        this.guardianProfile = response.data || { guardian: null, participantIds: [] };
        await this.loadGuardianProfile();
        this.app.showMessage(translate("guardian_save_success"), "success");
        this.render();
        this.attachEventListeners();
        rerendered = true;
      } else {
        throw new Error(response.message || translate("guardian_save_error"));
      }
    } catch (error) {
      debugError("Error updating guardian info:", error);
      const errorMessage = typeof error.message === "string" && error.message.toLowerCase().includes("no linked participants")
        ? translate("guardian_no_participants")
        : error.message;
      this.app.showMessage(errorMessage || translate("guardian_save_error"), "error");
    } finally {
      this.isLoading = false;
      if (!rerendered && submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = translate("guardian_save");
      }
    }
  }

  /**
   * Handle full name update
   * @param {Event} event - Form submit event
   */
  async handleFullNameUpdate(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const fullNameInput = form.querySelector("#fullname-input");
    const fullName = fullNameInput.value.trim();
    const submitButton = form.querySelector("#fullname-submit");

    // Validate input
    if (!fullName || fullName.length < 2) {
      this.app.showMessage(translate("account_info_fullname_error"), "error");
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      debugLog("Updating full name:", fullName);

      const response = await makeApiRequest("v1/users/me/name", {
        method: "PATCH",
        body: { fullName },
      });

      if (response.success) {
        this.app.showMessage(translate("success_profile_updated") || translate("account_info_fullname_success"), "success");
        this.userData.full_name = response.data.full_name;

        // Update stored user name if present
        const storedName = localStorage.getItem("userFullName");
        if (storedName) {
          localStorage.setItem("userFullName", response.data.full_name);
        }
      } else {
        throw new Error(response.message || translate("account_info_fullname_error"));
      }
    } catch (error) {
      debugError("Error updating full name:", error);
      this.app.showMessage(translate("account_info_fullname_error"), "error");
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("save_profile") || translate("account_info_fullname_button");
    }
  }

  /**
   * Handle email update
   * @param {Event} event - Form submit event
   */
  async handleEmailUpdate(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const emailInput = form.querySelector("#email-input");
    const email = emailInput.value.trim();
    const submitButton = form.querySelector("#email-submit");

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      this.app.showMessage(translate("error_email_invalid") || translate("account_info_email_invalid"), "error");
      return;
    }

    // Confirm action since it will log them out
    if (!confirm(translate("email_changed_logout_warning") || translate("account_info_email_warning"))) {
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      debugLog("Updating email:", email);

      const response = await makeApiRequest("v1/users/me/email", {
        method: "PATCH",
        body: { email },
      });

      if (response.success) {
        this.app.showMessage(translate("account_info_email_success"), "success");

        // Clear auth data and redirect to login after a short delay
        setTimeout(() => {
          localStorage.removeItem("jwtToken");
          localStorage.removeItem("userRole");
          localStorage.removeItem("userFullName");
          localStorage.removeItem("userId");
          window.location.href = "/login";
        }, 2000);
      } else {
        throw new Error(response.message || translate("account_info_email_error"));
      }
    } catch (error) {
      debugError("Error updating email:", error);
      this.app.showMessage(error.message || translate("account_info_email_error"), "error");
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("account_info_email_button");
    }
  }

  /**
   * Handle password change
   * @param {Event} event - Form submit event
   */
  async handlePasswordChange(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const currentPasswordInput = form.querySelector("#current-password-input");
    const newPasswordInput = form.querySelector("#new-password-input");
    const confirmPasswordInput = form.querySelector("#confirm-password-input");
    const submitButton = form.querySelector("#password-submit");

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    // Validate passwords
    if (!currentPassword || !newPassword || !confirmPassword) {
      this.app.showMessage(translate("error_password_required") || translate("account_info_password_error"), "error");
      return;
    }

    if (newPassword.length < 8) {
      this.app.showMessage(translate("error_password_too_short") || translate("account_info_password_minlength"), "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      this.app.showMessage(translate("error_passwords_dont_match") || translate("account_info_password_mismatch"), "error");
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      debugLog("Changing password");

      const response = await makeApiRequest("v1/users/me/password", {
        method: "PATCH",
        body: {
          currentPassword,
          newPassword,
        },
      });

      if (response.success) {
        this.app.showMessage(translate("success_password_changed") || translate("account_info_password_success"), "success");

        // Clear the form
        form.reset();
      } else {
        // Check for specific error messages
        if (response.message && response.message.includes("incorrect")) {
          throw new Error(translate("account_info_password_wrong_current"));
        }
        throw new Error(response.message || translate("account_info_password_error"));
      }
    } catch (error) {
      debugError("Error changing password:", error);
      this.app.showMessage(error.message || translate("error_password_change_failed") || translate("account_info_password_error"), "error");
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("change_password") || translate("account_info_password_button");
    }
  }

  /**
   * Handle language change
   * @param {Event} event - Button click event
   */
  async handleLanguageChange(event) {
    event.preventDefault();

    const button = event.currentTarget;
    const newLang = button.dataset.lang;

    if (!newLang) return;

    try {
      debugLog("Changing language to:", newLang);

      // Update app language immediately
      await this.app.setLanguage(newLang);

      // Show success message
      this.app.showMessage(translate("Language changed") || "Language changed successfully", "success");

      // Re-render to update UI
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error changing language:", error);
      this.app.showMessage(translate("Error") || "Failed to change language", "error");
    }
  }

  /**
   * Handle time format change
   * @param {Event} event - Select change event
   */
  handleTimeFormatChange(event) {
    const selected = event.target.value;
    const timeFormatKey = getStorageKey("TIME_FORMAT");
    const normalized = selected === "12h" ? "12h" : "24h";

    setStorage(timeFormatKey, normalized);
    this.app.showMessage(translate("data_saved"), "success");

    this.render();
    this.attachEventListeners();
  }

  /**
   * Handle push notification toggle
   * @param {Event} event - Toggle change event
   */
  async handlePushToggle(event) {
    const enabled = event.target.checked;
    const statusText = document.getElementById("push-status-text");

    try {
      if (enabled) {
        // Request notification permission
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
          event.target.checked = false;
          this.app.showMessage(translate("notification_permission_denied") || "Notification permission denied", "error");
          return;
        }

        // Subscribe to push notifications
        await this.subscribeToPush();
        this.pushEnabled = true;

        if (statusText) {
          statusText.textContent = translate("push_enabled") || "Push notifications enabled";
        }
        this.app.showMessage(translate("push_notifications_enabled") || "Push notifications enabled", "success");
      } else {
        // Unsubscribe from push notifications
        await this.unsubscribeFromPush();
        this.pushEnabled = false;

        if (statusText) {
          statusText.textContent = translate("push_disabled") || "Push notifications disabled";
        }
        this.app.showMessage(translate("push_notifications_disabled") || "Push notifications disabled", "success");
      }
    } catch (error) {
      debugError("Error toggling push notifications:", error);
      event.target.checked = !enabled; // Revert toggle state
      this.app.showMessage(translate("push_notification_error") || "Failed to toggle push notifications", "error");
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribeToPush() {
    try {
      const registration = await navigator.serviceWorker.ready;

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // Get VAPID public key from config
        const { urlBase64ToUint8Array } = await import('../functions.js');
        const { CONFIG } = await import('../config.js');

        const applicationServerKey = urlBase64ToUint8Array(CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY);

        // Subscribe
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey,
        });
      }

      // Send subscription to server
      const subscriptionData = subscription.toJSON();

      const response = await makeApiRequest('v1/push-subscription', {
        method: 'POST',
        body: {
          endpoint: subscriptionData.endpoint,
          expirationTime: subscriptionData.expirationTime,
          keys: {
            p256dh: subscriptionData.keys.p256dh,
            auth: subscriptionData.keys.auth
          }
        }
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to save subscription');
      }

      debugLog('Push subscription successful');
    } catch (error) {
      debugError('Error subscribing to push:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribeFromPush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        debugLog('Unsubscribed from push notifications');
      }

      // Optionally notify server about unsubscription
      // You may want to add an endpoint for this
    } catch (error) {
      debugError('Error unsubscribing from push:', error);
      throw error;
    }
  }

  /**
   * Handle logout
   */
  async handleLogout() {
    if (!confirm(translate("confirm_logout_message") || translate("confirm_logout") || "Are you sure you want to log out?")) {
      return;
    }

    try {
      // Call logout API
      await makeApiRequest('auth/logout', { method: 'POST' }).catch(() => {
        // Ignore errors, we'll clear local data anyway
      });
    } catch (error) {
      debugError('Logout error:', error);
    } finally {
      // Clear local storage regardless of API result
      localStorage.removeItem("jwtToken");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userFullName");
      localStorage.removeItem("userId");
      localStorage.removeItem("userRoles");
      localStorage.removeItem("userPermissions");

      // Redirect to login
      window.location.href = "/login";
    }
  }
}
