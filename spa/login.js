import { translate } from "./app.js";

export class Login {
  constructor(app) {
    this.app = app;
  }

  async init() {
    // Wait until organization settings are fetched
    while (!this.app.organizationSettings) {
      await new Promise(resolve => setTimeout(resolve, 100));  // Poll every 100ms
    }

    this.render();
  }


  render() {
     const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";

    const content = `
            <h1>${translate("login")}</h1>
             <h2>${organizationName}</h2> 
            <form id="login-form">
                <input type="email" name="email" placeholder="${translate(
                  "email"
                )}" required>
                <input type="password" name="password" placeholder="${translate(
                  "password"
                )}" required>
                <button type="submit">${translate("submit_login")}</button>
            </form>
            <p><a href="/register">${translate("create_account")}</a></p>
             <p><a href="/reset-password">${translate("forgot_password")}</a></p>
        `;
    document.getElementById("app").innerHTML = content;
    this.attachLoginFormListener();
  }

  async attachLoginFormListener() {
    const form = document.getElementById("login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      try {
        console.log("Attempting login...");
        const response = await fetch("/api.php?action=login", {
          method: "POST",
          body: formData,
        });

        console.log("Response received:", response);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseText = await response.text();
        console.log("Response text:", responseText);

        let result;
        try {
          result = JSON.parse(responseText);
        } catch (parseError) {
          console.error("Error parsing JSON:", parseError);
          throw new Error("Invalid JSON response from server");
        }

        console.log("Parsed result:", result);

        if (result.success) {
          console.log("Login was successful, handling success...");
          this.handleLoginSuccess(result);
        } else {
          console.log("Login failed:", result.message);
          alert(result.message || "Login failed");
        }
      } catch (error) {
        console.error("Login error:", error);
        alert(`Error logging in: ${error.message}`);
      }
    });
  }

  handleLoginSuccess(result) {
    console.log("Login successful:", result);
    this.app.isLoggedIn = true;
    this.app.userRole = result.user_role;
    this.app.userFullName = result.user_full_name || "User";

    // Store JWT token and user info
    localStorage.setItem("jwtToken", result.token);
    localStorage.setItem("userRole", result.user_role);
    localStorage.setItem("userFullName", this.app.userFullName);

    console.log("LocalStorage after setting:", {
      jwtToken: localStorage.getItem("jwtToken"),
      userRole: localStorage.getItem("userRole"),
      userFullName: localStorage.getItem("userFullName"),
    });

    // Redirect based on user role
    if (result.user_role === "parent") {
      this.app.router.route("/parent-dashboard");
    } else {
      this.app.router.route("/dashboard");
    }
  }

  static checkSession() {
    const jwtToken = localStorage.getItem("jwtToken");
    const userRole = localStorage.getItem("userRole");
    const userFullName = localStorage.getItem("userFullName");

    return {
      isLoggedIn: !!jwtToken,
      userRole: userRole,
      userFullName: userFullName,
    };
  }

  static logout() {
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("userRole");
    // Redirect to login page
    window.location.href = "/";
  }
}
