import {
  getParticipants,
  getGroups,
  getCurrentOrganizationId,
  getOrganizationSettings,
  CONFIG,
} from "./ajax-functions.js";
import {
  getAttendanceDates,
  getAttendance,
  getNextMeetingInfo,
  getPermissionSlips,
  getMedicationDistributions,
} from "./api/api-endpoints.js";
import { getActivities } from "./api/api-activities.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData, clearActivityRelatedCaches } from "./indexedDB.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { setContent, loadStylesheet } from "./utils/DOMUtils.js";
import { skeletonDashboard } from "./utils/SkeletonUtils.js";
import { getTodayISO, formatDate } from "./utils/DateUtils.js";
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
  isParent,
} from "./utils/PermissionUtils.js";
import { DashboardCacheManager } from "./utils/DashboardCacheManager.js";
import { NewsFeed } from "./modules/NewsFeed.js";
import { CarpoolQuickAccessModal } from "./modules/modals/CarpoolQuickAccessModal.js";
import { getTileContext, ROLE_WEIGHTS } from "./config/dashboard-customization.js";
import {
  applyPalette,
  getDashboardPrefs,
  setCollapsedToolGroups,
} from "./utils/DashboardPreferences.js";
import { CommandPalette } from "./modules/CommandPalette.js";
import { DashboardSettingsModal } from "./modules/DashboardSettingsModal.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { offlineManager } from "./modules/OfflineManager.js";

export class Dashboard extends BaseModule {
  constructor(app, options = {}) {
    super(app);
    this.groups = [];
    this.participants = [];
    this.newsFeed = new NewsFeed(app);
    this.pointsCollapsed = this.loadPointsCollapsedState();
    this.isLoading = true;
    this.mode = options.mode || "default";
    this.nextMeeting = null;
    this.medicationDoseIsTimeSensitive = false;
    this.counters = {
      medicationDosesToday: null,
      permissionSlipsPending: null,
      activitiesUpcoming: null,
    };
  }

  async init() {
    try {
      // Font Awesome is preloaded in index.html with font-display: swap
      // No additional loading strategy needed

      // Dashboard-specific styles aren't critical for the skeleton, but we
      // want them in place before the real render. Loaded on-demand so
      // non-dashboard pages don't pay for them.
      loadStylesheet("/css/dashboard-v2.css").catch((error) => {
        debugError("Failed to load dashboard-v2 stylesheet:", error);
      });

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

      // Counters / next-meeting fetch is non-blocking. Re-renders on arrival.
      this.refreshDashboardCounters();

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

    // Apply user's chosen palette as CSS variables (idempotent).
    applyPalette();

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

    const financeWorkspaceMode = this.mode === "finance-focused";

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

    const financeWorkspaceTiles = filterOffline(
      sortByLabel([
        hasPermission("finance.view") && { href: "/finance", icon: "fa-coins", label: "finance_memberships_tab" },
        hasPermission("finance.view") && { href: "/finance?tab=definitions", icon: "fa-file-invoice-dollar", label: "finance_definitions_tab" },
        hasPermission("finance.view") && { href: "/finance?tab=reports", icon: "fa-chart-pie", label: "financial_report" },
        hasAnyPermission("finance.manage", "finance.view") && { href: "/expenses", icon: "fa-wallet", label: "expense_tracking" },
        hasAnyPermission("finance.manage", "finance.view") && { href: "/external-revenue", icon: "fa-hand-holding-dollar", label: "external_revenue" },
        hasAnyPermission("finance.view", "fundraisers.view") && { href: "/revenue-dashboard", icon: "fa-chart-column", label: "revenue_dashboard" },
        hasPermission("fundraisers.view") && { href: "/fundraisers", icon: "fa-hand-holding-heart", label: "fundraisers" },
        hasPermission("budget.view") && { href: "/budgets", icon: "fa-sack-dollar", label: "budget_management" },
      ].filter(Boolean))
    );

    const crossRoleTiles = filterOffline(
      sortByLabel([
        isParent() && { href: "/parent-dashboard", icon: "fa-users", label: "parent_dashboard" },
        { href: "/account-info", icon: "fa-user-gear", label: "account_settings" },
      ].filter(Boolean))
    );

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
    if (financeWorkspaceMode) {
      const content = `
        <h1>${translate("dashboard_finance_section")}</h1>
        <h2>${this.organizationName}</h2>
        ${renderTileGroup("dashboard_finance_section", financeWorkspaceTiles)}
        ${renderTileGroup("main_actions", crossRoleTiles)}
        <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
      `;
      setContent(container, content);
      this.updateNewsSection();
      return;
    }

    // --- Moment-based layout ---
    // Pool all permission-granted tiles, then route them by tile context.
    const allTiles = [
      ...topTiles,
      ...dayToDayTiles,
      ...planningTiles,
      ...unitTiles,
      ...districtTiles,
      ...financeTiles,
      ...newsCommsTiles,
    ];

    // Snapshot user prefs once per render — avoids re-reading localStorage
    // for every tile (hiddenTiles lookup) and every Tools group (collapsed
    // lookup) downstream.
    this._prefs = getDashboardPrefs();
    const hiddenSet = new Set(this._prefs.hiddenTiles || []);
    this._allTiles = allTiles.filter((t) => !hiddenSet.has(t.href));
    const stats = this._computeTileStats();

    // Bucket tiles by moment. Apply user-hidden filter.
    const buckets = { now: [], week: [], tools: [] };
    this._allTiles.forEach((tile) => {
      const ctx = this._getTileContext(tile);
      const enriched = { ...tile, ...ctx, stat: stats[tile.href] };
      buckets[ctx.moment].push(enriched);
    });

    // Sort each bucket by role-aware domain weight, then by translated label.
    const roleKey = this._dominantRoleKey();
    const weights = ROLE_WEIGHTS[roleKey] || ROLE_WEIGHTS.default;
    const sortBucket = (arr) =>
      arr.sort((a, b) => {
        const pa = a.priority ?? 50;
        const pb = b.priority ?? 50;
        if (pa !== pb) return pa - pb;
        const wa = weights[a.domain] ?? 50;
        const wb = weights[b.domain] ?? 50;
        if (wa !== wb) return wa - wb;
        return translate(a.label).localeCompare(translate(b.label));
      });
    sortBucket(buckets.now);
    sortBucket(buckets.week);
    sortBucket(buckets.tools);

    const content = `
      ${this._renderTopBar()}
      ${this._renderHero(buckets.now)}
      ${this._renderWeek(buckets.week)}
      ${this._renderTools(buckets.tools)}
      <div class="dashboard-card" id="news-section">
        <div class="section-header">
          <h3>${translate("news_updates")}</h3>
          <button type="button" id="refresh-news-btn" class="ghost-button">${translate("refresh")}</button>
        </div>
        <div id="news-content"></div>
      </div>
      ${this._renderFab()}
      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;

    setContent(container, `<div class="dashboard-v2">${content}</div>`);
    this.updatePointsList();
    this.updateNewsSection();
  }

  // -----------------------------
  //   Moment-layout helpers
  // -----------------------------

  _dominantRoleKey() {
    const roles = (this.app?.userRoles || []).map((r) => (r || "").toString().toLowerCase());
    if (roles.includes("admin") || roles.includes("super_admin")) return "admin";
    if (roles.some((r) => r.includes("treasur") || r.includes("tresor"))) return "treasurer";
    if (roles.includes("parent") || roles.includes("guardian")) return "parent";
    if (roles.includes("animator") || roles.includes("animateur") || roles.includes("leader")) return "animator";
    return "default";
  }

  _getTileContext(tile) {
    const ctx = getTileContext(tile.href);
    if (tile.href !== "/medication-dispensing") return ctx;

    return this.medicationDoseIsTimeSensitive
      ? { ...ctx, moment: "now", priority: -1 }
      : ctx;
  }

  _computeTileStats() {
    // Counters derived from data already loaded — fast, no extra fetches.
    // Tiles without a stat just won't show one.
    const stats = {};
    const participantCount = this.participants?.length || 0;
    const groupCount = this.groups?.length || 0;
    const totalPoints = (this.participants || []).reduce(
      (sum, p) => sum + (parseInt(p.total_points) || 0),
      0,
    );
    if (participantCount) {
      stats["/manage-participants"] = { value: participantCount, label: translate("participants_short") };
      stats["/parent-contact-list"] = { value: participantCount, label: translate("contacts_short") };
    }
    if (groupCount) {
      stats["/manage-groups"] = { value: groupCount, label: translate("groups_short") };
    }
    if (totalPoints) {
      stats["/managePoints"] = { value: totalPoints, label: translate("points_short") };
    }

    // Counters from the background fetch — only added if a value arrived.
    const c = this.counters || {};
    if (typeof c.medicationDosesToday === "number" && c.medicationDosesToday > 0) {
      stats["/medication-dispensing"] = {
        value: c.medicationDosesToday,
        label: translate("doses_short"),
        urgent: true,
      };
    }
    if (typeof c.permissionSlipsPending === "number" && c.permissionSlipsPending > 0) {
      stats["/permission-slips"] = {
        value: c.permissionSlipsPending,
        label: translate("pending_short"),
        urgent: true,
      };
    }
    if (typeof c.activitiesUpcoming === "number" && c.activitiesUpcoming > 0) {
      stats["/activities"] = {
        value: c.activitiesUpcoming,
        label: translate("upcoming_short"),
      };
    }
    return stats;
  }

  /**
   * Fetch lightweight counter and "next meeting" data in parallel.
   * Every call is best-effort: failures are silent, missing permissions
   * just skip the fetch. Re-renders the dashboard when anything new arrives.
   */
  async refreshDashboardCounters() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const canSeeMedication = hasAnyPermission("medication.manage", "medication.view");
    const canSeeSlips = hasPermission("participants.view");
    const canSeeActivities = hasAnyPermission("activities.view", "activities.manage");

    const tasks = [
      ["nextMeeting", getNextMeetingInfo()],
      canSeeSlips ? ["slips", getPermissionSlips({})] : null,
      canSeeMedication ? ["meds", getMedicationDistributions({ upcoming_only: true })] : null,
      canSeeActivities ? ["activities", getActivities()] : null,
    ].filter(Boolean);

    const results = await Promise.allSettled(tasks.map(([, p]) => p));

    let changed = false;
    let medicationDistributions = null;
    let activities = null;
    results.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      const key = tasks[i][0];
      const value = res.value;
      try {
        if (key === "nextMeeting") {
          const meeting = value?.meeting || value?.data?.meeting || null;
          if (meeting && meeting.date) {
            this.nextMeeting = meeting;
            changed = true;
          }
        } else if (key === "slips") {
          const list = value?.data?.permission_slips || value?.permission_slips || [];
          const pending = list.filter((s) => {
            const status = (s.status || "").toLowerCase();
            return status === "pending" || status === "sent" || status === "unsigned";
          }).length;
          this.counters.permissionSlipsPending = pending;
          changed = true;
        } else if (key === "meds") {
          const list = value?.data?.distributions || value?.distributions || [];
          medicationDistributions = list;
          const todayISO = getTodayISO();
          const todays = list.filter((d) => {
            if (!d.scheduled_for) return false;
            const scheduled = String(d.scheduled_for).slice(0, 10);
            const status = (d.status || "scheduled").toLowerCase();
            return scheduled === todayISO && status === "scheduled";
          }).length;
          this.counters.medicationDosesToday = todays;
          changed = true;
        } else if (key === "activities") {
          const list = Array.isArray(value) ? value : value?.data || [];
          activities = list;
          const upcoming = list.filter((a) => {
            const dateStr = a.activity_date || a.start_date || a.date;
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= today && d <= dayOut;
          }).length;
          this.counters.activitiesUpcoming = upcoming;
          changed = true;
        }
      } catch (error) {
        debugLog("Counter parse skipped:", key, error);
      }
    });

    if (medicationDistributions || activities) {
      const shouldPromoteMedication = this._shouldPromoteMedicationAction(
        medicationDistributions || [],
        activities || [],
      );
      if (this.medicationDoseIsTimeSensitive !== shouldPromoteMedication) {
        this.medicationDoseIsTimeSensitive = shouldPromoteMedication;
        changed = true;
      }
    }

    if (changed && !this.isLoading) {
      this.render();
      this.attachEventListeners();
    }
  }

  /**
   * Medication becomes the dashboard primary action only when a scheduled dose
   * is near and the unit is currently in a camp/field-trip style activity.
   *
   * @param {Array<Object>} distributions
   * @param {Array<Object>} activities
   * @returns {boolean}
   */
  _shouldPromoteMedicationAction(distributions = [], activities = []) {
    const now = new Date();
    const activeActivity = this._getActiveMedicationActivity(activities, now)
      || this._getActivePreparedCampActivity();

    if (!activeActivity) return false;

    const beforeMs = (CONFIG.DASHBOARD?.MEDICATION_DUE_WINDOW_BEFORE_MINUTES ?? 90) * 60 * 1000;
    const afterMs = (CONFIG.DASHBOARD?.MEDICATION_DUE_WINDOW_AFTER_MINUTES ?? 15) * 60 * 1000;

    return distributions.some((distribution) => {
      if (!distribution?.scheduled_for) return false;
      const status = (distribution.status || "scheduled").toLowerCase();
      if (status !== "scheduled") return false;

      const scheduledAt = new Date(distribution.scheduled_for);
      if (Number.isNaN(scheduledAt.getTime())) return false;

      const delta = scheduledAt.getTime() - now.getTime();
      if (delta < -afterMs || delta > beforeMs) return false;

      return this._distributionMatchesActivity(distribution, activeActivity);
    });
  }

  _getActiveMedicationActivity(activities = [], now = new Date()) {
    return activities.find((activity) => {
      if (!this._isMedicationPriorityActivity(activity)) return false;

      const startDate = activity.activity_start_date || activity.start_date || activity.activity_date || activity.date;
      const endDate = activity.activity_end_date || activity.end_date || startDate;
      const startTime = activity.activity_start_time || activity.meeting_time_going || "00:00";
      const endTime = activity.activity_end_time || activity.departure_time_return || activity.departure_time_going || "23:59";
      const start = this._parseLocalActivityDateTime(startDate, startTime);
      const end = this._parseLocalActivityDateTime(endDate, endTime);

      if (!start || !end) return false;
      return start.getTime() <= now.getTime() && now.getTime() <= end.getTime();
    }) || null;
  }

  _getActivePreparedCampActivity() {
    try {
      const today = getTodayISO();
      if (!offlineManager?.campMode || !offlineManager.isDatePrepared(today)) {
        return null;
      }

      const prepared = offlineManager.getPreparedActivityForDate(today);
      return prepared ? { ...prepared, name: prepared.name || "" } : null;
    } catch (error) {
      debugLog("Prepared activity lookup skipped:", error);
      return null;
    }
  }

  _isMedicationPriorityActivity(activity = {}) {
    const startDate = activity.activity_start_date || activity.start_date || activity.activity_date || activity.date;
    const endDate = activity.activity_end_date || activity.end_date || startDate;
    if (startDate && endDate && startDate !== endDate) return true;

    const haystack = this._normalizeSearchText([
      activity.name,
      activity.title,
      activity.description,
      activity.activity_type,
      activity.type,
      activity.category,
    ].filter(Boolean).join(" "));

    return /\b(camp|camps|camping|field trip|fieldtrip|sortie|sorties|excursion|excursions)\b/.test(haystack);
  }

  _distributionMatchesActivity(distribution = {}, activity = {}) {
    if (!distribution.activity_name) return true;

    const distributionName = this._normalizeSearchText(distribution.activity_name);
    const activityName = this._normalizeSearchText(activity.name || activity.title || "");
    if (!activityName) return true;

    return distributionName.includes(activityName) || activityName.includes(distributionName);
  }

  _parseLocalActivityDateTime(dateValue, timeValue) {
    if (!dateValue) return null;
    const date = String(dateValue).slice(0, 10);
    const time = String(timeValue || "00:00").slice(0, 5);
    const match = `${date}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;

    const [, year, month, day, hour, minute] = match.map(Number);
    const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _normalizeSearchText(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  _renderTopBar() {
    const initials = (this.organizationName || "?")
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    const avatarHtml = this.organizationLogo
      ? `<img src="${escapeHTML(this.organizationLogo)}" alt="">`
      : escapeHTML(initials);
    const subtitle = this.app?.userFullName
      ? escapeHTML(this.app.userFullName)
      : escapeHTML(translate("dashboard_title"));

    return `
      <div class="dashboard-v2__topbar">
        <div class="dashboard-v2__org">
          <span class="dashboard-v2__org-avatar" aria-hidden="true">${avatarHtml}</span>
          <span class="dashboard-v2__org-text">
            <strong>${escapeHTML(this.organizationName || "")}</strong>
            <span>${subtitle}</span>
          </span>
        </div>
        <div class="dashboard-v2__top-actions">
          <button type="button" class="dashboard-v2__icon-btn" id="dashboard-search-btn"
                  aria-label="${escapeHTML(translate("dashboard_search_label"))}" title="${escapeHTML(translate("dashboard_search_label"))} (Ctrl+K)">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          </button>
          <button type="button" class="dashboard-v2__icon-btn" id="dashboard-settings-btn"
                  aria-label="${escapeHTML(translate("dashboard_settings"))}">
            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  }

  _renderHero(nowTiles) {
    if (!nowTiles.length) {
      return `
        <section class="dashboard-v2__section" aria-labelledby="moment-now">
          <h2 id="moment-now" class="dashboard-v2__section-title">${escapeHTML(translate("dashboard_now_section"))}</h2>
          <div class="dashboard-v2__empty">
            <i class="fa-solid fa-mug-hot" aria-hidden="true"></i>
            <p>${escapeHTML(translate("dashboard_empty_now"))}</p>
          </div>
        </section>
      `;
    }

    const [hero, ...rest] = nowTiles;

    const isMeetingHero = hero.href === "/upcoming-meeting" && this.nextMeeting;
    const chips = rest.slice(0, 3);
    const heroDomain = hero.domain || "attendance";
    const heroStyles = `--tile-bg-attendance: var(--tile-bg-${heroDomain}); --tile-fg-attendance: var(--tile-fg-${heroDomain});`;

    let eyebrow;
    let title;
    let meta = "";

    if (isMeetingHero) {
      const lang = this.app?.lang || "fr";
      const formattedDate = this._formatMeetingDate(this.nextMeeting.date, lang);
      eyebrow = escapeHTML(translate("dashboard_next_meeting_eyebrow"));
      title = escapeHTML(formattedDate);
      const place = this.nextMeeting.endroit;
      const animator = this.nextMeeting.animateur_responsable;
      const metaParts = [];
      if (place) metaParts.push(`<i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHTML(place)}`);
      if (animator) metaParts.push(`<i class="fa-solid fa-user" aria-hidden="true"></i> ${escapeHTML(animator)}`);
      meta = metaParts.length
        ? `<span class="dashboard-v2__hero-meta">${metaParts.join(' &nbsp;·&nbsp; ')}</span>`
        : "";
    } else {
      eyebrow = `<i class="fa-solid ${escapeHTML(hero.icon)}" aria-hidden="true"></i> ${escapeHTML(translate("dashboard_primary_action"))}`;
      title = escapeHTML(translate(hero.label));
      if (hero.stat) {
        meta = `<span class="dashboard-v2__hero-meta">${escapeHTML(String(hero.stat.value))} ${escapeHTML(hero.stat.label || "")}</span>`;
      }
    }

    const chipsHtml = chips
      .map((t) => {
        const badge = t.stat
          ? `<span class="dashboard-v2__hero-action-badge${t.stat.urgent ? " is-urgent" : ""}">${escapeHTML(String(t.stat.value))}</span>`
          : "";
        return `
          <a href="${escapeHTML(t.href)}" class="dashboard-v2__hero-action"${t.id ? ` id="${escapeHTML(t.id)}"` : ""}>
            <i class="fa-solid ${escapeHTML(t.icon)}" aria-hidden="true"></i>
            <span>${escapeHTML(translate(t.label))}</span>
            ${badge}
          </a>`;
      })
      .join("");

    // Hero is a non-anchor container so the chip links inside are not
    // nested inside another <a>. The title block is its own stretched-link
    // anchor (see .dashboard-v2__hero-card-link::after in dashboard-v2.css);
    // chips sit above that overlay via z-index so each click hits its own
    // target.
    return `
      <section class="dashboard-v2__section" aria-labelledby="moment-now">
        <h2 id="moment-now" class="dashboard-v2__section-title">${escapeHTML(translate("dashboard_now_section"))}</h2>
        <div class="dashboard-v2__hero">
          <div class="dashboard-v2__hero-card" style="${heroStyles}">
            <a href="${escapeHTML(hero.href)}" class="dashboard-v2__hero-card-link"${hero.id ? ` id="${escapeHTML(hero.id)}"` : ""}>
              <span class="dashboard-v2__hero-eyebrow">${eyebrow}</span>
              <h3 class="dashboard-v2__hero-title">${title}</h3>
              ${meta}
            </a>
            ${chipsHtml ? `<div class="dashboard-v2__hero-actions">${chipsHtml}</div>` : ""}
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Format a YYYY-MM-DD meeting date into a friendly hero label.
   * Shows "Today" / "Tomorrow" when applicable, otherwise weekday + date.
   */
  _formatMeetingDate(dateStr, lang) {
    if (!dateStr) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parts = String(dateStr).slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
    const meetingDate = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayDiff = Math.round((meetingDate - today) / (1000 * 60 * 60 * 24));

    const formatted = formatDate(String(dateStr).slice(0, 10), lang, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    if (dayDiff === 0) return `${translate("today")} — ${formatted}`;
    if (dayDiff === 1) return `${translate("tomorrow")} — ${formatted}`;
    return formatted;
  }

  _renderWeek(weekTiles) {
    if (!weekTiles.length) return "";
    const gridHtml = weekTiles.map((t) => this._renderTile(t)).join("");
    return `
      <section class="dashboard-v2__section" aria-labelledby="moment-week">
        <h2 id="moment-week" class="dashboard-v2__section-title">${escapeHTML(translate("dashboard_this_week_section"))}</h2>
        <div class="dashboard-v2__grid">${gridHtml}</div>
      </section>
    `;
  }

  _renderTools(toolTiles) {
    if (!toolTiles.length) return "";
    // Sub-group by domain for the collapsible "Tools" section.
    const groups = new Map();
    toolTiles.forEach((tile) => {
      const key = tile.domain || "neutral";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tile);
    });

    const collapsedSet = new Set(this._prefs?.collapsedToolGroups || []);
    const groupHtml = Array.from(groups.entries())
      .map(([domain, tiles]) => {
        const title = translate(`domain_${domain}`) || domain;
        const grid = tiles.map((t) => this._renderTile(t, { small: true })).join("");
        const isCollapsed = collapsedSet.has(domain);
        return `
          <div class="dashboard-v2__group" data-collapsed="${isCollapsed}" data-group="${escapeHTML(domain)}">
            <button type="button" class="dashboard-v2__group-toggle" aria-expanded="${!isCollapsed}">
              <span><i class="fa-solid fa-folder-open" aria-hidden="true"></i> ${escapeHTML(title)}</span>
              <i class="fa-solid fa-chevron-down chev" aria-hidden="true"></i>
            </button>
            <div class="dashboard-v2__group-body">
              <div class="dashboard-v2__grid">${grid}</div>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <section class="dashboard-v2__section" aria-labelledby="moment-tools">
        <h2 id="moment-tools" class="dashboard-v2__section-title">${escapeHTML(translate("dashboard_tools_section"))}</h2>
        ${groupHtml}
      </section>
    `;
  }

  _renderTile(tile, { small = false } = {}) {
    const domain = tile.domain || "neutral";
    const style = `--tile-bg: var(--tile-bg-${domain}); --tile-fg: var(--tile-fg-${domain}); --tile-accent: var(--tile-accent-${domain});`;
    const stat = tile.stat
      ? `<span class="dashboard-v2__tile-stat${tile.stat.urgent ? " is-urgent" : ""}" aria-label="${escapeHTML(tile.stat.label || "")}">${escapeHTML(String(tile.stat.value))}${tile.stat.label ? ` <span>${escapeHTML(tile.stat.label)}</span>` : ""}</span>`
      : "";
    const cls = `dashboard-v2__tile${small ? " dashboard-v2__tile--sm" : ""}`;
    return `
      <a href="${escapeHTML(tile.href)}" class="${cls}" style="${style}" data-domain="${escapeHTML(domain)}"${tile.id ? ` id="${escapeHTML(tile.id)}"` : ""}>
        <i class="fa-solid ${escapeHTML(tile.icon)} dashboard-v2__tile-icon" aria-hidden="true"></i>
        <span class="dashboard-v2__tile-label">${escapeHTML(translate(tile.label))}</span>
        ${stat}
      </a>
    `;
  }

  _renderFab() {
    return `
      <button type="button" class="dashboard-fab" id="dashboard-fab"
              aria-label="${escapeHTML(translate("dashboard_quick_actions"))}"
              title="${escapeHTML(translate("dashboard_quick_actions"))}">
        <i class="fa-solid fa-bolt" aria-hidden="true"></i>
        <span class="dashboard-fab__label">${escapeHTML(translate("dashboard_quick_actions"))}</span>
      </button>
    `;
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

    // --- v2 dashboard controls ---
    this._setupCommandPalette();

    this.addEventListener(document.getElementById("dashboard-search-btn"), "click", () => {
      this.commandPalette?.open();
    });

    this.addEventListener(document.getElementById("dashboard-fab"), "click", () => {
      this.commandPalette?.open();
    });

    this.addEventListener(document.getElementById("dashboard-settings-btn"), "click", () => {
      const modal = new DashboardSettingsModal({
        onChange: () => {
          // Palette CSS vars are already updated by the modal; rerender to refresh
          // any computed styles tied to tiles.
          this.render();
          this.attachEventListeners();
        },
      });
      modal.open();
    });

    // Collapse/expand "Tools" groups — persisted across renders/sessions.
    document.querySelectorAll(".dashboard-v2__group-toggle").forEach((btn) => {
      this.addEventListener(btn, "click", () => {
        const group = btn.closest(".dashboard-v2__group");
        if (!group) return;
        const wasCollapsed = group.getAttribute("data-collapsed") === "true";
        const nowCollapsed = !wasCollapsed;
        group.setAttribute("data-collapsed", String(nowCollapsed));
        btn.setAttribute("aria-expanded", String(!nowCollapsed));

        const domain = group.dataset.group;
        if (!domain) return;
        const collapsed = new Set(this._prefs?.collapsedToolGroups || []);
        if (nowCollapsed) collapsed.add(domain);
        else collapsed.delete(domain);
        setCollapsedToolGroups(Array.from(collapsed));
        // Keep the per-render prefs snapshot in sync without a re-read.
        if (this._prefs) this._prefs.collapsedToolGroups = Array.from(collapsed);
      });
    });
  }

  _setupCommandPalette() {
    const tiles = this._allTiles || [];
    if (!this.commandPalette) {
      this.commandPalette = new CommandPalette(this.app, tiles);
      this.commandPalette.attachGlobalShortcut();
    } else {
      this.commandPalette.setTiles(tiles);
    }
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
    // Detach global keyboard shortcut and close any open palette
    if (this.commandPalette) {
      this.commandPalette.detach();
      this.commandPalette = null;
    }
    // Clear data references
    this.groups = [];
    this.participants = [];
    this._allTiles = null;
  }
}
