import {
  getAuthHeader,
  getCurrentOrganizationId,
  getApiUrl,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";

export class TimeSinceRegistration {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.currentSort = { key: "longevity", order: "desc" }; // Default: longest first
  }

  async init() {
    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing time since registration:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      const response = await fetch(getApiUrl("time-since-registration-report"), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch time since registration data");
      }

      this.participants = result.data || [];
      debugLog("Fetched time since registration data:", this.participants);
    } catch (error) {
      debugError("Error fetching time since registration data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <h1>${translate("time_since_registration_report")}</h1>
      <div class="controls-container">
        <div class="sort-options">
          <button class="sort-btn" data-sort="name" title="${translate("sort_by_name")}">👤</button>
          <button class="sort-btn active" data-sort="longevity" title="${translate("sort_by_longevity")}">📅</button>
        </div>
      </div>
      <div id="registration-list" class="registration-list"></div>
    `;
    document.getElementById("app").innerHTML = content;
    this.renderList();
  }

  renderList() {
    const list = document.getElementById("registration-list");

    if (!this.participants || this.participants.length === 0) {
      list.innerHTML = `<p class="no-data">${translate("no_participants_found")}</p>`;
      return;
    }

    // Sort participants based on current sort settings
    const sortedParticipants = this.getSortedParticipants();

    const tableRows = sortedParticipants.map((participant) => {
      const fullName = `${participant.first_name} ${participant.last_name}`;
      const inscriptionDate = participant.inscription_date
        ? new Date(participant.inscription_date).toLocaleDateString()
        : `<span class="unavailable">${translate("date_unavailable")}</span>`;

      let timeWithGroup = "";
      if (participant.inscription_date && participant.years_with_group !== null) {
        const years = Math.floor(participant.years_with_group);
        const months = Math.floor(participant.months_with_group);

        const yearText = years > 0
          ? `${years} ${years === 1 ? translate("year") : translate("years")}`
          : "";
        const monthText = months > 0
          ? `${months} ${months === 1 ? translate("month") : translate("months")}`
          : "";

        if (years > 0 && months > 0) {
          timeWithGroup = `${yearText} ${translate("and")} ${monthText}`;
        } else if (years > 0) {
          timeWithGroup = yearText;
        } else if (months > 0) {
          timeWithGroup = monthText;
        } else {
          timeWithGroup = translate("less_than_one_month");
        }
      } else {
        timeWithGroup = `<span class="unavailable">(${translate("date_unavailable")})</span>`;
      }

      const groupName = participant.group_name || translate("no_group_assigned");

      return `
        <tr>
          <td>${fullName}</td>
          <td>${groupName}</td>
          <td>${inscriptionDate}</td>
          <td>${timeWithGroup}</td>
        </tr>
      `;
    }).join("");

    const html = `
      <table>
        <thead>
          <tr>
            <th>${translate("name")}</th>
            <th>${translate("group")}</th>
            <th>${translate("inscription_date")}</th>
            <th>${translate("time_with_group")}</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

    list.innerHTML = html;
  }

  getSortedParticipants() {
    const sorted = [...this.participants];

    sorted.sort((a, b) => {
      let compareValue = 0;

      if (this.currentSort.key === "name") {
        // Sort by first name
        const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
        const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
        compareValue = nameA.localeCompare(nameB);
      } else if (this.currentSort.key === "longevity") {
        // Sort by longevity (inscription_date)
        // Null dates go to the end
        if (!a.inscription_date && !b.inscription_date) return 0;
        if (!a.inscription_date) return 1;
        if (!b.inscription_date) return -1;

        const dateA = new Date(a.inscription_date);
        const dateB = new Date(b.inscription_date);
        compareValue = dateA - dateB; // Earlier date = longer tenure
      }

      return this.currentSort.order === "asc" ? compareValue : -compareValue;
    });

    return sorted;
  }

  attachEventListeners() {
    const sortButtons = document.querySelectorAll(".sort-btn");

    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.sortItems(btn.dataset.sort);
      });
    });
  }

  sortItems(key) {
    debugLog(`Sorting by ${key}`);

    // Toggle sort order if clicking same key, otherwise use default
    if (this.currentSort.key === key) {
      this.currentSort.order = this.currentSort.order === "asc" ? "desc" : "asc";
    } else {
      this.currentSort.key = key;
      // Default order depends on sort type
      this.currentSort.order = key === "longevity" ? "desc" : "asc";
    }

    // Update visual indicator for active sort button
    document.querySelectorAll(".sort-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    const activeBtn = document.querySelector(`.sort-btn[data-sort="${key}"]`);
    if (activeBtn) {
      activeBtn.classList.add("active");
    }

    // Re-render the list with new sort
    this.renderList();
  }

  renderError() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <h1>${translate("time_since_registration_report")}</h1>
      <div class="error-message">
        <p>${translate("error_loading_data")}</p>
      </div>
    `;
    document.getElementById("app").innerHTML = content;
  }
}
