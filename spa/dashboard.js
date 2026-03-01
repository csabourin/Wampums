import {
  getParticipants,
  getGroups,
  getCurrentOrganizationId,
  getOrganizationSettings,
  CONFIG,
} from "./ajax-functions.js";
import { getAttendanceDates, getAttendance } from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData, clearActivityRelatedCaches } from "./indexedDB.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { skeletonDashboard } from "./utils/SkeletonUtils.js";
import { getTodayISO } from "./utils/DateUtils.js";
import { normalizeParticipantList } from "./utils/ParticipantRoleUtils.js";
import { BaseModule } from "./utils/BaseModule.js";
import {
  hasPermission,
  hasAnyPermission,
  canAccessAdminPanel,
  canCreateOrganization,
  canManageRoles,
  canViewRoles,
  canManageForms,
} from "./utils/PermissionUtils.js";
import { DASHBOARD_TILES, SECTION_HEADINGS, SECTION_ORDER } from "./config/dashboard-tiles.js";
import { DashboardTileRenderer } from "./utils/DashboardTileRenderer.js";
import { DashboardCacheManager } from "./utils/DashboardCacheManager.js";
import { NewsFeed } from "./modules/NewsFeed.js";
import { CarpoolQuickAccessModal } from "./modules/modals/CarpoolQuickAccessModal.js";

export class Dashboard extends BaseModule {
  constructor(app) {
    super(app);
    this.groups = [];
    this.participants = [];
    this.newsFeed = new NewsFeed(app);
    this.pointsCollapsed = this.loadPointsCollapsedState();
    this.isLoading = true;
  }

  async init() {
    try {
      // Font Awesome is preloaded in index.html with font-display: swap
      // No additional loading strategy needed

      // Show loading skeleton immediately
      this.isLoading = true;
      this.render();

      // Parallelize independent data fetches for faster loading
      await Promise.all([
        this.fetchOrganizationInfo(),
        this.preloadDashboardData()
      ]);

      // Data loaded, render actual content
      this.isLoading = false;
      this.render();

      this.attachEventListeners();
      this.listenForConnectivityChanges();

      // Prefetch critical pages data after dashboard is ready
      // This is non-blocking and runs in background
      this.prefetchCriticalPages();

      this.loadNews();
    } catch (error) {
      debugError("Error initializing dashboard:", error);
      this.isLoading = false;
      this.renderError();
    }
  }

  loadPointsCollapsedState() {
    try {
      return localStorage.getItem("dashboard_points_collapsed") === "true";
    } catch {
      return false;
    }
  }

  /**
   * Prefetch critical data for the most time-sensitive pages:
   * - Attendance page (dates and today's data)
   * - Points page (groups data)
   *
   * This ensures instant loading when users navigate to these pages.
   * Runs after dashboard render to avoid blocking initial display.
   */
  async prefetchCriticalPages() {
    try {
      const today = getTodayISO();

      // Prefetch all critical data in parallel for maximum performance
      await Promise.allSettled([
        // Attendance page data
        getAttendanceDates().catch((error) => {
          debugLog("Prefetch attendance dates skipped:", error);
          return null;
        }),
        getAttendance(today).catch((error) => {
          debugLog("Prefetch today's attendance skipped:", error);
          return null;
        }),

        // Points page data (groups)
        // Only fetch if not already loaded by preloadDashboardData
        (async () => {
          if (this.groups && this.groups.length > 0) {
            debugLog("Groups already loaded, skipping prefetch");
            return null;
          }
          return getGroups().catch((error) => {
            debugLog("Prefetch groups skipped:", error);
            return null;
          });
        })(),
      ]);

      debugLog("Critical pages prefetch completed");
    } catch (error) {
      // Non-blocking: errors shouldn't affect dashboard
      debugLog("Critical pages prefetch error (non-blocking):", error);
    }
  }

  async fetchOrganizationInfo() {
    try {
      const settings = await this.app.waitForOrganizationSettings();
      const org = settings?.organization_info;

      if (org?.name) {
        this.organizationName = org.name;
        this.organizationLogo = org.logo;
      } else {
        this.organizationName = "Scouts";
      }
    } catch (error) {
      debugError("Error fetching organization info:", error);
      this.organizationName = "Scouts";
    }
  }

  async preloadDashboardData() {
    try {
      const cached = await DashboardCacheManager.preloadCachedData();

      if (cached.participants.length) {
        this.participants = normalizeParticipantList(
          cached.participants.map((p) => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            group_id: p.group_id,
            group_name: p.group_name,
            first_leader: p.first_leader ?? p.is_leader,
            second_leader: p.second_leader ?? p.is_second_leader,
          })),
        );
      }

      if (cached.groups.length) {
        this.groups = cached.groups;
      }

      const participantsResponse = await getParticipants();
      const freshParticipants =
        participantsResponse.data || participantsResponse.participants || [];

      if (freshParticipants.length) {
        const freshById = new Map(
          freshParticipants.map((participant) => [participant.id, participant]),
        );

        const mergedParticipants = this.participants.length
          ? this.participants.map(
            (participant) => freshById.get(participant.id) || participant,
          )
          : freshParticipants;

        const mergedIds = new Set(mergedParticipants.map((p) => p.id));
        freshParticipants.forEach((participant) => {
          if (!mergedIds.has(participant.id)) {
            mergedParticipants.push(participant);
          }
        });

        this.participants = mergedParticipants;
      }

      this.participants = normalizeParticipantList(this.participants);

      if (!cached.hasGroupsCache) {
        await this.fetchData(false, true);
      }

      if (!cached.hasParticipantsCache) {
        await DashboardCacheManager.cacheParticipants(this.participants);
      }

      if (!cached.hasGroupsCache) {
        await DashboardCacheManager.cacheGroups(this.groups);
      }

      this.render();
    } catch (error) {
      debugError("Error loading dashboard data:", error);
      this.render();
    }
  }

  async fetchData(fetchParticipants = true, fetchGroups = true) {
    const promises = [];
    if (fetchParticipants) {
      promises.push(
        getParticipants().catch((error) => {
          debugError("Error loading participants:", error);
          return { success: false, participants: [] };
        }),
      );
    }
    if (fetchGroups) {
      promises.push(
        getGroups().catch((error) => {
          debugError("Error loading groups:", error);
          return { success: false, data: [] };
        }),
      );
    }

    const results = await Promise.all(promises);
    let i = 0;

    if (fetchParticipants) {
      const res = results[i++];
      if (res.success && Array.isArray(res.participants)) {
        this.participants = res.participants;
      } else {
        debugLog("Failed to fetch participants, using existing data");
      }
    }

    if (fetchGroups) {
      const res = results[i];
      const groups = res.data || res.groups || [];
      if (res.success) {
        this.groups = groups.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        debugLog("Failed to fetch groups, using existing data");
      }
    }
  }

  // -----------------------------
  //          RENDER
  // -----------------------------
  render() {
    const container = document.getElementById("app");
    if (this.isLoading) {
      setContent(container, skeletonDashboard());
      return;
    }

    // Permission checks
    const showFinanceSection = hasAnyPermission("finance.view", "budget.view");
    const showRoleManagement = canViewRoles();
    const showOrgCreation = canCreateOrganization();
    const showReports = hasAnyPermission("reports.view", "reports.export");
    const showAdminPanel = canAccessAdminPanel();
    const showFormPermissions = canManageForms();

    // Routes whose JS modules are pre-loaded during camp mode preparation.
    // When offline, only tiles targeting these routes should be shown.
    const offlineAvailableRoutes = new Set([
      "/managePoints",
      "/manageHonors",
      "/attendance",
      "/upcoming-meeting",
      "/badge-tracker",
      "/badge-dashboard",
      "/program-progress",
      "/activities",
      "/medication-dispensing",
      "/medication-planning",
      "/medication-reception",
      "/carpool",
      "/manage-participants",
      "/manage-groups",
      "/prepare-offline",
    ]);
    const isOffline = !navigator.onLine;
    const filterOffline = (tiles) =>
      isOffline ? tiles.filter(t => offlineAvailableRoutes.has(t.href)) : tiles;

    // --- Helper for dynamic sorting by translated label ---
    const sortByLabel = (items) => {
      return items.slice().sort((a, b) => {
        const labelA = translate(a.label).toLocaleLowerCase();
        const labelB = translate(b.label).toLocaleLowerCase();
        return labelA.localeCompare(labelB);
      });
    };

    // --- Top Row (fixed order) ---
    const topTiles = filterOffline([
      { href: "/managePoints", icon: "fa-coins", label: "manage_points" },
      { href: "/manageHonors", icon: "fa-award", label: "manage_honors" },
      { href: "/attendance", icon: "fa-clipboard-check", label: "attendance" },
      { href: "/upcoming-meeting", icon: "fa-calendar-day", label: "upcoming_meeting" },
    ]);

    // --- Day-to-Day ---
    const dayToDayTiles = filterOffline(sortByLabel([
      { href: "/badge-tracker", icon: "fa-chart-bar", label: "badge_tracker_title" },
      { href: "/program-progress", icon: "fa-timeline", label: "program_progress_nav" },
      { href: "/parent-contact-list", icon: "fa-address-book", label: "parent_contact_list" },
      { href: "/medication-dispensing", icon: "fa-pills", label: "medication_dispensing_link" },
      { href: "/parent-dashboard", icon: "fa-users", label: "vue_parents" },
    ]));

    // --- Planning & Activities ---
    const planningTiles = filterOffline(sortByLabel([
      { href: "/activities", icon: "fa-calendar-days", label: "activities_calendar" },
      { href: "/carpool", icon: "fa-car", label: "carpool_coordination", id: "carpool-quick-access" },
      { href: "/preparation-reunions", icon: "fa-clipboard-list", label: "preparation_reunions" },
      { href: "/view-participant-documents", icon: "fa-file-lines", label: "view_participant_documents" },
      { href: "/inventory", icon: "fa-warehouse", label: "inventory_link" },
      { href: "/material-management", icon: "fa-calendar-check", label: "material_management_link" },
      { href: "/medication-planning", icon: "fa-pills", label: "medication_planning_link" },
      { href: "/medication-reception", icon: "fa-hospital", label: "med_reception_link" },
      { href: "/permission-slips", icon: "fa-file-signature", label: "manage_permission_slips" },
      { href: "/yearly-planner", icon: "fa-calendar-alt", label: "yearly_planner_nav" },
    ]));

    // --- Unit Management ---
    const unitTiles = filterOffline(sortByLabel([
      hasPermission("participants.view") && { href: "/manage-participants", icon: "fa-id-card", label: "manage_names" },
      hasPermission("groups.view") && { href: "/manage-groups", icon: "fa-people-group", label: "manage_groups" },
      hasPermission("users.view") && { href: "/manage-users-participants", icon: "fa-user-gear", label: "manage_users_participants" },
      showReports && { href: "/reports", icon: "fa-chart-line", label: "reports" },
      showReports && { href: "/group-participant-report", icon: "fa-table-list", label: "feuille_participants" },
    ].filter(Boolean)));

    // --- District & System Management ---
    const districtTiles = filterOffline(sortByLabel([
      showRoleManagement && { href: "/role-management", icon: "fa-user-tag", label: "role_management" },
      showRoleManagement && { href: "/district-management", icon: "fa-sitemap", label: "district_management_title" },
      showFormPermissions && { href: "/form-permissions", icon: "fa-clipboard-check", label: "form_permissions" },
      showOrgCreation && { href: "/create-organization", icon: "fa-building", label: "create_unit" },
      showAdminPanel && { href: "/admin", icon: "fa-user-shield", label: "administration", id: "admin-link" },
    ].filter(Boolean)));

    // --- Finance & Fundraising ---
    const financeTiles = filterOffline(showFinanceSection
      ? sortByLabel([
          hasPermission("finance.view") && { href: "/finance", icon: "fa-coins", label: "finance_memberships_tab" },
          hasPermission("finance.view") && { href: "/finance?tab=definitions", icon: "fa-file-invoice-dollar", label: "finance_definitions_tab" },
          hasPermission("finance.view") && { href: "/finance?tab=reports", icon: "fa-chart-pie", label: "financial_report" },
          hasAnyPermission("finance.manage", "finance.view") && { href: "/expenses", icon: "fa-wallet", label: "expense_tracking" },
          hasAnyPermission("finance.manage", "finance.view") && { href: "/external-revenue", icon: "fa-hand-holding-dollar", label: "external_revenue" },
          hasAnyPermission("finance.view", "fundraisers.view") && { href: "/revenue-dashboard", icon: "fa-chart-column", label: "revenue_dashboard" },
          hasPermission("fundraisers.view") && { href: "/fundraisers", icon: "fa-hand-holding-heart", label: "fundraisers" },
          hasPermission("budget.view") && { href: "/budgets", icon: "fa-sack-dollar", label: "budget_management" },
        ].filter(Boolean))
      : []);

    // --- News & Communications ---
    const newsCommsTiles = filterOffline(sortByLabel([
      hasPermission("communications.send") && { href: "/communications", icon: "fa-comments", label: "communications_title" },
      hasPermission("communications.send") && { href: "/mailing-list", icon: "fa-envelope-open-text", label: "mailing_list" },
    ].filter(Boolean)));

    // --- Helper to render a tile group ---
    const renderTileGroup = (titleKey, tiles) => {
      if (!tiles.length) return "";
      return `
        <section class="dashboard-section">
          <h3>${translate(titleKey)}</h3>
          <div class="manage-items">
            ${tiles
              .map(
                (tile) =>
                  `<a href="${tile.href}"${tile.id ? ` id="${tile.id}"` : ""}><i class="fa-solid ${tile.icon}"></i><span>${translate(tile.label)}</span></a>`
              )
              .join("\n")}
          </div>
        </section>
      `;
    };

    // --- Render content ---
    const content = `
      <h1>${translate("dashboard_title")}</h1>
      <h2>${this.organizationName}</h2>
      <div class="dashboard-section">
        <div class="manage-items">
          ${topTiles
            .map(
              (tile) =>
                `<a href="${tile.href}"><i class="fa-solid ${tile.icon}"></i><span>${translate(tile.label)}</span></a>`
            )
            .join("\n")}
        </div>
      </div>
      <div class="logo-container">
        <img class="logo" src="${this.organizationLogo}" width="335" height="366" alt="Logo">
      </div>
      ${renderTileGroup("dashboard_day_to_day_section", dayToDayTiles)}
      ${renderTileGroup("dashboard_planning_section", planningTiles)}
      ${renderTileGroup("dashboard_unit_management_section", unitTiles)}
      ${renderTileGroup("dashboard_district_system_section", districtTiles)}
      ${renderTileGroup("dashboard_finance_section", financeTiles)}
      ${renderTileGroup("dashboard_news_communications_section", newsCommsTiles)}
      <!-- NEWS -->
      <div class="dashboard-card" id="news-section">
        <div class="section-header">
          <h3>${translate("news_updates")}</h3>
          <button type="button" id="refresh-news-btn" class="ghost-button">${translate("refresh")}</button>
        </div>
        <div id="news-content"></div>
      </div>
      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;

    setContent(container, content);
    this.updatePointsList();
    this.updateNewsSection();
  }

  // --- Translation key suggestions for new section headings ---
  // "dashboard_day_to_day_section": "Day-to-Day",
  // "dashboard_planning_section": "Planning & Activities",
  // "dashboard_unit_management_section": "Unit Management",
  // "dashboard_district_system_section": "District & System Management",
  // "dashboard_finance_section": "Finance & Fundraising",
  // "dashboard_news_communications_section": "News & Communications",

  // -----------------------------
  // POINTS LIST
  // -----------------------------
  renderCollapsedPointsPlaceholder() {
    return `<p class="muted-text">${translate("points_collapsed_hint")}</p>`;
  }

  updatePointsList() {
    const list = document.getElementById("points-list");
    if (!list) return;

    list.classList.toggle("collapsed", this.pointsCollapsed);
    setContent(
      list,
      this.pointsCollapsed
        ? this.renderCollapsedPointsPlaceholder()
        : this.renderPointsList(),
    );
  }

  renderPointsList() {
    const groupParticipants = new Map(this.groups.map((g) => [g.id, []]));
    const noGroup = [];

    this.participants.forEach((p) => {
      if (p.group_id) {
        const arr = groupParticipants.get(p.group_id);
        if (arr) arr.push(p);
      } else noGroup.push(p);
    });

    let output = "";

    groupParticipants.forEach((members, groupId) => {
      const group = this.groups.find((g) => g.id === groupId);
      if (!group || members.length === 0) return;

      const total = members.reduce(
        (s, p) => s + (parseInt(p.total_points) || 0),
        0,
      );

      output += `
        <div class="group-header" data-group-id="${groupId}" data-type="group" data-points="${total}">
          <span>${group.name}</span>
          <span id="group-points-${groupId}">${total}</span>
        </div>
        <div class="group-content visible">
          ${this.renderParticipantsForGroup(members)}
        </div>
      `;
    });

    if (noGroup.length > 0) {
      output += `
        <div class="group-header" data-group-id="none" data-type="group" data-points="0">
          <span>${translate("no_group")}</span>
          <span>0</span>
        </div>
        <div class="group-content visible">
          ${this.renderParticipantsForGroup(noGroup)}
        </div>
      `;
    }

    return output;
  }

  renderParticipantsForGroup(participants) {
    participants.sort((a, b) => {
      if (a.first_leader && !b.first_leader) return -1;
      if (!a.first_leader && b.first_leader) return 1;
      if (a.second_leader && !b.second_leader) return 1;
      if (!a.second_leader && b.second_leader) return -1;
      return a.first_name.localeCompare(b.first_name);
    });

    return participants
      .map((p) => {
        const pts = parseInt(p.total_points) || 0;

        return `
          <div class="list-item"
               data-name-id="${p.id}"
               data-type="individual"
               data-group-id="${p.group_id || "none"}"
               data-points="${pts}"
              data-name="${p.first_name}">
            <span class="participant-name">
              ${p.first_name} ${p.last_name}
              ${p.first_leader ? ` <span class="badge leader">${translate("leader")}</span>` : ""}
              ${p.second_leader ? ` <span class="badge second-leader">${translate("second_leader")}</span>` : ""}
            </span>
            <span class="participant-points" id="name-points-${p.id}">${pts}</span>
          </div>
        `;
      })
      .join("");
  }

  // -----------------------------
  // NEWS FEED
  // -----------------------------
  // Load news with NewsFeed module
  async loadNews(force = false) {
    await this.newsFeed.load(force);
    this.updateNewsSection();
  }

  updateNewsSection() {
    const container = document.getElementById("news-content");
    if (container) setContent(container, this.newsFeed.renderContent());

    const btn = document.getElementById("refresh-news-btn");
    if (btn) btn.disabled = this.newsFeed.getIsLoading();
  }

  // -----------------------------
  // EVENT LISTENERS
  // -----------------------------
  attachEventListeners() {
    this.addEventListener(document.getElementById("logout-link"), "click", (e) => {
      e.preventDefault();
      this.lazyLogout();
    });

    this.addEventListener(document.getElementById("refresh-news-btn"), "click", () => {
      this.loadNews(true);
    });

    this.addEventListener(document.getElementById("carpool-quick-access"), "click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.app?.router) {
        this.app.router.navigate("/carpool");
      }

      try {
        const modal = new CarpoolQuickAccessModal(this.app);
        await modal.show();
      } catch (error) {
        debugError("Error opening carpool quick access:", error);
        if (typeof this.app?.showMessage === "function") {
          this.app.showMessage("error_loading_activities", "error");
        }
      }
    });
  }

  /**
   * Register online/offline listeners once (called from init, not attachEventListeners)
   * to avoid accumulating duplicate listeners on each re-render cycle.
   */
  listenForConnectivityChanges() {
    const rerender = () => {
      if (!this.isLoading) {
        this.render();
        this.attachEventListeners();
      }
    };
    this.addWindowEventListener("online", rerender);
    this.addWindowEventListener("offline", rerender);
  }

  async lazyLogout() {
    try {
      const { Login } = await import("./login.js");
      await Login.logout();
      // Note: Login.logout() always redirects via window.location.href (never throws)
    } catch (error) {
      // Handle import failure
      debugError("Failed to load logout module:", error);
      window.location.href = "/login";
    }
  }

  togglePointsVisibility() {
    this.pointsCollapsed = !this.pointsCollapsed;
    localStorage.setItem("dashboard_points_collapsed", this.pointsCollapsed);

    const toggleBtn = document.getElementById("toggle-points-btn");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", !this.pointsCollapsed);
      toggleBtn.textContent = this.pointsCollapsed
        ? translate("expand_points")
        : translate("collapse_points");
    }

    this.updatePointsList();
  }

  // Carpool modals are now handled by CarpoolQuickAccessModal module
  // See spa/modules/modals/CarpoolQuickAccessModal.js

  renderError() {
    setContent(
      document.getElementById("app"),
      `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_dashboard")}</p>
    `,
    );
  }

  /**
   * Clean up resources when navigating away
   * Called automatically by router
   */
  destroy() {
    super.destroy();
    // Clear data references
    this.groups = [];
    this.participants = [];
  }
}
