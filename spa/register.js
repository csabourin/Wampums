import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import * as ajaxFunctions from "./ajax-functions.js";
import { setContent } from "./utils/DOMUtils.js";

export class Register {
  constructor(app) {
    this.app = app;
  }

  render() {
    const content = `
            <form id="register-form">
                <h1>${translate("register")}</h1>
                <div id="error-message" class="error hidden" role="alert" aria-live="assertive"></div>
                <div id="success-message" class="message hidden" role="status" aria-live="polite"></div>

                <label for="full_name">${translate("full_name")}:</label>
                <input type="text" id="full_name" name="full_name" autocomplete="name" required>

                <label for="email">${translate("email")}:</label>
                <input type="email" id="email" name="email" autocomplete="email" required>

                <label for="password">${translate("password")}:</label>
                <input type="password" id="password" name="password" autocomplete="new-password" required minlength="8" maxlength="255">
                <small class="password-hint">${translate("password_requirements")}</small>

                <label for="confirm_password">${translate(
      "confirm_password"
    )}:</label>
                <input type="password" id="confirm_password" name="confirm_password" autocomplete="new-password" required minlength="8" maxlength="255">

                <label for="account_creation_password">${translate(
      "account_creation_password"
    )}:</label>
                <input type="password" id="account_creation_password" name="account_creation_password" autocomplete="off" required>

                <label for="user_type">${translate("user_type")}:</label>
                <select id="user_type" name="user_type" required>
                    <option value="parent">${translate("parent")}</option>
                    <option value="leader">${translate("leader")}</option>
                    <option value="finance">${translate("finance")}</option>
                    <option value="equipment">${translate("equipment") || translate("inventory")}</option>
                    <option value="administration">${translate("administration")}</option>
                </select>

                <input id="register-submit" type="submit" value="${translate("register")}">
            </form>
            <p><a href="/login">${translate("already_have_account")}</a></p>
        `;
    setContent(document.getElementById("app"), content);
    this.attachEventListeners();
  }

  attachEventListeners() {
    document
      .getElementById("register-form")
      .addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async handleSubmit(e) {
    e.preventDefault();
    const submitButton = document.getElementById("register-submit");
    if (submitButton?.disabled) return;
    const defaultSubmitLabel = submitButton?.value || translate("register");
    const formData = new FormData(e.target);
    const registerData = Object.fromEntries(formData.entries());

    // Convert email to lowercase
    registerData.email = registerData.email.toLowerCase();

    if (registerData.password !== registerData.confirm_password) {
      this.showError(translate("passwords_do_not_match"));
      return;
    }

    const passwordError = this.validatePassword(registerData.password);
    if (passwordError) {
      this.showError(passwordError);
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.value = translate("loading");
    }

    try {
      const result = await ajaxFunctions.register(registerData);
      if (result.success) {
        if (submitButton) submitButton.dataset.completed = "true";
        this.showSuccess(this.translateMessage(result.message, "registration_successful"));
        setTimeout(() => this.app.router.route("/login"), 3000);
      } else {
        this.showError(this.translateMessage(result.message, "error_creating_account"));
      }
    } catch (error) {
      // Extract validation errors and display them
      let errorMessage = this.translateMessage(error.message, "error_creating_account");

      // An address that is already active here belongs to someone who should be
      // signing in, so the reset page is the right destination.
      if (error.message === "account_already_exists") {
        this.app.router.navigate("/reset-password?error=account_already_exists");
        return;
      }

      // An address that exists but is deactivated here — or belongs to another
      // unit — needs the reactivation page instead. Sending it to reset-password
      // was the closed loop this flow used to fall into: the reset it asked for
      // was refused just as silently.
      if (error.message === "account_exists_reactivation_available") {
        this.app.router.navigate("/reactivate-account");
        return;
      }

      // Check if there are specific validation errors
      if (error.message && error.message.includes('Validation failed:')) {
        // Extract the specific validation message after "Validation failed:"
        const validationError = error.message.split('Validation failed:')[1];
        if (validationError) {
          errorMessage = validationError.trim();
        }
      }

      this.showError(errorMessage);
    } finally {
      if (submitButton && submitButton.dataset.completed !== "true") {
        submitButton.disabled = false;
        submitButton.value = defaultSubmitLabel;
      }
    }
  }

  /**
   * Translate API message keys while keeping a localized fallback for network
   * errors and other messages that are not part of the language bundle.
   *
   * @param {string} message Message or translation key returned by the API
   * @param {string} fallbackKey Translation key used when no translation exists
   * @returns {string} Safe user-facing message
   */
  translateMessage(message, fallbackKey) {
    if (!message) return translate(fallbackKey);
    const translatedMessage = translate(message);
    return translatedMessage && translatedMessage !== message
      ? translatedMessage
      : translate(fallbackKey);
  }

  validatePassword(password) {
    if (password.length < 8) return translate("password_min_length");
    if (password.length > 255) return translate("password_max_length");
    if (!/[A-Z]/.test(password)) return translate("password_needs_uppercase");
    if (!/[a-z]/.test(password)) return translate("password_needs_lowercase");
    if (!/[0-9]/.test(password)) return translate("password_needs_number");
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return translate("password_needs_special");
    return null;
  }

  showError(message) {
    const errorElement = document.getElementById("error-message");
    const successElement = document.getElementById("success-message");
    if (!errorElement || !successElement) return;
    errorElement.textContent = message;
    errorElement.classList.remove("hidden");
    successElement.classList.add("hidden");
    errorElement.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }

  showSuccess(message) {
    const successElement = document.getElementById("success-message");
    const errorElement = document.getElementById("error-message");
    if (!successElement || !errorElement) return;
    successElement.textContent = message;
    successElement.classList.remove("hidden");
    errorElement.classList.add("hidden");
    successElement.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }
}
