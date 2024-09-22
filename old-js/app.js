import {
  initializeDB,
  saveOfflineData,
  getOfflineData,
  clearOfflineData,
} from "./indexedDB.js";

const app = {
  isLoggedIn: window.initialData.isLoggedIn,
  userRole: window.initialData.userRole,
  lang: window.initialData.lang,
  currentPage: "",
  translations: {},

  async init() {
    await this.loadTranslations();
    this.registerServiceWorker();
    this.attachEventListeners();
    this.handleNavigation();
  },

  async loadTranslations() {
    const response = await fetch("get_translations.php");
    this.translations = await response.json();
  },

  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => {
          console.log(
            "Service Worker registered with scope:",
            registration.scope
          );
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    }
  },

  attachEventListeners() {
    window.addEventListener("popstate", () => this.handleNavigation());
    document.addEventListener("click", (e) => {
      if (e.target.matches("a")) {
        e.preventDefault();
        const url = e.target.getAttribute("href");
        history.pushState(null, "", url);
        this.handleNavigation();
      }
    });
  },

  async handleNavigation() {
    const path = window.location.pathname;
    this.showLoading();
    try {
      if (path === "/login" || path === "/login.php") {
        await this.renderLoginPage();
      } else if (this.isLoggedIn) {
        if (path === "/" || path === "/index.php") {
          await this.renderDashboard();
        } else {
          // Handle other routes...
        }
      } else {
        history.replaceState(null, "", "/login.php");
        await this.renderLoginPage();
      }
    } catch (error) {
      console.error("Navigation error:", error);
      // Handle the error appropriately
    } finally {
      this.hideLoading();
    }
  },

  async renderLoginPage() {
    const content = `
            <h1>${this.translate("login")}</h1>
            <form id="login-form">
                <input type="email" name="email" placeholder="${this.translate(
                  "email"
                )}" required>
                <input type="password" name="password" placeholder="${this.translate(
                  "password"
                )}" required>
                <button type="submit">${this.translate("submit_login")}</button>
            </form>
            <p><a href="/register.php">${this.translate(
              "create_account"
            )}</a></p>
        `;
    this.updateContent(content);
    this.attachLoginFormListener();
  },

  async renderDashboard() {
    try {
      const response = await fetch("index.php", {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const data = await response.json();

      let content = `
                <h1>${this.translate("dashboard_title")}</h1>
                <div class="manage-items">
                    <a href="/manage_points.php">${this.translate(
                      "manage_points"
                    )}</a>
                    <a href="/manage_honors.php">${this.translate(
                      "manage_honors"
                    )}</a>
                    <a href="/attendance.php">${this.translate(
                      "attendance"
                    )}</a>
                </div>
                <div id="points-list">
                    ${this.renderParticipantsList(data.participants)}
                </div>
                <p><a href="/logout.php">${this.translate("logout")}</a></p>
            `;
      this.updateContent(content);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      this.updateContent(`<p>${this.translate("error_loading_dashboard")}</p>`);
    }
  },

  renderParticipantsList(participants) {
    return participants
      .map(
        (participant) => `
            <div class="participant-item">
                <span>${participant.first_name} ${participant.last_name}</span>
                <a href="/fiche_sante.php?id=${participant.id}">
                    ${participant.has_fiche_sante ? "✅" : "❌"}
                    ${this.translate("fiche_sante")}
                </a>
                <a href="/acceptation_risque.php?id=${participant.id}">
                    ${participant.has_acceptation_risque ? "✅" : "❌"}
                    ${this.translate("acceptation_risque")}
                </a>
            </div>
        `
      )
      .join("");
  },

  updateContent(content) {
    document.getElementById("app").innerHTML = content;
  },

  attachLoginFormListener() {
    const form = document.getElementById("login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      try {
        const response = await fetch("login.php", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (result.success) {
          this.isLoggedIn = true;
          history.pushState(null, "", "/");
          this.handleNavigation();
        } else {
          alert(result.message);
        }
      } catch (error) {
        console.error("Login error:", error);
        alert(this.translate("error_logging_in"));
      }
    });
  },

  showLoading() {
    document.getElementById("loading-indicator").style.display = "block";
  },

  hideLoading() {
    document.getElementById("loading-indicator").style.display = "none";
  },

  translate(key) {
    return this.translations[key] || key;
  },
};

document.addEventListener("DOMContentLoaded", () => app.init());
