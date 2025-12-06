import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import {
  getParticipantsWithUsers,
  getParentUsers,
  fetchFromApi
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ManageUsersParticipants {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.parentUsers = [];
  }

  async init() {
    if (this.app.userRole !== "animation" && this.app.userRole !== "admin") {
      this.app.router.navigate("/");
      return;
    }

    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing manage users participants:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      const [participantsResponse, parentUsersResponse] = await Promise.all([
        getParticipantsWithUsers(),
        getParentUsers()
      ]);

      if (participantsResponse?.success) {
        const participantsData =
          participantsResponse.data?.participants ||
          participantsResponse.participants ||
          participantsResponse.data ||
          [];
        this.participants = Array.isArray(participantsData)
          ? participantsData
          : [];
      } else {
        throw new Error("Failed to fetch participants with users");
      }

      if (parentUsersResponse?.success) {
        const parentUsersData =
          parentUsersResponse.data?.users ||
          parentUsersResponse.users ||
          parentUsersResponse.data ||
          [];
        this.parentUsers = Array.isArray(parentUsersData)
          ? parentUsersData
          : [];
      } else {
        throw new Error("Failed to fetch parent users");
      }
    } catch (error) {
      debugError("Error fetching manage users participants data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      <h1>${translate("manage_users_participants")}</h1>
      <div id="message"></div>
      <table>
        <thead>
          <tr>
            <th>${translate("name")}</th>
            <th>${translate("associated_users")}</th>
            <th>${translate("actions")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.renderParticipantRows()}
        </tbody>
      </table>
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
    `;
    document.getElementById("app").innerHTML = content;
  }

  renderParticipantRows() {
    if (!Array.isArray(this.participants) || this.participants.length === 0) {
      return `
        <tr>
          <td colspan="3">${translate("no_participants_found")}</td>
        </tr>
      `;
    }

    return this.participants
      .map(
        (participant) => `
          <tr>
            <td>${escapeHTML(participant.first_name || "")} ${escapeHTML(participant.last_name || "")}</td>
            <td>${escapeHTML(participant.associated_users || translate("no_associated_users"))}</td>
            <td>
              <button class="remove-from-organization" data-participant-id="${participant.id}">
                ${translate("remove_from_organization")}
              </button>
              <select class="user-select" data-participant-id="${participant.id}">
                <option value="">${translate("select_parent")}</option>
                ${this.renderParentUserOptions()}
              </select>
              <button class="associate-user" data-participant-id="${participant.id}">
                ${translate("associate_user")}
              </button>
            </td>
          </tr>
        `
      )
      .join("");
  }

  renderParentUserOptions() {
    if (!Array.isArray(this.parentUsers) || this.parentUsers.length === 0) {
      return "";
    }

    return this.parentUsers
      .map(
        (user) => `
          <option value="${user.id}">${escapeHTML(user.full_name || "")}</option>
        `
      )
      .join("");
  }

  attachEventListeners() {
    document.querySelectorAll(".remove-from-organization").forEach((button) => {
      button.addEventListener("click", (event) =>
        this.handleRemoveFromOrganization(event)
      );
    });

    document.querySelectorAll(".associate-user").forEach((button) => {
      button.addEventListener("click", (event) =>
        this.handleAssociateUser(event)
      );
    });
  }

  async handleRemoveFromOrganization(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    if (confirm(translate("confirm_remove_participant_from_organization"))) {
      try {
        const result = await fetchFromApi('remove-participant-from-organization', 'POST', {
          participant_id: participantId
        });
        if (result.success) {
          this.showMessage(translate("participant_removed_from_organization"));
          await this.fetchData();
          this.render();
          this.attachEventListeners();
        } else {
          this.showError(result.message || translate("error_removing_participant_from_organization"));
        }
      } catch (error) {
        debugError("Error:", error);
        this.showError(translate("error_removing_participant_from_organization"));
      }
    }
  }

  async handleAssociateUser(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const userId = event.target.previousElementSibling.value;
    if (userId) {
      try {
        const result = await fetchFromApi('associate-user', 'POST', {
          participant_id: participantId,
          user_id: userId
        });
        if (result.success) {
          this.showMessage(translate("user_associated_successfully"));
          await this.fetchData();
          this.render();
          this.attachEventListeners();
        } else {
          this.showError(result.message || translate("error_associating_user"));
        }
      } catch (error) {
        debugError("Error:", error);
        this.showError(translate("error_associating_user"));
      }
    } else {
      this.showError(translate("please_select_parent"));
    }
  }

  showMessage(message, type = 'success') {
    this.app.showMessage(message, type);
  }

  showError(message) {
    this.app.showMessage(message, 'error');
  }

  renderError() {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_manage_users_participants")}</p>
    `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}