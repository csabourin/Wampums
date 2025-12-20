import {
  getParticipants,
  getGroups,
  getNews,
  getCurrentOrganizationId,
  getOrganizationSettings,
  CONFIG,
} from "./ajax-functions.js";
import { getAttendanceDates, getAttendance } from "./api/api-endpoints.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import {
  escapeHTML,
  sanitizeHTML,
  sanitizeURL,
} from "./utils/SecurityUtils.js";
import { getActivities, createActivity } from "./api/api-activities.js";
import { clearActivityRelatedCaches } from "./indexedDB.js";
import {
  hasPermission,
  hasAnyPermission,
  canAccessAdminPanel,
  canCreateOrganization,
  canManageRoles,
  canViewRoles,
} from "./utils/PermissionUtils.js";

export class Dashboard {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.participants = [];
    this.newsItems = [];
    this.newsLoading = true;
    this.newsError = null;
    this.pointsCollapsed = this.loadPointsCollapsedState();
  }

  async init() {
    try {
      this.applyIconFontLoadingStrategy();
      await this.fetchOrganizationInfo();
      await this.preloadDashboardData();
      this.attachEventListeners();

      // Prefetch critical pages data after dashboard is ready
      // This is non-blocking and runs in background
      this.prefetchCriticalPages();

      this.loadNews();
    } catch (error) {
      debugError("Error initializing dashboard:", error);
      this.renderError();
    }
  }

  /**
   * Ensure Font Awesome icons use a non-blocking loading strategy.
   *
   * The override adds `font-display: swap` so icons fall back to system
   * fonts until the CDN-delivered font finishes loading. Metric overrides
   * keep the fallback glyph dimensions close to the final font to mitigate
   * layout shifts when the icon font swaps in.
   */
  applyIconFontLoadingStrategy() {
    const existingOverride = document.getElementById(
      "fa-font-display-override",
    );

    if (existingOverride) {
      return;
    }

    const style = document.createElement("style");
    style.id = "fa-font-display-override";
    style.textContent = `
      @font-face {
        font-family: "Font Awesome 6 Free";
        font-style: normal;
        font-weight: 900;
        font-display: swap;
        src: url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2") format("woff2"),
             url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff") format("woff");
        ascent-override: 90%;
        descent-override: 22%;
        line-gap-override: 0%;
        size-adjust: 92%;
      }
    `;

    document.head.appendChild(style);
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
      const today = new Date().toISOString().split("T")[0];

      // Prefetch all critical data in parallel for maximum performance
      await Promise.allSettled([
        // Attendance page data
        getAttendanceDates().catch(error => {
          debugLog("Prefetch attendance dates skipped:", error);
          return null;
        }),
        getAttendance(today).catch(error => {
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
          return getGroups().catch(error => {
            debugLog("Prefetch groups skipped:", error);
            return null;
          });
        })()
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
      const [cachedGroups, cachedParticipants] = await Promise.all([
        getCachedData("dashboard_groups"),
        getCachedData("dashboard_participant_info"),
      ]);

      const shouldCacheParticipants = !cachedParticipants;
      const needsFreshGroups = !cachedGroups;

      if (cachedParticipants) {
        this.participants = cachedParticipants.map((p) => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          group_id: p.group_id,
          group_name: p.group_name,
          is_leader: p.is_leader,
          is_second_leader: p.is_second_leader,
        }));
      }

      if (cachedGroups) {
        this.groups = cachedGroups;
      }

      const participantsResponse = await getParticipants();
      const freshParticipants =
        participantsResponse.data || participantsResponse.participants || [];

      if (freshParticipants.length) {
        const freshById = new Map(
          freshParticipants.map((participant) => [participant.id, participant]),
        );

        const mergedParticipants = this.participants.length
          ? this.participants.map((participant) =>
              freshById.get(participant.id) || participant,
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

      if (needsFreshGroups) {
        await this.fetchData(false, true);
      }

      if (shouldCacheParticipants) {
        const minimalCache = this.participants.map((p) => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          group_id: p.group_id,
          group_name: p.group_name,
          is_leader: p.is_leader,
          is_second_leader: p.is_second_leader,
        }));
        await setCachedData(
          "dashboard_participant_info",
          minimalCache,
          CONFIG.CACHE_DURATION.SHORT,
        );
      }

      if (needsFreshGroups) {
        await setCachedData("dashboard_groups", this.groups, 60 * 60 * 1000);
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
        getParticipants().catch(error => {
          debugError("Error loading participants:", error);
          return { success: false, participants: [] };
        })
      );
    }
    if (fetchGroups) {
      promises.push(
        getGroups().catch(error => {
          debugError("Error loading groups:", error);
          return { success: false, data: [] };
        })
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
    // Permission-based visibility checks
    const showFinanceSection = hasAnyPermission('finance.view', 'budget.view');
    const showRoleManagement = canViewRoles();
    const showOrgCreation = canCreateOrganization();
    const showReports = hasAnyPermission('reports.view', 'reports.export');
    const showAdminPanel = canAccessAdminPanel(); // Old admin panel (legacy)

    // Build administration section links
    const administrationLinks = [];

    if (showRoleManagement) {
      administrationLinks.push(`<a href="/role-management"><i class="fa-solid fa-user-tag"></i><span>${translate("role_management") || "Role Management"}</span></a>`);
    }

    if (showOrgCreation) {
      administrationLinks.push(`<a href="/create-organization"><i class="fa-solid fa-building"></i><span>${translate("create_organization") || "Create Organization"}</span></a>`);
    }

    if (showAdminPanel) {
      administrationLinks.push(`<a href="/admin" id="admin-link"><i class="fa-solid fa-user-shield"></i><span>${translate("administration")}</span></a>`);
    }

    const content = `
      <h1>${translate("dashboard_title")}</h1>
      <h2>${this.organizationName}</h2>
<div class="dashboard-section">
<div class="manage-items">
<a href="/managePoints"><i class="fa-solid fa-coins"></i><span>${translate("manage_points")}</span></a>
<a href="/manageHonors"><i class="fa-solid fa-award"></i><span>${translate("manage_honors")}</span></a>
<a href="/attendance"><i class="fa-solid fa-clipboard-check"></i><span>${translate("attendance")}</span></a>
<a href="/upcoming-meeting"><i class="fa-solid fa-calendar-day"></i><span>${translate("upcoming_meeting")}</span></a>
</div>
</div>
      <div class="logo-container">
        <img class="logo" src="${this.organizationLogo}" width="335" height="366" alt="Logo">
      </div>
<!-- DAY-TO-DAY -->
<section class="dashboard-section">
  <h3>${translate("dashboard_day_to_day_section")}</h3>
  <div class="manage-items">
    <a href="/approve-badges"><i class="fa-solid fa-certificate"></i><span>${translate("approve_badges")}</span></a>
    <a href="/badge-dashboard"><i class="fa-solid fa-chart-bar"></i><span>${translate("badge_dashboard_link")}</span></a>
    <a href="/parent-contact-list"><i class="fa-solid fa-address-book"></i><span>${translate("parent_contact_list")}</span></a>
    <a href="/medication-dispensing"><i class="fa-solid fa-pills"></i><span>${translate("medication_dispensing_link")}</span></a>
    <a href="/parent-dashboard"><i class="fa-solid fa-users"></i><span>${translate("vue_parents")}</span></a>
  </div>
</section>

<!-- PREPARATION -->
<section class="dashboard-section">
  <h3>${translate("dashboard_preparation_section")}</h3>
  <div class="manage-items">
    <a href="/activities"><i class="fa-solid fa-calendar-days"></i><span>${translate("activities_calendar")}</span></a>
    <a href="/carpool" id="carpool-quick-access"><i class="fa-solid fa-car"></i><span>${translate("carpool_coordination")}</span></a>
    <a href="/preparation-reunions"><i class="fa-solid fa-clipboard-list"></i><span>${translate("preparation_reunions")}</span></a>
    <a href="/view-participant-documents"><i class="fa-solid fa-file-lines"></i><span>${translate("view_participant_documents")}</span></a>
    <a href="/inventory"><i class="fa-solid fa-warehouse"></i><span>${translate("inventory_link")}</span></a>
    <a href="/material-management"><i class="fa-solid fa-calendar-check"></i><span>${translate("material_management_link")}</span></a>
    <a href="/medication-planning"><i class="fa-solid fa-pills"></i><span>${translate("medication_planning_link")}</span></a>
    <a href="/permission-slips"><i class="fa-solid fa-file-signature"></i><span>${translate("manage_permission_slips")}</span></a>
  </div>
</section>

<!-- OPERATIONS -->
<section class="dashboard-section">
  <h3>${translate("dashboard_operations_section")}</h3>
  <div class="manage-items">
    <a href="/resources"><i class="fa-solid fa-boxes-stacked"></i><span>${translate("resource_dashboard_link")}</span></a>
    <a href="/permission-slips"><i class="fa-solid fa-file-shield"></i><span>${translate("permission_slip_dashboard_link")}</span></a>
  </div>
</section>

${showFinanceSection ? `
<!-- FINANCE & BUDGET -->
<section class="dashboard-section">
  <h3>${translate("dashboard_finance_section")}</h3>
  <div class="manage-items">
    ${hasPermission('finance.view') ? `<a href="/finance"><i class="fa-solid fa-coins"></i><span>${translate("finance_memberships_tab")}</span></a>` : ''}
    ${hasPermission('finance.view') ? `<a href="/finance?tab=definitions"><i class="fa-solid fa-file-invoice-dollar"></i><span>${translate("finance_definitions_tab")}</span></a>` : ''}
    ${hasPermission('finance.view') ? `<a href="/finance?tab=reports"><i class="fa-solid fa-chart-pie"></i><span>${translate("financial_report")}</span></a>` : ''}
    ${hasAnyPermission('finance.manage', 'finance.view') ? `<a href="/expenses"><i class="fa-solid fa-wallet"></i><span>${translate("expense_tracking")}</span></a>` : ''}
    ${hasAnyPermission('finance.manage', 'finance.view') ? `<a href="/external-revenue"><i class="fa-solid fa-hand-holding-dollar"></i><span>${translate("external_revenue")}</span></a>` : ''}
  </div>
</section>
` : ''}

<!-- ADMIN -->
<section class="dashboard-section">
  <h3>${translate("dashboard_admin_section")}</h3>
  <div class="manage-items">
    ${hasPermission('participants.view') ? `<a href="/manage-participants"><i class="fa-solid fa-id-card"></i><span>${translate("manage_names")}</span></a>` : ''}
    ${hasPermission('groups.view') ? `<a href="/manage-groups"><i class="fa-solid fa-people-group"></i><span>${translate("manage_groups")}</span></a>` : ''}
    ${hasPermission('users.view') ? `<a href="/manage-users-participants"><i class="fa-solid fa-user-gear"></i><span>${translate("manage_users_participants")}</span></a>` : ''}
    <a href="/account-info"><i class="fa-solid fa-user-circle"></i><span>${translate("account_info")}</span></a>
    ${hasPermission('communications.send') ? `<a href="/mailing-list"><i class="fa-solid fa-envelope-open-text"></i><span>${translate("mailing_list")}</span></a>` : ''}
    ${hasPermission('fundraisers.view') ? `<a href="/fundraisers"><i class="fa-solid fa-hand-holding-heart"></i><span>${translate("fundraisers")}</span></a>` : ''}
    ${hasAnyPermission('finance.view', 'fundraisers.view') ? `<a href="/revenue-dashboard"><i class="fa-solid fa-chart-column"></i><span>${translate("revenue_dashboard")}</span></a>` : ''}
    ${hasPermission('budget.view') ? `<a href="/budgets"><i class="fa-solid fa-sack-dollar"></i><span>${translate("budget_management")}</span></a>` : ''}
    ${showReports ? `<a href="/reports"><i class="fa-solid fa-chart-line"></i><span>${translate("reports")}</span></a>` : ''}
    ${showReports ? `<a href="/group-participant-report"><i class="fa-solid fa-table-list"></i><span>${translate("feuille_participants")}</span></a>` : ''}
  </div>
</section>

${administrationLinks.length > 0 ? `
<!-- ADMINISTRATION -->
<section class="dashboard-section administration-section">
  <h3>${translate("system_administration") || "System Administration"}</h3>
  <div class="manage-items">
    ${administrationLinks.join('\n    ')}
  </div>
</section>
` : ''}




      <!-- NEWS -->
      <div class="dashboard-card" id="news-section">
        <div class="section-header">
          <h3>${translate("news_updates")}</h3>
          <button type="button" id="refresh-news-btn" class="ghost-button">${translate("refresh")}</button>
        </div>
        <div id="news-content">${this.renderNewsContent()}</div>
      </div>

      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;

    document.getElementById("app").innerHTML = content;
    this.updatePointsList();
    this.updateNewsSection();
  }

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
    list.innerHTML = this.pointsCollapsed
      ? this.renderCollapsedPointsPlaceholder()
      : this.renderPointsList();
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
      if (a.is_leader && !b.is_leader) return -1;
      if (!a.is_leader && b.is_leader) return 1;
      if (a.is_second_leader && !b.is_second_leader) return 1;
      if (!a.is_second_leader && b.is_second_leader) return -1;
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
              ${p.is_leader ? ` <span class="badge leader">${translate("leader")}</span>` : ""}
              ${p.is_second_leader ? ` <span class="badge second-leader">${translate("second_leader")}</span>` : ""}
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
  async loadNews(force = false) {
    if (!force) {
      const cached = await getCachedData("dashboard_news");
      if (cached?.length) {
        this.newsItems = cached;
        this.newsLoading = false;
        this.updateNewsSection();
      }
    }

    this.newsLoading = true;
    this.newsError = null;
    this.updateNewsSection();

    try {
      const res = await getNews();
      this.newsItems = this.normalizeNewsItems(res);
      this.newsLoading = false;
      await setCachedData(
        "dashboard_news",
        this.newsItems,
        CONFIG.CACHE_DURATION.SHORT,
      );
    } catch (e) {
      this.newsLoading = false;
      this.newsError = translate("news_error");
    }

    this.updateNewsSection();
  }

  normalizeNewsItems(response) {
    const list = Array.isArray(response?.news)
      ? response.news
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];

    return list.slice(0, 5).map((item, index) => {
      const safeTitle = escapeHTML(
        item.title || item.heading || translate("news_untitled"),
      );
      const safeSummary = sanitizeHTML(
        item.summary || item.description || item.content || "",
        {
          stripAll: true,
        },
      );
      const safeLink = sanitizeURL(item.link || item.url || null);
      const date = item.published_at || item.date || item.created_at || "";

      return {
        id: item.id || `news-${index}`,
        title: safeTitle,
        summary: safeSummary,
        link: safeLink,
        date,
      };
    });
  }

  renderNewsContent() {
    if (this.newsLoading && this.newsItems.length === 0) {
      return `<p class="muted-text">${translate("news_loading")}</p>`;
    }

    const error = this.newsError
      ? `<p class="error-text">${this.newsError}</p>`
      : "";

    if (this.newsItems.length === 0) {
      return error || `<p class="muted-text">${translate("news_empty")}</p>`;
    }

    return `
      ${error}
      <ul class="news-list">
        ${this.newsItems.map((item) => this.renderNewsItem(item)).join("")}
      </ul>
    `;
  }

  renderNewsItem(item) {
    const date = this.formatNewsDate(item.date);
    const more = item.link
      ? `<a class="text-link" href="${item.link}" target="_blank" rel="noopener noreferrer">${translate("news_read_more")}</a>`
      : "";

    return `
      <li class="news-item" data-news-id="${item.id}">
        <div class="news-item-header">
          <p class="news-title">${item.title}</p>
          ${date ? `<span class="news-date">${translate("news_published")}: ${date}</span>` : ""}
        </div>
        <p class="news-summary">${item.summary || translate("news_no_summary")}</p>
        ${more}
      </li>
    `;
  }

  formatNewsDate(raw) {
    if (!raw) return "";
    const date = new Date(raw);
    if (isNaN(date)) return "";

    const locale = this.app.currentLanguage || CONFIG.DEFAULT_LANG;

    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  updateNewsSection() {
    const container = document.getElementById("news-content");
    if (container) container.innerHTML = this.renderNewsContent();

    const btn = document.getElementById("refresh-news-btn");
    if (btn) btn.disabled = this.newsLoading;
  }

  // -----------------------------
  // EVENT LISTENERS
  // -----------------------------
  attachEventListeners() {
    const logout = document.getElementById("logout-link");
    if (logout) {
      logout.addEventListener("click", (e) => {
        e.preventDefault();
        this.lazyLogout();
      });
    }

    const toggleBtn = document.getElementById("toggle-points-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => this.togglePointsVisibility());
    }

    const refreshBtn = document.getElementById("refresh-news-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.loadNews(true));
    }

    const carpoolBtn = document.getElementById("carpool-quick-access");
    if (carpoolBtn) {
      carpoolBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.app?.router) {
          this.app.router.navigate("/carpool");
        }

        try {
          await this.showCarpoolQuickAccess();
        } catch (error) {
          debugError("Error opening carpool quick access:", error);
          if (typeof this.app?.showMessage === "function") {
            this.app.showMessage("error_loading_activities", "error");
          }
        }
      });
    }
  }

  async lazyLogout() {
    const { Login } = await import("./login.js");

    try {
      Login.logout();
    } catch (error) {
      debugError("Error during logout:", error);
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

  async showCarpoolQuickAccess() {
    try {
      const activities = await getActivities();
      const now = new Date();
      const upcomingActivities = activities.filter(a => new Date(a.activity_date) >= now);

      const modal = document.createElement('div');
      modal.className = 'modal-screen';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100%';
      modal.style.height = '100%';
      modal.style.background = 'rgba(0,0,0,0.5)';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.zIndex = '10000';

      modal.innerHTML = `
        <div style="background: white; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow: auto; padding: 2rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="margin: 0;">${translate('carpool_coordination')}</h2>
            <button type="button" id="close-carpool-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0.5rem;">✕</button>
          </div>

          ${upcomingActivities.length > 0 ? `
            <p style="color: #666; margin-bottom: 1rem;">${translate('select_activity_for_carpool')}</p>
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
              ${upcomingActivities.map(activity => `
                <a href="/carpool/${activity.id}" style="padding: 1rem; border: 2px solid #e0e0e0; border-radius: 8px; text-decoration: none; color: inherit; display: block; transition: all 0.2s;">
                  <div style="display: flex; justify-content: space-between; gap: 1rem;">
                    <div style="flex: 1;">
                      <h3 style="margin: 0 0 0.5rem 0;">${escapeHTML(activity.name)}</h3>
                      <p style="margin: 0; color: #666; font-size: 0.9rem;">
                        ${new Date(activity.activity_date).toLocaleDateString()} - ${activity.departure_time_going}
                      </p>
                      <p style="margin: 0.25rem 0 0 0; color: #999; font-size: 0.85rem;">
                        ${escapeHTML(activity.meeting_location_going)}
                      </p>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; font-size: 0.85rem;">
                      <span style="background: #667eea; color: white; padding: 0.25rem 0.75rem; border-radius: 20px;">
                        ${activity.carpool_offer_count || 0} ${translate('vehicles')}
                      </span>
                      <span style="color: #666;">
                        ${activity.assigned_participant_count || 0} ${translate('assigned')}
                      </span>
                    </div>
                  </div>
                </a>
              `).join('')}
            </div>
          ` : `
            <div style="text-align: center; padding: 2rem; color: #999;">
              <p style="margin-bottom: 1rem;">${translate('no_upcoming_activities')}</p>
            </div>
          `}

          <div style="border-top: 1px solid #e0e0e0; padding-top: 1.5rem; margin-top: 1.5rem;">
            <button type="button" id="quick-create-activity-btn" class="button" style="width: 100%; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 500;">
              ➕ ${translate('quick_create_activity')}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Close handlers
      const closeBtn = modal.querySelector('#close-carpool-modal');
      closeBtn.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });

      // Quick create activity button
      const quickCreateBtn = modal.querySelector('#quick-create-activity-btn');
      quickCreateBtn.addEventListener('click', () => {
        modal.remove();
        this.showQuickCreateActivityModal();
      });

      // Add hover effects
      const activityLinks = modal.querySelectorAll('a[href^="/carpool/"]');
      activityLinks.forEach(link => {
        link.addEventListener('mouseenter', (e) => {
          e.currentTarget.style.borderColor = '#667eea';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(102,126,234,0.15)';
        });
        link.addEventListener('mouseleave', (e) => {
          e.currentTarget.style.borderColor = '#e0e0e0';
          e.currentTarget.style.boxShadow = 'none';
        });
      });

    } catch (error) {
      debugError('Error loading carpool activities:', error);
      this.app.showToast(translate('error_loading_activities'), 'error');
    }
  }

  showQuickCreateActivityModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-screen';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '10000';

    // Get tomorrow's date as default
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    modal.innerHTML = `
      <div style="background: white; border-radius: 12px; max-width: 500px; width: 90%; padding: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 style="margin: 0;">${translate('quick_create_activity')}</h2>
          <button type="button" id="close-quick-create-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0.5rem;">✕</button>
        </div>

        <form id="quick-create-activity-form">
          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate('activity_name')} <span style="color: #dc3545;">*</span>
            </label>
            <input type="text" name="name" required
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
              placeholder="${translate('activity_name')}">
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate('activity_date')} <span style="color: #dc3545;">*</span>
            </label>
            <input type="date" name="activity_date" required value="${tomorrowStr}"
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate('meeting_location')} (${translate('going')}) <span style="color: #dc3545;">*</span>
            </label>
            <input type="text" name="meeting_location_going" required
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
              placeholder="${translate('meeting_location_placeholder')}">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate('meeting_time')} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="meeting_time_going" required value="09:00"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate('departure_time')} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="departure_time_going" required value="09:15"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
          </div>

          <div style="margin: 1.5rem 0; padding-top: 1.5rem; border-top: 2px solid #e9ecef;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #667eea;">${translate('returning_from_activity')}</h3>

            <div style="margin-bottom: 1rem;">
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate('meeting_location')}
              </label>
              <input type="text" name="meeting_location_return"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
                placeholder="${translate('meeting_location_placeholder')}">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                  ${translate('meeting_time')}
                </label>
                <input type="time" name="meeting_time_return"
                  style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
              </div>
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                  ${translate('departure_time')}
                </label>
                <input type="time" name="departure_time_return"
                  style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
              </div>
            </div>
          </div>

          <div style="margin-top: 2rem; display: flex; gap: 1rem;">
            <button type="button" id="cancel-quick-create" style="flex: 1; padding: 0.75rem; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;">
              ${translate('cancel')}
            </button>
            <button type="submit" style="flex: 1; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: 500;">
              ${translate('create_activity')}
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeBtn = modal.querySelector('#close-quick-create-modal');
    const cancelBtn = modal.querySelector('#cancel-quick-create');
    closeBtn.addEventListener('click', () => modal.remove());
    cancelBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Form submission
    const form = modal.querySelector('#quick-create-activity-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      try {
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = translate('creating') + '...';

        const newActivity = await createActivity(data);

        // Clear activity-related caches so the new activity appears immediately
        await clearActivityRelatedCaches();

        modal.remove();
        this.app.showToast(translate('activity_created_success'), 'success');

        // Redirect to the carpool page for this new activity
        setTimeout(() => {
          window.location.hash = `/carpool/${newActivity.id}`;
        }, 500);
      } catch (error) {
        debugError('Error creating activity:', error);
        this.app.showToast(error.message || translate('error_saving_activity'), 'error');
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = translate('create_activity');
      }
    });
  }

  // -----------------------------
  // BUDGET WIDGET
  // -----------------------------
  /**
   * Calculate current fiscal year (Sept 1 - Aug 31)
   */
  getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    if (month >= 8) {
      // September or later (month 8 = September)
      return {
        start: `${year}-09-01`,
        end: `${year + 1}-08-31`,
        label: `${year}-${year + 1}`,
      };
    } else {
      return {
        start: `${year - 1}-09-01`,
        end: `${year}-08-31`,
        label: `${year - 1}-${year}`,
      };
    }
  }

  /**
   * Format currency value
   */
  formatCurrency(amount) {
    const value = Number(amount) || 0;
    const locale = this.app.currentLanguage || CONFIG.DEFAULT_LANG;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 2,
    }).format(value);
  }

  renderError() {
    document.getElementById("app").innerHTML = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_dashboard")}</p>
    `;
  }
}
