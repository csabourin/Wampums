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
       await this.preloadDashboardData();
      // await this.fetchData();
      await this.fetchOrganizationInfo();
      this.render();
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

      // Check if the response is successful and contains settings
      if (response && response.success && response.settings) {
        // Get the organization_info setting
        const organizationInfo = response.settings.organization_info;

        // If the setting exists, extract the name, otherwise set a default
        if (organizationInfo && organizationInfo.name) {
          this.organizationName = organizationInfo.name;
          this.organizationLogo = organizationInfo.logo;
        } else {
          this.organizationName = translate("organization_name_default");
        }
      } else {
        console.error("Invalid organization info response:", response);
      }
    } catch (error) {
      console.error("Error fetching organization info:", error);
    }
  }

  async preloadDashboardData() {
    const [cachedGroups, cachedParticipants] = await Promise.all([
      getCachedData('dashboard_groups'),
      getCachedData('dashboard_participants')
    ]);

    if (cachedGroups && cachedParticipants) {
      this.groups = cachedGroups;
      this.participants = cachedParticipants;
    }

    // Fetch fresh data in the background
    this.fetchData().then(() => {
      this.render(); // Re-render with fresh data
    });
  }

  async fetchData() {
    try {
      const [participantsData, groupsData] = await Promise.all([
        getParticipants(),
        getGroups()
      ]);

      if (Array.isArray(participantsData.participants)) {
        this.participants = participantsData.participants;
        await setCachedData('dashboard_participants', this.participants, 5 * 60 * 1000); // 5 minutes cache
      }

      if (Array.isArray(groupsData.groups)) {
        this.groups = groupsData.groups;
        await setCachedData('dashboard_groups', this.groups, 60 * 60 * 1000); // 1 hour cache
      }

      // Sort the groups alphabetically by name
      this.groups.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      throw error;
    }
  }

  async preloadAttendanceData() {
    const today = new Date().toISOString().split('T')[0];
    const nextFewDays = this.getNextFewDays(today, 0); // Get today and next 3 days

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
      `<a href="/admin" id="admin-link">${translate("administration")}</a>` :
      `<a href="#">${translate("administration")}</a>`;

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
        <img class="logo" src=".${this.organizationLogo}" width="335" heigth="366" alt="6e A St-Paul d'Aylmer">
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
      if (a.is_leader) return -1;
      if (b.is_leader) return 1;
      if (a.is_second_leader) return -1;
      if (b.is_second_leader) return 1;
      return a.first_name.localeCompare(b.first_name);
    });

    return participants.map(participant => `
      <div class="list-item" data-name-id="${participant.id}" data-type="individual" 
           data-group-id="${participant.group_id || 'none'}" data-points="${participant.total_points}"
           data-name="${participant.first_name}">
        <span>${participant.first_name} ${participant.last_name}</span>
        ${participant.is_leader ? `<span class="badge leader">${translate("leader")}</span>` : ''}
        ${participant.is_second_leader ? `<span class="badge second-leader">${translate("second_leader")}</span>` : ''}
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