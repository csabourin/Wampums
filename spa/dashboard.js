import { getParticipants, getGroups } from "./ajax-functions.js";
import { translate } from "./app.js";
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
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing dashboard:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      const [participantsData, groupsData] = await Promise.all([
        getParticipants(),
        getGroups()
      ]);

      if (!Array.isArray(participantsData.participants)) {
        throw new Error("Expected participants to be an array, but got: " + typeof participantsData.participants);
      }

      if (!Array.isArray(groupsData.groups)) {
        throw new Error("Expected groups to be an array, but got: " + typeof groupsData.groups);
      }

      this.participants = participantsData.participants;
      this.groups = groupsData.groups;

      // Sort the groups alphabetically by name
      this.groups.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      throw error;
    }
  }

  render() {
    const adminLink = this.app.userRole === "admin" ? 
      `<a href="/admin" id="admin-link">${translate("administration")}</a>` :
      `<a href="#">${translate("administration")}</a>`;

    const content = `
      <h1>${translate("dashboard_title")}</h1>
      <div class="manage-items">
        <a href="/managePoints">${translate("manage_points")}</a>
        <a href="/manageHonors">${translate("manage_honors")}</a>
        <a href="/attendance">${translate("attendance")}</a>
      </div>
      <div class="logo-container">
        <img class="logo" src="./images/6eASt-Paul.png" width="335" heigth="366" alt="6e A St-Paul d'Aylmer">
      </div>
      <div class="manage-items">
      <a href="/preparation_reunions">${translate("preparation_reunions")}</a>
        <a href="/manage_participants">${translate("manage_names")}</a>
        <a href="/manage_groups">${translate("manage_groups")}</a>
        <a href="/view_participant_documents">${translate("view_participant_documents")}</a>
        <a href="/approve_badges">${translate("approve_badges")}</a>
        <a href="/parent_dashboard">${translate("vue_parents")}</a>
        <a href="/parent_contact_list">${translate("parent_contact_list")}</a>
        <a href="/manage_users_participants">${translate("manage_participants")}</a>
        <a href="/mailing_list">${translate("mailing_list")}</a>
        <a href="/calendars">${translate("calendars")}</a>
        <a href="/reports">${translate("reports")}</a>
        ${adminLink}
      </div>
      <div id="points-list">
        ${this.renderPointsList()}
      </div>
      <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
    `;
    document.getElementById("app").innerHTML = content;
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