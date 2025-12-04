import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import {
  getParticipantsWithUsers,
  getParentUsers,
  fetchFromApi
} from "./ajax-functions.js";
import { translate } from "./app.js";

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
      [this.participants, this.parentUsers] = await Promise.all([
        getParticipantsWithUsers(),
        getParentUsers()
      ]);
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
    return this.participants
      .map(
        (participant) => `
          <tr>
            <td>${participant.first_name} ${participant.last_name}</td>
            <td>${participant.associated_users}</td>
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
    return this.parentUsers
      .map(
        (user) => `
          <option value="${user.id}">${user.full_name}</option>
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