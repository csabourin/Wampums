import {
  getParticipants,
  getGroups,
  updateParticipantGroup,
} from "./ajax-functions.js";
import {
  saveOfflineData,
  clearGroupRelatedCaches
} from "./indexedDB.js";
import { translate } from "./app.js";
import { CONFIG } from "./config.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ManageParticipants {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.groups = [];
    this.programSections = [];
  }

  async loadProgramSections() {
    try {
      if (this.app.fetchOrganizationSettings) {
        await this.app.fetchOrganizationSettings();
      }

      const settingsSections = this.app.organizationSettings?.program_sections;

      this.programSections =
        Array.isArray(settingsSections) && settingsSections.length > 0
          ? settingsSections
          : CONFIG.PROGRAM_SECTIONS.DEFAULT;
    } catch (error) {
      debugError("Error loading program sections:", error);
      this.programSections = CONFIG.PROGRAM_SECTIONS.DEFAULT;
    }
  }

  async init() {
    try {
      await this.loadProgramSections();
      await this.fetchData();
    } catch (error) {
      debugError("Error loading manage participants data:", error);
      // Continue rendering even if some data failed to load
      this.app.showMessage(translate("error_loading_data"), "warning");
    }

    // Always render the page, even with partial data
    try {
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error rendering manage participants page:", error);
      this.renderError();
    }
  }

  async fetchData() {
    // Load data with individual error handling to prevent total failure
    const [participantsResponse, groupsResponse] = await Promise.all([
      getParticipants().catch(error => {
        debugError("Error loading participants:", error);
        return { success: false, data: [] };
      }),
      getGroups().catch(error => {
        debugError("Error loading groups:", error);
        return { success: false, data: [] };
      }),
    ]);

    if (participantsResponse.success) {
      // Support both new format (data) and old format (participants)
      this.participants = participantsResponse.data || participantsResponse.participants || [];
    } else {
      debugError("Failed to fetch participants data");
      this.participants = [];
    }

    if (groupsResponse.success) {
      // Support both new format (data) and old format (groups)
      this.groups = groupsResponse.data || groupsResponse.groups || [];
    } else {
      debugError("Failed to fetch groups data");
      this.groups = [];
    }

    debugLog("Fetched Participants:", this.participants);
    debugLog("Fetched Groups:", this.groups);

    // Save offline data with error handling
    try {
      await saveOfflineData('participants', this.participants);
      await saveOfflineData('groups', this.groups);
    } catch (error) {
      debugError("Error saving offline data:", error);
      // Don't throw - this is not critical
    }
  }

  render() {
    const content = `
      <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
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
      .map((group) => {
        const sectionLabel = this.getSectionLabel(group.program_section);
        const safeGroupName = escapeHTML(group.name || "");
        const displayLabel = sectionLabel
          ? `${escapeHTML(sectionLabel)} — ${safeGroupName}`
          : safeGroupName;

        return `
        <option value="${group.id}" ${group.id == selectedGroupId ? "selected" : ""}>
          ${displayLabel}
        </option>
      `;
      })
      .join("");
  }

  getSectionLabel(sectionKey) {
    if (!sectionKey) {
      return "";
    }

    const match = (this.programSections || []).find(
      (section) => section.key === sectionKey,
    );
    const translationKey = `program_section_${sectionKey}`;
    const translated = translate(translationKey);

    if (translated !== translationKey) {
      return translated;
    }

    if (match?.labelKey) {
      const labelFromKey = translate(match.labelKey);
      if (labelFromKey !== match.labelKey) {
        return labelFromKey;
      }
    }

    if (match?.label) {
      return match.label;
    }

    return sectionKey;
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
            this.app.showMessage(translate("group_updated_successfully"), "success");
            // Wait for DB transaction to complete before refreshing
            setTimeout(async () => {
              await clearGroupRelatedCaches();
              await this.fetchData();
              this.render();
              this.attachEventListeners();
            }, 500);
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
        this.app.showMessage(translate("role_updated_successfully"), "success");
        // Wait for DB transaction to complete before refreshing
        setTimeout(async () => {
          await clearGroupRelatedCaches();
          await this.fetchData();
          this.render();
          this.attachEventListeners();
        }, 500);
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
        this.app.showMessage(translate("role_updated_successfully"), "success");
        // Wait for DB transaction to complete before refreshing
        setTimeout(async () => {
          await clearGroupRelatedCaches();
          await this.fetchData();
          this.render();
          this.attachEventListeners();
        }, 500);
      } else {
        this.app.showMessage(result.message || translate("error_updating_role"), "error");
      }
    } catch (error) {
      debugError("Error updating participant roles:", error);
      this.app.showMessage(error.message || translate("error_updating_role"), "error");
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
