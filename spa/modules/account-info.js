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

/**
 * Account Information Management Class
 */
export class AccountInfoModule {
  constructor(app) {
    this.app = app;
    this.userData = null;
    this.isLoading = false;
  }

  /**
   * Initialize the module
   * Loads user data and renders the page
   */
  async init() {
    debugLog("Initializing AccountInfoModule");
    try {
      await this.loadUserData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing account info module:", error);
      this.renderError(translate("error_loading_data"));
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
    const fullName = escapeHTML(this.userData?.full_name || "");
    const email = escapeHTML(this.userData?.email || "");

    const content = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
      <h1>${translate("account_info_title")}</h1>

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

    // Password form
    const passwordForm = document.getElementById("password-form");
    if (passwordForm) {
      passwordForm.addEventListener("submit", (e) => this.handlePasswordChange(e));
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
        body: JSON.stringify({ fullName }),
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
        body: JSON.stringify({ email }),
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
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
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
