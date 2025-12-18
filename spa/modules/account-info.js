/**
 * Account Information Module
 *
 * Handles user profile management: viewing and updating name, email, and password
 * Follows Wampums module patterns with security best practices
 *
 * @module modules/account-info
 */

import { makeApiRequest } from "../api/api-core.js";
import { debugLog, debugError } from "../utils/DebugUtils.js";
import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { WhatsAppConnectionModule } from "./whatsapp-connection.js";

/**
 * Account Information Management Class
 */
export class AccountInfoModule {
  constructor(app) {
    this.app = app;
    this.userData = null;
    this.isLoading = false;
    this.whatsappModule = null;
    this.guardianProfile = { guardian: null, participantIds: [] };
    this.guardianError = null;
  }

  /**
   * Initialize the module
   * Loads user data and renders the page
   */
  async init() {
    debugLog("Initializing AccountInfoModule");
    try {
      await this.loadUserData();
      await this.loadGuardianProfile();

      // Initialize WhatsApp connection module
      this.whatsappModule = new WhatsAppConnectionModule(this.app);
      await this.whatsappModule.init();

      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing account info module:", error);
      this.renderError(translate("error_loading_data"));
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
   * Render the account information page
   */
  render() {
    const homeLink = this.app?.userRole === "parent" ? "/parent-dashboard" : "/dashboard";

    const fullName = escapeHTML(this.userData?.full_name || "");
    const email = escapeHTML(this.userData?.email || "");
    const languagePreference = this.userData?.language_preference || "";
    const whatsappPhone = escapeHTML(this.userData?.whatsapp_phone_number || "");

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
      <a href="${homeLink}" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <h1>${translate("account_settings") || translate("account_info_title")}</h1>

      <!-- Full Name Section -->
      <section class="account-section">
        <h2>${translate("account_info_fullname_title")}</h2>
        <form id="fullname-form" class="account-form">
          <div class="form-group">
            <label for="fullname-input">${translate("account_info_fullname_label")}</label>
            <input 
              type="text" 
              id="fullname-input" 
              name="fullName"
              value="${fullName}"
              placeholder="${translate("account_info_fullname_placeholder")}"
              required
              minlength="2"
              maxlength="100"
              autocomplete="name"
            />
          </div>
          <button type="submit" class="btn btn-primary" id="fullname-submit">
            ${translate("account_info_fullname_button")}
          </button>
        </form>
      </section>

      <!-- Email Section -->
      <section class="account-section">
        <h2>${translate("account_info_email_title")}</h2>
        <div class="warning-box">
          <p>${translate("account_info_email_warning")}</p>
        </div>
        <form id="email-form" class="account-form">
          <div class="form-group">
            <label for="email-input">${translate("account_info_email_label")}</label>
            <input 
              type="email" 
              id="email-input" 
              name="email"
              value="${email}"
              placeholder="${translate("account_info_email_placeholder")}"
              required
              autocomplete="email"
            />
          </div>
          <button type="submit" class="btn btn-primary" id="email-submit">
            ${translate("account_info_email_button")}
          </button>
        </form>
      </section>

      <!-- Guardian Information Section -->
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

      <!-- Language Preference Section -->
      <section class="account-section">
        <h2>${translate("account_info_language_title")}</h2>
        <p class="section-description">${translate("account_info_language_description")}</p>
        <form id="language-form" class="account-form">
          <div class="form-group">
            <label for="language-select">${translate("account_info_language_label")}</label>
            <select
              id="language-select"
              name="languagePreference"
              class="form-control"
            >
              <option value="" ${!languagePreference ? 'selected' : ''}>${translate("account_info_language_org_default")}</option>
              <option value="en" ${languagePreference === 'en' ? 'selected' : ''}>English</option>
              <option value="fr" ${languagePreference === 'fr' ? 'selected' : ''}>Français</option>
              <option value="uk" ${languagePreference === 'uk' ? 'selected' : ''}>Українська</option>
              <option value="it" ${languagePreference === 'it' ? 'selected' : ''}>Italiano</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" id="language-submit">
            ${translate("account_info_language_button")}
          </button>
        </form>
      </section>

      <!-- WhatsApp Phone Number Section -->
      <section class="account-section">
        <h2>${translate("account_info_whatsapp_title") || "WhatsApp Notifications"}</h2>
        <p class="section-description">${translate("account_info_whatsapp_description") || "Set your WhatsApp phone number to receive notifications via WhatsApp. Phone number must be in international format (e.g., +15551234567)."}</p>
        <form id="whatsapp-form" class="account-form">
          <div class="form-group">
            <label for="whatsapp-input">${translate("account_info_whatsapp_label") || "WhatsApp Phone Number"}</label>
            <input
              type="tel"
              id="whatsapp-input"
              name="whatsappPhoneNumber"
              value="${whatsappPhone}"
              placeholder="${translate("account_info_whatsapp_placeholder") || "+15551234567"}"
              pattern="^\\+[1-9]\\d{6,14}$"
              title="${translate("account_info_whatsapp_format_help") || "Format: +[country code][number] (e.g., +15551234567)"}"
              autocomplete="tel"
            />
            <small class="form-text">${translate("account_info_whatsapp_help") || "Leave empty to disable WhatsApp notifications"}</small>
          </div>
          <button type="submit" class="btn btn-primary" id="whatsapp-submit">
            ${translate("account_info_whatsapp_button") || "Update WhatsApp Number"}
          </button>
        </form>
      </section>

      <!-- WhatsApp Connection Section (Baileys) -->
      ${this.whatsappModule ? this.whatsappModule.render() : ''}

      <!-- Password Section -->
      <section class="account-section">
        <h2>${translate("account_info_password_title")}</h2>
        <form id="password-form" class="account-form">
          <div class="form-group">
            <label for="current-password-input">${translate("account_info_password_current_label")}</label>
            <input 
              type="password" 
              id="current-password-input" 
              name="currentPassword"
              required
              autocomplete="current-password"
            />
          </div>
          <div class="form-group">
            <label for="new-password-input">${translate("account_info_password_new_label")}</label>
            <input 
              type="password" 
              id="new-password-input" 
              name="newPassword"
              required
              minlength="8"
              autocomplete="new-password"
            />
          </div>
          <div class="form-group">
            <label for="confirm-password-input">${translate("account_info_password_confirm_label")}</label>
            <input 
              type="password" 
              id="confirm-password-input" 
              name="confirmPassword"
              required
              minlength="8"
              autocomplete="new-password"
            />
          </div>
          <button type="submit" class="btn btn-primary" id="password-submit">
            ${translate("account_info_password_button")}
          </button>
        </form>
      </section>
    `;

    const appContainer = document.getElementById("app");
    if (appContainer) {
      appContainer.innerHTML = content;
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
      appContainer.innerHTML = content;
    }
  }

  /**
   * Attach event listeners to forms
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

    // Language preference form
    const languageForm = document.getElementById("language-form");
    if (languageForm) {
      languageForm.addEventListener("submit", (e) => this.handleLanguageUpdate(e));
    }

    // WhatsApp phone number form
    const whatsappForm = document.getElementById("whatsapp-form");
    if (whatsappForm) {
      whatsappForm.addEventListener("submit", (e) => this.handleWhatsAppUpdate(e));
    }

    // Guardian info form
    const guardianForm = document.getElementById("guardian-form");
    if (guardianForm) {
      guardianForm.addEventListener("submit", (e) => this.handleGuardianUpdate(e));
    }

    // WhatsApp connection module event listeners
    if (this.whatsappModule) {
      this.whatsappModule.attachEventListeners();
    }

    // Password form
    const passwordForm = document.getElementById("password-form");
    if (passwordForm) {
      passwordForm.addEventListener("submit", (e) => this.handlePasswordChange(e));
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
        this.app.showMessage(translate("account_info_fullname_success"), "success");
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
      submitButton.textContent = translate("account_info_fullname_button");
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
      this.app.showMessage(translate("account_info_email_invalid"), "error");
      return;
    }

    // Confirm action since it will log them out
    if (!confirm(translate("account_info_email_warning"))) {
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
   * Handle language preference update
   * @param {Event} event - Form submit event
   */
  async handleLanguageUpdate(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const languageSelect = form.querySelector("#language-select");
    const languagePreference = languageSelect.value;
    const submitButton = form.querySelector("#language-submit");

    // Empty value means use organization default
    if (!languagePreference) {
      this.app.showMessage(translate("account_info_language_select_required"), "error");
      return;
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      debugLog("Updating language preference:", languagePreference);

      const response = await makeApiRequest("v1/users/me/language-preference", {
        method: "PATCH",
        body: { languagePreference },
      });

      if (response.success) {
        this.app.showMessage(translate("account_info_language_success"), "success");
        this.userData.language_preference = response.data.language_preference;
      } else {
        throw new Error(response.message || translate("account_info_language_error"));
      }
    } catch (error) {
      debugError("Error updating language preference:", error);
      this.app.showMessage(error.message || translate("account_info_language_error"), "error");
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("account_info_language_button");
    }
  }

  /**
   * Handle WhatsApp phone number update
   * @param {Event} event - Form submit event
   */
  async handleWhatsAppUpdate(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const whatsappInput = form.querySelector("#whatsapp-input");
    const whatsappPhoneNumber = whatsappInput.value.trim();
    const submitButton = form.querySelector("#whatsapp-submit");

    // Validate phone number format if provided (E.164 format)
    if (whatsappPhoneNumber) {
      const e164Regex = /^\+[1-9]\d{6,14}$/;
      if (!e164Regex.test(whatsappPhoneNumber)) {
        this.app.showMessage(
          translate("account_info_whatsapp_invalid_format") ||
          "Invalid phone number format. Please use international format (e.g., +15551234567)",
          "error"
        );
        return;
      }
    }

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("loading") || "Loading...";

      debugLog("Updating WhatsApp phone number:", whatsappPhoneNumber || "(removing)");

      const response = await makeApiRequest("v1/users/me/whatsapp-phone", {
        method: "PATCH",
        body: { whatsappPhoneNumber: whatsappPhoneNumber || null },
      });

      if (response.success) {
        const successMsg = whatsappPhoneNumber
          ? translate("account_info_whatsapp_success") || "WhatsApp phone number updated successfully"
          : translate("account_info_whatsapp_removed") || "WhatsApp phone number removed successfully";

        this.app.showMessage(successMsg, "success");
        this.userData.whatsapp_phone_number = response.data.whatsapp_phone_number;
      } else {
        throw new Error(response.message || translate("account_info_whatsapp_error"));
      }
    } catch (error) {
      debugError("Error updating WhatsApp phone number:", error);
      this.app.showMessage(
        error.message || translate("account_info_whatsapp_error") || "Failed to update WhatsApp phone number",
        "error"
      );
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("account_info_whatsapp_button") || "Update WhatsApp Number";
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
      this.app.showMessage(translate("account_info_password_error"), "error");
      return;
    }

    if (newPassword.length < 8) {
      this.app.showMessage(translate("account_info_password_minlength"), "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      this.app.showMessage(translate("account_info_password_mismatch"), "error");
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
        this.app.showMessage(translate("account_info_password_success"), "success");

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
      this.app.showMessage(error.message || translate("account_info_password_error"), "error");
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("account_info_password_button");
    }
  }
}
