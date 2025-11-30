import { getParticipants, getGroups, getCurrentOrganizationId,
       getOrganizationSettings } from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { ManagePoints } from "./manage_points.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";

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
      console.error("Error initializing dashboard:", error);
      this.renderError();
    }
  }

  async fetchOrganizationInfo() {
    try {
      // Fetch all organization settings
      const response = await getOrganizationSettings();
      console.log("Organization settings response:", response);

      // Handle different response structures (response.data.organization_info or response.organization_info)
      const organizationInfo = response?.data?.organization_info || response?.organization_info;

      // If the setting exists, extract the name, otherwise set a default
      if (organizationInfo && organizationInfo.name) {
        this.organizationName = organizationInfo.name;
        this.organizationLogo = organizationInfo.logo;
      } else {
        console.error("Invalid organization info response:", response);
        this.organizationName = "Scouts";
      }
    } catch (error) {
      console.error("Error fetching organization info:", error);
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
      if (participantsResponse.success && Array.isArray(participantsResponse.participants)) {
        // Update points for existing participants or add new participants
        participantsResponse.participants.forEach(freshParticipant => {
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
        await setCachedData('dashboard_participant_info', participantsToCache, 5 * 60 * 1000);
      }

      if (needsFreshGroups) {
        await setCachedData('dashboard_groups', this.groups, 60 * 60 * 1000);
      }

      this.render();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
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
        if (groupsData.success && Array.isArray(groupsData.groups)) {
          this.groups = groupsData.groups;
          this.groups.sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
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
          console.log(`Preloaded attendance data for ${date}`);
        } catch (error) {
          console.error(`Error preloading attendance data for ${date}:`, error);
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
        <a href="/parent-dashboard">${translate("vue_parents")}</a>
        <a href="/parent-contact-list">${translate("parent_contact_list")}</a>
        <a href="/manage-users-participants">${translate("manage_participants")}</a>
        <a href="/mailing-list">${translate("mailing_list")}</a>
        <a href="/calendars">${translate("calendars")}</a>
        <a href="/reports">${translate("reports")}</a>
        <a href="/group-participant-report">${translate("feuille_participants")}</a>
        ${adminLink}
      </div>
      <div id="points-list">
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
            ${group.name} - 
            <span id="group-points-${groupId}">${groupTotalPoints} ${translate("points")}</span>
            <div class="group-content visible">
              ${this.renderParticipantsForGroup(participants)}
            </div>
          </div>
        `;
      }
    });

    // Render participants without a group
    if (participantsWithoutGroup.length > 0) {
      groupsList += `
        <div class="group-header" data-group-id="none" data-type="group" data-points="0">
          ${translate("no_group")} 
          <div class="group-content visible">
            ${this.renderParticipantsForGroup(participantsWithoutGroup)}
          </div>
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

    return participants.map(participant => `
      <div class="list-item" data-name-id="${participant.id}" data-type="individual" 
           data-group-id="${participant.group_id || 'none'}" data-points="${participant.total_points}"
           data-name="${participant.first_name}">
        <span>${participant.first_name} ${participant.last_name}    ${participant.is_leader ? `<span class="badge leader">${translate("leader")}</span>` : ''}
        ${participant.is_second_leader ? `<span class="badge second-leader">${translate("second_leader")}</span>` : ''}</span>
     
        <span id="name-points-${participant.id}">${participant.total_points} ${translate("points")}</span>
      </div>
    `).join("");
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