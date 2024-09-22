import { getParentContactList } from "./ajax-functions.js";
import { translate } from "./app.js";

export class ParentContactList {
  constructor(app) {
    this.app = app;
    this.children = [];
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
      console.error("Error initializing parent contact list:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      this.children = await getParentContactList();
    } catch (error) {
      console.error("Error fetching parent contact list:", error);
      throw error;
    }
  }

  render() {
    const content = `
            <h1>${translate("parent_contact_list")}</h1>
            <div id="contact-list">
                ${this.renderGroupsAndChildren()}
            </div>
            <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
        `;
    document.getElementById("app").innerHTML = content;
  }

  renderGroupsAndChildren() {
    let html = "";
    let currentGroup = null;
    for (const [childId, child] of Object.entries(this.children)) {
      if (currentGroup !== child.group) {
        if (currentGroup !== null) {
          html += `</div></div>`;
        }
        currentGroup = child.group;
        html += `
                    <div class="group">
                        <div class="group-header" data-group="${currentGroup}">${currentGroup}</div>
                        <div class="group-content">
                `;
      }
      html += this.renderChildCard(childId, child);
    }
    if (currentGroup !== null) {
      html += `</div></div>`;
    }
    return html;
  }

  renderChildCard(childId, child) {
    return `
            <div class="child-card" data-child-id="${childId}">
                <div class="child-name">${child.name}</div>
                <div class="contacts">
                    ${this.renderContacts(child.contacts)}
                </div>
            </div>
        `;
  }

  renderContacts(contacts) {
    return contacts
      .map(
        (contact) => `
            <div class="contact-info">
                <strong>${contact.name}</strong>
                ${
                  contact.is_emergency
                    ? `<span class="emergency-contact">${translate(
                        "emergency_contact"
                      )}</span>`
                    : ""
                }
                ${
                  contact.phone_home
                    ? `<span class="phone-number">${translate("phone_home")}: ${
                        contact.phone_home
                      }</span>`
                    : ""
                }
                ${
                  contact.phone_cell
                    ? `<span class="phone-number">${translate("phone_cell")}: ${
                        contact.phone_cell
                      }</span>`
                    : ""
                }
                ${
                  contact.phone_work
                    ? `<span class="phone-number">${translate("phone_work")}: ${
                        contact.phone_work
                      }</span>`
                    : ""
                }
            </div>
        `
      )
      .join("");
  }

  attachEventListeners() {
    document.querySelectorAll(".group-header").forEach((header) => {
      header.addEventListener("click", (e) => this.toggleGroup(e.target));
    });
  }

  toggleGroup(header) {
    const content = header.nextElementSibling;
    content.style.display = content.style.display === "none" ? "block" : "none";
  }

  renderError() {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${translate("error_loading_parent_contact_list")}</p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
