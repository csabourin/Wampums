import {
  getParticipants,
  getGroups,
  updateParticipantGroup,
} from "./ajax-functions.js";
import {
  saveOfflineData
} from "./indexedDB.js";
import { translate } from "./app.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ManageParticipants {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.groups = [];
  }

  async init() {
    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing manage participants:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (participantsResponse.success) {
        // Support both new format (data) and old format (participants)
        this.participants = participantsResponse.data || participantsResponse.participants;
      } else {
        throw new Error("Failed to fetch participants data");
      }

      if (groupsResponse.success) {
        // Support both new format (data) and old format (groups)
        this.groups = groupsResponse.data || groupsResponse.groups;
      } else {
        throw new Error("Failed to fetch groups data");
      }

      debugLog("Fetched Participants:", this.participants);
      debugLog("Fetched Groups:", this.groups);
      await saveOfflineData('participants', this.participants);
      await saveOfflineData('groups', this.groups);
    } catch (error) {
      debugError("Error fetching manage participants data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      <h1>${translate("manage_participants")}</h1>
      <div class="participants-table-container">
        <table class="participants-table">
          <thead>
            <tr>
              <th>${translate("name")}</th>
              <th>${translate("group")}</th>
              <th>${translate("role")}</th>
              <th>${translate("additional_roles")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.renderParticipantRows()}
          </tbody>
        </table>
      </div>
      <style>
        .participants-table-container {
          overflow-x: auto;
          margin: 1rem 0;
        }

        .participants-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 600px;
        }

        .participants-table th,
        .participants-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }

        .participants-table th {
          background-color: #f5f5f5;
          font-weight: 600;
          position: sticky;
          top: 0;
        }

        .participants-table select,
        .participants-table input[type="text"] {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 0.9rem;
          box-sizing: border-box;
        }

        .participants-table input[type="text"] {
          min-width: 150px;
        }

        /* Mobile-first responsive design */
        @media (max-width: 768px) {
          .participants-table {
            min-width: 100%;
            font-size: 0.85rem;
          }

          .participants-table th,
          .participants-table td {
            padding: 0.5rem 0.25rem;
          }

          .participants-table select,
          .participants-table input[type="text"] {
            font-size: 0.85rem;
            padding: 0.4rem;
          }
        }

        @media (max-width: 480px) {
          .participants-table th,
          .participants-table td {
            padding: 0.4rem 0.2rem;
          }

          h1 {
            font-size: 1.5rem;
          }
        }
      </style>
    `;
    document.getElementById("app").innerHTML = content;
  }

  renderParticipantRows() {
    return this.participants
      .map(
        (participant) => `
        <tr>
          <td>${escapeHTML(participant.first_name)} ${escapeHTML(participant.last_name)}</td>
          <td>
            <select class="group-select" data-participant-id="${participant.id}">
              <option value="none" ${!participant.group_id ? "selected" : ""}>${translate("no_group")}</option>
              ${this.renderGroupOptions(participant.group_id)}
            </select>
          </td>
          <td>
            <select class="role-select" data-participant-id="${participant.id}" ${!participant.group_id ? "disabled" : ""}>
              <option value="none" ${!participant.is_leader && !participant.is_second_leader ? "selected" : ""}>${translate("none")}</option>
              <option value="leader" ${participant.is_leader ? "selected" : ""}>${translate("leader")}</option>
              <option value="second_leader" ${participant.is_second_leader ? "selected" : ""}>${translate("second_leader")}</option>
            </select>
          </td>
          <td>
            <input
              type="text"
              class="roles-input"
              data-participant-id="${participant.id}"
              value="${escapeHTML(participant.roles || '')}"
              placeholder="${translate("additional_roles")}"
              ${!participant.group_id ? "disabled" : ""}
            />
          </td>
        </tr>
      `
      )
      .join("");
  }

  renderGroupOptions(selectedGroupId) {
    return this.groups
      .map(
        (group) => `
        <option value="${group.id}" ${group.id == selectedGroupId ? "selected" : ""}>
          ${group.name}
        </option>
      `
      )
      .join("");
  }

  attachEventListeners() {
    document.querySelectorAll(".group-select").forEach((select) => {
      select.addEventListener("change", (event) => this.handleGroupChange(event));
    });

    document.querySelectorAll(".role-select").forEach((select) => {
      select.addEventListener("change", (event) => this.handleRoleChange(event));
    });

    document.querySelectorAll(".roles-input").forEach((input) => {
      input.addEventListener("blur", (event) => this.handleRolesChange(event));
      input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.target.blur();
        }
      });
    });
  }

  async handleGroupChange(event) {
      const participantId = parseInt(event.target.getAttribute("data-participant-id"), 10);
      const groupIdRaw = event.target.value;
      const groupId = groupIdRaw === "none" ? null : parseInt(groupIdRaw, 10);
      const row = event.target.closest("tr");
      const roleSelect = row.querySelector(".role-select");
      const rolesInput = row.querySelector(".roles-input");

      const requestData = {
          participant_id: participantId,
          group_id: groupId,
          is_leader: false,
          is_second_leader: false,
          roles: null
      };

      debugLog("Sending group change data to backend:", JSON.stringify(requestData));

      try {
          const result = await updateParticipantGroup(
              requestData.participant_id,
              requestData.group_id,
              requestData.is_leader,
              requestData.is_second_leader,
              requestData.roles
          );

          if (result.success) {
              roleSelect.disabled = !groupId;
              rolesInput.disabled = !groupId;
              if (!groupId) {
                  roleSelect.value = "none";
                  rolesInput.value = "";
              }
            await this.fetchData()
              this.app.showMessage(translate("group_updated_successfully"), "success");
          } else {
              throw new Error(result.message || translate("error_updating_group"));
          }
      } catch (error) {
          debugError("Error updating group membership:", error);
          // Revert the select to its previous value if there was an error
          event.target.value = event.target.getAttribute("data-previous-value") || "none";
          this.app.showMessage(error.message || translate("error_updating_group"), "error");
      }
  }


  async handleRoleChange(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const role = event.target.value;
    const row = event.target.closest("tr");
    const groupId = row.querySelector(".group-select").value;
    const rolesInput = row.querySelector(".roles-input");
    const roles = rolesInput.value.trim() || null;

    if (!groupId || groupId === "none") {
      this.app.showMessage(translate("assign_group_before_role"), "error");
      event.target.value = "no_group";
      return;
    }

    // Ensure we are passing valid boolean values (true/false) for is_leader and is_second_leader
    const isLeader = role === "leader" ? true : false;
    const isSecondLeader = role === "second_leader" ? true : false;

    // Log the data that will be sent
    const requestData = {
      participant_id: participantId,
      group_id: groupId,
      is_leader: isLeader,
      is_second_leader: isSecondLeader,
      roles: roles
    };

    debugLog("Sending role change data to backend:", JSON.stringify(requestData));

    try {
      const result = await updateParticipantGroup(participantId, groupId, isLeader, isSecondLeader, roles);

      if (result.success) {
        await this.fetchData()
        this.app.showMessage(translate("role_updated_successfully"), "success");
      } else {
        this.app.showMessage(result.message || translate("error_updating_role"), "error");
      }
    } catch (error) {
      debugError("Error updating participant role:", error);
      this.app.showMessage(translate("error_updating_role"), "error");
    }
  }

  async handleRolesChange(event) {
    const participantId = parseInt(event.target.getAttribute("data-participant-id"), 10);
    const roles = event.target.value.trim() || null;
    const row = event.target.closest("tr");
    const groupId = row.querySelector(".group-select").value;
    const roleSelect = row.querySelector(".role-select");

    if (!groupId || groupId === "none") {
      this.app.showMessage(translate("assign_group_before_role"), "error");
      event.target.value = "";
      return;
    }

    // Get current role values
    const role = roleSelect.value;
    const isLeader = role === "leader" ? true : false;
    const isSecondLeader = role === "second_leader" ? true : false;

    // Log the data that will be sent
    const requestData = {
      participant_id: participantId,
      group_id: groupId,
      is_leader: isLeader,
      is_second_leader: isSecondLeader,
      roles: roles
    };

    debugLog("Sending roles change data to backend:", JSON.stringify(requestData));

    try {
      const result = await updateParticipantGroup(participantId, groupId, isLeader, isSecondLeader, roles);

      if (result.success) {
        await this.fetchData()
        this.app.showMessage(translate("role_updated_successfully"), "success");
      } else {
        this.app.showMessage(result.message || translate("error_updating_role"), "error");
      }
    } catch (error) {
      debugError("Error updating participant roles:", error);
      this.app.showMessage(translate("error_updating_role"), "error");
    }
  }




  renderError() {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_manage_participants")}</p>
    `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
