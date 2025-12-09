import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import {login, getApiUrl, getCurrentOrganizationId} from "./ajax-functions.js";
import { setStorage, getStorage, removeStorage, setStorageMultiple } from "./utils/StorageUtils.js";
import { clearAllClientData } from "./utils/ClientCleanupUtils.js";

export class Login {
  constructor(app) {
    this.app = app;
  }

  async init() {
    debugLog("Login init started");
    
    // Try to fetch organization settings if not already loaded
    if (!this.app.organizationSettings && !this.app.isOrganizationSettingsFetched) {
      debugLog("Organization settings not loaded, attempting to fetch...");
      try {
        await this.app.fetchOrganizationSettings();
      } catch (error) {
        debugError("Failed to fetch organization settings in login:", error);
      }
    }

    // Set a maximum wait time of 3 seconds for organization settings
    let attempts = 0;
    const maxAttempts = 30; // 30 * 100ms = 3 seconds

    while (!this.app.organizationSettings && attempts < maxAttempts) {
      debugLog(`Waiting for organization settings... Attempt ${attempts + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // Render the login form even if we couldn't get organization settings
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
      appContainer.innerHTML = content;
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
        debugLog("Login successful, handling login success...");
        this.handleLoginSuccess(result);
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
  const userFullName = result.user_full_name || (result.data && result.data.user_full_name) || "User";
  const organizationId = result.organization_id || (result.data && result.data.organization_id);

  // Validate required fields
  if (!token) {
    debugError("ERROR: No JWT token received in login response");
    const statusElement = document.getElementById("login-message");
    if (statusElement) {
      statusElement.textContent = translate("login_error_no_token");
      statusElement.className = "status-message error";
    }
    return;
  }

  if (!userId) {
    debugError("ERROR: No user ID received in login response");
    const statusElement = document.getElementById("login-message");
    if (statusElement) {
      statusElement.textContent = translate("login_error_no_user_id");
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
  this.app.userRole = userRole;
  this.app.userFullName = userFullName;

  // Store user data in localStorage using StorageUtils
  const userData = {
    jwtToken: token,
    userRole: userRole || "",
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
  debugLog("currentOrganizationId:", getStorage("currentOrganizationId"));
  debugLog("organizationId:", getStorage("organizationId"));

  // Redirect based on user role
  if (userRole === "parent") {
    debugLog("Redirecting to parent dashboard");
    this.app.router.route("/parent-dashboard");
  } else {
    debugLog("Redirecting to main dashboard");
    this.app.router.route("/dashboard");
  }
}

  translateApiMessage(message) {
    const messageKey = message || "invalid_email_or_password";
    const messageMap = {
      invalid_email_or_password: translate("invalid_email_or_password"),
      account_not_verified_login: translate("account_not_verified_login") || translate("invalid_email_or_password"),
      too_many_login_attempts: translate("too_many_login_attempts") || translate("invalid_email_or_password"),
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
   * @returns {Object} Session information: isLoggedIn, userRole, and userFullName
   */
  static checkSession() {
    const token = getStorage('jwtToken');
    const userRole = getStorage('userRole');
    const userFullName = getStorage('userFullName');
    const userId = getStorage('userId');

    // Simple check - we consider the user logged in if we have a token AND user ID
    // The actual token validation happens on the server
    const isLoggedIn = !!token && !!userId && !!userRole;

    debugLog("Session check:", { isLoggedIn, userRole, userFullName, userId });
    return {
      isLoggedIn,
      userRole,
      userFullName,
      userId
    };
  }

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