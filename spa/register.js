import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import * as ajaxFunctions from "./ajax-functions.js";

export class Register {
  constructor(app) {
    this.app = app;
  }

  render() {
    const content = `
            <form id="register-form">
                <h1>${translate("register")}</h1>
                <div id="error-message" class="error hidden"></div>
                <div id="success-message" class="success hidden"></div>

                <label for="full_name">${translate("full_name")}:</label>
                <input type="text" id="full_name" name="full_name" autocomplete="name" required>

                <label for="email">${translate("email")}:</label>
                <input type="email" id="email" name="email" autocomplete="email" required>

                <label for="password">${translate("password")}:</label>
                <input type="password" id="password" name="password" autocomplete="new-password" required>

                <label for="confirm_password">${translate(
                  "confirm_password"
                )}:</label>
                <input type="password" id="confirm_password" name="confirm_password" autocomplete="new-password" required>

                <label for="account_creation_password">${translate(
                  "account_creation_password"
                )}:</label>
                <input type="password" id="account_creation_password" name="account_creation_password" autocomplete="off" required>

                <label for="user_type">${translate("user_type")}:</label>
                <select id="user_type" name="user_type" required>
                    <option value="parent">${translate("parent")}</option>
                    <option value="animation">${translate("animation")}</option>
                </select>

                <input type="submit" value="${translate("register")}">
            </form>
            <p><a href="/login">${translate("already_have_account")}</a></p>
        `;
    document.getElementById("app").innerHTML = content;
    this.attachEventListeners();
  }

  attachEventListeners() {
    document
      .getElementById("register-form")
      .addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const registerData = Object.fromEntries(formData.entries());

    // Convert email to lowercase
    registerData.email = registerData.email.toLowerCase();

    if (registerData.password !== registerData.confirm_password) {
      this.showError(translate("passwords_do_not_match"));
      return;
    }

    try {
      const result = await ajaxFunctions.register(registerData);
      if (result.success) {
        this.showSuccess(result.message);
        setTimeout(() => this.app.router.route("/login"), 3000);
      } else {
        this.showError(result.message);
      }
    } catch (error) {
      debugError("Registration error:", error);
      // Display the specific error message if available, otherwise show generic error
      this.showError(error.message || translate("error_creating_account"));
    }
  }

  showError(message) {
    const errorElement = document.getElementById("error-message");
    const successElement = document.getElementById("success-message");
    errorElement.textContent = message;
    errorElement.style.display = "block";
    successElement.style.display = "none";
  }

  showSuccess(message) {
    const successElement = document.getElementById("success-message");
    const errorElement = document.getElementById("error-message");
    successElement.textContent = message;
    successElement.style.display = "block";
    errorElement.style.display = "none";
  }
}
