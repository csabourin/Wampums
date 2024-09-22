import { getHonorsAndParticipants, awardHonor } from "./ajax-functions.js";
import { translate } from "./app.js";

export class ManageHonors {
  constructor(app) {
    this.app = app;
    this.currentDate = new Date().toLocaleDateString("en-CA"); // Local date in YYYY-MM-DD format
    this.honorsData = { groups: [], names: [] };
    this.availableDates = [];
    this.allHonors = [];
    this.allParticipants = [];
  }

  async init() {
    try {
      await this.fetchData();
      this.processHonors();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing manage honors:", error);
      this.renderError();
    }
  }

  async fetchData() {
    try {
      const { participants, honors } = await getHonorsAndParticipants();
      this.allParticipants = participants; // Cache all participants
      this.allHonors = honors; // Cache all honors

      // Sort available dates in descending order
      this.availableDates = [...new Set(honors.map((h) => h.date))].sort(
        (a, b) => new Date(b) - new Date(a)
      );

      // Ensure today is included in availableDates
      const today = new Date().toLocaleDateString("en-CA");
      if (!this.availableDates.includes(today)) {
        this.availableDates.unshift(today); // Add today's date at the beginning
      }
    } catch (error) {
      console.error("Error fetching honors data:", error);
      throw error;
    }
  }

  processHonors() {
    const today = new Date().toLocaleDateString("en-CA");

    if (this.currentDate === today) {
      // Show all participants on today's date
      this.honorsData.names = this.allParticipants.map((participant) => {
        const honorsForToday = this.allHonors.some(
          (honor) =>
            honor.name_id === participant.name_id && honor.date === today
        );
        const totalHonors = this.allHonors.filter(
          (honor) => honor.name_id === participant.name_id
        ).length;

        return {
          ...participant,
          honored_today: honorsForToday,
          total_honors: totalHonors,
        };
      });
    } else {
      // For past dates, only show participants who received honors on the selected date
      this.honorsData.names = this.allHonors
        .filter((honor) => honor.date === this.currentDate)
        .map((honor) => {
          const participant = this.allParticipants.find(
            (p) => p.name_id === honor.name_id
          );
          const totalHonors = this.allHonors.filter(
            (h) => h.name_id === honor.name_id
          ).length;

          return {
            ...participant,
            honored_today: true,
            total_honors: totalHonors,
          };
        });
    }

    // Group participants by their group_id, and translate "no_group"
    this.honorsData.groups = [
      ...new Map(
        this.honorsData.names.map((part) => [
          part.group_id,
          {
            id: part.group_id,
            name:
              part.group_name === "no_group"
                ? translate("no_group")
                : part.group_name,
          },
        ])
      ).values(),
    ];
  }

  render() {
    const content = `
        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
        <h1>${translate("manage_honors")}</h1>
        <div class="date-navigation">
            <button id="prevDate">&larr; ${translate("previous")}</button>
            <h2 id="currentDate">${this.formatDate(this.currentDate)}</h2>
            <button id="nextDate">${translate("next")} &rarr;</button>
        </div>
        <div class="sort-options">
            <button data-sort="name">${translate("sort_by_name")}</button>
            <button data-sort="honors">${translate("sort_by_honors")}</button>
        </div>
        <div id="honors-list">
            ${this.renderHonorsList()}
        </div>
        <div class="fixed-bottom">
            <button class="honor-btn" id="awardHonorButton" ${
              this.isPastDate() ? "disabled" : ""
            }>${translate("award_honor")}</button>
        </div>
    `;
    document.getElementById("app").innerHTML = content;
  }

  renderHonorsList() {
    if (this.honorsData.names.length === 0) {
      return `<p>${translate("no_honors_on_this_date")}</p>`;
    }

    let html = "";
    this.honorsData.groups.forEach((group) => {
      html += `<div class="group-header">${group.name}</div>`;
      const groupNames = this.honorsData.names.filter(
        (name) => name.group_id === group.id
      );
      groupNames.forEach((name) => {
        const isDisabled = this.isPastDate() || name.honored_today;
        const selectedClass = name.honored_today ? "selected" : "";
        const disabledClass = isDisabled ? "disabled" : "";

        html += `
          <div class="list-item ${selectedClass} ${disabledClass}" data-name-id="${
          name.name_id
        }" data-group-id="${name.group_id}">
            <input type="checkbox" id="name-${name.name_id}" ${
          isDisabled ? "disabled" : ""
        } ${name.honored_today ? "checked" : ""}>
            <label for="name-${name.name_id}">${name.first_name} ${
          name.last_name
        } (${name.total_honors} ${translate("honors")})</label>
          </div>
        `;
      });
    });
    return html;
  }

  attachEventListeners() {
    document.querySelectorAll(".list-item").forEach((item) => {
      item.addEventListener("click", (event) => {
        const checkbox = item.querySelector('input[type="checkbox"]');

        // Ignore clicks if the item is disabled
        if (checkbox.disabled) return;

        // Toggle checkbox checked state and add/remove the 'selected' class
        checkbox.checked = !checkbox.checked;
        item.classList.toggle("selected", checkbox.checked);
      });
    });
    document
      .getElementById("prevDate")
      .addEventListener("click", () => this.changeDate("prev"));
    document
      .getElementById("nextDate")
      .addEventListener("click", () => this.changeDate("next"));
    document.querySelectorAll(".sort-options button").forEach((button) => {
      button.addEventListener("click", () =>
        this.sortItems(button.dataset.sort)
      );
    });
    document
      .getElementById("awardHonorButton")
      .addEventListener("click", () => this.awardHonor());
  }

  async changeDate(direction) {
    const currentIndex = this.availableDates.indexOf(this.currentDate);

    if (direction === "next" && currentIndex > 0) {
      // Move forward to a more recent date
      this.currentDate = this.availableDates[currentIndex - 1];
    } else if (
      direction === "prev" &&
      currentIndex < this.availableDates.length - 1
    ) {
      // Move backward to an older date
      this.currentDate = this.availableDates[currentIndex + 1];
    }
    document.getElementById("currentDate").textContent = this.formatDate(
      this.currentDate
    );
    this.processHonors();
    this.updateHonorsListUI();
  }

  updateHonorsListUI() {
    const honorsList = document.getElementById("honors-list");
    honorsList.innerHTML = this.renderHonorsList();
    document.getElementById("awardHonorButton").disabled = this.isPastDate(); // Disable award button for past dates
  }

  isPastDate() {
    const today = new Date().toLocaleDateString("en-CA"); // Today's date in YYYY-MM-DD
    return this.currentDate < today; // Return true if the selected date is earlier than today
  }

  // Functionality to award honors to selected participants
  async awardHonor() {
    const selectedItems = document.querySelectorAll(
      '.list-item input[type="checkbox"]:checked:not(:disabled)'
    );

    if (selectedItems.length === 0) {
      alert(translate("select_individuals"));
      return;
    }

    const honors = Array.from(selectedItems).map((item) => ({
      nameId: item.closest(".list-item").dataset.nameId,
      date: this.currentDate,
    }));

    try {
      const result = await awardHonor(honors);
      if (result.status === "success") {
        await this.fetchData(); // Fetch the updated data after awarding the honor
        this.updateHonorsListUI(); // Update the honors list with new values
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error:", error);
      alert(`${translate("error_awarding_honor")}: ${error.message}`);
    }
  }

  sortItems(sortBy) {
    const honorsList = document.getElementById("honors-list");
    const items = Array.from(honorsList.querySelectorAll(".list-item"));

    items.sort((a, b) => {
      const aValue = a.querySelector("label").textContent;
      const bValue = b.querySelector("label").textContent;
      if (sortBy === "name") {
        return aValue.localeCompare(bValue);
      } else if (sortBy === "honors") {
        const aHonors = parseInt(aValue.match(/\((\d+)/)[1]);
        const bHonors = parseInt(bValue.match(/\((\d+)/)[1]);
        return bHonors - aHonors;
      }
    });

    items.forEach((item) => honorsList.appendChild(item));
  }

  formatDate(dateString) {
    const options = {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "America/Toronto", // Ensure correct timezone
    };
    const localDate = new Date(dateString + "T00:00:00"); // Ensure it's interpreted as local
    return localDate.toLocaleDateString(this.app.lang, options);
  }

  renderError() {
    const errorMessage = `
        <h1>${translate("error")}</h1>
        <p>${translate("error_loading_honors")}</p>
    `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
