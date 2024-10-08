import {
  getParticipants,
  getGroups,
  updateParticipantGroup,
} from "./ajax-functions.js";
import { translate } from "./app.js";

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
      console.error("Error initializing manage participants:", error);
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
        this.participants = participantsResponse.participants;
      } else {
        throw new Error("Failed to fetch participants data");
      }

      if (groupsResponse.success) {
        this.groups = groupsResponse.groups;
      } else {
        throw new Error("Failed to fetch groups data");
      }

      console.log("Fetched Participants:", this.participants);
      console.log("Fetched Groups:", this.groups);
    } catch (error) {
      console.error("Error fetching manage participants data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      <h1>${translate("manage_participants")}</h1>
      <table>
        <thead>
          <tr>
            <th>${translate("name")}</th>
            <th>${translate("group")}</th>
            <th>${translate("role")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.renderParticipantRows()}
        </tbody>
      </table>
    `;
    document.getElementById("app").innerHTML = content;
  }

  renderParticipantRows() {
    return this.participants
      .map(
        (participant) => `
        <tr>
          <td>${participant.first_name} ${participant.last_name}</td>
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
  }

  async handleGroupChange(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const groupId = event.target.value;
    const roleSelect = event.target.closest("tr").querySelector(".role-select");

    // Default values for roles when only changing the group
    const isLeader = false;
    const isSecondLeader = false;

    // Log the data that will be sent
    const requestData = {
      participant_id: participantId,
      group_id: groupId,
      is_leader: isLeader,
      is_second_leader: isSecondLeader,
    };

    console.log("Sending group change data to backend:", JSON.stringify(requestData));

    try {
      // Send the data to the backend wrapped in JSON
      const result = await updateParticipantGroup(participantId, groupId, isLeader, isSecondLeader);

      if (result.status === "success") {
        // Enable or disable role select based on whether a group is selected
        if (groupId && groupId !== "none") {
          roleSelect.disabled = false; // Enable the role select field
        } else {
          roleSelect.disabled = true;  // Disable the role select field if no group
          roleSelect.value = "none";   // Reset role to "none" if no group is selected
        }

        this.app.showMessage(translate("group_updated_successfully"), "success");
      } else {
        this.app.showMessage(result.message || translate("error_updating_group"), "error");
      }
    } catch (error) {
      console.error("Error updating group membership:", error);
      this.app.showMessage(translate("error_updating_group"), "error");
    }
  }


  async handleRoleChange(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const role = event.target.value;
    const groupId = event.target.closest("tr").querySelector(".group-select").value;

    if (!groupId || groupId === "none") {
      this.app.showMessage(translate("assign_group_before_role"), "error");
      event.target.value = "none";
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
    };

    console.log("Sending role change data to backend:", JSON.stringify(requestData));

    try {
      const result = await updateParticipantGroup(participantId, groupId, isLeader, isSecondLeader);

      if (result.status === "success") {
        this.app.showMessage(translate("role_updated_successfully"), "success");
      } else {
        this.app.showMessage(result.message || translate("error_updating_role"), "error");
      }
    } catch (error) {
      console.error("Error updating participant role:", error);
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
