// router.js

// Critical imports - loaded immediately (core functionality)
import { Dashboard } from "./modules/dashboard/Dashboard.js";
// Login imported dynamically to avoid circular dependency
import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, isDebugMode } from "./utils/DebugUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { buildNotFoundMarkup } from "./utils/NotFoundUtils.js";
import { checkSession } from "./utils/SessionUtils.js";
import { dismissActiveDialog } from "./utils/DialogUtils.js";
import { closeAllModals } from './utils/ModalUtils.js';
import { buildLoginRedirect } from './utils/LoginRedirectUtils.js';
import { releaseAllScrollLocks } from "./utils/ScrollLockUtils.js";
import { initScrollMemory, beginScrollNavigation, restoreScrollPosition } from './utils/ScrollMemory.js';
import { resetPageReads } from "./modules/live-sync/LiveSyncState.js";
import { focusPageStart } from './utils/PageFocusUtils.js';
import { TABBED_PAGES, MERGED_ROUTE_REDIRECTS } from "./config/tabbed-pages.js";
import {
  canApproveBadges,
  // ... (imports continue)
  canCreateOrganization,
  canManageActivities,
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
  canFollowPermissionSlips,
  canViewReports,
  canViewUsers,
  canViewIncidents,
  canManageIncidents,
  canViewMeetings,
  canManageMeetings,
  hasPermission,
  isParent,
  holdsFamilyRole
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
  ParentDashboard: () => import('./modules/dashboard/ParentDashboard.js').then(m => m.ParentDashboard),
  ParentFinance: () => import('./modules/finance/ParentFinance.js').then(m => m.ParentFinance),
  ParentFundraisers: () => import('./modules/fundraising/ParentFundraisers.js').then(m => m.ParentFundraisers),
  ParentProgramProgress: () => import('./modules/program-progress/ParentProgramProgress.js').then(m => m.ParentProgramProgress),
  FormulaireInscription: () => import('./modules/participants/FormulaireInscription.js').then(m => m.FormulaireInscription),
  ManagePoints: () => import('./modules/points/ManagePoints.js').then(m => m.ManagePoints),
  TimeSinceRegistration: () => import('./modules/participants/TimeSinceRegistration.js').then(m => m.TimeSinceRegistration),
  Attendance: () => import('./modules/attendance/Attendance.js').then(m => m.Attendance),
  ManageHonors: () => import('./modules/honors/ManageHonors.js').then(m => m.ManageHonors),
  ManageParticipants: () => import('./modules/participants/ManageParticipants.js').then(m => m.ManageParticipants),
  ManageUsersParticipants: () => import('./modules/participants/ManageUsersParticipants.js').then(m => m.ManageUsersParticipants),
  ManageGroups: () => import('./modules/groups/ManageGroups.js').then(m => m.ManageGroups),
  GuardianManagement: () => import('./modules/participants/GuardianManagement.js').then(m => m.initGuardianManagement),
  ViewParticipantDocuments: () => import('./modules/participants/ViewParticipantDocuments.js').then(m => m.ViewParticipantDocuments),
  ParentContactList: () => import('./modules/participants/ParentContactList.js').then(m => m.ParentContactList),
  BadgeTracker: () => import('./modules/badges/BadgeTracker.js').then(m => m.BadgeTracker),
  ProgramProgressDashboard: () => import('./modules/program-progress/ProgramProgressDashboard.js').then(m => m.ProgramProgressDashboard),
  BadgeForm: () => import('./modules/badges/BadgeForm.js').then(m => m.BadgeForm),
  Register: () => import('./modules/session/Register.js').then(m => m.Register),
  Admin: () => import('./modules/admin/Admin.js').then(m => m.Admin),
  MailingList: () => import('./modules/mailing-list/MailingList.js').then(m => m.MailingList),
  CommunicationHistory: () => import('./modules/communication-history/CommunicationHistory.js').then(m => m.CommunicationHistory),
  Calendars: () => import('./modules/fundraising/Calendars.js').then(m => m.Calendars),
  Fundraisers: () => import('./modules/fundraising/Fundraisers.js').then(m => m.Fundraisers),
  ResetPassword: () => import('./modules/session/ResetPassword.js').then(m => m.ResetPassword),
  DynamicFormHandler: () => import('./dynamicFormHandler.js').then(m => m.DynamicFormHandler),
  Reports: () => import('./modules/reports/Reports.js').then(m => m.Reports),
  MeetingPrep: () => import('./modules/meetings/MeetingPrep.js').then(m => m.MeetingPrep),
  CreateOrganization: () => import('./modules/organizations/CreateOrganization.js').then(m => m.CreateOrganization),
  PrintableGroupParticipantReport: () => import('./modules/groups/GroupParticipantReport.js').then(m => m.PrintableGroupParticipantReport),
  UpcomingMeeting: () => import('./modules/meetings/UpcomingMeeting.js').then(m => m.UpcomingMeeting),
  Finance: () => import('./modules/finance/Finance.js').then(m => m.Finance),
  Budgets: () => import('./modules/finance/Budgets.js').then(m => m.Budgets),
  ExternalRevenue: () => import('./modules/finance/ExternalRevenue.js').then(m => m.ExternalRevenue),
  Expenses: () => import('./modules/finance/Expenses.js').then(m => m.Expenses),
  RevenueDashboard: () => import('./modules/finance/RevenueDashboard.js').then(m => m.RevenueDashboard),
  ResourceDashboard: () => import('./modules/resources/ResourceDashboard.js').then(m => m.ResourceDashboard),
  Inventory: () => import('./modules/resources/Inventory.js').then(m => m.Inventory),
  MaterialManagement: () => import('./modules/resources/MaterialManagement.js').then(m => m.MaterialManagement),
  MedicationManagement: () => import('./modules/medication/MedicationManagement.js').then(m => m.MedicationManagement),
  MedicationReception: () => import('./modules/medication/MedicationReception.js').then(m => m.MedicationReception),
  PermissionSlipDashboard: () => import('./modules/permission-slips/PermissionSlipDashboard.js').then(m => m.PermissionSlipDashboard),
  PermissionSlipSign: () => import('./modules/permission-slips/PermissionSlipSign.js').then(m => m.PermissionSlipSign),
  AccountInfoModule: () => import('./modules/account-info.js').then(m => m.AccountInfoModule),
  FormBuilder: () => import('./modules/forms/FormBuilder.js').then(m => m.FormBuilder),
  Activities: () => import('./modules/activities/Activities.js').then(m => m.Activities),
  CarpoolLanding: () => import('./modules/carpool/CarpoolLanding.js').then(m => m.CarpoolLanding),
  CarpoolDashboard: () => import('./modules/carpool/CarpoolDashboard.js').then(m => m.CarpoolDashboard),
  RoleManagement: () => import('./modules/roles/RoleManagement.js').then(m => m.RoleManagement),
  DistrictManagement: () => import('./modules/district/DistrictManagement.js').then(m => m.DistrictManagement),
  FormPermissions: () => import('./modules/forms/FormPermissions.js').then(m => m.initFormPermissions),
  CommunicationSettings: () => import('./modules/communication-settings/CommunicationSettings.js').then(m => m.CommunicationSettings),
  UnitSettings: () => import('./modules/unit-settings/unit-settings.js').then(m => m.UnitSettings),
  OfflinePreparation: () => import('./modules/offline/OfflinePreparation.js').then(m => m.OfflinePreparation),
  IncidentReport: () => import('./modules/incident-report/incident-report.js').then(m => m.IncidentReport),
  YearlyPlanner: () => import('./modules/yearly-planner/YearlyPlanner.js').then(m => m.YearlyPlanner),
  ScoutYearTransition: () => import('./modules/scout-year/ScoutYearTransition.js').then(m => m.ScoutYearTransition),
  AlumniLink: () => import('./modules/alumni/AlumniLink.js').then(m => m.AlumniLink),
  ReactivationLink: () => import('./modules/reactivation/ReactivationLink.js').then(m => m.ReactivationLink),
  CompleteRegistration: () => import('./modules/family-access/CompleteRegistration.js').then(m => m.CompleteRegistration),
  FamilyLinkReview: () => import('./modules/family-access/FamilyLinkReview.js').then(m => m.FamilyLinkReview),
  ParentInvitations: () => import('./modules/parent-invitations/ParentInvitations.js').then(m => m.ParentInvitations),
  ParticipantDuplicates: () => import('./modules/participant-duplicates/ParticipantDuplicates.js').then(m => m.ParticipantDuplicates),
  ParentOnboarding: () => import('./modules/parent-onboarding/ParentOnboarding.js').then(m => m.ParentOnboarding),
  FamilyAccess: () => import('./modules/family-access/FamilyAccess.js').then(m => m.FamilyAccess),
  WalkInChildren: () => import('./modules/walk-in/WalkInChildren.js').then(m => m.WalkInChildren),
  Messages: () => import('./modules/messages/Messages.js').then(m => m.Messages)
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
  '/parent-fundraisers': 'parentFundraisers',
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
  "/badge-tracker": "badgeTracker",
  "/program-progress": "programProgressDashboard",
  "/parent-program-progress": "parentProgramProgress",
  "/parent-contact-list": "parentContactList",
  "/mailing-list": "mailingList",
  '/communication-history': 'communicationHistory',
  "/badge-form/:id": "badgeForm",
  "/register": "register",
  "/fundraisers": "fundraisers",
  "/calendars/:id": "calendars",
  "/reset-password": "resetPassword",
  "/alumni-consent": "alumniConsent",
  "/alumni-unsubscribe": "alumniUnsubscribe",
  "/reactivate-account": "reactivateAccount",
  "/complete-registration": "completeRegistration",
  "/family-link": "familyLink",
  "/parent-invitations": "parentInvitations",
  '/leader-invitations': 'leaderInvitations',
  "/participant-duplicates": "participantDuplicates",
  "/parent-onboarding": "parentOnboarding",
  "/family-access": "familyAccess",
  "/walk-in-children": "walkInChildren",
  '/messages': 'messages',
  '/messages/:id': 'message',
  "/reports": "reports",
  "/preparation-reunions": "preparation_reunions",
  "/preparation-reunions/:date": "preparation_reunions",
  "/manage-users-participants": "manageUsersParticipants",
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
    this.pendingRefresh = false;
    this.refreshNavigationId = null;
    // Each route() call, nested redirects included; only the latest one moves focus.
    this.routeSequence = 0;
    this.hasRouted = false;
    this.routingFirstScreen = false;
  }

  /**
   * Whether the screen being drawn replaces itself, with the same screen on
   * display (live sync redrawing it), rather than being navigated to. Such a
   * screen keeps what is on display while it loads instead of a skeleton.
   * @returns {boolean} True during a refresh of the screen on display
   */
  isRefreshingScreen() {
    return this.refreshNavigationId !== null && this.refreshNavigationId === this.navigationId;
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
    closeAllModals();

    // Focus must leave the subtree before it is detached, otherwise it falls
    // back to <body> and screen readers lose their place.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      const insideOverlay = activeElement.closest(
        '.modal, .modal-container, .modal-screen, .modal-overlay, .dialog-overlay',
      );
      if (insideOverlay) {
        activeElement.blur();
      }
    }

    const appRoot = document.getElementById('app');
    const transientSelectors = '.modal, .modal-container, .modal-screen, .modal-overlay, .dialog-overlay';
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

    // Release any body scroll lock the previous screen was holding. Without
    // this a report modal left open during navigation freezes the destination
    // page (the dashboard could not be scrolled after visiting a report).
    releaseAllScrollLocks();
  }

  navigate(path) {
    debugLog("Navigating to:", path);
    history.pushState(null, "", path);
    this.route(path.split('#')[0]);
  }

  /**
   * Show the screen for a path, returning it to where it was last scrolled.
   *
   * After a navigation, focus moves to the new screen's heading so a screen
   * reader announces it and Tab continues from there. The first screen after
   * a page load keeps the browser's own start, and a screen drawn again in
   * place (live sync) keeps focus where the person left it.
   *
   * @param {string} path - Path and query string to show
   * @param {{ refresh?: boolean, firstScreen?: boolean }} [options] -
   *   `refresh`: the screen on display is drawn again with fresh data (see
   *   isRefreshingScreen); `firstScreen`: a redirect carries on the route
   *   that started it, page load or not
   * @returns {Promise<void>}
   */
  async route(path, { refresh = false, firstScreen } = {}) {
    const sequence = ++this.routeSequence;
    const previousFocus = document.activeElement;
    // Settled now, not once drawn: a link followed while the first screen
    // still loads is a navigation like any other.
    const isFirstScreen = firstScreen ?? !this.hasRouted;
    this.hasRouted = true;
    this.routingFirstScreen = isFirstScreen;
    this.pendingRefresh = refresh;
    const scrollToken = beginScrollNavigation(path);
    try {
      await this.renderRoute(path);
    } finally {
      restoreScrollPosition(scrollToken);
    }
    if (sequence === this.routeSequence && !refresh && !isFirstScreen) {
      focusPageStart({ previousFocus });
    }
  }

  async renderRoute(path) {
    const navigationId = ++this.navigationId;
    this.refreshNavigationId = this.pendingRefresh ? navigationId : null;
    this.pendingRefresh = false;
    debugLog("Routing to:", path);

    // MEMORY LEAK FIX: Clean up previous module before loading new one
    this.cleanupCurrentModule();

    // Live sync redraws a screen only when it shows data that changed.
    resetPageReads();

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
      // Read before any await: it still describes the route() that called us.
      await this.route(mergedTarget, { firstScreen: this.routingFirstScreen });
      return;
    }
    const [routeName, param] = this.getRouteNameAndParam(path);

    // Check session
    const session = checkSession();
    this.app.isLoggedIn = session.isLoggedIn;
    this.app.userRole = session.userRole;
    this.app.userFullName = session.userFullName;
    this.app.userRoles = session.userRoles;
    this.app.userPermissions = session.userPermissions;
    this.app.userDataScope = session.userDataScope;

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
      // so requiring a session would make them unusable by design. The
      // invitation and family-link pages are reached by people who may have no
      // account at all yet -- creating one is what those pages are for.
      if (!this.app.isLoggedIn && !["login", "register", "resetPassword", "permissionSlipSign", "alumniConsent", "alumniUnsubscribe", "reactivateAccount", "completeRegistration", "familyLink"].includes(routeName)) {
        if (path !== "/login") {
          debugWarn('Redirecting to login from route:', routeName);
          history.pushState(null, "", buildLoginRedirect(path, window.location.href));
        }
        await this.loadLoginPage();
        return;

      }

      // Any form type for one participant; checked after the session so a
      // signed-out visitor is sent to login like on every other private page.
      const dynamicFormMatch = path.split("?")[0].match(/^\/dynamic-form\/([^/]+)\/(\d+)$/);
      if (dynamicFormMatch) {
        if (guard(holdsFamilyRole() || canViewParticipants())) {
          await this.loadDynamicForm(decodeURIComponent(dynamicFormMatch[1]), dynamicFormMatch[2]);
        }
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
          // The screen and its API both need fundraisers.view.
          if (!guard(canViewFundraisers())) {
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
          if (!guard(holdsFamilyRole() || canViewMedication())) {
            break;
          }
          const MedicationManagementParticipant = await this.loadModule('MedicationManagement');
          const participantId = parseInt(param);
          const medicationManagementParticipant = new MedicationManagementParticipant(this.app, {
            view: "planning",
            participantId: participantId,
            returnUrl: isParent() || !canViewMedication() ? '/parent-dashboard' : '/medication-reception'
          });
          this.currentModuleInstance = medicationManagementParticipant;
          await medicationManagementParticipant.init();
          break;
        case "medicationAuthorizationsParticipant":
          if (!guard(holdsFamilyRole() || canViewMedication())) {
            break;
          }
          const MedicationManagementAuth = await this.loadModule('MedicationManagement');
          const authParticipantId = parseInt(param);
          const medicationManagementAuth = new MedicationManagementAuth(this.app, {
            view: "authorizations",
            participantId: authParticipantId,
            returnUrl: isParent() || !canViewMedication() ? '/parent-dashboard' : '/medication-planning'
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
          if (!guard(canFollowPermissionSlips())) {
            break;
          }
          const PermissionSlipDashboard = await this.loadModule('PermissionSlipDashboard');
          const permissionSlipDashboard = new PermissionSlipDashboard(this.app);
          this.currentModuleInstance = permissionSlipDashboard;
          await permissionSlipDashboard.init();
          break;
        case "permissionSlipDashboardActivity":
          if (!guard(canFollowPermissionSlips())) {
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
        case 'parentFundraisers':
          // Same door as the parent dashboard that links here; the API limits
          // the answer to the account's own children.
          if (!guard(canAccessParentTools())) {
            break;
          }
          await this.loadParentFundraisers();
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
        case "reactivateAccount":
          await this.loadReactivationPage();
          break;
        case "completeRegistration":
          await this.loadModuleInstance('CompleteRegistration');
          break;
        case "familyLink":
          await this.loadModuleInstance('FamilyLinkReview');
          break;
        case "parentInvitations":
          if (!guard(hasPermission('users.invite'))) {
            break;
          }
          await this.loadModuleInstance('ParentInvitations');
          break;
        case 'leaderInvitations':
          // Inviting a leader also grants them a role
          if (!guard(hasPermission('users.invite') && hasPermission('users.assign_roles'))) {
            break;
          }
          await this.loadModuleInstance('ParentInvitations', { kind: 'leader' });
          break;
        case "participantDuplicates":
          if (!guard(hasPermission('participants.edit'))) {
            break;
          }
          await this.loadModuleInstance('ParticipantDuplicates');
          break;
        case "parentOnboarding":
          if (!guard(hasPermission('participants.create_own'))) {
            break;
          }
          await this.loadModuleInstance('ParentOnboarding');
          break;
        case "familyAccess":
          if (!guard(hasPermission('participants.create_own'))) {
            break;
          }
          await this.loadModuleInstance('FamilyAccess');
          break;
        case "walkInChildren":
          if (!guard(hasPermission('participants.walk_in'))) {
            break;
          }
          await this.loadModuleInstance('WalkInChildren');
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
          if (!guard(holdsFamilyRole() || canViewParticipants())) {
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
        case 'communicationHistory':
          // Every member reads the unit's news; the screen offers the sent messages
          // and the archive only to those who may send communications.
          await this.loadModuleInstance('CommunicationHistory');
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
          this.currentModuleInstance = await GuardianManagement(this.app);
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
          if (!guard(holdsFamilyRole() || canViewParticipants())) {
            break;
          }
          await this.loadParentProgramProgress();
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
          if (!guard(holdsFamilyRole() || canViewCarpools())) {
            break;
          }
          const CarpoolLanding = await this.loadModule('CarpoolLanding');
          const carpoolLanding = new CarpoolLanding(this.app);
          this.currentModuleInstance = carpoolLanding;
          await carpoolLanding.init();
          break;
        case 'messages':
        case 'message': {
          // Every member reads their own messages; the server returns only theirs.
          const Messages = await this.loadModule('Messages');
          const messages = new Messages(this.app, { messageId: routeName === 'message' ? parseInt(param, 10) : null });
          this.currentModuleInstance = messages;
          await messages.init();
          break;
        }
        case "carpool":
          if (!guard(holdsFamilyRole() || canViewCarpools())) {
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
          // Whoever may open the admin panel.
          if (!guard(canAccessAdminPanel())) {
            break;
          }
          const initFormPermissions = await this.loadModule('FormPermissions');
          this.currentModuleInstance = await initFormPermissions(this.app);
          break;
        case "register":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            // (replaceState so the URL matches what is rendered)
            const registerTarget = isParent() ? "/parent-dashboard" : "/dashboard";
            history.replaceState(null, "", registerTarget);
            return this.route(registerTarget);
          } else {
            await this.loadRegisterPage();
          }
          break;
        // ... other cases ...
        default:
          this.loadNotFoundPage();
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

  async loadParentFundraisers() {
    const ParentFundraisers = await this.loadModule('ParentFundraisers');
    const parentFundraisers = new ParentFundraisers(this.app);
    this.currentModuleInstance = parentFundraisers;
    await parentFundraisers.init();
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
    await resetPassword.render(token, errorParam);
  }

  async loadAlumniLinkPage(action) {
    const AlumniLink = await this.loadModule('AlumniLink');
    const alumniLink = new AlumniLink(this.app, action);
    this.currentModuleInstance = alumniLink;
    await alumniLink.init();
  }

  /**
   * Load a page module whose constructor takes the app and whose init() renders.
   *
   * @param {string} moduleName - Key in the module registry
   * @returns {Promise<void>}
   */
  async loadModuleInstance(moduleName, options = undefined) {
    const PageModule = await this.loadModule(moduleName);
    const instance = new PageModule(this.app, options);
    this.currentModuleInstance = instance;
    await instance.init();
  }

  async loadReactivationPage() {
    const ReactivationLink = await this.loadModule('ReactivationLink');
    const reactivationLink = new ReactivationLink(this.app);
    this.currentModuleInstance = reactivationLink;
    await reactivationLink.init();
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

  loadNotFoundPage() {
    setContent(document.getElementById("app"), buildNotFoundMarkup({
      titleKey: 'error_404_not_found'
    }));
  }

  loadNotAuthorizedPage() {
    setContent(document.getElementById("app"), buildNotFoundMarkup({
      titleKey: 'error_403_not_authorized',
      messageKey: 'error_403_not_authorized_message'
    }));
  }

  async loadRegisterPage() {
    const Register = await this.loadModule('Register');
    const register = new Register(this.app);
    this.currentModuleInstance = register;
    register.render();
  }

  reloadCurrentRoute() {
    this.route(`${window.location.pathname}${window.location.search}`);
  }

  async handleLogout() {
    try {
      const { Login } = await import('./modules/session/Login.js');
      await Login.logout();
      // Note: Login.logout() always redirects via window.location.href (never throws)
    } catch (error) {
      // Handle import failure
      debugError("Failed to load logout module:", error);
      window.location.href = "/login";
    }
  }

  async loadLoginPage() {
    const { Login } = await import('./modules/session/Login.js');
    const login = new Login(this.app);
    this.currentModuleInstance = login;
    login.init();
  }
}

export function initRouter(app) {
  const router = new Router(app);
  initScrollMemory();

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
      // eslint-disable-next-line no-script-url -- leaves javascript: links to the browser instead of routing them
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
