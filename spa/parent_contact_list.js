import { getParentContactList } from "./ajax-functions.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { canSendCommunications, canViewParticipants } from "./utils/PermissionUtils.js";
import { debounce } from "./utils/PerformanceUtils.js";

export class ParentContactList {
  constructor(app) {
    this.app = app;
    this.children = [];
    this.searchFilter = "";
    // Create debounced search handler (300ms delay)
    this.debouncedSearch = debounce((value) => {
      this.searchFilter = value;
      this.updateContactList();
    }, 300);
  }

  async init() {
    if (!canSendCommunications() && !canViewParticipants()) {
      this.app.router.navigate("/");
      return;
    }

    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing parent contact list:", error);
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
            contacts: [],
          };
        }

        // Add group if exists
        if (row.group_name) {
          childrenMap[participantId].groups.add(row.group_name);
        }

        // Add guardian/contact if exists and not already added
        if (
          row.guardian_id &&
          !childrenMap[participantId].contacts.find(
            (c) => c.id === row.guardian_id,
          )
        ) {
          childrenMap[participantId].contacts.push({
            id: row.guardian_id,
            name: `${row.prenom} ${row.nom}`,
            relationship: row.lien,
            email: row.courriel,
            phone_home: row.telephone_residence,
            phone_work: row.telephone_travail,
            phone_cell: row.telephone_cellulaire,
            is_emergency: row.is_emergency_contact,
            is_primary: row.is_primary,
          });
        }
      }

      // Convert groups Set to Array for each child
      for (const child of Object.values(childrenMap)) {
        child.groups = Array.from(child.groups);
      }

      this.children = childrenMap;
    } catch (error) {
      debugError("Error fetching parent contact list:", error);
      throw error;
    }
  }

  render() {
    const content = `
            <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
            <h1>${translate("parent_contact_list")}</h1>
            <div class="search-container">
                <input
                    type="text"
                    id="contact-search"
                    class="search-input"
                    placeholder="${translate("search_participants")}..."
                    value="${this.searchFilter}"
                />
            </div>
            <div id="contact-list">
                ${this.renderChildrenByFirstName()}
            </div>
        `;
    document.getElementById("app").innerHTML = content;
    this.attachEventListeners();
  }

  renderChildrenByFirstName() {
    // Sort children by first name
    let sortedChildren = Object.entries(this.children)
      .map(([id, child]) => ({ id, ...child }))
      .sort((a, b) => {
        const aFirstName = a.name.split(" ")[0];
        const bFirstName = b.name.split(" ")[0];
        return aFirstName.localeCompare(bFirstName);
      });

    // Apply search filter if exists
    if (this.searchFilter) {
      const filterLower = this.searchFilter.toLowerCase();
      sortedChildren = sortedChildren.filter((child) => {
        // Check if child name matches
        if (child.name.toLowerCase().includes(filterLower)) {
          return true;
        }
        // Check if any contact name matches
        return child.contacts.some((contact) =>
          contact.name.toLowerCase().includes(filterLower)
        );
      });
    }

    // Group by first letter of first name
    const groupedByLetter = {};
    for (const child of sortedChildren) {
      const firstLetter = child.name[0].toUpperCase();
      if (!groupedByLetter[firstLetter]) {
        groupedByLetter[firstLetter] = [];
      }
      groupedByLetter[firstLetter].push(child);
    }

    // Render grouped and collapsed by default
    let html = "";
    for (const [letter, children] of Object.entries(groupedByLetter).sort()) {
      html += `


        `;
      for (const child of children) {
        html += this.renderChildCard(child.id, child);
      }
      html += ``;
    }

    return html;
  }

  renderGroupsAndChildren() {
    // Extract unique groups from the children list
    const allGroups = new Set();
    for (const child of Object.values(this.children)) {
      child.groups.forEach((group) => allGroups.add(group));
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
                <details>
                    <summary class="child-name">${child.name}</summary>
                <div class="contacts">
                    ${this.renderContacts(child.contacts)}
                </div>
                </details>
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
                        "is_emergency_contact",
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
        `,
      )
      .join("");
  }

  attachEventListeners() {
    document.querySelectorAll(".group-header").forEach((header) => {
      header.addEventListener("click", (e) => this.toggleGroup(e.target));
    });

    // Add search input listener with debouncing
    const searchInput = document.getElementById("contact-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        // Use debounced search to avoid excessive filtering
        this.debouncedSearch(e.target.value);
      });
    }
  }

  updateContactList() {
    const contactList = document.getElementById("contact-list");
    if (contactList) {
      contactList.innerHTML = this.renderChildrenByFirstName();
    }
  }

  toggleGroup(header) {
    const content = header.nextElementSibling;
    header.classList.toggle("collapsed");
    content.classList.toggle("collapsed");
  }

  renderError() {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${translate("error_loading_parent_contact_list")}</p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
