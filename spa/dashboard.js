import { getParticipants, getGroups, getNews, getCurrentOrganizationId,
       getOrganizationSettings, CONFIG } from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { ManagePoints } from "./manage_points.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { escapeHTML, sanitizeHTML, sanitizeURL } from "./utils/SecurityUtils.js";

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
  }

  async init() {
    try {
      // Fetch organization info first so it's available for all renders
      await this.fetchOrganizationInfo();
      await this.preloadDashboardData();
      // Note: preloadDashboardData calls render() internally
      this.attachEventListeners();
      this.preloadAttendanceData();
      this.loadNews();
    } catch (error) {
      debugError("Error initializing dashboard:", error);
      this.renderError();
    }
  }

  loadPointsCollapsedState() {
    try {
      return localStorage.getItem("dashboard_points_collapsed") === "true";
    } catch (error) {
      debugError("Error reading points collapsed state:", error);
      return false;
    }
  }

  async fetchOrganizationInfo() {
    try {
      // Use app's waitForOrganizationSettings to avoid race condition
      const settings = await this.app.waitForOrganizationSettings();
      debugLog("Organization settings from app:", settings);

      // Handle different response structures
      const organizationInfo = settings?.organization_info;

      // If the setting exists, extract the name, otherwise set a default
      if (organizationInfo && organizationInfo.name) {
        this.organizationName = organizationInfo.name;
        this.organizationLogo = organizationInfo.logo;
      } else {
        debugError("Invalid organization info:", settings);
        this.organizationName = "Scouts";
      }
    } catch (error) {
      debugError("Error fetching organization info:", error);
      this.organizationName = "Scouts";
    }
  }

  async preloadDashboardData() {
    try {
      // Get cached data for non-points information only
      const [cachedGroups, cachedParticipants] = await Promise.all([
        getCachedData('dashboard_groups'),
        getCachedData('dashboard_participant_info')
      ]);

      let shouldRenderImmediately = false;
      let needsFreshParticipants = false;
      let needsFreshGroups = false;

      // Initialize with cached basic info (excluding points)
      if (cachedParticipants) {
        // Only use cached non-points data
        this.participants = cachedParticipants.map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          group_id: p.group_id,
          group_name: p.group_name,
          is_leader: p.is_leader,
          is_second_leader: p.is_second_leader
        }));
        shouldRenderImmediately = true;
      } else {
        needsFreshParticipants = true;
      }

      if (cachedGroups) {
        this.groups = cachedGroups;
        shouldRenderImmediately = true;
      } else {
        needsFreshGroups = true;
      }

      // Always fetch fresh points data
      const participantsResponse = await getParticipants();
      // Support both new format (data) and old format (participants)
      const freshParticipants = participantsResponse.data || participantsResponse.participants;
      if (participantsResponse.success && Array.isArray(freshParticipants)) {
        // Update points for existing participants or add new participants
        freshParticipants.forEach(freshParticipant => {
          const existingParticipant = this.participants.find(p => p.id === freshParticipant.id);
          if (existingParticipant) {
            existingParticipant.total_points = freshParticipant.total_points;
          } else {
            this.participants.push(freshParticipant);
          }
        });
      }

      // If we need to fetch any other fresh data
      if (needsFreshParticipants || needsFreshGroups) {
        await this.fetchData(needsFreshParticipants, needsFreshGroups);
      }

      // Cache only non-points data
      if (needsFreshParticipants) {
        const participantsToCache = this.participants.map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          group_id: p.group_id,
          group_name: p.group_name,
          is_leader: p.is_leader,
          is_second_leader: p.is_second_leader
        }));
        await setCachedData('dashboard_participant_info', participantsToCache, CONFIG.CACHE_DURATION.SHORT);
      }

      if (needsFreshGroups) {
        await setCachedData('dashboard_groups', this.groups, 60 * 60 * 1000);
      }

      this.render();
    } catch (error) {
      debugError('Error loading dashboard data:', error);
      this.render();
    }
  }

  async fetchData(fetchParticipants = true, fetchGroups = true) {
    try {
      const promises = [];
      if (fetchParticipants) {
        promises.push(getParticipants());
      }
      if (fetchGroups) {
        promises.push(getGroups());
      }

      const results = await Promise.all(promises);
      let index = 0;

      if (fetchParticipants) {
        const participantsData = results[index++];
        if (participantsData.success && Array.isArray(participantsData.participants)) {
          this.participants = participantsData.participants;
        }
      }

      if (fetchGroups) {
        const groupsData = results[index];
        const groups = groupsData.data || groupsData.groups || [];
        if (groupsData.success && Array.isArray(groups)) {
          this.groups = groups;
          this.groups.sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    } catch (error) {
      debugError("Error fetching dashboard data:", error);
      throw error;
    }
  }

  async preloadAttendanceData() {
    const today = new Date().toISOString().split('T')[0];
    const nextFewDays = this.getNextFewDays(today, 0); // Get today and next 0 days

    for (const date of nextFewDays) {
      const cachedAttendance = await getCachedData(`attendance_${date}`);
      if (!cachedAttendance) {
        try {
          const attendanceData = await getAttendance(date);
          await setCachedData(`attendance_${date}`, attendanceData, 24 * 60 * 60 * 1000); // Cache for 24 hours
          debugLog(`Preloaded attendance data for ${date}`);
        } catch (error) {
          debugError(`Error preloading attendance data for ${date}:`, error);
        }
      }
    }
  }

  getNextFewDays(startDate, numDays) {
    const dates = [];
    let currentDate = new Date(startDate);
    for (let i = 0; i < numDays; i++) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
  }

  render() {
    const adminLink = this.app.userRole === "admin" ?
      `<a href="/admin" id="admin-link">${translate("administration")}</a>` :``;

    const content = `
      <h1>${translate("dashboard_title")}</h1>
      <h2>${this.organizationName}</h2>
      <div class="manage-items">
        <a href="/managePoints">${translate("manage_points")}</a>
        <a href="/manageHonors">${translate("manage_honors")}</a>
        <a href="/attendance">${translate("attendance")}</a>
        <a href="/upcoming-meeting">${translate("upcoming_meeting")}</a>
      </div>
      <div class="logo-container">
        <img
  class="logo"
  src="${this.organizationLogo}"
  width="335"
  height="366"
  alt="Logo"
  loading="eager"
  decoding="async"
>
      </div>
      <div class="manage-items">
      <a href="/preparation-reunions">${translate("preparation_reunions")}</a>
        <a href="/manage-participants">${translate("manage_names")}</a>
        <a href="/manage-groups">${translate("manage_groups")}</a>
        <a href="/view-participant-documents">${translate("view_participant_documents")}</a>
        <a href="/approve-badges">${translate("approve_badges")}</a>
        <a href="/badge-dashboard">${translate("badge_dashboard_link")}</a>
        <a href="/parent-dashboard">${translate("vue_parents")}</a>
        <a href="/parent-contact-list">${translate("parent_contact_list")}</a>
        <a href="/manage-users-participants">${translate("manage_participants")}</a>
        <a href="/mailing-list">${translate("mailing_list")}</a>
        <a href="/fundraisers">${translate("fundraisers")}</a>
        <a href="/reports">${translate("reports")}</a>
        <a href="/group-participant-report">${translate("feuille_participants")}</a>
        ${adminLink}
      </div>
      <div class="dashboard-card" id="points-section">
        <div class="section-header">
          <h3>${translate("points")}</h3>
          <div class="section-actions">
            <button type="button" id="toggle-points-btn" class="ghost-button" aria-expanded="${!this.pointsCollapsed}">
              ${this.pointsCollapsed ? translate("expand_points") : translate("collapse_points")}
            </button>
            <a class="text-link" href="/managePoints#points-list">${translate("view_full_points")}</a>
          </div>
        </div>
        <div id="points-list" class="${this.pointsCollapsed ? "collapsed" : "expanded"}">
          ${this.pointsCollapsed ? this.renderCollapsedPointsPlaceholder() : this.renderPointsList()}
        </div>
      </div>
      <div class="dashboard-card" id="news-section">
        <div class="section-header">
          <h3>${translate("news_updates")}</h3>
          <button type="button" id="refresh-news-btn" class="ghost-button">${translate("refresh")}</button>
        </div>
        <div id="news-content">
          ${this.renderNewsContent()}
        </div>
      </div>
      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;
    document.getElementById("app").innerHTML = content;
    this.updatePointsList();
    this.updateNewsSection();
  }

  renderPointsList() {
    // Create a map of group IDs to their participants
    const groupParticipants = new Map(this.groups.map(group => [group.id, []]));
    const participantsWithoutGroup = [];

    // Assign participants to their groups
    this.participants.forEach(participant => {
      if (participant.group_id) {
        const group = groupParticipants.get(participant.group_id);
        if (group) {
          group.push(participant);
        }
      } else {
        participantsWithoutGroup.push(participant);
      }
    });

    // Render groups with participants
    let groupsList = '';
    groupParticipants.forEach((participants, groupId) => {
      const group = this.groups.find(g => g.id === groupId);
      if (group && participants.length > 0) {
        const groupTotalPoints = participants.reduce((sum, p) => sum + (parseInt(p.total_points) || 0), 0);
        groupsList += `
          <div class="group-header" data-group-id="${groupId}" data-type="group" data-points="${groupTotalPoints}">
            <span>${group.name}</span>
            <span id="group-points-${groupId}">${groupTotalPoints}</span>
          </div>
          <div class="group-content visible">
            ${this.renderParticipantsForGroup(participants)}
          </div>
        `;
      }
    });

    // Render participants without a group
    if (participantsWithoutGroup.length > 0) {
      groupsList += `
        <div class="group-header" data-group-id="none" data-type="group" data-points="0">
          <span>${translate("no_group")}</span>
          <span>0</span>
        </div>
        <div class="group-content visible">
          ${this.renderParticipantsForGroup(participantsWithoutGroup)}
        </div>
      `;
    }

    return groupsList;
  }

  updatePointsList() {
    const pointsList = document.getElementById("points-list");
    if (pointsList) {
      pointsList.classList.toggle("collapsed", this.pointsCollapsed);
      pointsList.innerHTML = this.pointsCollapsed
        ? this.renderCollapsedPointsPlaceholder()
        : this.renderPointsList();
    }
  }

  renderCollapsedPointsPlaceholder() {
    return `
      <p class="muted-text">${translate("points_collapsed_hint")}</p>
    `;
  }

  renderParticipantsForGroup(participants) {
    // Sort participants: leader first, then second leader, then alphabetically by first name
    participants.sort((a, b) => {
      // Sort leaders first
      if (a.is_leader && !b.is_leader) return -1;
      if (!a.is_leader && b.is_leader) return 1;

      // Sort second leaders last
      if (a.is_second_leader && !b.is_second_leader) return 1;
      if (!a.is_second_leader && b.is_second_leader) return -1;

      // Alphabetical sort by first name for non-leaders and non-second-leaders
      return a.first_name.localeCompare(b.first_name);
    });

    return participants.map(participant => {
      // Ensure total_points is a number, default to 0 if undefined
      const points = parseInt(participant.total_points) || 0;
      return `
      <div class="list-item" data-name-id="${participant.id}" data-type="individual"
           data-group-id="${participant.group_id || 'none'}" data-points="${points}"
           data-name="${participant.first_name}">
        <span class="participant-name">${participant.first_name} ${participant.last_name}${participant.is_leader ? ` <span class="badge leader">${translate("leader")}</span>` : ''}${participant.is_second_leader ? ` <span class="badge second-leader">${translate("second_leader")}</span>` : ''}</span>
        <span class="participant-points" id="name-points-${participant.id}">${points}</span>
      </div>
    `;
    }).join("");
  }

  async loadNews(forceRefresh = false) {
    if (!forceRefresh) {
      try {
        const cachedNews = await getCachedData("dashboard_news");
        if (cachedNews && Array.isArray(cachedNews)) {
          this.newsItems = cachedNews;
          this.newsLoading = false;
          this.newsError = null;
          this.updateNewsSection();
        }
      } catch (error) {
        debugError("Error loading cached news:", error);
      }
    }

    this.newsLoading = true;
    this.newsError = null;
    this.updateNewsSection();

    try {
      const newsResponse = await getNews();
      this.newsItems = this.normalizeNewsItems(newsResponse);
      this.newsLoading = false;
      await setCachedData("dashboard_news", this.newsItems, CONFIG.CACHE_DURATION.SHORT);
    } catch (error) {
      debugError("Error loading news feed:", error);
      this.newsLoading = false;
      this.newsError = translate("news_error");
    }

    this.updateNewsSection();
  }

  normalizeNewsItems(newsResponse) {
    const rawNews = Array.isArray(newsResponse?.news) ? newsResponse.news
      : Array.isArray(newsResponse?.data) ? newsResponse.data
        : Array.isArray(newsResponse) ? newsResponse
          : [];

    return rawNews.slice(0, 5).map((item, index) => {
      const safeTitle = escapeHTML(item.title || item.heading || translate("news_untitled"));
      const safeSummary = sanitizeHTML(item.summary || item.description || item.content || "", { stripAll: true });
      const safeLink = sanitizeURL(item.link || item.url || "");
      const publishedAt = item.published_at || item.date || item.created_at || "";

      return {
        id: item.id || item.slug || `news-${index}`,
        title: safeTitle,
        summary: safeSummary,
        link: safeLink,
        date: publishedAt
      };
    });
  }

  renderNewsContent() {
    if (this.newsLoading && !this.newsItems.length) {
      return `<p class="muted-text">${translate("news_loading")}</p>`;
    }

    const errorBanner = this.newsError ? `<p class="error-text">${this.newsError}</p>` : "";

    if (!this.newsItems.length) {
      return errorBanner || `<p class="muted-text">${translate("news_empty")}</p>`;
    }

    return `
      ${errorBanner}
      <ul class="news-list">
        ${this.newsItems.map(newsItem => this.renderNewsItem(newsItem)).join("\n")} 
      </ul>
    `;
  }

  renderNewsItem(newsItem) {
    const formattedDate = this.formatNewsDate(newsItem.date);
    const summaryText = newsItem.summary || translate("news_no_summary");

    const linkTemplate = newsItem.link ?
      `<a class="text-link" href="${newsItem.link}" rel="noopener noreferrer" target="_blank">${translate("news_read_more")}</a>`
      : "";

    return `
      <li class="news-item" data-news-id="${newsItem.id}">
        <div class="news-item-header">
          <p class="news-title">${newsItem.title}</p>
          ${formattedDate ? `<span class="news-date">${translate("news_published")}: ${formattedDate}</span>` : ""}
        </div>
        <p class="news-summary">${summaryText}</p>
        ${linkTemplate}
      </li>
    `;
  }

  formatNewsDate(dateValue) {
    if (!dateValue) return "";

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const locale = this.app?.currentLanguage || this.app?.language || CONFIG.DEFAULT_LANG;
    return new Intl.DateTimeFormat(locale || "en", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  updateNewsSection() {
    const newsContainer = document.getElementById("news-content");
    if (newsContainer) {
      newsContainer.innerHTML = this.renderNewsContent();
    }

    const refreshNewsButton = document.getElementById("refresh-news-btn");
    if (refreshNewsButton) {
      refreshNewsButton.disabled = this.newsLoading;
    }
  }

  attachEventListeners() {
    document.getElementById("logout-link").addEventListener("click", (e) => {
      e.preventDefault();
      Login.logout();
    });

    const togglePointsButton = document.getElementById("toggle-points-btn");
    if (togglePointsButton) {
      togglePointsButton.addEventListener("click", () => this.togglePointsVisibility());
    }

    const refreshNewsButton = document.getElementById("refresh-news-btn");
    if (refreshNewsButton) {
      refreshNewsButton.addEventListener("click", () => this.loadNews(true));
    }
  }

  togglePointsVisibility() {
    this.pointsCollapsed = !this.pointsCollapsed;
    try {
      localStorage.setItem("dashboard_points_collapsed", String(this.pointsCollapsed));
    } catch (error) {
      debugError("Error saving points collapsed state:", error);
    }

    const togglePointsButton = document.getElementById("toggle-points-btn");
    if (togglePointsButton) {
      togglePointsButton.setAttribute("aria-expanded", String(!this.pointsCollapsed));
      togglePointsButton.textContent = this.pointsCollapsed ? translate("expand_points") : translate("collapse_points");
    }

    this.updatePointsList();
  }

  handleItemClick(item) {
    document.querySelectorAll(".list-item.selected, .group-header.selected").forEach((selectedItem) => {
      selectedItem.classList.remove("selected");
    });
    item.classList.add("selected");
  }

  renderError() {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_dashboard")}</p>
    `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}