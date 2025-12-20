import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import {
  getParticipantsWithUsers,
  getParentUsers,
  removeParticipantFromOrganization,
  associateUser
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { canViewUsers } from "./utils/PermissionUtils.js";

export class ManageUsersParticipants {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.parentUsers = [];
  }

  async init() {
    if (!canViewUsers()) {
      this.app.router.navigate("/");
      return;
    }

    try {
      await this.fetchData();
    } catch (error) {
      debugError("Error loading manage users participants data:", error);
      // Continue rendering even if some data failed to load
      this.app.showMessage(translate("error_loading_data"), "warning");
    }

    // Always render the page, even with partial data
    try {
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error rendering manage users participants page:", error);
      this.renderError();
    }
  }

  async fetchData(forceRefresh = false) {
    // Load data with individual error handling to prevent total failure
    const [participantsResponse, parentUsersResponse] = await Promise.all([
      getParticipantsWithUsers(forceRefresh).catch(error => {
        debugError("Error loading participants with users:", error);
        return { success: false, data: [] };
      }),
      getParentUsers(forceRefresh).catch(error => {
        debugError("Error loading parent users:", error);
        return { success: false, data: [] };
      })
    ]);

    if (participantsResponse?.success) {
      const participantsData =
        participantsResponse.data?.participants ||
        participantsResponse.participants ||
        participantsResponse.data ||
        [];
      this.participants = this.normalizeParticipants(participantsData);
    } else {
      debugError("Failed to fetch participants with users");
      this.participants = [];
    }

    if (parentUsersResponse?.success) {
      const parentUsersData =
        parentUsersResponse.data?.users ||
        parentUsersResponse.users ||
        parentUsersResponse.data ||
        [];
      this.parentUsers = this.normalizeParentUsers(parentUsersData);
    } else {
      debugError("Failed to fetch parent users");
      this.parentUsers = [];
    }
  }

  /**
   * Normalize participants to ensure unique participants with deduped associated users.
   * @param {Array} participantsData
   * @returns {Array}
   */
  normalizeParticipants(participantsData) {
    if (!Array.isArray(participantsData)) {
      return [];
    }

    const participantMap = new Map();

    participantsData.forEach((participant) => {
      if (!participant || typeof participant !== "object") return;

      const participantId = participant.id || participant.participant_id;
      if (!participantId) return;

      const existingEntry = participantMap.get(participantId) || {
        ...participant,
        associatedUsers: []
      };

      if (
        !existingEntry.associatedUsers.length &&
        typeof participant.associated_users === "string"
      ) {
        participant.associated_users
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .forEach((name) => existingEntry.associatedUsers.push(name));
      }

      const associatedName = (participant.user_full_name || participant.user_email || "").trim();
      if (associatedName && !existingEntry.associatedUsers.includes(associatedName)) {
        existingEntry.associatedUsers.push(associatedName);
      }

      participantMap.set(participantId, existingEntry);
    });

    return Array.from(participantMap.values()).map((participant) => ({
      ...participant,
      associated_users: participant.associatedUsers?.join(", ") || ""
    }));
  }

  /**
   * Normalize parent users to ensure unique options in the select list.
   * @param {Array} parentUsersData
   * @returns {Array}
   */
  normalizeParentUsers(parentUsersData) {
    if (!Array.isArray(parentUsersData)) {
      return [];
    }

    const parentUserMap = new Map();

    parentUsersData.forEach((user) => {
      if (!user || typeof user !== "object" || !user.id) return;
      if (!parentUserMap.has(user.id)) {
        parentUserMap.set(user.id, user);
      }
    });

    return Array.from(parentUserMap.values());
  }

  render() {
    const content = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
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
        const result = await removeParticipantFromOrganization(participantId);
        if (result.success) {
          this.showMessage(translate("participant_removed_from_organization"));
          this.removeParticipantLocally(participantId);
          this.render();
          this.attachEventListeners();
          await this.fetchData(true);
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
        const result = await associateUser(participantId, userId);
        if (result.success) {
          this.showMessage(translate("user_associated_successfully"));
          this.updateParticipantAssociationLocally(participantId, userId);
          this.render();
          this.attachEventListeners();
          await this.fetchData(true);
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

  /**
   * Remove a participant from local state for immediate UI feedback.
   * @param {string|number} participantId
   */
  removeParticipantLocally(participantId) {
    if (!participantId) {
      return;
    }
    this.participants = this.participants.filter(
      (participant) => `${participant.id}` !== `${participantId}`
    );
  }

  /**
   * Update participant association locally so the UI reflects changes without waiting for a fresh fetch.
   * @param {string|number} participantId
   * @param {string|number} userId
   */
  updateParticipantAssociationLocally(participantId, userId) {
    if (!participantId || !userId) {
      return;
    }

    const participant = this.participants.find(
      (entry) => `${entry.id}` === `${participantId}`
    );
    if (!participant) {
      return;
    }

    const parentUser = this.parentUsers.find(
      (user) => `${user.id}` === `${userId}`
    );
    if (!parentUser) {
      return;
    }

    const associationName =
      parentUser.full_name ||
      parentUser.user_full_name ||
      parentUser.email ||
      parentUser.user_email;
    if (!associationName) {
      return;
    }

    const currentAssociations = (participant.associated_users || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    if (!currentAssociations.includes(associationName)) {
      currentAssociations.push(associationName);
    }

    participant.associated_users = currentAssociations.join(", ");
  }
}
