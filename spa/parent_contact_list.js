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
      const response = await getParentContactList();
      // Extract contacts from response - API returns {success: true, contacts: [...]}
      const rows = response.contacts || response;

      // Transform flat SQL rows into nested structure
      const childrenMap = {};

      for (const row of rows) {
        const participantId = row.participant_id;

        // Initialize child entry if not exists
        if (!childrenMap[participantId]) {
          childrenMap[participantId] = {
            name: `${row.first_name} ${row.last_name}`,
            groups: new Set(),
            contacts: []
          };
        }

        // Add group if exists
        if (row.group_name) {
          childrenMap[participantId].groups.add(row.group_name);
        }

        // Add guardian/contact if exists and not already added
        if (row.guardian_id && !childrenMap[participantId].contacts.find(c => c.id === row.guardian_id)) {
          childrenMap[participantId].contacts.push({
            id: row.guardian_id,
            name: `${row.prenom} ${row.nom}`,
            relationship: row.lien,
            email: row.courriel,
            phone_home: row.telephone_residence,
            phone_work: row.telephone_travail,
            phone_cell: row.telephone_cellulaire,
            is_emergency: row.is_emergency_contact,
            is_primary: row.is_primary
          });
        }
      }

      // Convert groups Set to Array for each child
      for (const child of Object.values(childrenMap)) {
        child.groups = Array.from(child.groups);
      }

      this.children = childrenMap;
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
      // Extract unique groups from the children list
      const allGroups = new Set();
      for (const child of Object.values(this.children)) {
          child.groups.forEach(group => allGroups.add(group));
      }
      const sortedGroups = Array.from(allGroups).sort(); // Sort groups alphabetically

      let html = "";
      for (const group of sortedGroups) {
          html += `
              <div class="group">
                  <div class="group-header" data-group="${group}">${group}</div>
                  <div class="group-content">
          `;
          // Render all children belonging to this group
          for (const [childId, child] of Object.entries(this.children)) {
              if (child.groups.includes(group)) {
                  html += this.renderChildCard(childId, child);
              }
          }
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
