import { getHonorsAndParticipants, awardHonor } from "./ajax-functions.js";
import { translate } from "./app.js";

export class ManageHonors {
  constructor(app) {
    this.app = app;
    this.currentDate = new Date().toLocaleDateString("en-CA");
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
      const data = await getHonorsAndParticipants(this.currentDate);
      console.log('API Response:', data); // Add this line for debugging

      this.allParticipants = data.participants || [];
      this.allHonors = data.honors || [];

      // Filter out null, undefined, and invalid dates
      this.availableDates = (data.availableDates || []).filter(date => {
        if (!date || date === 'null' || date === 'undefined') return false;
        const testDate = new Date(date);
        return !isNaN(testDate.getTime());
      });

      const today = new Date().toLocaleDateString("en-CA");
      if (!this.availableDates.includes(today)) {
        this.availableDates.unshift(today);
      }

      if (!this.availableDates.includes(this.currentDate)) {
        this.availableDates.push(this.currentDate);
      }

      // Sort the dates in descending order
      this.availableDates.sort((a, b) => new Date(b) - new Date(a));

      console.log('Processed availableDates:', this.availableDates); // Add this line for debugging
    } catch (error) {
      console.error("Error fetching honors data:", error);
      throw error;
    }
  }

  processHonors() {
    const today = new Date().toLocaleDateString("en-CA");
    const isCurrentDate = this.currentDate === today;

    const participantMap = new Map();

    this.allParticipants.forEach(participant => {
      const honorsForDate = this.allHonors.filter(
        honor => honor.participant_id === participant.participant_id && honor.date === this.currentDate
      );
      const totalHonors = this.allHonors.filter(
        honor => honor.participant_id === participant.participant_id && new Date(honor.date) <= new Date(this.currentDate)
      ).length;

      const processedParticipant = {
        ...participant,
        honored_today: honorsForDate.length > 0,
        total_honors: totalHonors,
        visible: isCurrentDate || honorsForDate.length > 0
      };

      if (!participantMap.has(participant.group_id)) {
        participantMap.set(participant.group_id, {
          id: participant.group_id,
          name: participant.group_name === "no_group" ? translate("no_group") : participant.group_name,
          participants: []
        });
      }

      if (processedParticipant.visible) {
        participantMap.get(participant.group_id).participants.push(processedParticipant);
      }
    });

    this.honorsData.groups = Array.from(participantMap.values());
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
    if (this.honorsData.groups.length === 0) {
      return `<p>${translate("no_honors_on_this_date")}</p>`;
    }

    return this.honorsData.groups.map(group => `
      <div class="group-header">${group.name}</div>
      ${group.participants.map(participant => this.renderParticipantItem(participant)).join('')}
    `).join('');
  }

  renderParticipantItem(participant) {
    const isDisabled = this.isPastDate() || participant.honored_today;
    const selectedClass = participant.honored_today ? "selected" : "";
    const disabledClass = isDisabled ? "disabled" : "";

    return `
      <div class="list-item ${selectedClass} ${disabledClass}" data-participant-id="${participant.participant_id}" data-group-id="${participant.group_id}">
        <input type="checkbox" id="participant-${participant.participant_id}" ${isDisabled ? "disabled" : ""} ${participant.honored_today ? "checked" : ""}>
        <label for="participant-${participant.participant_id}">
          ${participant.first_name} ${participant.last_name} 
          (${participant.total_honors} ${translate("honors")})
        </label>
      </div>
    `;
  }

  attachEventListeners() {
    document.querySelectorAll(".list-item").forEach((item) => {
      item.addEventListener("click", (event) => this.handleItemClick(event));
    });
    document.getElementById("prevDate").addEventListener("click", () => this.changeDate("prev"));
    document.getElementById("nextDate").addEventListener("click", () => this.changeDate("next"));
    document.querySelectorAll(".sort-options button").forEach((button) => {
      button.addEventListener("click", () => this.sortItems(button.dataset.sort));
    });
    document.getElementById("awardHonorButton").addEventListener("click", () => this.awardHonor());
  }

  handleItemClick(event) {
    const item = event.currentTarget;
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox.disabled) return;
    checkbox.checked = !checkbox.checked;
    item.classList.toggle("selected", checkbox.checked);
  }

  async changeDate(direction) {
    const currentIndex = this.availableDates.indexOf(this.currentDate);
    if (direction === "next" && currentIndex > 0) {
      this.currentDate = this.availableDates[currentIndex - 1];
    } else if (direction === "prev" && currentIndex < this.availableDates.length - 1) {
      this.currentDate = this.availableDates[currentIndex + 1];
    }
    await this.fetchData();
    this.processHonors();
    this.updateHonorsListUI();
  }

  updateHonorsListUI() {
    document.getElementById("currentDate").textContent = this.formatDate(this.currentDate);
    document.getElementById("honors-list").innerHTML = this.renderHonorsList();
    document.getElementById("awardHonorButton").disabled = this.isPastDate();

    // Attach event listeners to list items only
    this.attachEventListenersToListItems();
  }


  isPastDate() {
    const today = new Date().toLocaleDateString("en-CA");
    return this.currentDate < today;
  }

  async awardHonor() {
    const selectedItems = document.querySelectorAll('.list-item input[type="checkbox"]:checked:not(:disabled)');
    if (selectedItems.length === 0) {
      this.app.showMessage(translate("select_individuals"), "error");
      return;
    }

    const honors = Array.from(selectedItems).map((item) => ({
        participantId: item.closest(".list-item").dataset.participantId,
      date: this.currentDate,
    }));

    try {
      const result = await awardHonor(honors);
      if (result.status === "success") {
        await this.fetchData();
        this.processHonors();
        this.updateHonorsListUI();
        this.app.showMessage(translate("honors_awarded_successfully"), "success");
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error:", error);
      this.app.showMessage(`${translate("error_awarding_honor")}: ${error.message}`, "error");
    }
  }

  sortItems(sortBy) {
    // Sort participants by name or honors
    this.honorsData.groups.forEach(group => {
      group.participants.sort((a, b) => {
        if (sortBy === "name") {
          return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
        } else if (sortBy === "honors") {
          return b.total_honors - a.total_honors;
        }
      });
    });

    // Directly update the UI without reattaching event listeners
    document.getElementById("honors-list").innerHTML = this.renderHonorsList();

    // Only reattach event listeners for the updated list items
    this.attachEventListenersToListItems();
  }

  attachEventListenersToListItems() {
    document.querySelectorAll(".list-item").forEach((item) => {
      item.addEventListener("click", (event) => this.handleItemClick(event));
    });
  }

  formatDate(dateString) {
    // Validate the date string
    if (!dateString || dateString === 'null' || dateString === 'undefined') {
      return 'Invalid Date';
    }

    const options = { day: "numeric", month: "short", year: "numeric", timeZone: "America/Toronto" };
    const localDate = new Date(dateString + "T00:00:00");

    // Check if the date is valid after creation
    if (isNaN(localDate.getTime())) {
      return 'Invalid Date';
    }

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