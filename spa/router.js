import { Dashboard } from "./dashboard.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";
import { FormulaireInscription } from "./formulaire_inscription.js";
import { ManagePoints } from "./manage_points.js";
import { Attendance } from "./attendance.js";
import { ManageHonors } from "./manage_honors.js";
import { ManageParticipants } from "./manage_participants.js";
import { ManageUsersParticipants } from "./manage_users_participants.js";
import { ManageGroups } from "./manage_groups.js";
import { ViewParticipantDocuments } from "./view_participant_documents.js";
import { ParentContactList } from "./parent_contact_list.js";
import { ApproveBadges } from "./approve_badges.js";
import { FicheSante } from "./fiche_sante.js";
import { AcceptationRisque } from "./acceptation_risque.js";
import { BadgeForm } from "./badge_form.js";
import { Register } from "./register.js";
import { Admin } from "./admin.js";
import { MailingList } from "./mailing_list.js";
import { Calendars } from './calendars.js';
import {ResetPassword} from './reset_password.js';
import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { Reports } from "./reports.js";

const debugMode =
  window.location.hostname === "localhost" ||
  window.location.hostname.includes("replit.dev")
    ? true
    : false;

function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

function debugError(...args) {
  if (debugMode) {
    console.error(...args);
  }
}

const routes = {
  "/": "dashboard",
  "/admin": "admin",
  "/dashboard": "dashboard",
  "/index.php": "dashboard",
  "/login": "login",
  "/login.php": "login",
  "/logout": "logout",
  "/parent_dashboard": "parentDashboard",
  "/formulaire_inscription": "formulaireInscription",
  "/formulaire_inscription/:id": "formulaireInscription",
  "/attendance": "attendance",
  "/manage_points.php": "managePoints",
  "/managePoints": "managePoints",
  "/manage_honors.php": "manageHonors",
  "/attendance.php": "attendance",
  "/manage_participants": "manageParticipants",
  "/manage_participants.php": "manageParticipants",
  "/manage_groups.php": "manageGroups",
  "/view_participant_documents.php": "viewParticipantDocuments",
  "/approve_badges.php": "approveBadges",
  "/parent_contact_list.php": "parentContactList",
  "/mailing_list": "mailingList",
  "/manage_users_participants.php": "manageUsersParticipants",
  "/manage_points": "managePoints",
  "/manage_points.php": "managePoints",
  "/manage_honors": "manageHonors",
  "/manage_honors.php": "manageHonors",
  "/manage_users_participants": "manageUsersParticipants",
  "/manage_users_participants.php": "manageUsersParticipants",
  "/manage_groups": "manageGroups",
  "/parent_contact_list": "parentContactList",
  "/parent_contact_list.php": "parentContactList",
  "/view_participant_documents": "viewParticipantDocuments",
  "/view_participant_documents.php": "viewParticipantDocuments",
  "/approve_badges": "approveBadges",
  "/approve_badges.php": "approveBadges",
  "/fiche_sante/:id": "ficheSante",
  "/acceptation_risque/:id": "acceptationRisque",
  "/badge_form/:id": "badgeForm",
  "/register": "register",
  "/register.php": "register",
  "/calendars": "calendars",
  "/reset_password": "resetPassword",
   "/reports": "reports",
};

export class Router {
  constructor(app) {
    this.app = app;
  }

   navigate(path) {
    debugLog("Navigating to:", path);
    history.pushState(null, "", path);
    this.route(path);
  }

  async route(path) {
    debugLog("Routing to:", path);
    // Check if the path ends with .html
    if (path.endsWith('.html')) {
      // Do nothing, let the server handle this request
      return;}
    const [routeName, param] = this.getRouteNameAndParam(path);
    const dynamicFormMatch = path.match(/^\/dynamic-form\/([^\/]+)\/(\d+)$/);
      if (dynamicFormMatch) {
        const formType = dynamicFormMatch[1];
        const participantId = dynamicFormMatch[2];
        await this.loadDynamicForm(formType, participantId);
        return;
      }

    // Check session
    const session = Login.checkSession();
    this.app.isLoggedIn = session.isLoggedIn;
    this.app.userRole = session.userRole;
    this.app.userFullName = session.userFullName;

    try {
      // Allow access to login, register, and index pages without being logged in
      if (
        !this.app.isLoggedIn &&
        !["login", "register","reset_password", "resetPassword" ,""].includes(routeName)
      ) {
        // Redirect to login if not logged in and not trying to access allowed pages
        history.pushState(null, "", "/login");
        await this.loadLoginPage();
        return;
      }

      switch (routeName) {
        case "dashboard":
          if (this.app.userRole === "parent") {
            await this.loadParentDashboard();
          } else {
            await this.loadDashboard();
          }
          break;
          case "admin":
          if (this.app.userRole !== "admin") {
            this.loadNotAuthorizedPage();
          } else {
            await this.loadAdminPage();
          }
          break;
        case "calendars":
          if (this.app.userRole !== "admin" && this.app.userRole !== "animation"){
            this.loadNotAuthorizedPage();
          } else {
            await this.loadCalendarsPage();
          }
          break;
        case "parentDashboard":
          await this.loadParentDashboard();
          break;
        case "login":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            this.route(
              this.app.userRole === "parent"
                ? "/parent_dashboard"
                : "/dashboard"
            );
          } else {
            await this.loadLoginPage();
          }
          break;
        case "logout":
          await this.handleLogout();
          break;
          case "resetPassword":
          await this.loadResetPasswordPage();
          break;
        case "attendance":
          await this.loadAttendance();
          break;
        case "formulaireInscription":
          await this.loadFormulaireInscription(param);
          break;
          case "mailingList":
          await this.loadMailingList();
          break;
        case "managePoints":
          await this.loadManagePoints();
          break;
        case "manageHonors":
          await this.loadManageHonors();
          break;
        case "manageParticipants":
          await this.loadManageParticipants();
          break;
        case "manageUsersParticipants":
          await this.loadManageUsersParticipants();
          break;
        case "manageGroups":
          await this.loadManageGroups();
          break;
        case "viewParticipantDocuments":
          await this.loadViewParticipantDocuments();
          break;
        case "parentContactList":
          await this.loadParentContactList();
          break;
          case 'reports':
          await this.loadReports();
          break;
        case "approveBadges":
          await this.loadApproveBadges();
          break;
        case "ficheSante":
          await this.loadFicheSante(param);
          break;
        case "acceptationRisque":
          await this.loadAcceptationRisque(param);
          break;
        case "badgeForm":
          await this.loadBadgeForm(param);
          break;
        case "register":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            this.route(
              this.app.userRole === "parent"
                ? "/parent_dashboard"
                : "/dashboard"
            );
          } else {
            await this.loadRegisterPage();
          }
          break;
        // ... other cases ...
        default:
          this.loadNotFoundPage();
      }
    } catch (error) {
      console.error("Routing error:", error);
      this.app.renderError("An error occurred while loading the page.");
    }
  }

  async loadDynamicForm(formType, participantId) {
    const dynamicFormHandler = new DynamicFormHandler(this.app);
    await dynamicFormHandler.init(formType, participantId);
  }

  async loadCalendarsPage() {
    const calendars= new Calendars(this.app);
    await calendars.init();
  }

  getRouteNameAndParam(path) {
    const parts = path.split("/");
    if (parts.length > 2 && routes[`/${parts[1]}/:id`]) {
      return [routes[`/${parts[1]}/:id`], parts[2]];
    }
    return [routes[path] || "notFound", null];
  }

  async loadDashboard() {
    const dashboard = new Dashboard(this.app);
    await dashboard.init();
  }

  async loadAdminPage() {
    const admin = new Admin(this.app);
    await admin.init();
  }

  loadNotAuthorizedPage() {
    document.getElementById("app").innerHTML = "<h1>403 - Accès interdit</h1>";
  }

  async loadParentDashboard() {
    const parentDashboard = new ParentDashboard(this.app);
    await parentDashboard.init();
  }

  async loadManagePoints() {
    const managePoints = new ManagePoints(this.app);
    await managePoints.init();
  }

  async loadBadgeForm(participantId) {
    const badgeForm = new BadgeForm(this.app);
    await badgeForm.init(participantId);
  }

  async loadAttendance() {
    const attendance = new Attendance(this.app);
    await attendance.init();
  }

  async loadLoginPage() {
    const login = new Login(this.app);
    login.render();
  }

  async loadReports() {
    const reports = new Reports(this.app);
    await reports.init();
  }

  async loadManageHonors() {
    const manageHonors = new ManageHonors(this.app);
    await manageHonors.init();
  }

  async loadManageGroups() {
    const manageGroups = new ManageGroups(this.app);
    await manageGroups.init();
  }

  async loadResetPasswordPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const resetPassword = new ResetPassword(this.app);
    resetPassword.render(token);
  }

  async loadManageParticipants() {
    if (this.app.userRole !== "animation" && this.app.userRole !== "admin") {
      this.route("/");
      return;
    }
    const manageParticipants = new ManageParticipants(this.app);
    await manageParticipants.init();
  }

  async loadFormulaireInscription(participantId = null) {
    const formulaireInscription = new FormulaireInscription(this.app);
    await formulaireInscription.init(participantId);
  }

  async loadManageUsersParticipants() {
    const manageUsersParticipants = new ManageUsersParticipants(this.app);
    await manageUsersParticipants.init();
  }

  async loadViewParticipantDocuments() {
    const viewParticipantDocuments = new ViewParticipantDocuments(this.app);
    await viewParticipantDocuments.init();
  }

  async loadParentContactList() {
    const parentContactList = new ParentContactList(this.app);
    await parentContactList.init();
  }

  async loadMailingList(){
    const mailingList = new MailingList(this.app);
    await mailingList.init();
  }

  async loadApproveBadges() {
    const approveBadges = new ApproveBadges(this.app);
    await approveBadges.init();
  }

  async loadFicheSante(participantId) {
    const ficheSante = new FicheSante(this.app);
    await ficheSante.init(participantId);
  }

  async loadAcceptationRisque(participantId) {
    const acceptationRisque = new AcceptationRisque(this.app);
    await acceptationRisque.init(participantId);
  }

  loadNotFoundPage() {
    document.getElementById("app").innerHTML = "<h1>404 - Page Not Found</h1>";
  }

  loadNotAuthorizedPage() {
    document.getElementById("app").innerHTML = "<h1>403 - Not Authorized</h1>";
  }

  async loadRegisterPage() {
    const register = new Register(this.app);
    register.render();
  }

  reloadCurrentRoute() {
      this.route(window.location.pathname);
  }

  async handleLogout() {
    try {
      await Login.logout();
      this.app.isLoggedIn = false;
      this.app.userRole = null;
      this.app.userFullName = null;
      history.pushState(null, "", "/login");
      await this.loadLoginPage();
    } catch (error) {
      console.error("Logout error:", error);
      this.app.renderError("An error occurred during logout.");
    }
  }

  async loadLoginPage() {
    const login = new Login(this.app);
    login.render();
  }
}

export function initRouter(app) {
  const router = new Router(app);

  // Handle initial route
  // router.route(window.location.pathname);

  // Handle navigation
  document.addEventListener("click", (e) => {
    if (e.target.matches("a")) {
      e.preventDefault();
      const url = e.target.getAttribute("href");
      history.pushState(null, "", url);
      router.route(url);
    }
  });

  // Handle back/forward browser buttons
  window.addEventListener("popstate", () => {
    router.route(window.location.pathname);
  });

  return router;
}

export function navigate(path) {
  if (
    window.app &&
    window.app.router &&
    typeof window.app.router.navigate === "function"
  ) {
    window.app.router.navigate(path);
  } else {
    console.warn("Router not available, using window.location");
    window.location.href = path;
  }
}
