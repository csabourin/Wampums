import {
  getGroups,
  addGroup,
  removeGroup,
  updateGroupName,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { clearGroupRelatedCaches } from "./indexedDB.js";

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
      console.error("Error initializing manage groups:", error);
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
        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
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
                <tr>
                    <th>${translate("group_name")}</th>
                    <th>${translate("action")}</th>
                </tr>
                ${this.renderGroupRows()}
            </table>
        `;
    document.getElementById("app").innerHTML = content;
  }

  renderGroupRows() {
    return this.groups
      .map(
        (group) => `
            <tr>
                <td>
                    <span class="editable-group" contenteditable="true" data-group-id="${
                      group.id
                    }">${group.name}</span>
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
    document
      .getElementById("add-group-form")
      .addEventListener("submit", (e) => this.handleAddGroup(e));
    document.querySelectorAll(".editable-group").forEach((span) => {
      span.addEventListener("blur", (e) => this.handleUpdateGroupName(e));
    });
    document.querySelectorAll(".remove-group").forEach((button) => {
      button.addEventListener("click", (e) => this.handleRemoveGroup(e));
    });
  }

  async handleAddGroup(e) {
    e.preventDefault();
    const groupName = document.getElementById("group_name").value.trim();
    if (groupName) {
      try {
        const result = await addGroup(groupName);
        this.showMessage(result.message);
        if (result.status === "success") {
          // Clear all group-related caches
          await clearGroupRelatedCaches();
          await this.fetchGroups();
          this.render();
          this.attachEventListeners();
        }
      } catch (error) {
        console.error("Error:", error);
        this.showMessage(translate("error_adding_group"));
      }
    }
  }

  async handleUpdateGroupName(e) {
    const span = e.target;
    const groupId = span.getAttribute("data-group-id");
    const newName = span.textContent.trim();
    try {
      const result = await updateGroupName(groupId, newName);
      this.showMessage(result.message);
      if (result.status === "success") {
        // Clear all group-related caches
        await clearGroupRelatedCaches();
      }
    } catch (error) {
      console.error("Error:", error);
      this.showMessage(translate("error_updating_group_name"));
    }
  }

  async handleRemoveGroup(e) {
    const groupId = e.target.getAttribute("data-group-id");
    if (confirm(translate("confirm_delete_group"))) {
      try {
        const result = await removeGroup(groupId);
        this.showMessage(result.message);
        if (result.status === "success") {
          // Clear all group-related caches
          await clearGroupRelatedCaches();
          await this.fetchGroups();
          this.render();
          this.attachEventListeners();
        }
      } catch (error) {
        console.error("Error:", error);
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
