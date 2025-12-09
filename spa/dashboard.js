import {
  getParticipants,
  getGroups,
  getNews,
  getCurrentOrganizationId,
  getOrganizationSettings,
  CONFIG,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { ManagePoints } from "./manage_points.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import {
  escapeHTML,
  sanitizeHTML,
  sanitizeURL,
} from "./utils/SecurityUtils.js";
import { getBudgetSummaryReport } from "./api/api-endpoints.js";

export class Dashboard {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.participants = [];
    this.managePoints = new ManagePoints(this);
    this.newsItems = [];
    this.newsLoading = true;
    this.newsError = null;
    this.pointsCollapsed = this.loadPointsCollapsedState();
    this.budgetSummary = null;
  }

  async init() {
    try {
      await this.fetchOrganizationInfo();
      await this.preloadDashboardData();
      this.attachEventListeners();
      await this.preloadAttendanceData();
      this.loadNews();
      this.loadBudgetWidget();
    } catch (error) {
      debugError("Error initializing dashboard:", error);
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
   * Gracefully preload attendance cache to maintain backward compatibility
   * when the attendance module moves data loading elsewhere.
   *
   * This is intentionally non-blocking beyond the awaited promise to avoid
   * failing dashboard initialization if IndexedDB is unavailable.
   */
  async preloadAttendanceData() {
    try {
      await getCachedData(
        `attendance_${new Date().toISOString().split("T")[0]}`,
      );
    } catch (error) {
      debugLog("Attendance preload skipped", error);
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

      let needsFreshParticipants = !cachedParticipants;
      let needsFreshGroups = !cachedGroups;

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

      freshParticipants.forEach((fp) => {
        const existing = this.participants.find((p) => p.id === fp.id);
        if (existing) {
          existing.total_points = fp.total_points;
        } else {
          this.participants.push(fp);
        }
      });

      if (needsFreshParticipants || needsFreshGroups) {
        await this.fetchData(needsFreshParticipants, needsFreshGroups);
      }

      if (needsFreshParticipants) {
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
    if (fetchParticipants) promises.push(getParticipants());
    if (fetchGroups) promises.push(getGroups());

    const results = await Promise.all(promises);
    let i = 0;

    if (fetchParticipants) {
      const res = results[i++];
      if (res.success && Array.isArray(res.participants)) {
        this.participants = res.participants;
      }
    }

    if (fetchGroups) {
      const res = results[i];
      const groups = res.data || res.groups || [];
      if (res.success) {
        this.groups = groups.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  }

  // -----------------------------
  //          RENDER
  // -----------------------------
  render() {
    const adminLink =
      this.app.userRole === "admin"
        ? `<a href="/admin" id="admin-link"><i class="fa-solid fa-user-shield"></i><span>${translate("administration")}</span></a>`
        : ``;

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
    <a href="/fundraisers"><i class="fa-solid fa-hand-holding-heart"></i><span>${translate("fundraisers")}</span></a>
    <a href="/parent-contact-list"><i class="fa-solid fa-address-book"></i><span>${translate("parent_contact_list")}</span></a>
    <a href="/parent-dashboard"><i class="fa-solid fa-users"></i><span>${translate("vue_parents")}</span></a>
    <a href="/finance"><i class="fa-solid fa-coins"></i><span>${translate("finance_memberships_tab")}</span></a>
  </div>
</section>

<!-- PREPARATION -->
<section class="dashboard-section">
  <h3>${translate("dashboard_preparation_section")}</h3>
  <div class="manage-items">
    <a href="/preparation-reunions"><i class="fa-solid fa-clipboard-list"></i><span>${translate("preparation_reunions")}</span></a>
    <a href="/view-participant-documents"><i class="fa-solid fa-file-lines"></i><span>${translate("view_participant_documents")}</span></a>
  </div>
</section>

<!-- ADMIN -->
<section class="dashboard-section">
  <h3>${translate("dashboard_admin_section")}</h3>
  <div class="manage-items">
    <a href="/manage-participants"><i class="fa-solid fa-id-card"></i><span>${translate("manage_names")}</span></a>
    <a href="/manage-groups"><i class="fa-solid fa-people-group"></i><span>${translate("manage_groups")}</span></a>
    <a href="/manage-users-participants"><i class="fa-solid fa-user-gear"></i><span>${translate("manage_users_participants")}</span></a>
    <a href="/mailing-list"><i class="fa-solid fa-envelope-open-text"></i><span>${translate("mailing_list")}</span></a>
    <a href="/reports"><i class="fa-solid fa-chart-line"></i><span>${translate("reports")}</span></a>
    <a href="/finance?tab=reports"><i class="fa-solid fa-chart-pie"></i><span>${translate("financial_report")}</span></a>
    <a href="/budgets"><i class="fa-solid fa-sack-dollar"></i><span>${translate("budget_management")}</span></a>
    <a href="/group-participant-report"><i class="fa-solid fa-table-list"></i><span>${translate("feuille_participants")}</span></a>
    <a href="/finance?tab=definitions"><i class="fa-solid fa-file-invoice-dollar"></i><span>${translate("finance_definitions_tab")}</span></a>
    ${adminLink}
  </div>
</section>




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
        Login.logout();
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
   * Check if budget features should be visible for current user role
   */
  canAccessBudgetFeatures() {
    return ["admin", "animation"].includes(this.app.userRole);
  }

  /**
   * Load budget widget data (only for admin/animation roles)
   */
  async loadBudgetWidget() {
    // Only show budget widget for admin and animation roles
    if (!this.canAccessBudgetFeatures()) {
      return;
    }

    try {
      const fiscalYear = this.getCurrentFiscalYear();
      const response = await getBudgetSummaryReport(
        fiscalYear.start,
        fiscalYear.end,
      );

      if (response?.success && response?.data) {
        this.budgetSummary = response.data;
        this.updateBudgetWidget();
      }
    } catch (error) {
      debugError("Error loading budget widget:", error);
      // Fail silently - budget widget is optional
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

  /**
   * Render budget widget (only shown for admin/animation roles)
   */
  renderBudgetWidget() {
    // Only show for admin and animation roles
    if (!this.canAccessBudgetFeatures()) {
      return "";
    }

    if (!this.budgetSummary) {
      return `
        <div class="dashboard-card budget-widget-card" id="budget-widget">
          <div class="section-header">
            <h3><i class="fa-solid fa-sack-dollar"></i> ${translate("budget_widget_title")}</h3>
          </div>
          <p class="muted-text">${translate("loading")}...</p>
        </div>
      `;
    }

    const totals = this.budgetSummary.totals || {};
    const totalRevenue = totals.total_revenue || 0;
    const totalExpense = totals.total_expense || 0;
    const netAmount = totals.net_amount || totalRevenue - totalExpense;
    const isPositive = netAmount >= 0;

    return `
      <div class="dashboard-card budget-widget-card" id="budget-widget">
        <div class="section-header">
          <h3><i class="fa-solid fa-sack-dollar"></i> ${translate("budget_widget_title")}</h3>
          <a href="/budgets" class="text-link">${translate("view_full_budget")} →</a>
        </div>
        <div class="budget-widget-summary">
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("total_revenue")}</span>
            <span class="budget-stat-value revenue">${this.formatCurrency(totalRevenue)}</span>
          </div>
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("total_expenses")}</span>
            <span class="budget-stat-value expense">${this.formatCurrency(totalExpense)}</span>
          </div>
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("net_position")}</span>
            <span class="budget-stat-value ${isPositive ? "positive" : "negative"}">
              ${this.formatCurrency(netAmount)}
            </span>
          </div>
        </div>
        <p class="budget-widget-fiscal-year muted-text">
          ${translate("current_fiscal_year")}: ${escapeHTML(this.budgetSummary.fiscal_year?.start || "")} - ${escapeHTML(this.budgetSummary.fiscal_year?.end || "")}
        </p>
      </div>
    `;
  }

  /**
   * Update budget widget after initial render
   */
  updateBudgetWidget() {
    const widget = document.getElementById("budget-widget");
    if (widget && this.budgetSummary) {
      const totals = this.budgetSummary.totals || {};
      const totalRevenue = totals.total_revenue || 0;
      const totalExpense = totals.total_expense || 0;
      const netAmount = totals.net_amount || totalRevenue - totalExpense;
      const isPositive = netAmount >= 0;

      widget.innerHTML = `
        <div class="section-header">
          <h3><i class="fa-solid fa-sack-dollar"></i> ${translate("budget_widget_title")}</h3>
          <a href="/budgets" class="text-link">${translate("view_full_budget")} →</a>
        </div>
        <div class="budget-widget-summary">
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("total_revenue")}</span>
            <span class="budget-stat-value revenue">${this.formatCurrency(totalRevenue)}</span>
          </div>
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("total_expenses")}</span>
            <span class="budget-stat-value expense">${this.formatCurrency(totalExpense)}</span>
          </div>
          <div class="budget-stat">
            <span class="budget-stat-label">${translate("net_position")}</span>
            <span class="budget-stat-value ${isPositive ? "positive" : "negative"}">
              ${this.formatCurrency(netAmount)}
            </span>
          </div>
        </div>
        <p class="budget-widget-fiscal-year muted-text">
          ${translate("current_fiscal_year")}: ${escapeHTML(this.budgetSummary.fiscal_year?.start || "")} - ${escapeHTML(this.budgetSummary.fiscal_year?.end || "")}
        </p>
      `;
    }
  }

  renderError() {
    document.getElementById("app").innerHTML = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_dashboard")}</p>
    `;
  }
}
