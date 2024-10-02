import {
  getParticipants,
  getAttendance,
  updateAttendance,
  getAttendanceDates,
  saveGuest,
  getGuestsByDate
} from "./ajax-functions.js";
import { translate } from "./app.js";

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
  }

  async init() {
    try {
      await this.fetchAttendanceDates();
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing attendance:", error);
      this.renderError();
    }
  }

  async fetchAttendanceDates() {
    try {
      this.availableDates = await getAttendanceDates();
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
      const participantsResponse = await getParticipants();
      if (participantsResponse.success && Array.isArray(participantsResponse.participants)) {
        this.participants = participantsResponse.participants;
      } else {
        throw new Error("Invalid participants data structure");
      }

      this.attendanceData = await getAttendance(this.currentDate);
      this.guests = await this.getGuestsByDate(this.currentDate);

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
    } catch (error) {
      console.error("Error fetching attendance data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <div class="attendance-container">
        <div class="date-navigation fixed-header">
          <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
          <select id="dateSelect" class="date-select">
            ${this.renderDateOptions()}
          </select>
        </div>
        <div id="attendance-list" class="attendance-list">
          ${this.renderGroupsAndNames()}
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
    document.getElementById("app").innerHTML = content;
  }

  renderDateOptions() {
    return this.availableDates
      .map(date => `<option value="${date}" ${date === this.currentDate ? "selected" : ""}>
        ${this.formatDate(date)}
      </option>`)
      .join("");
  }

  renderGroupsAndNames() {
    let html = "";
    Object.values(this.groups).forEach(group => {
      html += `<div class="group-card"><h3>${group.name}</h3>`;
      group.participants.forEach(participant => {
        const status = this.attendanceData[participant.id] || "present";
        const statusClass = status === "present" && !this.attendanceData[participant.id] ? "gray" : status;
        html += `
          <div class="participant-row" data-id="${participant.id}">
            <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
            <span class="participant-status ${statusClass}">${translate(status)}</span>
          </div>
        `;
      });
      html += "</div>";
    });
    return html;
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
    document.getElementById("dateSelect").addEventListener("change", (e) => this.changeDate(e.target.value));

    const participantList = document.getElementById("attendance-list");
    participantList.addEventListener("click", (e) => {
      const participantRow = e.target.closest(".participant-row");
      if (participantRow) {
        this.selectParticipant(participantRow);
      }
    });

    const statusButtonsContainer = document.querySelector(".status-buttons");
    statusButtonsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("status-btn")) {
        this.handleStatusChange(e.target.dataset.status);
      }
    });

    document.getElementById("addGuestButton").addEventListener("click", () => this.addGuest());
  }

  selectParticipant(row) {
    if (this.selectedParticipant) {
      this.selectedParticipant.classList.remove("selected");
    }
    row.classList.add("selected");
    this.selectedParticipant = row;
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
      if (result.status === "success") {
        statusSpan.classList.remove(previousStatus);
        statusSpan.classList.add(newStatus);
        statusSpan.textContent = translate(newStatus);

        this.attendanceData[participantId] = newStatus;

        this.app.showMessage(translate("attendance_updated_successfully"), "success");
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error:", error);
      this.app.showMessage(`${translate("error_updating_attendance")}: ${error.message}`, "error");
    }
  }

  async changeDate(newDate) {
    this.currentDate = newDate;
    document.getElementById("dateSelect").value = this.currentDate;
    console.log(`Changing date to ${this.currentDate}`);
    await this.loadAttendanceForDate(this.currentDate);
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
      const statusClass = status === "present" && !this.attendanceData[participantId] ? "gray" : status;

      statusSpan.className = `participant-status ${statusClass}`;
      statusSpan.textContent = translate(status);
    });

    document.getElementById("guestList").innerHTML = this.renderGuests();
  }

  formatDate(dateString) {
    const options = { day: "numeric", month: "short", year: "numeric", timeZone: "America/Toronto" };
    const localDate = new Date(dateString + "T00:00:00");
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