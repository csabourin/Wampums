import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { login, verify2FA, getApiUrl, getCurrentOrganizationId, fetchOrganizationId } from "./ajax-functions.js";
import { setStorage, getStorage, removeStorage, setStorageMultiple } from "./utils/StorageUtils.js";
import { clearAllClientData } from "./utils/ClientCleanupUtils.js";
import { isParent } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

export class Login {
  constructor(app) {
    this.app = app;
  }

  /**
   * Ensure the current organization ID is available before rendering login.
   * Login API calls require the organization header, so this is a hard precondition.
   */
  async ensureOrganizationIdLoaded() {
    let organizationId = this.app.organizationId || getCurrentOrganizationId();

    if (organizationId) {
      this.app.organizationId = organizationId;
      return organizationId;
    }

    debugLog("No organization ID found in app/storage, fetching before login render...");

    try {
      const response = await fetchOrganizationId();
      const fetchedOrganizationId = response?.organization_id || response?.organizationId || response?.id || response || null;

      if (!fetchedOrganizationId) {
        throw new Error("Organization ID not found in API response");
      }

      const normalizedOrganizationId = String(fetchedOrganizationId);
      this.app.organizationId = normalizedOrganizationId;
      setStorageMultiple({
        currentOrganizationId: normalizedOrganizationId,
        organizationId: normalizedOrganizationId
      });

      debugLog("Organization ID fetched for login render:", normalizedOrganizationId);
      return normalizedOrganizationId;
    } catch (error) {
      debugError("Failed to fetch organization ID before login render:", error);
      throw error;
    }
  }

  async init() {
    debugLog("Login init started");

    try {
      await this.ensureOrganizationIdLoaded();
    } catch (error) {
      const appContainer = document.getElementById("app");
      if (appContainer) {
        setContent(appContainer, `
          <div class="login-container">
            <h1>${translate("login")}</h1>
            <div class="status-message error" role="alert">${translate("error_loading_application")}</div>
          </div>
        `);
      }
      return;
    }

    // Try to fetch organization settings if not already loaded
    // Since we're not logged in, this will use the public endpoint
    if (!this.app.organizationSettings && !this.app.isOrganizationSettingsFetched) {
      debugLog("Organization settings not loaded, attempting to fetch...");
      try {
        await this.app.fetchOrganizationSettings();
      } catch (error) {
        debugError("Failed to fetch organization settings in login:", error);
        // Don't block rendering if settings fetch fails
      }
    }

    // Render the login form immediately
    // Organization settings will be available now or use defaults
    debugLog("Rendering login form, organizationSettings:",
      this.app.organizationSettings ? "loaded" : "not loaded");
    this.render();
  }

  render() {
    debugLog("Login.render() called");
    // Get organization name with fallback
    const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";
    debugLog("Using organization name:", organizationName);

    const content = `
      <div class="login-container">
        <h1>${translate("login")}</h1>
        <h2>${organizationName}</h2>
        <form id="login-form">
          <div class="form-group">
            <input type="email" name="email" placeholder="${translate("email")}" autocomplete="email" required>
          </div>
          <div class="form-group">
            <input type="password" name="password" placeholder="${translate("password")}" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn-primary">${translate("submit_login")}</button>
        </form>
        <div id="login-message" class="status-message" role="status" aria-live="polite"></div>
        <p><a href="/register">${translate("create_account")}</a></p>
        <p><a href="/reset-password">${translate("forgot_password")}</a></p>
      </div>
    `;

    const appContainer = document.getElementById("app");
    if (appContainer) {
      setContent(appContainer, content);
      this.attachLoginFormListener();
      debugLog("Login form rendered successfully");
    } else {
      debugError("Could not find app container element");
    }
  }

  async attachLoginFormListener() {
    const form = document.getElementById("login-form");
    if (!form) {
      debugError("Login form not found in DOM");
      return;
    }

    debugLog("Attaching login form listener");
    const statusElement = document.getElementById("login-message");

    const setStatus = (message, type = "info") => {
      if (!statusElement) {
        return;
      }
      statusElement.textContent = message;
      statusElement.className = `status-message ${type}`;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      debugLog("Login form submitted");

      const formData = new FormData(form);

      // Extract the actual values from FormData
      const email = formData.get("email");
      const password = formData.get("password");

      setStatus("", "info");
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) {
        submitButton.disabled = true;
      }

      try {
        debugLog("Sending login request via ajax-functions.js..." + email);

        // Pass individual parameters instead of FormData object
        const result = await login(email, password);

        debugLog("Login result received:", result);

        if (result.success) {
          // Check if 2FA is required
          if (result.requires_2fa) {
            debugLog("2FA required, showing verification form...");
            this.show2FAForm(email, setStatus);
          } else {
            debugLog("Login successful, handling login success...");
            this.handleLoginSuccess(result);
          }
        } else {
          debugWarn("Login failed:", result.message);
          const friendlyMessage = this.translateApiMessage(result.message);
          setStatus(friendlyMessage, "error");
        }
      } catch (error) {
        debugError("Login error:", error);
        setStatus(`${translate("error_logging_in")}: ${error.message}`, "error");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });
    debugLog("Login form listener attached");
  }

  handleLoginSuccess(result) {
    debugLog("=== LOGIN SUCCESS DEBUG ===");
    debugLog("Full result object:", result);
    debugLog("result.success:", result.success);
    debugLog("result.token:", result.token);
    debugLog("result.user_id:", result.user_id);
    debugLog("result.user_role:", result.user_role);
    debugLog("result.user_full_name:", result.user_full_name);

    // Check if data is nested
    if (result.data) {
      debugLog("Data is nested under result.data:");
      debugLog("result.data.token:", result.data.token);
      debugLog("result.data.user_id:", result.data.user_id);
      debugLog("result.data.user_role:", result.data.user_role);
    }
    debugLog("=== END LOGIN DEBUG ===");

    // Handle both nested and flat response structures
    const token = result.token || (result.data && result.data.token);
    const userId = result.user_id || (result.data && result.data.user_id);
    const userRole = result.user_role || (result.data && result.data.user_role);
    const userRoles = result.user_roles || (result.data && result.data.user_roles) || [userRole]; // Array of role names
    const userPermissions = result.user_permissions || (result.data && result.data.user_permissions) || []; // Array of permission keys
    const userFullName = result.user_full_name || (result.data && result.data.user_full_name) || "User";
    const organizationId = result.organization_id || (result.data && result.data.organization_id);

    // Try to find the appropriate status element (could be login-message or verify-message)
    const statusElement = document.getElementById("verify-message") || document.getElementById("login-message");

    // Validate required fields
    if (!token) {
      debugError("ERROR: No JWT token received in login response");
      if (statusElement) {
        statusElement.textContent = translate("login_error_no_token") || "Login error: No authentication token received";
        statusElement.className = "status-message error";
      }
      return;
    }

    if (!userId) {
      debugError("ERROR: No user ID received in login response");
      if (statusElement) {
        statusElement.textContent = translate("login_error_no_user_id") || "Login error: No user ID received";
        statusElement.className = "status-message error";
      }
      return;
    }

    debugLog("=== STORING USER DATA ===");
    debugLog("Token:", token ? "EXISTS" : "MISSING");
    debugLog("User ID:", userId);
    debugLog("User Role:", userRole);
    debugLog("User Full Name:", userFullName);
    debugLog("Organization ID:", organizationId);

    // Update app state
    this.app.isLoggedIn = true;
    this.app.userRole = userRole; // Primary role (for backward compatibility)
    this.app.userRoles = userRoles; // All roles
    this.app.userPermissions = userPermissions; // All permissions
    this.app.userFullName = userFullName;

    // Store user data in localStorage using StorageUtils
    const userData = {
      jwtToken: token,
      userRole: userRole || "", // Primary role (for backward compatibility)
      userRoles: JSON.stringify(userRoles), // Store as JSON string
      userPermissions: JSON.stringify(userPermissions), // Store as JSON string
      userFullName: userFullName,
      userId: userId
    };

    // Store organization ID from login response
    if (organizationId) {
      userData.currentOrganizationId = organizationId;
      // Also store as organizationId for backward compatibility
      userData.organizationId = organizationId;
    }

    // Store guardian participants if available
    const guardianParticipants = result.guardian_participants || (result.data && result.data.guardian_participants);
    if (guardianParticipants && guardianParticipants.length > 0) {
      userData.guardianParticipants = guardianParticipants;
    }

    // Save all user data at once
    setStorageMultiple(userData);

    debugLog("=== FINAL LOCALSTORAGE CHECK ===");
    debugLog("jwtToken:", getStorage("jwtToken") ? "STORED" : "MISSING");
    debugLog("userId:", getStorage("userId"));
    debugLog("userRole:", getStorage("userRole"));
    debugLog("userRoles:", getStorage("userRoles"));
    debugLog("userPermissions:", getStorage("userPermissions"));
    debugLog("currentOrganizationId:", getStorage("currentOrganizationId"));
    debugLog("organizationId:", getStorage("organizationId"));

    // Redirect based on user role
    const targetPath = isParent() ? "/parent-dashboard" : "/dashboard";
    debugLog(`Redirecting to ${targetPath}`);

    // Update the URL in browser history
    history.pushState(null, "", targetPath);

    // Navigate using the router - it will now find the session data in localStorage
    setTimeout(() => {
      this.app.router.route(targetPath);
    }, 100);
  }

  /**
   * Show 2FA verification form
   * @param {string} email - User's email address
   * @param {Function} setStatus - Function to set status messages
   */
  show2FAForm(email, setStatus) {
    const appContainer = document.getElementById("app");
    if (!appContainer) {
      debugError("Could not find app container element");
      return;
    }

    const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";

    const content = `
      <div class="login-container">
        <h1>${translate("two_factor_verification") || "Verify Your Identity"}</h1>
        <h2>${organizationName}</h2>
        <p style="margin: 20px 0; text-align: center;">
          ${translate("two_factor_message") || "We've sent a 6-digit verification code to your email. Please enter it below."}
        </p>
        <form id="verify-2fa-form">
          <div class="form-group">
            <input
              type="text"
              name="code"
              placeholder="${translate("verification_code") || "Verification Code"}"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]{6}"
              inputmode="numeric"
              style="font-size: 24px; letter-spacing: 8px; text-align: center; font-family: monospace;"
              required>
          </div>
          <button type="submit" class="btn-primary">${translate("verify") || "Verify"}</button>
        </form>
        <div id="verify-message" class="status-message" role="status" aria-live="polite"></div>
        <p style="text-align: center; margin-top: 20px;">
          <a href="#" id="back-to-login">${translate("back_to_login") || "Back to Login"}</a>
        </p>
      </div>
    `;

    setContent(appContainer, content);
    this.attach2FAFormListener(email);
  }

  /**
   * Attach event listener to 2FA verification form
   * @param {string} email - User's email address
   */
  attach2FAFormListener(email) {
    const form = document.getElementById("verify-2fa-form");
    const statusElement = document.getElementById("verify-message");
    const backToLogin = document.getElementById("back-to-login");

    if (!form) {
      debugError("2FA form not found in DOM");
      return;
    }

    const setStatus = (message, type = "info") => {
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = `status-message ${type}`;
    };

    // Show success message
    setStatus(translate("verification_code_sent") || "A verification code has been sent to your email.", "success");

    // Handle back to login
    if (backToLogin) {
      backToLogin.addEventListener("click", (e) => {
        e.preventDefault();
        this.render();
      });
    }

    // Handle form submission
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      debugLog("2FA verification form submitted");

      const formData = new FormData(form);
      const code = formData.get("code");

      if (!code || code.length !== 6) {
        setStatus(translate("invalid_code_format") || "Please enter a valid 6-digit code.", "error");
        return;
      }

      setStatus("", "info");
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) {
        submitButton.disabled = true;
      }

      try {
        debugLog("Sending 2FA verification request...");

        const result = await verify2FA(email, code);

        debugLog("2FA verification result:", result);

        if (result.success) {
          debugLog("2FA verification successful, handling login success...");
          setStatus(translate("verification_successful") || "Verification successful! Logging you in...", "success");

          // Store device token if returned
          if (result.device_token) {
            localStorage.setItem('device_token', result.device_token);
            debugLog('Device token stored for future logins');
          }

          // Handle successful login
          this.handleLoginSuccess(result);
        } else {
          debugWarn("2FA verification failed:", result.message);
          const friendlyMessage = this.translate2FAMessage(result.message);
          setStatus(friendlyMessage, "error");
        }
      } catch (error) {
        debugError("2FA verification error:", error);
        setStatus(`${translate("verification_error") || "Verification failed"}: ${error.message}`, "error");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });

    // Auto-focus the code input
    const codeInput = form.querySelector('input[name="code"]');
    if (codeInput) {
      codeInput.focus();
    }

    debugLog("2FA form listener attached");
  }

  /**
   * Translate 2FA error messages
   */
  translate2FAMessage(message) {
    const messageKey = message || "invalid_2fa_code";
    const messageMap = {
      invalid_2fa_code: translate("invalid_verification_code") || "Invalid verification code.",
      invalid_or_expired_2fa_code: translate("invalid_or_expired_code") || "Invalid or expired verification code. Please try logging in again.",
      too_many_attempts: translate("too_many_attempts") || "Too many attempts. Please try logging in again.",
      internal_server_error: translate("internal_server_error") || "An error occurred. Please try again."
    };

    return messageMap[messageKey] || translate("verification_error") || "Verification failed. Please try again.";
  }

  translateApiMessage(message) {
    const messageKey = message || "invalid_email_or_password";
    const messageMap = {
      invalid_email_or_password: translate("invalid_email_or_password"),
      account_not_verified_login: translate("account_not_verified_login") || translate("invalid_email_or_password"),
      too_many_login_attempts: translate("too_many_login_attempts"),
      internal_server_error: translate("internal_server_error")
    };

    return messageMap[messageKey] || translate("invalid_credentials");
  }

  static decodeJwt(token) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  }

  /**
   * Check if user has a valid session
   * @returns {Object} Session information: isLoggedIn, userRole, userRoles, userPermissions, and userFullName
   */
  // function moved to SessionUtils.js

  static async logout() {
    debugLog("Logging out...");

    try {
      // Try to call the server logout endpoint
      await fetch(getApiUrl('logout'), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getStorage("jwtToken")}`,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      debugWarn("Error during server logout:", error);
      // Continue with client-side logout even if server logout fails
    }

    try {
      await clearAllClientData();
      debugLog("Client data cleared, redirecting to login page");
    } catch (cleanupError) {
      debugWarn("Error during client cleanup:", cleanupError);
    }

    // Redirect to login page
    window.location.href = "/login";
  }
}
