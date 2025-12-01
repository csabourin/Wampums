import {
  getParticipants,
  getAttendance,
  updateAttendance,
  getAttendanceDates,
  saveGuest,
  getGuestsByDate
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";


export class Attendance {
  constructor(app) {
    this.app = app;
    this.currentDate = new Date().toLocaleDateString("en-CA");
    this.participants = [];
    this.attendanceData = {};
    this.guests = [];
    this.selectedParticipant = null;
    this.availableDates = [];
    this.saveGuest = saveGuest;
    this.getGuestsByDate = getGuestsByDate;
    this.groups = [];
    this.freshContent=``;
    this.isInitialized = false;
      this.isLoading = true;
  }

  async init() {
    try {
      this.renderSkeleton();  this.isLoading = true;

      // Load all required data
      await Promise.all([
        this.fetchAttendanceDates(),
        this.preloadAttendanceData()
      ]);

      // Mark as initialized and not loading
      this.isInitialized = true;
      this.isLoading = false;
      // Only render if we're still on the attendance page
      if (document.querySelector('.attendance-container')) {
        this.render();
        this.attachEventListeners();
      }
    } catch (error) {
      console.error("Error initializing attendance:", error);
      this.isLoading = false;
      this.renderError();
    }
  }

  async preloadAttendanceData() {
    try {
      const cachedData = await getCachedData(`attendance_${this.currentDate}`);
      if (cachedData) {
        this.participants = cachedData.participants;
        this.attendanceData = cachedData.attendanceData;
        this.guests = cachedData.guests;
        this.groups = cachedData.groups;
        return;
      }
      await this.fetchData();
    } catch (error) {
      console.error("Error preloading attendance data:", error);
      throw error;
    }
  }

  async fetchAttendanceDates() {
    try {
      const response = await getAttendanceDates(); // Call the API
      if (response.success && response.dates) {
        // Filter out null, undefined, and invalid dates
        this.availableDates = response.dates.filter(date => {
          if (!date || date === 'null' || date === 'undefined') return false;
          const testDate = new Date(date);
          return !isNaN(testDate.getTime());
        });
      } else {
        throw new Error("Failed to fetch attendance dates or no dates available.");
      }

      this.availableDates.sort((a, b) => new Date(b) - new Date(a));
      const today = new Date().toLocaleDateString("en-CA");
      if (!this.availableDates.includes(today)) {
        this.availableDates.unshift(today);
      }
      this.currentDate = this.availableDates[0];
    } catch (error) {
      console.error("Error fetching attendance dates:", error);
      throw error;
    }
  }

  async fetchData() {
    try {
      // Check if cached data is available
      const cachedData = await getCachedData(`attendance_${this.currentDate}`);
      if (cachedData) {
        this.participants = cachedData.participants;
        this.attendanceData = cachedData.attendanceData;
        this.guests = cachedData.guests;
        this.groups = cachedData.groups;
        console.log("Loaded data from cache");
        return; // No need to proceed if cached data is found
      }

      // Fetch the data if not cached
      const [participantsResponse, attendanceData, guestsResponse] = await Promise.all([
        getParticipants(),
        getAttendance(this.currentDate),
        this.getGuestsByDate(this.currentDate)
      ]);

      if (participantsResponse.success && Array.isArray(participantsResponse.participants)) {
        this.participants = participantsResponse.participants;
      } else {
        throw new Error("Invalid participants data structure");
      }

      this.attendanceData = attendanceData;
      // Handle both array response and object response with guests property
      this.guests = Array.isArray(guestsResponse) ? guestsResponse : (guestsResponse?.guests || []);

      // Group participants
      this.groups = this.participants.reduce((acc, participant) => {
        if (!acc[participant.group_id]) {
          acc[participant.group_id] = {
            id: participant.group_id,
            name: participant.group_name,
            participants: []
          };
        }
        acc[participant.group_id].participants.push(participant);
        return acc;
      }, {});

      // Sort participants in each group by leader, second leader, and then alphabetically
      Object.values(this.groups).forEach(group => {
        group.participants.sort((a, b) => {
          // Sort leaders first
          if (a.is_leader && !b.is_leader) return -1;
          if (!a.is_leader && b.is_leader) return 1;

          // Sort second leaders last
          if (a.is_second_leader && !b.is_second_leader) return 1;
          if (!a.is_second_leader && b.is_second_leader) return -1;

          // Alphabetical sort by first name for non-leaders and non-second-leaders
          return a.first_name.localeCompare(b.first_name);
        });
      });

      // Sort groups alphabetically by group name
      // this.groups = Object.values(this.groups).sort((a, b) => a.name.localeCompare(b.name));
      // Sort groups alphabetically by group name, put participants without a group last
      this.groups = Object.entries(this.groups).map(([id, group]) => ({ id, ...group })).sort((a, b) => {
        if (!a.name) return 1; // Move groups without a name to the end
        if (!b.name) return -1;
        return a.name.localeCompare(b.name);
      });

      // Cache the fetched data for 5 minues
      await setCachedData(`attendance_${this.currentDate}`, {
        participants: this.participants,
        attendanceData: this.attendanceData,
        guests: this.guests,
        groups: this.groups
      },  5 * 60 * 1000); // Cache for 5 minute
    } catch (error) {
      console.error("Error fetching attendance data:", error);
      throw error;
    }
  }


  renderSkeleton() {
    const content = `
      <div class="attendance-container skeleton">
        <div class="date-navigation">
          <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
          <select id="skeleton-dateSelect" class="date-select skeleton-text"></select>
        </div>
        <div id="skeleton-attendance-list" class="attendance-list">
          ${this.renderSkeletonGroups()}
        </div>
        <div class="guest-entry">
          <h3>${translate("add_guest")}</h3>
          <input type="text" id="skeleton-guestName" class="skeleton-text" disabled>
          <input type="email" id="skeleton-guestEmail" class="skeleton-text" disabled>
          <button id="skeleton-addGuestButton" class="skeleton-button" disabled>${translate("add_guest_button")}</button>
          <div id="skeleton-guestList" class="skeleton-guest-list">
            ${this.renderSkeletonGuests()}
          </div>
        </div>
        <div class="status-buttons fixed-footer">
          <button class="status-btn skeleton-button"></button>
          <button class="status-btn skeleton-button"></button>
          <button class="status-btn skeleton-button"></button>
          <button class="status-btn skeleton-button"></button>
        </div>
      </div>
    `;
    document.getElementById("app").innerHTML = content;
  }


  renderSkeletonGroups() {
    // Mock structure of group and participant rows
    return `
      <div class="group-card skeleton">
        <h3 class="skeleton-text">Loading...</h3>
        <div class="participant-row skeleton">
          <span class="participant-name skeleton-text"></span>
          <span class="participant-status skeleton-text"></span>
        </div>
        <div class="participant-row skeleton">
          <span class="participant-name skeleton-text"></span>
          <span class="participant-status skeleton-text"></span>
        </div>
      </div>
    `;
  }

  renderSkeletonGuests() {
    return `
      <div class="guest-row skeleton">
        <span class="guest-name skeleton-text"></span>
        <span class="guest-email skeleton-text"></span>
      </div>
    `;
  }


  render() {
  // Safety check to prevent rendering if we've navigated away
  if (!document.querySelector('.attendance-container')) {
    return;
  }

  // Don't render if we're still loading
  if (this.isLoading) {
    return;
  }
    this.freshContent = `
      <div class="attendance-container">
        <div class="date-navigation">
          <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
          <select id="dateSelect" class="date-select">
            ${this.renderDateOptions()}
          </select>
        </div>
        <div id="attendance-list" class="attendance-list">
          <!-- This will be filled by renderGroupsAndNames() -->
        </div>
        <div class="guest-entry">
          <h3>${translate("add_guest")}</h3>
          <input type="text" id="guestName" placeholder="${translate("guest_name")}">
          <input type="email" id="guestEmail" placeholder="${translate("guest_email_optional")}">
          <button id="addGuestButton">${translate("add_guest_button")}</button>
          <div id="guestList">
            ${this.renderGuests()}
          </div>
        </div>
        <div class="status-buttons fixed-footer">
          <button class="status-btn present" data-status="present">${translate("present")}</button>
          <button class="status-btn absent" data-status="absent">${translate("absent")}</button>
          <button class="status-btn late" data-status="late">${translate("late")}</button>
          <button class="status-btn excused" data-status="excused">${translate("excused")}</button>
        </div>
      </div>
    `;

   const appElement = document.querySelector("#app");
    if (appElement) {
      appElement.innerHTML = this.freshContent;
      const attendanceList = document.getElementById("attendance-list");
      if (attendanceList) {
        attendanceList.innerHTML = "";
        attendanceList.appendChild(this.renderGroupsAndNames());
      }
    }
  }

  renderDateOptions() {
    return this.availableDates
      .map(date => `<option value="${date}" ${date === this.currentDate ? "selected" : ""}>
        ${this.formatDate(date)}
      </option>`)
      .join("");
  }

  renderGroupsAndNames() {
    const fragment = document.createDocumentFragment();

    Object.values(this.groups).forEach(group => {
      let groupDiv = document.createElement('div');
      groupDiv.classList.add('group-card');

      // Create group header with proper class and data attribute
      let groupHeader = document.createElement('h3');
      groupHeader.classList.add('group-header'); // Make sure this class is added
      groupHeader.dataset.groupId = group.id;
      groupHeader.textContent = group.name;
      groupDiv.appendChild(groupHeader);

      group.participants.forEach(participant => {
        const status = this.attendanceData[participant.id] || "present";
        const statusClass = status === "present" && !this.attendanceData[participant.id] ? "" : status;
        const participantRow = document.createElement('div');
        participantRow.classList.add('participant-row');
        participantRow.dataset.participantId = participant.id;
        participantRow.dataset.groupId = group.id;
        participantRow.innerHTML = `
          <span class="participant-name">${participant.first_name} ${participant.last_name}    
            ${participant.is_leader ? `<span class="badge leader">${translate("leader")}</span>` : ''}
            ${participant.is_second_leader ? `<span class="badge second-leader">${translate("second_leader")}</span>` : ''}
          </span>      
          <span class="participant-status ${statusClass}">${translate(status)}</span>
        `;

        groupDiv.appendChild(participantRow);
      });

      fragment.appendChild(groupDiv);
    });

    return fragment;
  }


  renderGuests() {
    return this.guests.map(guest => `
      <div class="guest-row">
        <span class="guest-name">${guest.name}</span>
        <span class="guest-email">${guest.email || translate("no_email")}</span>
        <span class="guest-date">${this.formatDate(guest.attendance_date)}</span>
      </div>
    `).join("");
  }

  attachEventListeners() {
    const dateSelect = document.getElementById("dateSelect");
    if (dateSelect) {
      const newDateSelect = dateSelect.cloneNode(true);
      dateSelect.parentNode.replaceChild(newDateSelect, dateSelect);
      newDateSelect.addEventListener("change", (e) => this.changeDate(e.target.value));
    }

    // Use event delegation with a more specific target check
    const attendanceList = document.getElementById("attendance-list");
    if (attendanceList) {
      attendanceList.addEventListener("click", (e) => {
        const groupHeader = e.target.closest('.group-header');
        const participantRow = e.target.closest('.participant-row');
console.log(groupHeader, participantRow);
        if (groupHeader) {
          this.toggleGroupSelection(groupHeader);
        } else if (participantRow) {
          this.toggleIndividualSelection(participantRow);
        }
      });
    }

    document.querySelectorAll('.status-btn').forEach(button => {
      button.addEventListener('click', (e) => this.updateStatus(e.target.dataset.status));
    });

    const addGuestButton = document.getElementById("addGuestButton");
    if (addGuestButton) {
      addGuestButton.addEventListener("click", () => this.addGuest());
    }
  }


  async handleStatusChange(newStatus) {
    if (!this.selectedParticipant) {
      this.app.showMessage(translate("select_participant"), "error");
      return;
    }

    const participantId = this.selectedParticipant.dataset.id;
    const statusSpan = this.selectedParticipant.querySelector(".participant-status");
    const previousStatus = statusSpan.classList[1];

    try {
      const result = await updateAttendance(participantId, newStatus, this.currentDate, previousStatus);
      if (result.success) {
        // Proceed with updating the UI
        statusSpan.classList.remove(previousStatus);
        statusSpan.classList.add(newStatus);
        statusSpan.textContent = translate(newStatus);

        this.attendanceData[participantId] = newStatus;
        this.app.showMessage(translate("attendance_updated_successfully"), "success");
        // Cache the fetched data for 5 minues
        await setCachedData(`attendance_${this.currentDate}`, {
          participants: this.participants,
          attendanceData: this.attendanceData,
          guests: this.guests,
          groups: this.groups
        },  5 * 60 * 1000); // Cache for 5 minute
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }

    } catch (error) {
      console.error("Error:", error);
      this.app.showMessage(`${translate("error_updating_attendance")}: ${error.message}`, "error");
    }
  }

    // Fix the selection toggle methods
    toggleGroupSelection(header) {
      const groupId = header.dataset.groupId;

      // Remove any existing participant selection
      if (this.selectedParticipant) {
        this.selectedParticipant.classList.remove('selected');
        this.selectedParticipant = null;
      }

      // Handle group selection
      if (this.selectedGroup === groupId) {
        // Deselect current group
        this.selectedGroup = null;
        header.classList.remove('selected');
        document.querySelectorAll(`.participant-row[data-group-id="${groupId}"]`)
          .forEach(row => row.classList.remove('highlighted'));
      } else {
        // Deselect previous group if exists
        if (this.selectedGroup) {
          const previousHeader = document.querySelector(`.group-header[data-group-id="${this.selectedGroup}"]`);
          if (previousHeader) previousHeader.classList.remove('selected');
          document.querySelectorAll(`.participant-row[data-group-id="${this.selectedGroup}"]`)
            .forEach(row => row.classList.remove('highlighted'));
        }

        // Select new group
        this.selectedGroup = groupId;
        header.classList.add('selected');
        document.querySelectorAll(`.participant-row[data-group-id="${groupId}"]`)
          .forEach(row => row.classList.add('highlighted'));
      }
    }

    toggleIndividualSelection(row) {
      // Remove any existing group selection
      if (this.selectedGroup) {
        const groupHeader = document.querySelector(`.group-header[data-group-id="${this.selectedGroup}"]`);
        if (groupHeader) groupHeader.classList.remove('selected');
        document.querySelectorAll(`.participant-row[data-group-id="${this.selectedGroup}"]`)
          .forEach(r => r.classList.remove('highlighted'));
        this.selectedGroup = null;
      }

      // Handle participant selection
      if (this.selectedParticipant === row) {
        this.selectedParticipant = null;
        row.classList.remove('selected');
      } else {
        if (this.selectedParticipant) {
          this.selectedParticipant.classList.remove('selected');
        }
        this.selectedParticipant = row;
        row.classList.add('selected');
      }
    }

  async updateStatus(newStatus) {
    if (this.selectedParticipant) {
      const participantId = this.selectedParticipant.dataset.participantId;
      await this.updateIndividualStatus(participantId, newStatus);
    } else if (this.selectedGroup) {
      await this.updateGroupStatus(this.selectedGroup, newStatus);
    } else {
      this.app.showMessage(translate("no_selection"), "error");
    }
  }


  async updateIndividualStatus(participantId, newStatus) {
    const previousStatus = this.attendanceData[participantId] || 'present'; // Default to present if no status
    const row = document.querySelector(`.participant-row[data-participant-id="${participantId}"]`);
    const statusSpan = row.querySelector(".participant-status");

    // Optimistically update UI immediately
    this.attendanceData[participantId] = newStatus;
    this.updateAttendanceDisplay(participantId, newStatus, previousStatus);

    try {
      // Call the server to update attendance
      const result = await updateAttendance([participantId], newStatus, this.currentDate);

      if (result.success) {
        // Success: Keep the optimistic update
        this.app.showMessage(translate("attendance_updated"), "success");
        // Cache the fetched data for 5 minues
        await setCachedData(`attendance_${this.currentDate}`, {
          participants: this.participants,
          attendanceData: this.attendanceData,
          guests: this.guests,
          groups: this.groups
        },  5 * 60 * 1000); // Cache for 5 minute
      } else {
        // Failure: Rollback the UI change
        this.attendanceData[participantId] = previousStatus;
        this.updateAttendanceDisplay(participantId, previousStatus, newStatus);
        this.app.showMessage(result.message || translate("error_updating_attendance"), "error");
      }
    } catch (error) {
      // Error: Rollback the UI change
      console.error("Error updating attendance:", error);
      this.attendanceData[participantId] = previousStatus;
      this.updateAttendanceDisplay(participantId, previousStatus, newStatus);
      this.app.showMessage(translate("error_updating_attendance"), "error");
    }
  }


  async updateGroupStatus(groupId, newStatus) {
    const participantsToUpdate = this.participants.filter(p => p.group_id == groupId);

    const participantIds = participantsToUpdate.map(p => p.id);

    // Save previous statuses for rollback if necessary
    const previousStatuses = participantIds.reduce((acc, id) => {
      acc[id] = this.attendanceData[id] || 'present';
      return acc;
    }, {});

    // Optimistically update the UI
    participantIds.forEach(id => {
      this.attendanceData[id] = newStatus;
      this.updateAttendanceDisplay(id, newStatus, previousStatuses[id]);
    });

    try {
      const result = await updateAttendance(participantIds, newStatus, this.currentDate);

      if (result.success) {
        this.app.showMessage(translate("group_attendance_updated"), "success");
        // Cache the fetched data for 5 minues
        await setCachedData(`attendance_${this.currentDate}`, {
          participants: this.participants,
          attendanceData: this.attendanceData,
          guests: this.guests,
          groups: this.groups
        },  5 * 60 * 1000); // Cache for 5 minute
      } else {
        // Rollback if server fails
        participantIds.forEach(id => {
          this.attendanceData[id] = previousStatuses[id];
          this.updateAttendanceDisplay(id, previousStatuses[id], newStatus);
        });
        this.app.showMessage(result.message || translate("error_updating_group_attendance"), "error");
      }
    } catch (error) {
      // Rollback on error
      console.error("Error updating group attendance:", error);
      participantIds.forEach(id => {
        this.attendanceData[id] = previousStatuses[id];
        this.updateAttendanceDisplay(id, previousStatuses[id], newStatus);
      });
      this.app.showMessage(translate("error_updating_group_attendance"), "error");
    }
  }


  updateAttendanceDisplay(participantId, newStatus, previousStatus) {
    const row = document.querySelector(`.participant-row[data-participant-id="${participantId}"]`);
    if (row) {
      const statusSpan = row.querySelector(".participant-status");
      statusSpan.classList.remove(`${previousStatus}`);
      statusSpan.classList.add(`${newStatus}`);
      statusSpan.textContent = translate(newStatus);
    }
  }

  

  async changeDate(newDate) {
    this.currentDate = newDate;
    document.getElementById("dateSelect").value = this.currentDate;
    console.log(`Changing date to ${this.currentDate}`);
    await this.preloadAttendanceData();
    this.updateAttendanceUIForDate();
  }

  async loadAttendanceForDate(date) {
    try {
      this.attendanceData = await getAttendance(date);
      this.guests = await this.getGuestsByDate(date);
      this.updateAttendanceUIForDate();
    } catch (error) {
      console.error("Error:", error);
      this.app.showMessage(translate("error_loading_attendance"), "error");
    }
  }

  

  updateAttendanceUIForDate() {
    document.querySelectorAll(".participant-row").forEach((row) => {
      const participantId = row.dataset.id;
      const statusSpan = row.querySelector(".participant-status");
      const status = this.attendanceData[participantId] || "present";
      const statusClass = status === "present" && !this.attendanceData[participantId] ? "" : status;

      statusSpan.className = `participant-status ${statusClass}`;
      statusSpan.textContent = translate(status);
    });

    document.getElementById("guestList").innerHTML = this.renderGuests();
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
      <p>${translate("error_loading_attendance")}</p>
    `;
    document.getElementById("app").innerHTML = errorMessage;
  }

  async addGuest() {
    const guestName = document.getElementById("guestName").value.trim();
    const guestEmail = document.getElementById("guestEmail").value.trim();
    if (guestName === "") {
      this.app.showMessage(translate("guest_name_required"), "error");
      return;
    }

    const guest = {
      name: guestName,
      email: guestEmail,
      attendance_date: this.currentDate
    };

    try {
      await this.saveGuest(guest);
      this.guests.push(guest);
      document.getElementById("guestList").innerHTML = this.renderGuests();
      document.getElementById("guestName").value = "";
      document.getElementById("guestEmail").value = "";
      this.app.showMessage(translate("guest_added_successfully"), "success");
    } catch (error) {
      console.error("Error saving guest:", error);
      this.app.showMessage(translate("error_saving_guest"), "error");
    }
  }
}