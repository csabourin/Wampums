import { getParticipants, getGroups } from "./ajax-functions.js";
import { translate } from "./app.js";
import { ManagePoints } from "./manage_points.js";
import { ParentDashboard } from "./parent_dashboard.js";
import { Login } from "./login.js";

const debugMode =
  window.location.hostname === "localhost" ||
  window.location.hostname.includes("replit.dev")
    ? true
    : false;

function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

function debugError(...args) {
  if (debugMode) {
    console.error(...args);
  }
}

export class Dashboard {
  constructor(app) {
    this.app=app;
    this.groups = [];
    this.participants = [];
    this.managePoints = new ManagePoints(this);
  }

  async init() {
    debugLog("Dashboard init started");
    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
      debugLog("Dashboard init completed");
    } catch (error) {
      console.error("Error initializing dashboard:", error);
      this.renderError();
    }
  }

  async fetchData() {
    debugLog("Fetching dashboard data");
    try {
      [this.participants, this.groups] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      throw error;
    }
  }

  render() {
    
    // Check if the user role is admin
    const adminLink =this.app.userRole === "admin"? 
      `<a href="/admin" id="admin-link">${translate("administration")}</a>`:
      `<a href="#">${translate("administration")}</a>`;
    
    debugLog("Rendering dashboard");
    const content = `
			<h1>${translate("dashboard_title")}</h1>
			<div class="manage-items">
				<a href="/managePoints">${translate("manage_points")}</a>
				<a href="/manage_honors">${translate("manage_honors")}</a>
				<a href="/attendance">${translate("attendance")}</a>
			</div>
			<div class="logo-container">
				<img class="logo" src="./images/6eASt-Paul.png" alt="6e A St-Paul d'Aylmer">
			</div>
			<div class="manage-items">
				<a href="/manage_participants">${translate("manage_names")}</a>
				<a href="/manage_groups">${translate("manage_groups")}</a>
				<a href="/view_participant_documents">${translate(
          "view_participant_documents"
        )}</a>
				<a href="/approve_badges">${translate("approve_badges")}</a>
				<a href="/parent_dashboard">${translate("vue_parents")}</a>
				<a href="/parent_contact_list">${translate("parent_contact_list")}</a>
				<a href="/manage_users_participants">${translate("manage_participants")}</a>
        <a href="/mailing_list">${translate("mailing_list")}</a>
        <a href="/calendars">${translate("calendars")}</a>
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
    // Render groups with participants
    let groupsList =
      this.groups.length === 0
        ? `<p>${translate("no_groups")}</p>`
        : this.groups
            .map(
              (group) => `
		<div class="group-header" data-group-id="${
      group.id
    }" data-type="group" data-points="${group.total_points}">
			${group.name} - 
			<span id="group-points-${group.id}">${group.total_points} ${translate(
                "points"
              )}</span>
			<div class="group-content visible">
				${this.renderParticipantsForGroup(group.id)}
			</div>
		</div>
	`
            )
            .join("");

    // Render participants without a group
    const participantsWithoutGroup = this.renderParticipantsWithoutGroup();
    if (participantsWithoutGroup) {
      groupsList += `
			<div class="group-header" data-group-id="none" data-type="group" data-points="0">
				${translate("no_group")} 
				<div class="group-content visible">
					${participantsWithoutGroup}
				</div>
			</div>
		`;
    }

    return groupsList;
  }

  renderParticipantsWithoutGroup() {
    // Filter participants without a group
    const participantsWithoutGroup = this.participants.filter(
      (p) => !p.group_id
    );
    if (participantsWithoutGroup.length === 0) {
      return `<p>${translate("no_participants_without_group")}</p>`;
    }

    return participantsWithoutGroup
      .map(
        (participant) => `
		<div class="list-item" data-name-id="${participant.id}" data-type="individual" 
			 data-group-id="none" data-points="${participant.total_points}"
			 data-name="${participant.first_name}">
			<span>${participant.first_name} ${participant.last_name}</span>
			<span id="name-points-${participant.id}">${
          participant.total_points
        } ${translate("points")}</span>
		</div>
	`
      )
      .join("");
  }

  renderParticipantsForGroup(groupId) {
    const groupParticipants = this.participants.filter(
      (p) => p.group_id == groupId
    );
    if (groupParticipants.length === 0) {
      return `<p>${translate("no_participants_in_group")}</p>`;
    }

    return groupParticipants
      .map(
        (participant) => `
			<div class="list-item" data-name-id="${participant.id}" data-type="individual" 
				 data-group-id="${participant.group_id}" data-points="${
          participant.total_points
        }"
				 data-name="${participant.first_name}">
				<span>${participant.first_name} ${participant.last_name}</span>
				<span id="name-points-${participant.id}">${
          participant.total_points
        } ${translate("points")}</span>
			</div>
		`
      )
      .join("");
  }

  attachEventListeners() {
    debugLog("Attaching event listeners");

    document.querySelectorAll(".group-header, .list-item").forEach((item) => {
      item.addEventListener("click", () => this.handleItemClick(item));
    });

    // Add logout event listener
    document.getElementById("logout-link").addEventListener("click", (e) => {
      e.preventDefault();
      Login.logout();
    });
  }

  handleItemClick(item) {
    debugLog("Item clicked:", item);
    document
      .querySelectorAll(".list-item.selected, .group-header.selected")
      .forEach((selectedItem) => {
        selectedItem.classList.add("hidden");
      });
    item.classList.remove("hidden");
  }

  renderError() {
    debugLog("Rendering dashboard error");
    const errorMessage = `
			<h1>${translate("error")}</h1>
			<p>${translate("error_loading_dashboard")}</p>
		`;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
