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
      this.participants = await getParticipants();
      this.attendanceData = await getAttendance(this.currentDate);
      this.guests = await this.getGuestsByDate(this.currentDate);
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
    let currentGroup = null;

    this.participants.forEach((participant) => {
      if (currentGroup !== participant.group_id) {
        if (currentGroup !== null) {
          html += "</div>";
        }
        currentGroup = participant.group_id;
        html += `<div class="group-card"><h3>${participant.group_name}</h3>`;
      }

      const status = this.attendanceData[participant.id] || "present";
      const statusClass = status === "present" && !this.attendanceData[participant.id] ? "gray" : "present";

      html += `
        <div class="participant-row" data-id="${participant.id}">
          <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
          <span class="participant-status ${status} ${statusClass}">${translate(status)}</span>
        </div>
      `;
    });

    if (currentGroup !== null) {
      html += "</div>";
    }

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
      alert(translate("select_participant"));
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

        let pointAdjustment = 0;
        if (previousStatus !== "absent" && newStatus === "absent") {
          pointAdjustment = -1;
        } else if (previousStatus === "absent" && newStatus !== "absent") {
          pointAdjustment = 1;
        }

        if (pointAdjustment !== 0) {
          this.updatePointsUI(participantId, pointAdjustment);
        }

        console.log(`Status changed from ${previousStatus} to ${newStatus}. Point adjustment: ${pointAdjustment}`);
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error:", error);
      alert(`${translate("error_updating_attendance")}: ${error.message}`);
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
      alert(translate("error_loading_attendance"));
    }
  }

  updateAttendanceUIForDate() {
    document.querySelectorAll(".participant-row").forEach((row) => {
      const participantId = row.dataset.id;
      const statusSpan = row.querySelector(".participant-status");
      const status = this.attendanceData[participantId] || "present";
      const statusClass = status === "present" && !this.attendanceData[participantId] ? "gray" : "present";

      statusSpan.className = `participant-status ${status} ${statusClass}`;
      statusSpan.textContent = translate(status);
    });

    document.getElementById("guestList").innerHTML = this.renderGuests();
  }

  updatePointsUI(participantId, pointAdjustment) {
    console.log(`Points updated for ${participantId}: ${pointAdjustment}`);
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
      alert(translate("guest_name_required"));
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
    } catch (error) {
      console.error("Error saving guest:", error);
      alert(translate("error_saving_guest"));
    }
  }
}