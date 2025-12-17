import {
  getGroups,
  addGroup,
  removeGroup,
  updateGroupName,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { CONFIG } from "./config.js";
import { clearGroupRelatedCaches } from "./indexedDB.js";
import { debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

export class ManageGroups {
  constructor(app) {
    this.app = app;
    this.groups = [];
  }

  async init() {
    try {
      await this.fetchGroups();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing manage groups:", error);
      this.renderError();
    }
  }

  async fetchGroups() {
    const fetchedGroup = await getGroups();
    if (fetchedGroup.success) {
      this.groups = fetchedGroup.data || fetchedGroup.groups || [];
    }
  }


  render() {
    const content = `
        <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
            <h1>${translate("manage_groups")}</h1>
            <div id="message"></div>
            <form id="add-group-form">
                <h2>${translate("add_group")}</h2>
                <label for="group_name">${translate("group_name")}:</label>
                <input type="text" id="group_name" name="group_name" required>
                <button type="submit">${translate("add_group")}</button>
            </form>
            <h2>${translate("existing_groups")}</h2>
            <table>
                <thead>
                  <tr>
                      <th>${translate("group_name")}</th>
                      <th>${translate("action")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.renderGroupRows()}
                </tbody>
            </table>
        `;
    document.getElementById("app").innerHTML = content;
  }

  renderGroupRows() {
    return this.groups
      .map(
        (group) => `
            <tr data-group-row="${group.id}">
                <td>
                    <span class="editable-group" contenteditable="true" data-group-id="${group.id}">${escapeHTML(group.name || "")}</span>
                </td>
                <td>
                    <button class="remove-group" data-group-id="${
                      group.id
                    }" style="background-color: #f44336;">
                        ${translate("remove_group")}
                    </button>
                </td>
            </tr>
        `
      )
      .join("");
  }

  attachEventListeners() {
    const addGroupForm = document.getElementById("add-group-form");

    if (addGroupForm) {
      addGroupForm.addEventListener("submit", (e) => this.handleAddGroup(e));
    }

    document.querySelectorAll(".editable-group").forEach((span) => {
      span.addEventListener("blur", (event) => {
        const groupId = event.target.getAttribute("data-group-id");
        this.handleUpdateGroup(groupId);
      });
    });

    document.querySelectorAll(".remove-group").forEach((button) => {
      button.addEventListener("click", (e) => this.handleRemoveGroup(e));
    });
  }

  async handleAddGroup(e) {
    e.preventDefault();
    const groupName = document.getElementById("group_name").value.trim();

    if (!groupName) {
      this.showMessage(translate("group_name_required"));
      return;
    }

    try {
      const result = await addGroup(groupName);
      if (result.success) {
        // Clear all group-related caches
        await clearGroupRelatedCaches();
        await this.fetchGroups();
        this.render();
        this.attachEventListeners();
        // Show translated success message
        this.showMessage(translate("group_added_successfully"));
        // Clear the input field
        document.getElementById("group_name").value = "";
      } else {
        this.showMessage(result.message || translate("error_adding_group"));
      }
    } catch (error) {
      debugError("Error:", error);
      this.showMessage(translate("error_adding_group"));
    }
  }

  async handleUpdateGroup(groupId) {
    const row = document.querySelector(`[data-group-row="${groupId}"]`);

    if (!row) {
      return;
    }

    const nameElement = row.querySelector(".editable-group");
    const newName = nameElement?.textContent.trim() || "";

    if (!newName) {
      this.showMessage(translate("group_name_required"));
      return;
    }

    try {
      const result = await updateGroupName(groupId, newName);

      if (result.success) {
        // Clear all group-related caches
        await clearGroupRelatedCaches();
        await this.fetchGroups();
        this.render();
        this.attachEventListeners();
        this.showMessage(translate("group_updated_successfully"));
      } else {
        this.showMessage(result.message || translate("error_updating_group_name"));
      }
    } catch (error) {
      debugError("Error:", error);
      this.showMessage(translate("error_updating_group_name"));
    }
  }

  async handleRemoveGroup(e) {
    const groupId = e.target.getAttribute("data-group-id");
    if (confirm(translate("confirm_delete_group"))) {
      try {
        const result = await removeGroup(groupId);
        if (result.success) {
          // Clear all group-related caches
          await clearGroupRelatedCaches();
          await this.fetchGroups();
          this.render();
          this.attachEventListeners();
          this.showMessage(translate("group_removed_successfully"));
        } else {
          this.showMessage(result.message || translate("error_removing_group"));
        }
      } catch (error) {
        debugError("Error:", error);
        this.showMessage(translate("error_removing_group"));
      }
    }
  }

  showMessage(message) {
    const messageElement = document.getElementById("message");
    messageElement.textContent = message;
    messageElement.style.display = "block";
    setTimeout(() => {
      messageElement.style.display = "none";
    }, 3000);
  }

  renderError() {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${translate("error_loading_manage_groups")}</p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
