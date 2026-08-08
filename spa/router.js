// router.js

// Critical imports - loaded immediately (core functionality)
import { Dashboard } from "./dashboard.js";
// Login imported dynamically to avoid circular dependency
import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, isDebugMode } from "./utils/DebugUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { buildNotFoundMarkup } from "./utils/NotFoundUtils.js";
import { checkSession } from "./utils/SessionUtils.js";
import { dismissActiveDialog } from "./utils/DialogUtils.js";
import { releaseAllScrollLocks } from "./utils/ScrollLockUtils.js";
import { TABBED_PAGES, MERGED_ROUTE_REDIRECTS } from "./config/tabbed-pages.js";
import {
  canApproveBadges,
  // ... (imports continue)
  canCreateOrganization,
  canManageActivities,
  canManageAttendance,
  canManageBudget,
  canManageFinance,
  canManageFundraisers,
  canManageInventory,
  canManagePoints,
  canManageRoles,
  canViewRoles,
  canSendCommunications,
  canAccessAdminPanel,
  canAccessParentTools,
  canManageForms,
  canViewActivities,
  canViewAttendance,
  canViewBadges,
  canViewBudget,
  canViewCarpools,
  canViewFinance,
  canViewFundraisers,
  canViewGroups,
  canViewInventory,
  canViewMedication,
  canViewParticipants,
  canViewReports,
  canViewUsers,
  canViewIncidents,
  canManageIncidents,
  canViewMeetings,
  canManageMeetings,
  hasPermission,
  isParent
} from "./utils/PermissionUtils.js";

function canAccessFinanceWorkspace() {
  return canViewFinance() || canManageFinance() || canViewBudget() || canManageBudget();
}

// Custom error for offline module loading failures
class OfflineModuleError extends Error {
  constructor(moduleName) {
    super(`Module "${moduleName}" is not available offline`);
    this.name = 'OfflineModuleError';
  }
}

class NavigationCancelledError extends Error {
  constructor() {
    super('Navigation was superseded by a newer route');
    this.name = 'NavigationCancelledError';
  }
}

// Lazy-loaded modules - loaded on demand for better performance
// These will be dynamically imported when the route is accessed
const lazyModules = {
  ParentDashboard: () => import('./parent_dashboard.js').then(m => m.ParentDashboard),
  ParentFinance: () => import('./parent_finance.js').then(m => m.ParentFinance),
  ParentProgramProgress: () => import('./modules/program-progress/ParentProgramProgress.js').then(m => m.ParentProgramProgress),
  FormulaireInscription: () => import('./formulaire_inscription.js').then(m => m.FormulaireInscription),
  ManagePoints: () => import('./manage_points.js').then(m => m.ManagePoints),
  TimeSinceRegistration: () => import('./time_since_registration.js').then(m => m.TimeSinceRegistration),
  Attendance: () => import('./attendance.js').then(m => m.Attendance),
  ManageHonors: () => import('./manage_honors.js').then(m => m.ManageHonors),
  ManageParticipants: () => import('./manage_participants.js').then(m => m.ManageParticipants),
  ManageUsersParticipants: () => import('./manage_users_participants.js').then(m => m.ManageUsersParticipants),
  ManageGroups: () => import('./manage_groups.js').then(m => m.ManageGroups),
  GuardianManagement: () => import('./guardian-management.js').then(m => m.initGuardianManagement),
  ViewParticipantDocuments: () => import('./view_participant_documents.js').then(m => m.ViewParticipantDocuments),
  ParentContactList: () => import('./parent_contact_list.js').then(m => m.ParentContactList),
  ApproveBadges: () => import('./approve_badges.js').then(m => m.ApproveBadges),
  BadgeDashboard: () => import('./badge_dashboard.js').then(m => m.BadgeDashboard),
  BadgeTracker: () => import('./badge_tracker.js').then(m => m.BadgeTracker),
  ProgramProgressDashboard: () => import('./modules/program-progress/ProgramProgressDashboard.js').then(m => m.ProgramProgressDashboard),
  FicheSante: () => import('./fiche_sante.js').then(m => m.FicheSante),
  AcceptationRisque: () => import('./acceptation_risque.js').then(m => m.AcceptationRisque),
  BadgeForm: () => import('./badge_form.js').then(m => m.BadgeForm),
  Register: () => import('./register.js').then(m => m.Register),
  Admin: () => import('./admin.js').then(m => m.Admin),
  MailingList: () => import('./mailing_list.js').then(m => m.MailingList),
  Calendars: () => import('./calendars.js').then(m => m.Calendars),
  Fundraisers: () => import('./fundraisers.js').then(m => m.Fundraisers),
  ResetPassword: () => import('./reset_password.js').then(m => m.ResetPassword),
  DynamicFormHandler: () => import('./dynamicFormHandler.js').then(m => m.DynamicFormHandler),
  Reports: () => import('./reports.js').then(m => m.Reports),
  MeetingPrep: () => import('./modules/meetings/MeetingPrep.js').then(m => m.MeetingPrep),
  RegisterOrganization: () => import('./register_organization.js').then(m => m.RegisterOrganization),
  CreateOrganization: () => import('./create_organization.js').then(m => m.CreateOrganization),
  PrintableGroupParticipantReport: () => import('./group-participant-report.js').then(m => m.PrintableGroupParticipantReport),
  UpcomingMeeting: () => import('./upcoming_meeting.js').then(m => m.UpcomingMeeting),
  Finance: () => import('./finance.js').then(m => m.Finance),
  Budgets: () => import('./budgets.js').then(m => m.Budgets),
  ExternalRevenue: () => import('./external-revenue.js').then(m => m.ExternalRevenue),
  Expenses: () => import('./expenses.js').then(m => m.Expenses),
  RevenueDashboard: () => import('./revenue-dashboard.js').then(m => m.RevenueDashboard),
  ResourceDashboard: () => import('./resource_dashboard.js').then(m => m.ResourceDashboard),
  Inventory: () => import('./inventory.js').then(m => m.Inventory),
  MaterialManagement: () => import('./material_management.js').then(m => m.MaterialManagement),
  MedicationManagement: () => import('./medication_management.js').then(m => m.MedicationManagement),
  MedicationReception: () => import('./medication_reception.js').then(m => m.MedicationReception),
  PermissionSlipDashboard: () => import('./permission_slip_dashboard.js').then(m => m.PermissionSlipDashboard),
  PermissionSlipSign: () => import('./permission_slip_sign.js').then(m => m.PermissionSlipSign),
  AccountInfoModule: () => import('./modules/account-info.js').then(m => m.AccountInfoModule),
  FormBuilder: () => import('./formBuilder.js').then(m => m.FormBuilder),
  Activities: () => import('./modules/activities/Activities.js').then(m => m.Activities),
  CarpoolLanding: () => import('./carpool.js').then(m => m.CarpoolLanding),
  CarpoolDashboard: () => import('./carpool_dashboard.js').then(m => m.CarpoolDashboard),
  RoleManagement: () => import('./role_management.js').then(m => m.RoleManagement),
  DistrictManagement: () => import('./district_management.js').then(m => m.DistrictManagement),
  FormPermissions: () => import('./form_permissions.js').then(m => m.initFormPermissions),
  CommunicationSettings: () => import('./communication-settings.js').then(m => m.CommunicationSettings),
  UnitSettings: () => import('./modules/unit-settings/unit-settings.js').then(m => m.UnitSettings),
  OfflinePreparation: () => import('./offline_preparation.js').then(m => m.OfflinePreparation),
  IncidentReport: () => import('./modules/incident-report/incident-report.js').then(m => m.IncidentReport),
  YearlyPlanner: () => import('./modules/yearly-planner/YearlyPlanner.js').then(m => m.YearlyPlanner),
  ScoutYearTransition: () => import('./modules/scout-year/ScoutYearTransition.js').then(m => m.ScoutYearTransition),
  AlumniLink: () => import('./modules/alumni/AlumniLink.js').then(m => m.AlumniLink)
};

// Cache for loaded modules
const moduleCache = {};

const debugMode = isDebugMode();

const routes = {

  "/": "dashboard",
  "/admin": "admin",
  // Merged destinations (see spa/config/tabbed-pages.js); the pages they
  // replace stay reachable through MERGED_ROUTE_REDIRECTS.
  "/progression": "progression",
  "/reunions": "reunions",
  "/district": "district",
  "/dashboard": "dashboard",
  "/main-dashboard": "mainDashboard",
  "/login": "login",
  "/logout": "logout",
  "/parent-dashboard": "parentDashboard",
  "/parent-finance": "parentFinance",
  "/formulaire-inscription": "formulaireInscription",
  "/formulaire-inscription/:id": "formulaireInscription",
  "/attendance": "attendance",
  "/managePoints": "managePoints",
  "/manage-points": "managePoints",
  "/time-since-registration": "timeSinceRegistration",
  "/manageHonors": "manageHonors",
  "/manage-participants": "manageParticipants",
  "/manage-groups": "manageGroups",
  "/guardian-management": "guardianManagement",
  "/view-participant-documents": "viewParticipantDocuments",
  "/approve-badges": "approveBadges",
  "/badge-dashboard": "badgeDashboard",
  "/badge-tracker": "badgeTracker",
  "/program-progress": "programProgressDashboard",
  "/parent-program-progress": "parentProgramProgress",
  "/parent-contact-list": "parentContactList",
  "/mailing-list": "mailingList",
  "/fiche-sante/:id": "ficheSante",
  "/acceptation-risque/:id": "acceptationRisque",
  "/badge-form/:id": "badgeForm",
  "/register": "register",
  "/fundraisers": "fundraisers",
  "/calendars/:id": "calendars",
  "/reset-password": "resetPassword",
  "/alumni-consent": "alumniConsent",
  "/alumni-unsubscribe": "alumniUnsubscribe",
  "/reports": "reports",
  "/preparation-reunions": "preparation_reunions",
  "/preparation-reunions/:date": "preparation_reunions",
  "/register-organization": "registerOrganization",
  "/manage-users-participants": "manageUsersParticipants",
  "/dynamic-form/fiche_sante/:id": "ficheSante",
  "/create-organization": "createOrganization",
  "/group-participant-report": "PrintableGroupParticipantReport",
  "/upcoming-meeting": "UpcomingMeeting",
  "/finance": "finance",
  "/budgets": "budgets",
  "/external-revenue": "externalRevenue",
  "/expenses": "expenses",
  "/revenue-dashboard": "revenueDashboard",
  "/resources": "resourceDashboard",
  "/inventory": "inventory",
  "/material-management": "materialManagement",
  "/medication-management": "medicationPlanning",
  "/medication-planning": "medicationPlanning",
  "/medication-planning/:id": "medicationPlanningParticipant",
  "/medication-authorizations/:id": "medicationAuthorizationsParticipant",
  "/medication-dispensing": "medicationDispensing",
  "/medication-reception": "medicationReception",
  "/permission-slips": "permissionSlipDashboard",
  "/permission-slips/:id": "permissionSlipDashboardActivity",
  "/permission-slip/:token": "permissionSlipSign",
  "/account-info": "accountInfo",
  "/form-builder": "formBuilder",
  "/admin/form-builder": "formBuilder",
  "/activities": "activities",
  "/carpool": "carpoolLanding",
  "/carpool/:id": "carpool",
  "/role-management": "roleManagement",
  "/district-management": "districtManagement",
  "/form-permissions": "formPermissions",
  "/communications": "communications",
  "/prepare-offline": "offlinePreparation",
  "/incident-reports": "incidentReports",
  "/incident-reports/new": "incidentReportNew",
  "/incident-reports/:id": "incidentReportView",
  "/incident-reports/:id/edit": "incidentReportEdit",
  "/yearly-planner": "yearlyPlanner",
  "/yearly-planner/:planId": "yearlyPlannerDetail",
  "/unit-settings": "unitSettings",
  "/scout-year": "scoutYear"

};

export class Router {
  constructor(app) {
    this.app = app;
    // MEMORY LEAK FIX: Track current module instance for cleanup
    this.currentModuleInstance = null;
    this.navigationId = 0;
  }

  /**
   * Clean up the current module before loading a new one
   * CRITICAL: Prevents memory leaks by calling destroy() on modules
   */
  cleanupCurrentModule() {
    if (this.currentModuleInstance && typeof this.currentModuleInstance.destroy === 'function') {
      debugLog('[Router] Cleaning up previous module');
      try {
        this.currentModuleInstance.destroy();
      } catch (error) {
        debugError('[Router] Error during module cleanup:', error);
      }
    }
    this.currentModuleInstance = null;
    this.dismissTransientOverlays();
  }

  /**
   * Remove any modal/dialog overlays left open by the previous screen.
   * Modules that append modals to document.body (award modals, AI prompts,
   * settings overlays, confirm dialogs) must not survive navigation.
   * Persistent app chrome (command palette, sync panel, offline indicator,
   * PWA prompts) uses distinct class names and is left untouched.
   *
   * Removing the overlay DOM is not enough on its own: an overlay also locks
   * body scrolling and may hold focus. Both are released here so the incoming
   * screen is scrollable and keyboard-usable immediately, whichever way the
   * user left the previous one.
   */
  dismissTransientOverlays() {
    dismissActiveDialog();

    // Focus must leave the subtree before it is detached, otherwise it falls
    // back to <body> and screen readers lose their place.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      const insideOverlay = activeElement.closest(
        '.modal, .modal-container, .modal-screen, .modal-overlay, .dash-settings, .dialog-overlay',
      );
      if (insideOverlay) {
        activeElement.blur();
      }
    }

    const appRoot = document.getElementById('app');
    const transientSelectors = '.modal, .modal-container, .modal-screen, .modal-overlay, .dash-settings, .dialog-overlay';
    document.querySelectorAll(transientSelectors).forEach((el) => {
      // Overlays inside #app are replaced by the next render anyway.
      if (appRoot && appRoot.contains(el)) {
        return;
      }
      let top = el;
      while (top.parentElement && top.parentElement !== document.body) {
        top = top.parentElement;
      }
      if (top.parentElement === document.body) {
        top.remove();
      }
    });

    document.body.classList.remove('dash-settings-open');

    // Release any body scroll lock the previous screen was holding. Without
    // this a report modal left open during navigation freezes the destination
    // page (the dashboard could not be scrolled after visiting a report).
    releaseAllScrollLocks();
  }

  navigate(path) {
    debugLog("Navigating to:", path);
    history.pushState(null, "", path);
    this.route(path);
  }

  async route(path) {
    const navigationId = ++this.navigationId;
    debugLog("Routing to:", path);

    // MEMORY LEAK FIX: Clean up previous module before loading new one
    this.cleanupCurrentModule();

    // Each screen starts at the top; without this, navigating from the
    // bottom of a long list opens the next page mid-scroll.
    window.scrollTo(0, 0);

    // Guard against null, undefined, or empty paths
    if (!path || typeof path !== 'string') {
      debugLog("Invalid path received, ignoring route:", path);
      return;
    }

    // Check if the path ends with .html
    if (path.endsWith('.html')) {
      // Do nothing, let the server handle this request
      return;
    }

    // Pages merged into a tabbed destination: keep old links, bookmarks and
    // service-worker-cached URLs working by sending them to the right tab.
    const mergedTarget = MERGED_ROUTE_REDIRECTS[path.split("?")[0]];
    if (mergedTarget) {
      debugLog("Redirecting merged route:", path, "->", mergedTarget);
      history.replaceState(null, "", mergedTarget);
      await this.route(mergedTarget);
      return;
    }
    const [routeName, param] = this.getRouteNameAndParam(path);
    const dynamicFormMatch = path.match(/^\/dynamic-form\/([^\/]+)\/(\d+)$/);
    if (dynamicFormMatch) {
      const formType = dynamicFormMatch[1];
      const participantId = dynamicFormMatch[2];
      await this.loadDynamicForm(formType, participantId);
      return;
    }

    // Check session
    const session = checkSession();
    this.app.isLoggedIn = session.isLoggedIn;
    this.app.userRole = session.userRole;
    this.app.userFullName = session.userFullName;
    this.app.userRoles = session.userRoles;
    this.app.userPermissions = session.userPermissions;

    if (this.app.isLoggedIn) {
      this.app.addSettingsIcon();
    } else {
      this.app.removeSettingsIcon();
    }

    try {
      const guard = (condition) => {
        if (!condition) {
          this.loadNotAuthorizedPage();
          return false;
        }
        return true;
      };
      // Allow access to login, register, permission slip signing, and index pages without being logged in
      // The alumni links are reached by people whose access was just withdrawn,
      // so requiring a session would make them unusable by design.
      if (!this.app.isLoggedIn && !["login", "register", "resetPassword", "permissionSlipSign", "alumniConsent", "alumniUnsubscribe"].includes(routeName)) {
        if (path !== "/login") {
          debugWarn('Redirecting to login from route:', routeName);
          history.pushState(null, "", "/login");
        }
        await this.loadLoginPage();
        return;

      }


      switch (routeName) {
        case "dashboard":
          if (isParent()) {
            await this.loadParentDashboard();
          } else {
            await this.loadDashboard();
          }
          break;
        case "mainDashboard":
          if (!guard(canAccessFinanceWorkspace())) {
            break;
          }
          await this.loadDashboard({ mode: isParent() ? "finance-focused" : "default" });
          break;
        case 'PrintableGroupParticipantReport':
          if (!guard(canViewReports())) {
            break;
          }
          const PrintableGroupParticipantReport = await this.loadModule('PrintableGroupParticipantReport');
          const report = new PrintableGroupParticipantReport(this.app);
          this.currentModuleInstance = report;
          await report.init();
          break;
        case "admin":
          if (!guard(canAccessAdminPanel())) {
            break;
          }
          await this.loadAdminPage();
          break;
        case "fundraisers":
          if (!guard(canViewFundraisers() || canManageFundraisers() || canViewFinance())) {
            break;
          }
          await this.loadFundraisersPage();
          break;
        case "finance":
          if (!guard(canViewFinance())) {
            break;
          }
          const Finance = await this.loadModule('Finance');
          const finance = new Finance(this.app);
          this.currentModuleInstance = finance;
          await finance.init();
          break;
        case "budgets":
          if (!guard(canViewBudget() || canManageBudget() || canManageFinance())) {
            break;
          }
          const Budgets = await this.loadModule('Budgets');
          const budgets = new Budgets(this.app);
          this.currentModuleInstance = budgets; // Track for cleanup
          await budgets.init();
          break;
        case "externalRevenue":
          if (!guard(canManageFinance() || canViewFinance())) {
            break;
          }
          const ExternalRevenue = await this.loadModule('ExternalRevenue');
          const externalRevenue = new ExternalRevenue(this.app);
          this.currentModuleInstance = externalRevenue;
          await externalRevenue.init();
          break;
        case "expenses":
          if (!guard(canManageFinance() || canViewFinance())) {
            break;
          }
          const Expenses = await this.loadModule('Expenses');
          const expenses = new Expenses(this.app);
          this.currentModuleInstance = expenses;
          await expenses.init();
          break;
        case "revenueDashboard":
          if (!guard(canViewFinance() || canViewFundraisers() || canViewBudget())) {
            break;
          }
          const RevenueDashboard = await this.loadModule('RevenueDashboard');
          const revenueDashboard = new RevenueDashboard(this.app);
          this.currentModuleInstance = revenueDashboard;
          await revenueDashboard.init();
          break;
        case "resourceDashboard":
          if (!guard(canViewInventory())) {
            break;
          }
          const ResourceDashboard = await this.loadModule('ResourceDashboard');
          const resourceDashboard = new ResourceDashboard(this.app);
          this.currentModuleInstance = resourceDashboard;
          await resourceDashboard.init();
          break;
        case "inventory":
          if (!guard(canViewInventory())) {
            break;
          }
          const Inventory = await this.loadModule('Inventory');
          const inventory = new Inventory(this.app);
          this.currentModuleInstance = inventory;
          await inventory.init();
          break;
        case "medicationPlanning":
        case "medicationDispensing":
          if (!guard(canViewMedication())) {
            break;
          }
          const MedicationManagement = await this.loadModule('MedicationManagement');
          const medicationManagement = new MedicationManagement(this.app, {
            view: routeName === "medicationDispensing" ? "dispensing" : "planning",
            enableAlerts: routeName === "medicationDispensing"
          });
          this.currentModuleInstance = medicationManagement;
          await medicationManagement.init();
          break;
        case "medicationPlanningParticipant":
          if (!guard(isParent() || canViewMedication())) {
            break;
          }
          const MedicationManagementParticipant = await this.loadModule('MedicationManagement');
          const participantId = parseInt(param);
          const medicationManagementParticipant = new MedicationManagementParticipant(this.app, {
            view: "planning",
            participantId: participantId,
            returnUrl: isParent() ? '/parent-dashboard' : '/medication-reception'
          });
          this.currentModuleInstance = medicationManagementParticipant;
          await medicationManagementParticipant.init();
          break;
        case "medicationAuthorizationsParticipant":
          if (!guard(isParent() || canViewMedication())) {
            break;
          }
          const MedicationManagementAuth = await this.loadModule('MedicationManagement');
          const authParticipantId = parseInt(param);
          const medicationManagementAuth = new MedicationManagementAuth(this.app, {
            view: "authorizations",
            participantId: authParticipantId,
            returnUrl: isParent() ? '/parent-dashboard' : '/medication-planning'
          });
          this.currentModuleInstance = medicationManagementAuth;
          await medicationManagementAuth.init();
          break;
        case "medicationReception":
          if (!guard(canViewMedication())) {
            break;
          }
          const MedicationReception = await this.loadModule('MedicationReception');
          const medicationReception = new MedicationReception(this.app);
          this.currentModuleInstance = medicationReception;
          await medicationReception.init();
          break;
        case "materialManagement":
          if (!guard(canManageInventory() || canViewInventory())) {
            break;
          }
          const MaterialManagement = await this.loadModule('MaterialManagement');
          const materialManagement = new MaterialManagement(this.app);
          this.currentModuleInstance = materialManagement;
          await materialManagement.init();
          break;
        case "permissionSlipDashboard":
          if (!guard(canViewParticipants())) {
            break;
          }
          const PermissionSlipDashboard = await this.loadModule('PermissionSlipDashboard');
          const permissionSlipDashboard = new PermissionSlipDashboard(this.app);
          this.currentModuleInstance = permissionSlipDashboard;
          await permissionSlipDashboard.init();
          break;
        case "permissionSlipDashboardActivity":
          if (!guard(canViewParticipants())) {
            break;
          }
          const PermissionSlipDashboardActivity = await this.loadModule('PermissionSlipDashboard');
          const activityId = parseInt(param);
          const permissionSlipDashboardActivity = new PermissionSlipDashboardActivity(this.app, { activityId });
          this.currentModuleInstance = permissionSlipDashboardActivity;
          await permissionSlipDashboardActivity.init();
          break;
        case "permissionSlipSign":
          // Public route - allow anyone to sign permission slips via email link
          debugLog('[ROUTER DEBUG] Loading PermissionSlipSign with ID:', param);
          const PermissionSlipSign = await this.loadModule('PermissionSlipSign');
          const permissionSlipSign = new PermissionSlipSign(this.app, param);
          this.currentModuleInstance = permissionSlipSign;
          await permissionSlipSign.init();
          break;
        case "calendars":
          if (!guard(canViewFundraisers() || canManageFundraisers())) {
            break;
          }
          await this.loadCalendarsPage(param);
          break;
        case "createOrganization":
          if (!guard(canCreateOrganization())) {
            break;
          }
          const CreateOrganization = await this.loadModule('CreateOrganization');
          const createOrganization = new CreateOrganization(this.app);
          this.currentModuleInstance = createOrganization;
          await createOrganization.init();
          break;
        case "parentDashboard":
          if (!guard(canAccessParentTools())) {
            break;
          }
          await this.loadParentDashboard();
          break;
        case "parentFinance":
          if (!guard(canAccessParentTools())) {
            break;
          }
          await this.loadParentFinance();
          break;
        case "communications":
          if (!guard(canSendCommunications() || canAccessAdminPanel())) {
            break;
          }
          const CommunicationSettings = await this.loadModule('CommunicationSettings');
          const communicationSettings = new CommunicationSettings(this.app);
          this.currentModuleInstance = communicationSettings;
          await communicationSettings.init();
          break;
        case "unitSettings":
          if (!guard(canAccessAdminPanel())) {
            break;
          }
          const UnitSettings = await this.loadModule('UnitSettings');
          const unitSettings = new UnitSettings(this.app);
          this.currentModuleInstance = unitSettings;
          await unitSettings.init();
          break;
        case "scoutYear":
          if (!guard(hasPermission('scout_year.view') || hasPermission('scout_year.manage'))) {
            break;
          }
          const ScoutYearTransition = await this.loadModule('ScoutYearTransition');
          const scoutYearTransition = new ScoutYearTransition(this.app);
          this.currentModuleInstance = scoutYearTransition;
          await scoutYearTransition.init();
          break;
        case "incidentReports":
          if (!guard(canViewIncidents())) break;
          const IncidentReportList = await this.loadModule('IncidentReport');
          const incidentList = new IncidentReportList(this.app, { view: 'list' });
          this.currentModuleInstance = incidentList;
          await incidentList.init();
          break;
        case "incidentReportNew":
          if (!guard(canManageIncidents())) break;
          const IncidentReportCreate = await this.loadModule('IncidentReport');
          const incidentCreate = new IncidentReportCreate(this.app, { view: 'create' });
          this.currentModuleInstance = incidentCreate;
          await incidentCreate.init();
          break;
        case "incidentReportView":
          if (!guard(canViewIncidents())) break;
          const IncidentReportView = await this.loadModule('IncidentReport');
          const incidentView = new IncidentReportView(this.app, { view: 'view', incidentId: parseInt(param) });
          this.currentModuleInstance = incidentView;
          await incidentView.init();
          break;
        case "incidentReportEdit":
          if (!guard(canManageIncidents())) break;
          const IncidentReportEdit = await this.loadModule('IncidentReport');
          const incidentEdit = new IncidentReportEdit(this.app, { view: 'edit', incidentId: parseInt(param) });
          this.currentModuleInstance = incidentEdit;
          await incidentEdit.init();
          break;
        case "yearlyPlanner":
        case "yearlyPlannerDetail":
          if (!guard(canViewMeetings())) break;
          const YearlyPlanner = await this.loadModule('YearlyPlanner');
          const yearlyPlanner = new YearlyPlanner(this.app);
          this.currentModuleInstance = yearlyPlanner;
          await yearlyPlanner.init(routeName === 'yearlyPlannerDetail' ? parseInt(param, 10) : null);
          break;
        case "offlinePreparation":
          if (!guard(canViewActivities())) break;
          const OfflinePreparation = await this.loadModule('OfflinePreparation');
          const offlinePreparation = new OfflinePreparation(this.app);
          this.currentModuleInstance = offlinePreparation;
          await offlinePreparation.init();
          break;
        case "login":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            // (replaceState so the URL matches what is rendered)
            const loginTarget = isParent() ? "/parent-dashboard" : "/dashboard";
            history.replaceState(null, "", loginTarget);
            return this.route(loginTarget);
          } else {
            await this.loadLoginPage();
          }
          break;
        case "registerOrganization":
          if (!guard(canCreateOrganization())) {
            break;
          }
          const RegisterOrganization = await this.loadModule('RegisterOrganization');
          const registerOrganization = new RegisterOrganization(this.app);
          this.currentModuleInstance = registerOrganization;
          await registerOrganization.init();
          break;
        case "logout":
          await this.handleLogout();
          break;
        case "resetPassword":
          await this.loadResetPasswordPage();
          break;
        case "alumniConsent":
          await this.loadAlumniLinkPage("consent");
          break;
        case "alumniUnsubscribe":
          await this.loadAlumniLinkPage("unsubscribe");
          break;
        case "attendance":
          if (!guard(canViewAttendance())) {
            break;
          }
          await this.loadAttendance();
          break;
        case "UpcomingMeeting":
          if (!guard(canViewActivities() || canViewParticipants())) {
            break;
          }
          await this.loadUpcomingMeeting();
          break;
        case "formulaireInscription":
          if (!guard(isParent() || canViewParticipants())) {
            break;
          }
          await this.loadFormulaireInscription(param);
          break;
        case "mailingList":
          if (!guard(canSendCommunications())) {
            break;
          }
          await this.loadMailingList();
          break;
        case "managePoints":
          if (!guard(canManagePoints())) {
            break;
          }
          await this.loadManagePoints();
          break;
        case "timeSinceRegistration":
          if (!guard(canViewReports())) {
            break;
          }
          await this.loadTimeSinceRegistration();
          break;
        case "manageHonors":
          if (!guard(canManagePoints())) {
            break;
          }
          await this.loadManageHonors();
          break;
        case "manageParticipants":
          if (!guard(canViewParticipants())) {
            break;
          }
          await this.loadManageParticipants();
          break;
        case "manageUsersParticipants":
          if (!guard(canViewUsers())) {
            break;
          }
          await this.loadManageUsersParticipants();
          break;
        case "manageGroups":
          if (!guard(canViewGroups())) {
            break;
          }
          await this.loadManageGroups();
          break;
        case "guardianManagement":
          if (!guard(canViewParticipants())) {
            break;
          }
          const GuardianManagement = await this.loadModule('GuardianManagement');
          await GuardianManagement(this.app);
          break;
        case "viewParticipantDocuments":
          if (!guard(canViewParticipants())) {
            break;
          }
          await this.loadViewParticipantDocuments();
          break;
        case "parentContactList":
          if (!guard(canSendCommunications() || canViewParticipants())) {
            break;
          }
          await this.loadParentContactList();
          break;
        case 'reports':
          if (!guard(canViewReports())) {
            break;
          }
          await this.loadReports();
          break;
        case "approveBadges":
          if (!guard(canApproveBadges())) {
            break;
          }
          await this.loadApproveBadges();
          break;
        case "badgeDashboard":
          if (!guard(canViewBadges() || canApproveBadges())) {
            break;
          }
          await this.loadBadgeDashboard();
          break;
        case "progression":
          if (!guard(canViewBadges() || canApproveBadges() || canViewParticipants())) {
            break;
          }
          await this.loadTabbedPage("progression");
          break;
        case "reunions":
          if (!guard(canViewActivities() || canViewParticipants())) {
            break;
          }
          await this.loadTabbedPage("reunions");
          break;
        case "district":
          if (!guard(canViewRoles() || canAccessAdminPanel())) {
            break;
          }
          await this.loadTabbedPage("district");
          break;
        case "badgeTracker":
          if (!guard(canViewBadges() || canApproveBadges())) {
            break;
          }
          await this.loadBadgeTracker();
          break;
        case "programProgressDashboard":
          if (!guard(canViewParticipants() || canViewBadges())) {
            break;
          }
          await this.loadProgramProgressDashboard();
          break;
        case "parentProgramProgress":
          if (!guard(isParent() || canViewParticipants())) {
            break;
          }
          await this.loadParentProgramProgress();
          break;
        case "ficheSante":
          if (!guard(isParent() || canViewParticipants())) {
            break;
          }
          await this.loadFicheSante(param);
          break;
        case "acceptationRisque":
          if (!guard(isParent() || canViewParticipants())) {
            break;
          }
          await this.loadAcceptationRisque(param);
          break;
        case "badgeForm":
          if (!guard(canViewBadges() || canApproveBadges())) {
            break;
          }
          await this.loadBadgeForm(param);
          break;
        case 'preparation_reunions':
          if (!guard(canViewMeetings() || canManageMeetings())) {
            break;
          }
          await this.loadPreparationReunions(param);
          break;
        case "accountInfo":
          await this.loadAccountInfo();
          break;
        case "formBuilder":
          if (!guard(canManageForms())) {
            break;
          }
          const FormBuilder = await this.loadModule('FormBuilder');
          const formBuilder = new FormBuilder(this.app);
          this.currentModuleInstance = formBuilder;
          await formBuilder.init();
          break;
        case "activities":
          if (!guard(canViewActivities() || canManageActivities())) {
            break;
          }
          const Activities = await this.loadModule('Activities');
          const activities = new Activities(this.app);
          this.currentModuleInstance = activities;
          await activities.init();
          break;
        case "carpoolLanding":
          if (!guard(isParent() || canViewCarpools())) {
            break;
          }
          const CarpoolLanding = await this.loadModule('CarpoolLanding');
          const carpoolLanding = new CarpoolLanding(this.app);
          this.currentModuleInstance = carpoolLanding;
          await carpoolLanding.init();
          break;
        case "carpool":
          if (!guard(isParent() || canViewCarpools())) {
            break;
          }
          const CarpoolDashboard = await this.loadModule('CarpoolDashboard');
          const carpoolDashboard = new CarpoolDashboard(this.app, param);
          this.currentModuleInstance = carpoolDashboard;
          await carpoolDashboard.init();
          break;
        case "roleManagement":
          // Only accessible by users with role management permissions
          // Permission check is done within the RoleManagement component
          if (!guard(canManageRoles() || canViewRoles())) {
            break;
          }
          const RoleManagement = await this.loadModule('RoleManagement');
          const roleManagement = new RoleManagement(this.app);
          this.currentModuleInstance = roleManagement;
          await roleManagement.init();
          break;
        case "districtManagement":
          if (!guard(canViewRoles())) {
            break;
          }
          const DistrictManagement = await this.loadModule('DistrictManagement');
          const districtManagement = new DistrictManagement(this.app);
          this.currentModuleInstance = districtManagement;
          await districtManagement.init();
          break;
        case "formPermissions":
          // Only accessible by district and unitadmin
          if (!guard(canAccessAdminPanel())) {
            break;
          }
          const initFormPermissions = await this.loadModule('FormPermissions');
          await initFormPermissions(this.app);
          break;
        case "register":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            // (replaceState so the URL matches what is rendered)
            const registerTarget = isParent() ? "/parent-dashboard" : "/dashboard";
            history.replaceState(null, "", registerTarget);
            this.route(registerTarget);
          } else {
            await this.loadRegisterPage();
          }
          break;
        // ... other cases ...
        default:
          this.loadNotFoundPage();
      }

      // Load activity widget only on dashboard/activity-related routes for better performance
      const activityRoutes = ['dashboard', 'activities', 'carpool', 'carpoolLanding'];
      const canShowActivityWidget = (canViewActivities() || canManageActivities() || canManageAttendance()) && !isParent();
      if (
        this.app.isLoggedIn &&
        canShowActivityWidget &&
        activityRoutes.includes(routeName) &&
        !this.activityWidgetInitialized  // Check if the widget is already initialized
      ) {
        import('./init-activity-widget.js').then(module => {
          module.initActivityWidget(this.app);
        });
        this.activityWidgetInitialized = true;  // Mark the widget as initialized
      }
    } catch (error) {
      if (error instanceof NavigationCancelledError || navigationId !== this.navigationId) {
        debugLog('[Router] Ignoring superseded navigation');
      } else if (error instanceof OfflineModuleError) {
        debugWarn("Offline module error:", error.message);
        this.app.renderError(translate('offline_page_unavailable'), {
          titleKey: 'offline_indicator',
          actions: [{ labelKey: 'back_to_home', href: '/' }]
        });
      } else {
        debugError("Routing error:", error);
        this.app.renderError(translate('error_loading_page'));
      }
    }
  }

  async loadDynamicForm(formType, participantId) {
    const DynamicFormHandler = await this.loadModule('DynamicFormHandler');
    const dynamicFormHandler = new DynamicFormHandler(this.app);
    this.currentModuleInstance = dynamicFormHandler;
    await dynamicFormHandler.init(formType, participantId);
  }

  async loadFundraisersPage() {
    const Fundraisers = await this.loadModule('Fundraisers');
    const fundraisers = new Fundraisers(this.app);
    this.currentModuleInstance = fundraisers;
    await fundraisers.init();
  }

  async loadCalendarsPage(fundraiserId) {
    const Calendars = await this.loadModule('Calendars');
    const calendars = new Calendars(this.app);
    this.currentModuleInstance = calendars;
    await calendars.init(fundraiserId);
  }

  getRouteNameAndParam(path) {
    const cleanPath = path.split("?")[0];

    // Exact matches win over parameterized routes so static paths like
    // /incident-reports/new are not shadowed by /incident-reports/:id
    if (routes[cleanPath]) {
      debugLog('[ROUTER DEBUG] Exact route match:', cleanPath, '->', routes[cleanPath]);
      return [routes[cleanPath], null];
    }

    // Parameterized routes: match segment by segment. Supports any param
    // name (:id, :token, :date) at any position (/x/:id, /x/:id/edit).
    const pathParts = cleanPath.split("/");
    for (const [pattern, routeName] of Object.entries(routes)) {
      if (!pattern.includes("/:")) {
        continue;
      }
      const patternParts = pattern.split("/");
      if (patternParts.length !== pathParts.length) {
        continue;
      }
      let param = null;
      let matched = true;
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
          param = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        debugLog('[ROUTER DEBUG] Matched parameterized route:', pattern, '->', routeName, 'Param:', param);
        return [routeName, param];
      }
    }

    debugLog('[ROUTER DEBUG] No route match for:', cleanPath);
    return ["notFound", null];
  }


  async loadDashboard(options = {}) {
    const dashboard = new Dashboard(this.app, options);
    this.currentModuleInstance = dashboard;
    await dashboard.init();
  }

  async loadAdminPage() {
    const Admin = await this.loadModule('Admin');
    const admin = new Admin(this.app);
    this.currentModuleInstance = admin;
    await admin.init();
  }

  // Helper method to lazy-load and cache modules
  async loadModule(moduleName, ...args) {
    const navigationId = this.navigationId;
    // Check cache first
    if (moduleCache[moduleName]) {
      return moduleCache[moduleName];
    }

    // Load the module dynamically
    if (lazyModules[moduleName]) {
      try {
        const ModuleClass = await lazyModules[moduleName]();
        if (navigationId !== this.navigationId) {
          throw new NavigationCancelledError();
        }
        moduleCache[moduleName] = ModuleClass;
        return ModuleClass;
      } catch (error) {
        if (error instanceof NavigationCancelledError) {
          throw error;
        }
        // If the dynamic import failed and we're offline, throw a specific error
        // so the route method can display an appropriate offline message
        if (!navigator.onLine) {
          debugError(`[Router] Failed to load module "${moduleName}" while offline:`, error);
          throw new OfflineModuleError(moduleName);
        }
        throw error;
      }
    }

    throw new Error(`Module ${moduleName} not found`);
  }

  async loadParentDashboard() {
    const ParentDashboard = await this.loadModule('ParentDashboard');
    const parentDashboard = new ParentDashboard(this.app);
    this.currentModuleInstance = parentDashboard;
    await parentDashboard.init();
  }

  async loadParentFinance() {
    const ParentFinance = await this.loadModule('ParentFinance');
    const parentFinance = new ParentFinance(this.app);
    this.currentModuleInstance = parentFinance;
    await parentFinance.init();
  }

  async loadManagePoints() {
    const ManagePoints = await this.loadModule('ManagePoints');
    const managePoints = new ManagePoints(this.app);
    this.currentModuleInstance = managePoints;
    await managePoints.init();
  }

  async loadTimeSinceRegistration() {
    const TimeSinceRegistration = await this.loadModule('TimeSinceRegistration');
    const timeSinceRegistration = new TimeSinceRegistration(this.app);
    this.currentModuleInstance = timeSinceRegistration;
    await timeSinceRegistration.init();
  }

  async loadBadgeForm(participantId) {
    const BadgeForm = await this.loadModule('BadgeForm');
    const badgeForm = new BadgeForm(this.app);
    this.currentModuleInstance = badgeForm;
    await badgeForm.init(participantId);
  }

  async loadAttendance() {
    const Attendance = await this.loadModule('Attendance');
    const attendance = new Attendance(this.app);
    this.currentModuleInstance = attendance;
    await attendance.init();
  }

  // duplicate loadLoginPage removed (see end of file)

  async loadReports() {
    const Reports = await this.loadModule('Reports');
    const reports = new Reports(this.app);
    this.currentModuleInstance = reports;
    await reports.init();
  }

  /**
   * Mount one of the merged, tabbed destinations.
   *
   * @param {string} key - Key into TABBED_PAGES.
   */
  async loadTabbedPage(key) {
    const config = TABBED_PAGES[key];
    if (!config) {
      debugError("Unknown tabbed page:", key);
      return;
    }
    const { TabbedPage } = await import("./modules/TabbedPage.js");
    const page = new TabbedPage(this.app, config);
    this.currentModuleInstance = page;
    await page.init();
  }

  async loadUpcomingMeeting() {
    const UpcomingMeeting = await this.loadModule('UpcomingMeeting');
    const upcomingMeeting = new UpcomingMeeting(this.app);
    this.currentModuleInstance = upcomingMeeting;
    await upcomingMeeting.init();
  }

  async loadPreparationReunions(date = null) {
    const MeetingPrep = await this.loadModule('MeetingPrep');
    const meetingPrep = new MeetingPrep(this.app);
    this.currentModuleInstance = meetingPrep;
    await meetingPrep.init(date);
  }

  async loadAccountInfo() {
    const AccountInfoModule = await this.loadModule('AccountInfoModule');
    const accountInfo = new AccountInfoModule(this.app);
    this.currentModuleInstance = accountInfo;
    await accountInfo.init();
  }

  async loadManageHonors() {
    const ManageHonors = await this.loadModule('ManageHonors');
    const manageHonors = new ManageHonors(this.app);
    this.currentModuleInstance = manageHonors;
    await manageHonors.init();
  }

  async loadManageGroups() {
    const ManageGroups = await this.loadModule('ManageGroups');
    const manageGroups = new ManageGroups(this.app);
    this.currentModuleInstance = manageGroups;
    await manageGroups.init();
  }

  async loadResetPasswordPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const errorParam = urlParams.get('error');
    const ResetPassword = await this.loadModule('ResetPassword');
    const resetPassword = new ResetPassword(this.app);
    this.currentModuleInstance = resetPassword;
    resetPassword.render(token, errorParam);
  }

  async loadAlumniLinkPage(action) {
    const AlumniLink = await this.loadModule('AlumniLink');
    const alumniLink = new AlumniLink(this.app, action);
    this.currentModuleInstance = alumniLink;
    await alumniLink.init();
  }

  async loadManageParticipants() {
    const ManageParticipants = await this.loadModule('ManageParticipants');
    const manageParticipants = new ManageParticipants(this.app);
    this.currentModuleInstance = manageParticipants;
    await manageParticipants.init();
  }

  async loadFormulaireInscription(participantId = null) {
    debugLog("Initializing FormulaireInscription with participantId:", participantId);
    const FormulaireInscription = await this.loadModule('FormulaireInscription');
    const formulaireInscription = new FormulaireInscription(this.app);
    this.currentModuleInstance = formulaireInscription;
    await formulaireInscription.init(participantId);
  }

  async loadManageUsersParticipants() {
    const ManageUsersParticipants = await this.loadModule('ManageUsersParticipants');
    const manageUsersParticipants = new ManageUsersParticipants(this.app);
    this.currentModuleInstance = manageUsersParticipants;
    await manageUsersParticipants.init();
  }

  async loadViewParticipantDocuments() {
    const ViewParticipantDocuments = await this.loadModule('ViewParticipantDocuments');
    const viewParticipantDocuments = new ViewParticipantDocuments(this.app);
    this.currentModuleInstance = viewParticipantDocuments;
    await viewParticipantDocuments.init();
  }

  async loadParentContactList() {
    const ParentContactList = await this.loadModule('ParentContactList');
    const parentContactList = new ParentContactList(this.app);
    this.currentModuleInstance = parentContactList;
    await parentContactList.init();
  }

  async loadMailingList() {
    const MailingList = await this.loadModule('MailingList');
    const mailingList = new MailingList(this.app);
    this.currentModuleInstance = mailingList;
    await mailingList.init();
  }

  async loadApproveBadges() {
    const ApproveBadges = await this.loadModule('ApproveBadges');
    const approveBadges = new ApproveBadges(this.app);
    this.currentModuleInstance = approveBadges;
    await approveBadges.init();
  }

  async loadBadgeDashboard() {
    const BadgeDashboard = await this.loadModule('BadgeDashboard');
    const badgeDashboard = new BadgeDashboard(this.app);
    this.currentModuleInstance = badgeDashboard;
    await badgeDashboard.init();
  }

  async loadBadgeTracker() {
    const BadgeTracker = await this.loadModule('BadgeTracker');
    const badgeTracker = new BadgeTracker(this.app);
    this.currentModuleInstance = badgeTracker;
    await badgeTracker.init();
  }

  async loadProgramProgressDashboard() {
    const ProgramProgressDashboard = await this.loadModule('ProgramProgressDashboard');
    const programProgressDashboard = new ProgramProgressDashboard(this.app);
    this.currentModuleInstance = programProgressDashboard;
    await programProgressDashboard.init();
  }

  async loadParentProgramProgress() {
    const ParentProgramProgress = await this.loadModule('ParentProgramProgress');
    const parentProgramProgress = new ParentProgramProgress(this.app);
    this.currentModuleInstance = parentProgramProgress;
    await parentProgramProgress.init();
  }

  async loadFicheSante(participantId) {
    const FicheSante = await this.loadModule('FicheSante');
    const ficheSante = new FicheSante(this.app);
    this.currentModuleInstance = ficheSante;
    await ficheSante.init(participantId);
  }

  async loadAcceptationRisque(participantId) {
    const AcceptationRisque = await this.loadModule('AcceptationRisque');
    const acceptationRisque = new AcceptationRisque(this.app);
    this.currentModuleInstance = acceptationRisque;
    await acceptationRisque.init(participantId);
  }

  loadNotFoundPage() {
    setContent(document.getElementById("app"), buildNotFoundMarkup({
      titleKey: 'error_404_not_found'
    }));
  }

  loadNotAuthorizedPage() {
    setContent(document.getElementById("app"), buildNotFoundMarkup({
      titleKey: 'error_403_not_authorized',
      messageKey: 'error_403_not_authorized_message',
      backHref: '/',
      backLabelKey: 'back_to_home'
    }));
  }

  async loadRegisterPage() {
    const Register = await this.loadModule('Register');
    const register = new Register(this.app);
    this.currentModuleInstance = register;
    register.render();
  }

  reloadCurrentRoute() {
    this.route(window.location.pathname);
  }

  async handleLogout() {
    try {
      const { Login } = await import('./login.js');
      await Login.logout();
      // Note: Login.logout() always redirects via window.location.href (never throws)
    } catch (error) {
      // Handle import failure
      debugError("Failed to load logout module:", error);
      window.location.href = "/login";
    }
  }

  async loadLoginPage() {
    const { Login } = await import('./login.js');
    const login = new Login(this.app);
    this.currentModuleInstance = login;
    login.init();
  }
}

export function initRouter(app) {
  const router = new Router(app);

  // Handle navigation
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) {
      return;
    }

    const anchor = e.target.closest("a");
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    const target = anchor.getAttribute("target");
    const isDownload = anchor.hasAttribute("download");

    // Allow browser default behavior for non-router links
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("blob:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      isDownload ||
      target === "_blank" ||
      e.defaultPrevented ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      return;
    }

    let resolvedUrl;
    try {
      resolvedUrl = new URL(href, window.location.origin);
    } catch (error) {
      debugWarn("Ignoring invalid navigation URL:", href, error);
      return;
    }

    if (resolvedUrl.origin !== window.location.origin) {
      return;
    }

    const routePath = `${resolvedUrl.pathname}${resolvedUrl.search}`;
    const historyPath = `${routePath}${resolvedUrl.hash}`;
    e.preventDefault();
    history.pushState(null, "", historyPath);
    router.route(routePath);
  });

  // Handle back/forward browser buttons (keep the query string so
  // tab-parameterized pages like /finance?tab=reports restore correctly)
  window.addEventListener("popstate", () => {
    router.route(`${window.location.pathname}${window.location.search}`);
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
    debugWarn("Router not available, using window.location");
    window.location.href = path;
  }
}
