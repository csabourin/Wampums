import { translate } from "./app.js";

export class Login {
  constructor(app) {
    this.app = app;
  }

  async init() {
    console.log("Login init started");

    // Try to fetch organization settings if not already loaded
    if (!this.app.organizationSettings && !this.app.isOrganizationSettingsFetched) {
      console.log("Organization settings not loaded, attempting to fetch...");
      try {
        await this.app.fetchOrganizationSettings();
      } catch (error) {
        console.error("Failed to fetch organization settings in login:", error);
      }
    }

    // Set a maximum wait time of 3 seconds for organization settings
    let attempts = 0;
    const maxAttempts = 30; // 30 * 100ms = 3 seconds

    while (!this.app.organizationSettings && attempts < maxAttempts) {
      console.log(`Waiting for organization settings... Attempt ${attempts + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // Render the login form even if we couldn't get organization settings
    console.log("Rendering login form, organizationSettings:", 
                this.app.organizationSettings ? "loaded" : "not loaded");
    this.render();
  }

  render() {
    console.log("Login.render() called");
    // Get organization name with fallback
    const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";
    console.log("Using organization name:", organizationName);

    const content = `
      <div class="login-container">
        <h1>${translate("login")}</h1>
        <h2>${organizationName}</h2> 
        <form id="login-form">
          <div class="form-group">
            <input type="email" name="email" placeholder="${translate("email")}" required>
          </div>
          <div class="form-group">
            <input type="password" name="password" placeholder="${translate("password")}" required>
          </div>
          <button type="submit" class="btn-primary">${translate("submit_login")}</button>
        </form>
        <p><a href="/register">${translate("create_account")}</a></p>
        <p><a href="/reset-password">${translate("forgot_password")}</a></p>
      </div>
    `;

    const appContainer = document.getElementById("app");
    if (appContainer) {
      appContainer.innerHTML = content;
      this.attachLoginFormListener();
      console.log("Login form rendered successfully");
    } else {
      console.error("Could not find app container element");
    }
  }

  async attachLoginFormListener() {
    const form = document.getElementById("login-form");
    if (!form) {
      console.error("Login form not found in DOM");
      return;
    }

    console.log("Attaching login form listener");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("Login form submitted");

      const formData = new FormData(form);
      try {
        console.log("Sending login request...");
        const response = await fetch("/api.php?action=login", {
          method: "POST",
          body: formData,
        });

        console.log("Login response status:", response.status);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseText = await response.text();
        console.log("Login response length:", responseText.length);

        let result;
        try {
          result = JSON.parse(responseText);
          console.log("Login result parsed successfully");
        } catch (parseError) {
          console.error("Error parsing JSON:", parseError);
          throw new Error("Invalid JSON response from server");
        }

        if (result.success) {
          console.log("Login successful, handling login success...");
          this.handleLoginSuccess(result);
        } else {
          console.warn("Login failed:", result.message);
          alert(result.message || "Login failed");
        }
      } catch (error) {
        console.error("Login error:", error);
        alert(`Error logging in: ${error.message}`);
      }
    });
    console.log("Login form listener attached");
  }

  handleLoginSuccess(result) {
    console.log("Handling login success:", result);
    this.app.isLoggedIn = true;
    this.app.userRole = result.user_role;
    this.app.userFullName = result.user_full_name || "User";

    // Store JWT token and user info
    localStorage.setItem("jwtToken", result.token);
    localStorage.setItem("userRole", result.user_role);
    localStorage.setItem("userFullName", this.app.userFullName);
    localStorage.setItem("userId", result.user_id);

    // Store guardian participants if available
    if (result.guardian_participants && result.guardian_participants.length > 0) {
      localStorage.setItem("guardianParticipants", JSON.stringify(result.guardian_participants));
    }

    console.log("LocalStorage updated with user info");

    // Redirect based on user role
    if (result.user_role === "parent") {
      console.log("Redirecting to parent dashboard");
      this.app.router.route("/parent-dashboard");
    } else {
      console.log("Redirecting to main dashboard");
      this.app.router.route("/dashboard");
    }
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
    const token = localStorage.getItem('jwtToken');
    const userRole = localStorage.getItem('userRole');
    const userFullName = localStorage.getItem('userFullName');
    const userId = localStorage.getItem('userId');

    // Simple check - we consider the user logged in if we have a token AND user ID
    // The actual token validation happens on the server
    const isLoggedIn = !!token && !!userId && !!userRole;

    console.log("Session check:", { isLoggedIn, userRole, userFullName, userId });
    return {
      isLoggedIn,
      userRole,
      userFullName,
      userId
    };
  }

  static async logout() {
    console.log("Logging out...");

    try {
      // Try to call the server logout endpoint
      await fetch("/api.php?action=logout", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("jwtToken")}`,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.warn("Error during server logout:", error);
      // Continue with client-side logout even if server logout fails
    }

    // Clear user data from localStorage
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userFullName");
    localStorage.removeItem("userId");
    localStorage.removeItem("guardianParticipants");

    console.log("Local storage cleared, redirecting to login page");

    // Redirect to login page
    window.location.href = "/login";
  }
}