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
                <label for="program_section">${translate("program_section")}:</label>
                <select id="program_section" name="program_section" required>
                  ${this.renderSectionOptions()}
                </select>
                <button type="submit">${translate("add_group")}</button>
            </form>
            <h2>${translate("existing_groups")}</h2>
            <table>
                <thead>
                  <tr>
                      <th>${translate("group_name")}</th>
                      <th>${translate("program_section")}</th>
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
                  <select class="section-select" data-group-id="${group.id}" aria-label="${translate("program_section")}">
                    ${this.renderSectionOptions(group.program_section)}
                  </select>
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

  renderSectionOptions(selectedSection = "") {
    const sections =
      Array.isArray(this.programSections) && this.programSections.length > 0
        ? this.programSections
        : CONFIG.PROGRAM_SECTIONS.DEFAULT;

    return sections
      .map((section) => {
        const value = escapeHTML(section.key);
        const label = escapeHTML(this.getSectionLabel(section.key));
        const selected = section.key === selectedSection ? "selected" : "";

        return `<option value="${value}" ${selected}>${label}</option>`;
      })
      .join("");
  }

  getSectionLabel(sectionKey) {
    if (!sectionKey) {
      return translate("program_section");
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

    document.querySelectorAll(".section-select").forEach((select) => {
      select.addEventListener("change", (event) => {
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
    const programSection = document.getElementById("program_section")?.value || "";

    if (!groupName) {
      this.showMessage(translate("group_name_required"));
      return;
    }

    if (!programSection) {
      this.showMessage(translate("program_section_required"));
      return;
    }

    try {
      const result = await addGroup(groupName, programSection);
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
        if (document.getElementById("program_section")) {
          document.getElementById("program_section").value =
            this.programSections[0]?.key || "";
        }
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
    const sectionElement = row.querySelector(".section-select");

    const newName = nameElement?.textContent.trim() || "";
    const newSection = sectionElement?.value || "";

    if (!newName) {
      this.showMessage(translate("group_name_required"));
      return;
    }

    if (!newSection) {
      this.showMessage(translate("program_section_required"));
      return;
    }

    try {
      const result = await updateGroupName(groupId, newName, newSection);

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
