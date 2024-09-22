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
      [this.participants, this.groups] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);
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
                <td data-label="${translate("name")}">
                    ${participant.first_name} ${participant.last_name}
                </td>
                <td data-label="${translate("group")}">
                    <select class="group-select" data-participant-id="${
                      participant.id
                    }">
                        <option value="" ${
                          participant.group_id === null ? "selected" : ""
                        }>${translate("no_group")}</option>
                        ${this.renderGroupOptions(participant.group_id)}
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
            <option value="${group.id}" ${
          group.id == selectedGroupId ? "selected" : ""
        }>
                ${group.name}
            </option>
        `
      )
      .join("");
  }

  attachEventListeners() {
    document.querySelectorAll(".group-select").forEach((select) => {
      select.addEventListener("change", (event) =>
        this.handleGroupChange(event)
      );
    });
  }

  async handleGroupChange(event) {
    const participantId = event.target.getAttribute("data-participant-id");
    const groupId = event.target.value;
    try {
      const result = await updateParticipantGroup(participantId, groupId);
      if (result.status === "success") {
        console.log(result.message);
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred while updating the group.");
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
