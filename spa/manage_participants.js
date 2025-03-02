import {
  getParticipants,
  getGroups,
  updateParticipantGroup,
} from "./ajax-functions.js";
import {
  saveOfflineData
} from "./indexedDB.js";
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
      await saveOfflineData('participants', this.participants);
      await saveOfflineData('groups', this.groups);
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
      const participantId = parseInt(event.target.getAttribute("data-participant-id"), 10);
      const groupIdRaw = event.target.value;
      const groupId = groupIdRaw === "none" ? null : parseInt(groupIdRaw, 10);
      const roleSelect = event.target.closest("tr").querySelector(".role-select");

      const requestData = {
          participant_id: participantId,
          group_id: groupId,
          is_leader: false,
          is_second_leader: false
      };

      console.log("Sending group change data to backend:", JSON.stringify(requestData));

      try {
          const result = await updateParticipantGroup(
              requestData.participant_id,
              requestData.group_id,
              requestData.is_leader,
              requestData.is_second_leader
          );

          if (result.status === "success") {
              roleSelect.disabled = !groupId;
              if (!groupId) {
                  roleSelect.value = "none";
              }
            await this.fetchData()
              this.app.showMessage(translate("group_updated_successfully"), "success");
          } else {
              throw new Error(result.message || translate("error_updating_group"));
          }
      } catch (error) {
          console.error("Error updating group membership:", error);
          // Revert the select to its previous value if there was an error
          event.target.value = event.target.getAttribute("data-previous-value") || "none";
          this.app.showMessage(error.message || translate("error_updating_group"), "error");
      }
  }


  async handleRoleChange(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const role = event.target.value;
    const groupId = event.target.closest("tr").querySelector(".group-select").value;

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
    };

    console.log("Sending role change data to backend:", JSON.stringify(requestData));

    try {
      const result = await updateParticipantGroup(participantId, groupId, isLeader, isSecondLeader);

      if (result.status === "success") {
        await this.fetchData()
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
