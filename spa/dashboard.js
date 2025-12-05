import { getParticipants, getGroups, getCurrentOrganizationId,
       getOrganizationSettings, CONFIG } from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { ManagePoints } from "./manage_points.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";

export class Dashboard {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.participants = [];
    this.managePoints = new ManagePoints(this);
  }

  async init() {
    try {
      // Fetch organization info first so it's available for all renders
      await this.fetchOrganizationInfo();
      await this.preloadDashboardData();
      // Note: preloadDashboardData calls render() internally
      this.attachEventListeners();
      this.preloadAttendanceData();
    } catch (error) {
      debugError("Error initializing dashboard:", error);
      this.renderError();
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
      `<a href="/admin" id="admin-link" aria-label="${translate("administration")}">
          <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
          <span>${translate("administration")}</span>
        </a>` :``;

    const content = `
      <h1>${translate("dashboard_title")}</h1>
      <h2>${this.organizationName}</h2>
      <div class="manage-items">
        <a href="/managePoints" aria-label="${translate("manage_points")}">
          <i class="fa-solid fa-coins" aria-hidden="true"></i>
          <span>${translate("manage_points")}</span>
        </a>
        <a href="/manageHonors" aria-label="${translate("manage_honors")}">
          <i class="fa-solid fa-award" aria-hidden="true"></i>
          <span>${translate("manage_honors")}</span>
        </a>
        <a href="/attendance" aria-label="${translate("attendance")}">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true"></i>
          <span>${translate("attendance")}</span>
        </a>
        <a href="/upcoming-meeting" aria-label="${translate("upcoming_meeting")}">
          <i class="fa-solid fa-calendar-day" aria-hidden="true"></i>
          <span>${translate("upcoming_meeting")}</span>
        </a>
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
        <a href="/preparation-reunions" aria-label="${translate("preparation_reunions")}">
          <i class="fa-solid fa-clipboard-list" aria-hidden="true"></i>
          <span>${translate("preparation_reunions")}</span>
        </a>
        <a href="/manage-participants" aria-label="${translate("manage_names")}">
          <i class="fa-solid fa-id-card" aria-hidden="true"></i>
          <span>${translate("manage_names")}</span>
        </a>
        <a href="/manage-groups" aria-label="${translate("manage_groups")}">
          <i class="fa-solid fa-people-group" aria-hidden="true"></i>
          <span>${translate("manage_groups")}</span>
        </a>
        <a href="/view-participant-documents" aria-label="${translate("view_participant_documents")}">
          <i class="fa-solid fa-file-lines" aria-hidden="true"></i>
          <span>${translate("view_participant_documents")}</span>
        </a>
        <a href="/approve-badges" aria-label="${translate("approve_badges")}">
          <i class="fa-solid fa-certificate" aria-hidden="true"></i>
          <span>${translate("approve_badges")}</span>
        </a>
        <a href="/badge-dashboard" aria-label="${translate("badge_dashboard_link")}">
          <i class="fa-solid fa-chart-bar" aria-hidden="true"></i>
          <span>${translate("badge_dashboard_link")}</span>
        </a>
        <a href="/parent-dashboard" aria-label="${translate("vue_parents")}">
          <i class="fa-solid fa-users" aria-hidden="true"></i>
          <span>${translate("vue_parents")}</span>
        </a>
        <a href="/parent-contact-list" aria-label="${translate("parent_contact_list")}">
          <i class="fa-solid fa-address-book" aria-hidden="true"></i>
          <span>${translate("parent_contact_list")}</span>
        </a>
        <a href="/manage-users-participants" aria-label="${translate("manage_participants")}">
          <i class="fa-solid fa-user-gear" aria-hidden="true"></i>
          <span>${translate("manage_participants")}</span>
        </a>
        <a href="/mailing-list" aria-label="${translate("mailing_list")}">
          <i class="fa-solid fa-envelope-open-text" aria-hidden="true"></i>
          <span>${translate("mailing_list")}</span>
        </a>
        <a href="/fundraisers" aria-label="${translate("fundraisers")}">
          <i class="fa-solid fa-hand-holding-heart" aria-hidden="true"></i>
          <span>${translate("fundraisers")}</span>
        </a>
        <a href="/reports" aria-label="${translate("reports")}">
          <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
          <span>${translate("reports")}</span>
        </a>
        <a href="/group-participant-report" aria-label="${translate("feuille_participants")}">
          <i class="fa-solid fa-table-list" aria-hidden="true"></i>
          <span>${translate("feuille_participants")}</span>
        </a>
        ${adminLink}
      </div>
      <div id="points-list">
        <h3 style="text-align: center; margin: 1rem 0;">${translate("points")}</h3>
        ${this.renderPointsList()}
      </div>
      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;
    document.getElementById("app").innerHTML = content;
    this.updatePointsList();
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
      pointsList.innerHTML = this.renderPointsList();
    }
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

  attachEventListeners() {
   
    document.getElementById("logout-link").addEventListener("click", (e) => {
      e.preventDefault();
      Login.logout();
    });
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