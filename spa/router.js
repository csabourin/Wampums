//router.js

// Critical imports - loaded immediately (core functionality)
import { Dashboard } from "./dashboard.js";
import { Login } from "./login.js";
import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, isDebugMode } from "./utils/DebugUtils.js";
import {
  canApproveBadges,
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
  canViewParticipants,
  canViewReports,
  canViewUsers,
  isParent
} from "./utils/PermissionUtils.js";

// Lazy-loaded modules - loaded on demand for better performance
// These will be dynamically imported when the route is accessed
const lazyModules = {
  ParentDashboard: () => import('./parent_dashboard.js').then(m => m.ParentDashboard),
  ParentFinance: () => import('./parent_finance.js').then(m => m.ParentFinance),
  FormulaireInscription: () => import('./formulaire_inscription.js').then(m => m.FormulaireInscription),
  ManagePoints: () => import('./manage_points.js').then(m => m.ManagePoints),
  TimeSinceRegistration: () => import('./time_since_registration.js').then(m => m.TimeSinceRegistration),
  Attendance: () => import('./attendance.js').then(m => m.Attendance),
  ManageHonors: () => import('./manage_honors.js').then(m => m.ManageHonors),
  ManageParticipants: () => import('./manage_participants.js').then(m => m.ManageParticipants),
  ManageUsersParticipants: () => import('./manage_users_participants.js').then(m => m.ManageUsersParticipants),
  ManageGroups: () => import('./manage_groups.js').then(m => m.ManageGroups),
  ViewParticipantDocuments: () => import('./view_participant_documents.js').then(m => m.ViewParticipantDocuments),
  ParentContactList: () => import('./parent_contact_list.js').then(m => m.ParentContactList),
  ApproveBadges: () => import('./approve_badges.js').then(m => m.ApproveBadges),
  BadgeDashboard: () => import('./badge_dashboard.js').then(m => m.BadgeDashboard),
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
  PreparationReunions: () => import('./preparation_reunions.js').then(m => m.PreparationReunions),
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
  PermissionSlipDashboard: () => import('./permission_slip_dashboard.js').then(m => m.PermissionSlipDashboard),
  PermissionSlipSign: () => import('./permission_slip_sign.js').then(m => m.PermissionSlipSign),
  AccountInfoModule: () => import('./modules/account-info.js').then(m => m.AccountInfoModule),
  FormBuilder: () => import('./formBuilder.js').then(m => m.FormBuilder),
  Activities: () => import('./activities.js').then(m => m.Activities),
  CarpoolLanding: () => import('./carpool.js').then(m => m.CarpoolLanding),
  CarpoolDashboard: () => import('./carpool_dashboard.js').then(m => m.CarpoolDashboard),
  RoleManagement: () => import('./role_management.js').then(m => m.RoleManagement)
};

// Cache for loaded modules
const moduleCache = {};

const debugMode = isDebugMode();

const routes = {

  "/": "dashboard",
  "/admin": "admin",
  "/dashboard": "dashboard",
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
  "/view-participant-documents": "viewParticipantDocuments",
  "/approve-badges": "approveBadges",
  "/badge-dashboard": "badgeDashboard",
  "/parent-contact-list": "parentContactList",
  "/mailing-list": "mailingList",
  "/fiche-sante/:id": "ficheSante",
  "/acceptation-risque/:id": "acceptationRisque",
  "/badge-form/:id": "badgeForm",
  "/register": "register",
  "/fundraisers": "fundraisers",
  "/calendars/:id": "calendars",
  "/reset-password": "resetPassword",
  "/reports": "reports",
  "/preparation-reunions": "preparation_reunions",
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
  "/medication-dispensing": "medicationDispensing",
  "/permission-slips": "permissionSlipDashboard",
  "/permission-slip/:id": "permissionSlipSign",
  "/account-info": "accountInfo",
  "/form-builder": "formBuilder",
  "/admin/form-builder": "formBuilder",
  "/activities": "activities",
  "/carpool": "carpoolLanding",
  "/carpool/:id": "carpool",
  "/role-management": "roleManagement"

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
    this.app.userRoles = session.userRoles;
    this.app.userPermissions = session.userPermissions;

    try {
      const guard = (condition) => {
        if (!condition) {
          this.loadNotAuthorizedPage();
          return false;
        }
        return true;
      };
      // Allow access to login, register, permission slip signing, and index pages without being logged in
      if (!this.app.isLoggedIn && !["login", "register", "resetPassword", "permissionSlipSign"].includes(routeName)) {
          if (path !== "/login") {
              console.trace(`Redirecting to login from route: ${routeName}`);
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
          case 'PrintableGroupParticipantReport':
          const PrintableGroupParticipantReport = await this.loadModule('PrintableGroupParticipantReport');
          const report = new PrintableGroupParticipantReport(this.app);
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
          await finance.init();
          break;
        case "budgets":
          if (!guard(canViewBudget() || canManageBudget() || canManageFinance())) {
            break;
          }
          const Budgets = await this.loadModule('Budgets');
          const budgets = new Budgets(this.app);
          await budgets.init();
          break;
        case "externalRevenue":
          if (!guard(canManageFinance() || canViewFinance())) {
            break;
          }
          const ExternalRevenue = await this.loadModule('ExternalRevenue');
          const externalRevenue = new ExternalRevenue(this.app);
          await externalRevenue.init();
          break;
        case "expenses":
          if (!guard(canManageFinance() || canViewFinance())) {
            break;
          }
          const Expenses = await this.loadModule('Expenses');
          const expenses = new Expenses(this.app);
          await expenses.init();
          break;
        case "revenueDashboard":
          if (!guard(canViewFinance() || canViewFundraisers() || canViewBudget())) {
            break;
          }
          const RevenueDashboard = await this.loadModule('RevenueDashboard');
        const revenueDashboard = new RevenueDashboard(this.app);
        await revenueDashboard.init();
        break;
      case "resourceDashboard":
          if (!guard(canViewInventory())) {
            break;
          }
          const ResourceDashboard = await this.loadModule('ResourceDashboard');
          const resourceDashboard = new ResourceDashboard(this.app);
          await resourceDashboard.init();
          break;
        case "inventory":
          if (!guard(canViewInventory())) {
            break;
          }
          const Inventory = await this.loadModule('Inventory');
          const inventory = new Inventory(this.app);
          await inventory.init();
          break;
        case "medicationManagement":
        case "medicationPlanning":
        case "medicationDispensing":
          if (!guard(canViewAttendance() || canViewParticipants())) {
            break;
          }
          const MedicationManagement = await this.loadModule('MedicationManagement');
          const medicationManagement = new MedicationManagement(this.app, {
            view: routeName === "medicationDispensing" ? "dispensing" : "planning",
            enableAlerts: routeName === "medicationDispensing"
          });
          await medicationManagement.init();
          break;
        case "materialManagement":
          if (!guard(canManageInventory() || canViewInventory())) {
            break;
          }
          const MaterialManagement = await this.loadModule('MaterialManagement');
          const materialManagement = new MaterialManagement(this.app);
          await materialManagement.init();
          break;
        case "permissionSlipDashboard":
          if (!guard(canViewParticipants())) {
            break;
          }
          const PermissionSlipDashboard = await this.loadModule('PermissionSlipDashboard');
          const permissionSlipDashboard = new PermissionSlipDashboard(this.app);
          await permissionSlipDashboard.init();
          break;
        case "permissionSlipSign":
          // Public route - allow anyone to sign permission slips via email link
          console.log('[ROUTER DEBUG] Loading PermissionSlipSign with ID:', param);
          const PermissionSlipSign = await this.loadModule('PermissionSlipSign');
          const permissionSlipSign = new PermissionSlipSign(this.app, param);
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
        case "login":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            this.route(
              isParent()
                ? "/parent-dashboard"
                : "/dashboard"
            );
          } else {
            await this.loadLoginPage();
          }
          break;
          case "registerOrganization":
          const RegisterOrganization = await this.loadModule('RegisterOrganization');
          const registerOrganization = new RegisterOrganization(this.app);
          await registerOrganization.init();
          break;
        case "logout":
          await this.handleLogout();
          break;
          case "resetPassword":
          await this.loadResetPasswordPage();
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
          if (!guard(canViewParticipants())) {
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
        case "ficheSante":
          await this.loadFicheSante(param);
          break;
        case "acceptationRisque":
          await this.loadAcceptationRisque(param);
          break;
        case "badgeForm":
          await this.loadBadgeForm(param);
          break;
          case 'preparation_reunions':
          await this.loadPreparationReunions();
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
          await formBuilder.init();
          break;
        case "activities":
          if (!guard(canViewActivities() || canManageActivities())) {
            break;
          }
          const Activities = await this.loadModule('Activities');
          const activities = new Activities(this.app);
          await activities.init();
          break;
        case "carpoolLanding":
          if (!guard(isParent() || canViewCarpools())) {
            break;
          }
          const CarpoolLanding = await this.loadModule('CarpoolLanding');
          const carpoolLanding = new CarpoolLanding(this.app);
          await carpoolLanding.init();
          break;
        case "carpool":
          if (!guard(isParent() || canViewCarpools())) {
            break;
          }
          const CarpoolDashboard = await this.loadModule('CarpoolDashboard');
          const carpoolDashboard = new CarpoolDashboard(this.app, param);
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
          await roleManagement.init();
          break;
        case "register":
          if (this.app.isLoggedIn) {
            // Redirect to appropriate dashboard if already logged in
            this.route(
              isParent()
                ? "/parent-dashboard"
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
      debugError("Routing error:", error);
      this.app.renderError("An error occurred while loading the page.");
    }
  }

  async loadDynamicForm(formType, participantId) {
    const DynamicFormHandler = await this.loadModule('DynamicFormHandler');
    const dynamicFormHandler = new DynamicFormHandler(this.app);
    await dynamicFormHandler.init(formType, participantId);
  }

  async loadFundraisersPage() {
    const Fundraisers = await this.loadModule('Fundraisers');
    const fundraisers = new Fundraisers(this.app);
    await fundraisers.init();
  }

  async loadCalendarsPage(fundraiserId) {
    const Calendars = await this.loadModule('Calendars');
    const calendars = new Calendars(this.app);
    await calendars.init(fundraiserId);
  }

  getRouteNameAndParam(path) {
      const cleanPath = path.split("?")[0];
      const parts = cleanPath.split("/");
      console.log('[ROUTER DEBUG] Path:', cleanPath, 'Parts:', parts);
      console.log('[ROUTER DEBUG] Checking:', `/${parts[1]}/:id`, 'Exists:', !!routes[`/${parts[1]}/:id`]);
      if (parts.length > 2 && routes[`/${parts[1]}/:id`]) {
        console.log('[ROUTER DEBUG] Matched parameterized route:', routes[`/${parts[1]}/:id`], 'Param:', parts[2]);
        return [routes[`/${parts[1]}/:id`], parts[2]];
      }
      debugLog(`Path: ${cleanPath}, RouteName: ${routes[cleanPath]}`);
      console.log('[ROUTER DEBUG] Route name:', routes[cleanPath] || "notFound");
      return [routes[cleanPath] || "notFound", null];
  }


  async loadDashboard() {
    const dashboard = new Dashboard(this.app);
    await dashboard.init();
  }

  async loadAdminPage() {
    const Admin = await this.loadModule('Admin');
    const admin = new Admin(this.app);
    await admin.init();
  }

  // Helper method to lazy-load and cache modules
  async loadModule(moduleName, ...args) {
    // Check cache first
    if (moduleCache[moduleName]) {
      return moduleCache[moduleName];
    }

    // Load the module dynamically
    if (lazyModules[moduleName]) {
      const ModuleClass = await lazyModules[moduleName]();
      moduleCache[moduleName] = ModuleClass;
      return ModuleClass;
    }

    throw new Error(`Module ${moduleName} not found`);
  }

  async loadParentDashboard() {
    const ParentDashboard = await this.loadModule('ParentDashboard');
    const parentDashboard = new ParentDashboard(this.app);
    await parentDashboard.init();
  }

  async loadParentFinance() {
    const ParentFinance = await this.loadModule('ParentFinance');
    const parentFinance = new ParentFinance(this.app);
    await parentFinance.init();
  }

  async loadManagePoints() {
    const ManagePoints = await this.loadModule('ManagePoints');
    const managePoints = new ManagePoints(this.app);
    await managePoints.init();
  }

  async loadTimeSinceRegistration() {
    const TimeSinceRegistration = await this.loadModule('TimeSinceRegistration');
    const timeSinceRegistration = new TimeSinceRegistration(this.app);
    await timeSinceRegistration.init();
  }

  async loadBadgeForm(participantId) {
    const BadgeForm = await this.loadModule('BadgeForm');
    const badgeForm = new BadgeForm(this.app);
    await badgeForm.init(participantId);
  }

  async loadAttendance() {
    const Attendance = await this.loadModule('Attendance');
    const attendance = new Attendance(this.app);
    await attendance.init();
  }

  async loadLoginPage() {
    const login = new Login(this.app);
    login.init();
  }

  async loadReports() {
    const Reports = await this.loadModule('Reports');
    const reports = new Reports(this.app);
    await reports.init();
  }

  async loadUpcomingMeeting(){
    const UpcomingMeeting = await this.loadModule('UpcomingMeeting');
    const upcomingMeeting = new UpcomingMeeting(this.app);
    upcomingMeeting.init();
  }

  async loadPreparationReunions() {
    const PreparationReunions = await this.loadModule('PreparationReunions');
    const preparationReunions = new PreparationReunions(this.app);
    await preparationReunions.init();
  }

  async loadAccountInfo() {
    const AccountInfoModule = await this.loadModule('AccountInfoModule');
    const accountInfo = new AccountInfoModule(this.app);
    await accountInfo.init();
  }

  async loadManageHonors() {
    const ManageHonors = await this.loadModule('ManageHonors');
    const manageHonors = new ManageHonors(this.app);
    await manageHonors.init();
  }

  async loadManageGroups() {
    const ManageGroups = await this.loadModule('ManageGroups');
    const manageGroups = new ManageGroups(this.app);
    await manageGroups.init();
  }

  async loadResetPasswordPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const ResetPassword = await this.loadModule('ResetPassword');
    const resetPassword = new ResetPassword(this.app);
    resetPassword.render(token);
  }

  async loadManageParticipants() {
    const ManageParticipants = await this.loadModule('ManageParticipants');
    const manageParticipants = new ManageParticipants(this.app);
    await manageParticipants.init();
  }

  async loadFormulaireInscription(participantId = null) {
    debugLog("Initializing FormulaireInscription with participantId:", participantId);
    const FormulaireInscription = await this.loadModule('FormulaireInscription');
    const formulaireInscription = new FormulaireInscription(this.app);
    await formulaireInscription.init(participantId);
  }

  async loadManageUsersParticipants() {
    const ManageUsersParticipants = await this.loadModule('ManageUsersParticipants');
    const manageUsersParticipants = new ManageUsersParticipants(this.app);
    await manageUsersParticipants.init();
  }

  async loadViewParticipantDocuments() {
    const ViewParticipantDocuments = await this.loadModule('ViewParticipantDocuments');
    const viewParticipantDocuments = new ViewParticipantDocuments(this.app);
    await viewParticipantDocuments.init();
  }

  async loadParentContactList() {
    const ParentContactList = await this.loadModule('ParentContactList');
    const parentContactList = new ParentContactList(this.app);
    await parentContactList.init();
  }

  async loadMailingList(){
    const MailingList = await this.loadModule('MailingList');
    const mailingList = new MailingList(this.app);
    await mailingList.init();
  }

  async loadApproveBadges() {
    const ApproveBadges = await this.loadModule('ApproveBadges');
    const approveBadges = new ApproveBadges(this.app);
    await approveBadges.init();
  }

  async loadBadgeDashboard() {
    const BadgeDashboard = await this.loadModule('BadgeDashboard');
    const badgeDashboard = new BadgeDashboard(this.app);
    await badgeDashboard.init();
  }

  async loadFicheSante(participantId) {
    const FicheSante = await this.loadModule('FicheSante');
    const ficheSante = new FicheSante(this.app);
    await ficheSante.init(participantId);
  }

  async loadAcceptationRisque(participantId) {
    const AcceptationRisque = await this.loadModule('AcceptationRisque');
    const acceptationRisque = new AcceptationRisque(this.app);
    await acceptationRisque.init(participantId);
  }

  loadNotFoundPage() {
    document.getElementById("app").innerHTML = `<h1>${translate("error_404_not_found")}</h1>`;
  }

  loadNotAuthorizedPage() {
    document.getElementById("app").innerHTML = `<h1>${translate("error_403_not_authorized")}</h1>`;
  }

  async loadRegisterPage() {
    const Register = await this.loadModule('Register');
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
      debugError("Logout error:", error);
      this.app.renderError("An error occurred during logout.");
    }
  }

  async loadLoginPage() {
    const login = new Login(this.app);
    login.init();
  }
}

export function initRouter(app) {
    const router = new Router(app);

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
    debugWarn("Router not available, using window.location");
    window.location.href = path;
  }
}
