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

  // showLinkParticipantsDialog(guardianParticipants) {
  //     const dialogContent = `
  //         <h2>${translate("link_existing_participants")}</h2>
  //         <p>${translate("existing_participants_found")}</p>
  //         <form id="link-participants-form">
  //             ${guardianParticipants.map(participant => `
  //                 <label>
  //                     <input type="checkbox" name="link_participants" value="${participant.participant_id}">
  //                     ${participant.first_name} ${participant.last_name}
  //                 </label>
  //             `).join('')}
  //             <button type="submit">${translate("link_selected_participants")}</button>
  //         </form>
  //     `;

  //     const dialog = document.createElement('div');
  //     dialog.innerHTML = dialogContent;
  //     dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border: 1px solid black; z-index: 1000;';
  //     document.body.appendChild(dialog);

  //     document.getElementById('link-participants-form').addEventListener('submit', async (e) => {
  //         e.preventDefault();
  //         const formData = new FormData(e.target);
  //         const selectedParticipants = formData.getAll('link_participants');

  //         try {
  //             const response = await fetch('/api.php?action=link_user_participants', {
  //                 method: 'POST',
  //                 headers: {
  //                     'Content-Type': 'application/json',
  //                     'Authorization': `Bearer ${localStorage.getItem('jwtToken')}`
  //                 },
  //                 body: JSON.stringify({ participant_ids: selectedParticipants })
  //             });
  //             const result = await response.json();
  //             if (result.success) {
  //                 this.app.showMessage(translate("participants_linked_successfully"));
  //             } else {
  //                 this.app.showMessage(translate("error_linking_participants"), "error");
  //             }
  //         } catch (error) {
  //             console.error("Error linking participants:", error);
  //             this.app.showMessage(translate("error_linking_participants"), "error");
  //         }

  //         document.body.removeChild(dialog);
  //         this.redirectAfterLogin(this.app.userRole);
  //     });
  // }

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

      // Store guardian participants if available
      if (result.guardian_participants && result.guardian_participants.length > 0) {
          localStorage.setItem("guardianParticipants", JSON.stringify(result.guardian_participants));
      }

      console.log("LocalStorage after setting:", {
          jwtToken: localStorage.getItem("jwtToken"),
          userRole: localStorage.getItem("userRole"),
          userFullName: localStorage.getItem("userFullName"),
          guardianParticipants: localStorage.getItem("guardianParticipants"),
      });

      // Redirect based on user role
      if (result.user_role === "parent") {
          this.app.router.route("/parent-dashboard");
      } else {
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

      return {
          isLoggedIn,
          userRole,
          userFullName,
          userId
      };
  }

  static logout() {
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("userRole");
    // Redirect to login page
    window.location.href = "/";
  }
}
