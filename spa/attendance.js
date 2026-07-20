import {
  getParticipants,
  getAttendance,
  updateAttendance,
  getAttendanceDates,
  saveGuest,
  getGuestsByDate,
  getApiUrl,
  getAuthHeader,
  getCurrentOrganizationId,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData, deleteCachedData } from "./indexedDB.js";
import { offlineManager } from "./modules/OfflineManager.js";
import { getActivities } from "./api/api-activities.js";
import {
  getActivityStartDate,
  getActivityEndDate,
} from "./utils/ActivityDateUtils.js";
import {
  getTodayISO,
  formatDate,
  isValidDate,
  isoToDateString,
} from "./utils/DateUtils.js";
import { debugLog, debugError } from "./utils/DebugUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { CONFIG } from "./config.js";
import { canViewAttendance } from "./utils/PermissionUtils.js";
import { normalizeParticipantList } from "./utils/ParticipantRoleUtils.js";
import { OptimisticUpdateManager } from "./utils/OptimisticUpdateManager.js";
import { setContent } from "./utils/DOMUtils.js";
import { withButtonLoading, debounce } from "./utils/PerformanceUtils.js";

export class Attendance {
  constructor(app) {
    this.app = app;
    this.currentDate = getTodayISO();
    this.participants = [];
    this.attendanceData = {};
    this.guests = [];
    this.selectedParticipant = null;
    this.availableDates = [];
    this.saveGuest = saveGuest;
    this.getGuestsByDate = getGuestsByDate;
    this.groups = [];
    this.freshContent = ``;
    this.isInitialized = false;
    this.isLoading = true;
    this.searchTerm = '';
    // Multi-day activity (camp) covering the current date, when one exists:
    // { activity, dates: [...], dayIndex }
    this.activeActivity = null;
    // Optimistic update manager for instant attendance updates
    this.optimisticManager = new OptimisticUpdateManager();
  }

  async init() {
    // Check permission
    if (!canViewAttendance()) {
      this.app.router.navigate("/dashboard");
      return;
    }

    try {
      this.renderSkeleton();
      this.isLoading = true;

      // Load all required data
      await Promise.all([
        this.fetchAttendanceDates(),
        this.preloadAttendanceData(),
      ]);

      // Detect whether the current date is part of a multi-day activity (camp)
      await this.detectActivityContext();

      // During a multi-day activity, automatically carry forward attendance
      // from the previous day (works with or without offline camp mode)
      await this.autoCarryForward();

      // Mark as initialized and not loading
      this.isInitialized = true;
      this.isLoading = false;
      // Only render if we're still on the attendance page
      if (document.querySelector(".attendance-container")) {
        this.render();
        this.attachEventListeners();
      }
    } catch (error) {
      debugError("Error initializing attendance:", error);
      this.isLoading = false;
      this.renderError();
    }
  }

  async preloadAttendanceData() {
    try {
      // Check for cached data first (camp-prepared caches use a longer duration)
      const cachedData = await getCachedData(`attendance_${this.currentDate}`);
      if (cachedData) {
        if (offlineManager.isDatePrepared(this.currentDate) || offlineManager.campMode) {
          debugLog("Using camp-prepared attendance data for", this.currentDate);
        }
        this.applyCacheEntry(this.parseAttendanceCacheEntry(cachedData));
        return;
      }
      await this.fetchData();
    } catch (error) {
      debugError("Error preloading attendance data:", error);
      throw error;
    }
  }

  /**
   * Parse any historical attendance cache entry into the canonical shape:
   * { participants, attendanceMap, guests, groups, availableDates }
   *
   * Handles all legacy formats:
   * - optional `{ data: ... }` wrapper
   * - attendance as array of {participant_id, attendance_status} (camp prep)
   *   or map of {participant_id: status}
   * - groups as raw rows (camp prep) or pre-grouped {id, name, participants}
   *
   * @param {Object} cacheEntry - Raw entry from IndexedDB
   * @returns {{participants: Array, attendanceMap: Object, guests: Array, groups: Array, availableDates: Array|null}}
   */
  parseAttendanceCacheEntry(cacheEntry) {
    const data = cacheEntry?.data || cacheEntry || {};

    const participants = normalizeParticipantList(data.participants || []);

    let attendanceMap = {};
    const rawAttendance = data.attendanceData || data.attendanceMap || {};
    if (Array.isArray(rawAttendance)) {
      rawAttendance.forEach((record) => {
        const status = record.attendance_status || record.status;
        if (record.participant_id && status) {
          attendanceMap[record.participant_id] = status;
        }
      });
    } else {
      attendanceMap = { ...rawAttendance };
    }

    let groups;
    if (Array.isArray(data.groups) && data.groups.length > 0 && !data.groups[0]?.participants) {
      // Raw groups (camp prep) - rebuild grouped structure from participants
      groups = this.buildGroupsFromParticipants(participants);
    } else {
      groups = data.groups || [];
    }

    return {
      participants,
      attendanceMap,
      guests: data.guests || [],
      groups,
      availableDates: Array.isArray(data.availableDates) ? data.availableDates : null,
    };
  }

  /**
   * Apply a canonical cache entry to instance state
   */
  applyCacheEntry(entry) {
    this.participants = entry.participants;
    this.attendanceData = entry.attendanceMap;
    this.guests = entry.guests;
    this.groups = entry.groups;
    if (offlineManager.campMode && entry.availableDates) {
      this.availableDates = entry.availableDates;
    }
  }

  /**
   * Persist current state to the per-date cache in the canonical shape.
   * Single write path so every reader sees the same format.
   */
  async writeAttendanceCache(date = this.currentDate) {
    const duration = offlineManager.campMode
      ? (CONFIG.CACHE_DURATION.CAMP_MODE || CONFIG.CACHE_DURATION.SHORT)
      : CONFIG.CACHE_DURATION.SHORT;
    await setCachedData(
      `attendance_${date}`,
      {
        participants: this.participants,
        attendanceData: this.attendanceData,
        guests: this.guests,
        groups: this.groups,
        availableDates: this.availableDates,
      },
      duration,
    );
  }

  /**
   * Group + sort participants into the render structure
   * (leaders first, second leaders last, then alphabetical)
   */
  buildGroupsFromParticipants(participants) {
    const grouped = participants.reduce((acc, participant) => {
      if (!acc[participant.group_id]) {
        acc[participant.group_id] = {
          id: participant.group_id,
          name: participant.group_name,
          participants: [],
        };
      }
      acc[participant.group_id].participants.push(participant);
      return acc;
    }, {});

    Object.values(grouped).forEach((group) => {
      group.participants.sort((a, b) => {
        if (a.first_leader && !b.first_leader) return -1;
        if (!a.first_leader && b.first_leader) return 1;
        if (a.second_leader && !b.second_leader) return 1;
        if (!a.second_leader && b.second_leader) return -1;
        return a.first_name.localeCompare(b.first_name);
      });
    });

    return Object.entries(grouped)
      .map(([id, group]) => ({ id, ...group }))
      .sort((a, b) => {
        if (!a.name) return 1;
        if (!b.name) return -1;
        return a.name.localeCompare(b.name);
      });
  }

  async fetchAttendanceDates() {
    try {
      // In camp mode, check if we have prepared dates
      if (offlineManager.campMode) {
        const preparedActivity = offlineManager.getPreparedActivityForDate(getTodayISO());
        if (preparedActivity && preparedActivity.dates) {
          debugLog("Using camp-prepared dates:", preparedActivity.dates);
          this.availableDates = [...preparedActivity.dates];
          this.finalizeAvailableDates();
          return;
        }
      }

      const response = await getAttendanceDates(); // Call the API
      debugLog("Attendance dates response:", response);
      if (response.success && response.data) {
        debugLog("Raw dates from API:", response.data);
        // Convert ISO dates to YYYY-MM-DD format and filter out invalid dates
        this.availableDates = response.data
          .map((date) => isoToDateString(date)) // Convert ISO to YYYY-MM-DD
          .filter((date) => {
            const valid = isValidDate(date);
            debugLog(`Date ${date} is ${valid ? "valid" : "invalid"}`);
            return valid;
          });
        debugLog("Available dates after filtering:", this.availableDates);
      } else {
        throw new Error(
          "Failed to fetch attendance dates or no dates available.",
        );
      }

      this.finalizeAvailableDates();
      debugLog("Final available dates:", this.availableDates);
    } catch (error) {
      debugError("Error fetching attendance dates:", error);
      throw error;
    }
  }

  /**
   * Sort available dates (newest first), ensure today is present, and default
   * the current date to today. The list may now contain future dates (planned
   * activities), so "first entry" is no longer a safe default.
   */
  finalizeAvailableDates() {
    const today = getTodayISO();
    if (!this.availableDates.includes(today)) {
      this.availableDates.push(today);
    }
    this.availableDates.sort((a, b) => new Date(b) - new Date(a));
    this.currentDate = today;
  }

  async fetchData() {
    try {
      // Check if cached data is available
      const cachedData = await getCachedData(`attendance_${this.currentDate}`);
      if (cachedData) {
        this.applyCacheEntry(this.parseAttendanceCacheEntry(cachedData));
        debugLog("Loaded data from cache");
        return; // No need to proceed if cached data is found
      }

      // Fetch the data if not cached
      const [participantsResponse, attendanceResponse, guestsResponse] =
        await Promise.all([
          getParticipants(),
          getAttendance(this.currentDate),
          this.getGuestsByDate(this.currentDate),
        ]);

      // Support both new format (data) and old format (participants)
      const participantsList =
        participantsResponse.data || participantsResponse.participants;
      if (participantsResponse.success && Array.isArray(participantsList)) {
        this.participants = normalizeParticipantList(participantsList);
      } else {
        throw new Error("Invalid participants data structure");
      }

      // Transform attendance response into a map of participant_id -> status
      // Handle multiple API formats
      this.attendanceData = {};
      if (attendanceResponse && typeof attendanceResponse === "object") {
        const attendanceData = attendanceResponse.data || attendanceResponse;

        if (Array.isArray(attendanceData)) {
          // RESTful API format: {success: true, data: [{participant_id, status, ...}, ...]}
          attendanceData.forEach((record) => {
            if (record.participant_id && record.status) {
              this.attendanceData[record.participant_id] = record.status;
            }
          });
          debugLog(
            `Parsed ${Object.keys(this.attendanceData).length} attendance records`,
          );
        } else if (Array.isArray(attendanceData.participants)) {
          // Legacy Node.js format: {success: true, data: {participants: [{participant_id, attendance_status}, ...]}}
          attendanceData.participants.forEach((p) => {
            if (p.attendance_status) {
              this.attendanceData[p.participant_id] = p.attendance_status;
            }
          });
        } else if (attendanceResponse.success === undefined) {
          // PHP API format: {participant_id: status, ...}
          this.attendanceData = attendanceResponse;
        }
      }
      debugLog("Final attendanceData:", this.attendanceData);

      // Standard envelope: data is the guests array
      this.guests = Array.isArray(guestsResponse)
        ? guestsResponse
        : guestsResponse?.data || guestsResponse?.guests || [];

      // Group and sort participants for rendering
      this.groups = this.buildGroupsFromParticipants(this.participants);

      await this.writeAttendanceCache();
    } catch (error) {
      debugError("Error fetching attendance data:", error);
      throw error;
    }
  }

  /**
   * Detect whether the current date falls inside a multi-day activity (camp).
   * Sets this.activeActivity to { activity, dates, dayIndex } or null.
   * Works from the cached activities list, so it also functions offline as
   * long as activities were loaded at least once.
   */
  async detectActivityContext() {
    this.activeActivity = null;
    try {
      const activities = await getActivities();
      const current = this.currentDate;

      for (const activity of activities) {
        const startDate = getActivityStartDate(activity);
        const endDate = getActivityEndDate(activity);
        if (!startDate || !endDate || startDate === endDate) {
          continue;
        }
        if (current >= startDate && current <= endDate) {
          const dates = this.enumerateDateRange(startDate, endDate);
          this.activeActivity = {
            activity,
            dates,
            dayIndex: dates.indexOf(current),
          };
          debugLog("Multi-day activity context:", activity.name, `day ${this.activeActivity.dayIndex + 1}/${dates.length}`);
          return;
        }
      }
    } catch (error) {
      // Non-critical: attendance works without activity context
      debugError("Could not detect activity context:", error);
    }
  }

  /**
   * List every date (YYYY-MM-DD) from start to end inclusive.
   * Formats from local date components — toISOString() would shift the date
   * across midnight in UTC+ timezones.
   */
  enumerateDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const MAX_DAYS = 31;
    if (isNaN(current) || isNaN(end) || (end - current) / MS_PER_DAY > MAX_DAYS) {
      return [startDate];
    }
    const PAD_LENGTH = 2;
    while (current <= end) {
      const month = String(current.getMonth() + 1).padStart(PAD_LENGTH, "0");
      const day = String(current.getDate()).padStart(PAD_LENGTH, "0");
      dates.push(`${current.getFullYear()}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  /**
   * The dates of the multi-day context the page is currently in:
   * offline-prepared camp dates when camp mode is on, otherwise the
   * detected activity's date range. Null when not in a multi-day context.
   */
  getCampDates() {
    if (offlineManager.campMode) {
      const prepared = offlineManager.getPreparedActivityForDate(this.currentDate);
      if (prepared?.dates?.length) {
        return prepared.dates;
      }
    }
    return this.activeActivity?.dates || null;
  }

  /**
   * Carry forward attendance from the previous day of a multi-day activity.
   * Runs whenever the current date is day 2+ of a camp and has no attendance
   * yet — with or without offline camp mode. Online, the server performs the
   * copy (so it persists); offline, cached data is used and the copy syncs
   * next time the server endpoint is reachable via normal attendance updates.
   */
  async autoCarryForward() {
    const campDates = this.getCampDates();
    if (!campDates) {
      return;
    }

    const hasAttendanceData = Object.keys(this.attendanceData).some(
      id => this.attendanceData[id] && this.attendanceData[id] !== ''
    );
    if (hasAttendanceData) {
      debugLog("Attendance data exists for", this.currentDate, "- no carry-forward needed");
      return;
    }

    const dateIndex = campDates.indexOf(this.currentDate);
    if (dateIndex <= 0) {
      debugLog("No previous day to carry forward from (day 1 of camp or date not in range)");
      return;
    }

    const previousDates = campDates.slice(0, dateIndex);
    const source = navigator.onLine
      ? await this.findCarryForwardSourceOnline(previousDates)
      : await this.findCarryForwardSourceOffline(previousDates);

    if (!source) {
      debugLog("No previous day with attendance data found in camp dates");
      return;
    }

    // Only present/late carry forward: absences should be re-confirmed daily,
    // and this matches what the server-side carry-forward endpoint copies.
    const toCarryForward = {};
    for (const [participantId, status] of Object.entries(source.attendance)) {
      if (status === 'present' || status === 'late') {
        toCarryForward[participantId] = status;
      }
    }

    const carryCount = Object.keys(toCarryForward).length;
    if (carryCount === 0) {
      debugLog("No attendance statuses to carry forward from", source.date);
      return;
    }

    this.attendanceData = { ...toCarryForward };

    this.app.showMessage(
      translate("attendance_carried_forward").replace("{{count}}", carryCount).replace("{{date}}", formatDate(source.date, this.app.lang)),
      "info"
    );

    debugLog(`Carried forward ${carryCount} attendance records from ${source.date}`);

    await this.writeAttendanceCache();

    // Persist server-side so every device sees the carried-forward statuses
    if (navigator.onLine) {
      try {
        const response = await fetch(getApiUrl("v1/attendance/carry-forward"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
            "x-organization-id": getCurrentOrganizationId(),
          },
          body: JSON.stringify({
            fromDate: source.date,
            toDate: this.currentDate
          }),
        });

        if (response.ok) {
          const result = await response.json();
          debugLog("Server carry-forward result:", result);
          await deleteCachedData(`attendance_api_${this.currentDate}`);
        }
      } catch (error) {
        // Non-critical error - local carry-forward still works
        debugError("Failed to sync carry-forward to server:", error);
      }
    }
  }

  /**
   * Find the most recent previous camp date with attendance, from the server.
   * Fetches all candidate dates in parallel and picks the latest with records.
   * @param {string[]} previousDates - Camp dates before the current one (ascending)
   * @returns {Promise<{date: string, attendance: Object}|null>}
   */
  async findCarryForwardSourceOnline(previousDates) {
    try {
      const responses = await Promise.all(
        previousDates.map(async (date) => {
          try {
            const response = await getAttendance(date);
            return { date, response };
          } catch (err) {
            debugError("Could not fetch attendance for", date, err);
            return { date, response: null };
          }
        })
      );

      for (let i = responses.length - 1; i >= 0; i--) {
        const { date, response } = responses[i];
        const records = Array.isArray(response?.data) ? response.data : [];
        if (records.length > 0) {
          const attendance = {};
          records.forEach((record) => {
            const status = record.status || record.attendance_status;
            if (record.participant_id && status) {
              attendance[record.participant_id] = status;
            }
          });
          return { date, attendance };
        }
      }
      return null;
    } catch (error) {
      debugError("Error searching carry-forward source online:", error);
      return null;
    }
  }

  /**
   * Find the most recent previous camp date with attendance, from local caches.
   * @param {string[]} previousDates - Camp dates before the current one (ascending)
   * @returns {Promise<{date: string, attendance: Object}|null>}
   */
  async findCarryForwardSourceOffline(previousDates) {
    const caches = await Promise.all(
      previousDates.map(async (date) => ({
        date,
        cache: await getCachedData(`attendance_${date}`),
      }))
    );

    for (let i = caches.length - 1; i >= 0; i--) {
      const { date, cache } = caches[i];
      if (!cache) continue;
      const { attendanceMap } = this.parseAttendanceCacheEntry(cache);
      const hasData = Object.values(attendanceMap).some(
        status => status === 'present' || status === 'late' || status === 'absent' || status === 'excused'
      );
      if (hasData) {
        return { date, attendance: attendanceMap };
      }
    }
    return null;
  }

  renderSkeleton() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <div class="attendance-container skeleton">
        <div class="date-navigation">
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
    setContent(document.getElementById("app"), content);
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
    if (!document.querySelector(".attendance-container")) {
      return;
    }

    // Don't render if we're still loading
    if (this.isLoading) {
      return;
    }
    this.freshContent = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <div class="attendance-container">
        ${this.renderCampBanner()}
        <div class="date-navigation">
          <select id="dateSelect" class="date-select">
            ${this.renderDateOptions()}
          </select>
        </div>
        <div class="search-container" style="margin-bottom: 1rem;">
          <input type="search" id="attendance-search" class="search-input" style="width: 100%; padding: 0.5rem;" placeholder="${translate("search")}..." value="${escapeHTML(this.searchTerm)}">
        </div>
        ${this.renderMarkRemainingButton()}
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
      setContent(appElement, this.freshContent);
      const attendanceList = document.getElementById("attendance-list");
      if (attendanceList) {
        setContent(attendanceList, "");
        attendanceList.appendChild(this.renderGroupsAndNames());
      }
    }
  }

  /**
   * Banner shown while the selected date is part of a multi-day activity
   */
  renderCampBanner() {
    if (!this.activeActivity) {
      return "";
    }
    const { activity, dates, dayIndex } = this.activeActivity;
    const dayLabel = translate("camp_day_of")
      .replace("{{day}}", dayIndex + 1)
      .replace("{{total}}", dates.length);
    return `
      <div class="camp-banner">
        <span class="camp-banner__icon">🏕️</span>
        <span class="camp-banner__name">${escapeHTML(activity.name)}</span>
        <span class="camp-banner__day">${dayLabel}</span>
      </div>
    `;
  }

  /**
   * Bulk action to mark everyone without a recorded status as present
   */
  renderMarkRemainingButton() {
    const unmarkedCount = this.getUnmarkedParticipantIds().length;
    if (unmarkedCount === 0) {
      return "";
    }
    return `
      <button id="mark-remaining-present" class="button button--secondary mark-remaining-btn">
        ${translate("mark_remaining_present").replace("{{count}}", unmarkedCount)}
      </button>
    `;
  }

  getUnmarkedParticipantIds() {
    return this.participants
      .filter((p) => !this.attendanceData[p.id])
      .map((p) => p.id);
  }

  renderDateOptions() {
    debugLog("Rendering date options. Available dates:", this.availableDates);
    debugLog("Current date:", this.currentDate);
    debugLog("App language:", this.app.lang);
    const options = this.availableDates
      .map((date) => {
        const formatted = formatDate(date, this.app.lang);
        debugLog(`Date ${date} formatted as: ${formatted}`);
        return `<option value="${date}" ${date === this.currentDate ? "selected" : ""}>
        ${formatted}
      </option>`;
      })
      .join("");
    debugLog("Final options HTML:", options);
    return options;
  }

  renderGroupsAndNames() {
    const fragment = document.createDocumentFragment();
    const term = this.searchTerm.toLowerCase();

    Object.values(this.groups).forEach((group) => {
      // Filter participants if search term exists
      const filteredParticipants = group.participants.filter(p => {
        if (!term) return true;
        const name = `${p.first_name} ${p.last_name}`.toLowerCase();
        return name.includes(term);
      });

      if (filteredParticipants.length === 0) return;

      let groupDiv = document.createElement("div");
      groupDiv.classList.add("group-card");

      // Create group header with proper class and data attribute
      let groupHeader = document.createElement("h3");
      groupHeader.classList.add("group-header"); // Make sure this class is added
      groupHeader.dataset.groupId = group.id;
      groupHeader.textContent = group.name;
      groupDiv.appendChild(groupHeader);



      filteredParticipants.forEach((participant) => {
        // No fake default: a participant with no recorded status shows as
        // "unmarked" so what the leader sees matches what is persisted
        const recordedStatus = this.attendanceData[participant.id] || null;
        const status = recordedStatus || "unmarked";
        const statusClass = recordedStatus || "unmarked";
        const participantRow = document.createElement("div");
        participantRow.classList.add("participant-row");
        participantRow.dataset.participantId = participant.id;
        participantRow.dataset.groupId = group.id;
        setContent(
          participantRow,
          `
          <span class="participant-name">${participant.first_name} ${participant.last_name}    
            ${participant.first_leader ? `<span class="badge leader">${translate("first_leader")}</span>` : ""}
            ${participant.second_leader ? `<span class="badge second-leader">${translate("second_leader")}</span>` : ""}
          </span>      
          <span class="participant-status ${statusClass}">${translate(status)}</span>
        `,
        );
        groupDiv.appendChild(participantRow);
      });

      fragment.appendChild(groupDiv);
    });

    return fragment;
  }

  renderGuests() {
    return this.guests
      .map(
        (guest) => `
      <div class="guest-row">
        <span class="guest-name">${escapeHTML(guest.name)}</span>
        <span class="guest-email">${escapeHTML(guest.email || translate("no_email"))}</span>
        <span class="guest-date">${formatDate(guest.attendance_date, this.app.lang)}</span>
      </div>
    `,
      )
      .join("");
  }

  attachEventListeners() {
    const dateSelect = document.getElementById("dateSelect");
    if (dateSelect) {
      const newDateSelect = dateSelect.cloneNode(true);
      dateSelect.parentNode.replaceChild(newDateSelect, dateSelect);
      newDateSelect.addEventListener("change", (e) =>
        this.changeDate(e.target.value),
      );
    }

    // Use event delegation with a more specific target check
    const attendanceList = document.getElementById("attendance-list");
    if (attendanceList) {
      attendanceList.addEventListener("click", (e) => {
        const groupHeader = e.target.closest(".group-header");
        const participantRow = e.target.closest(".participant-row");
        debugLog(groupHeader, participantRow);
        if (groupHeader) {
          this.toggleGroupSelection(groupHeader);
        } else if (participantRow) {
          this.toggleIndividualSelection(participantRow);
        }
      });
    }

    document.querySelectorAll(".status-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        withButtonLoading(e.target, () => this.updateStatus(e.target.dataset.status));
      });
    });

    const addGuestButton = document.getElementById("addGuestButton");
    if (addGuestButton) {
      addGuestButton.addEventListener("click", (e) => {
        withButtonLoading(e.target, () => this.addGuest());
      });
    }

    const markRemainingButton = document.getElementById("mark-remaining-present");
    if (markRemainingButton) {
      markRemainingButton.addEventListener("click", (e) => {
        withButtonLoading(e.target, () => this.markAllRemainingPresent());
      });
    }

    // Search listener
    const searchInput = document.getElementById('attendance-search');
    if (searchInput) {
      searchInput.addEventListener('input', debounce((e) => {
        this.searchTerm = e.target.value;
        // Re-render only list
        this.render(); // This re-renders whole content including search input
        this.attachEventListeners();
        // Restore focus
        const newInput = document.getElementById('attendance-search');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, 300));
    }
  }

  // Fix the selection toggle methods
  toggleGroupSelection(header) {
    const groupId = header.dataset.groupId;

    // Remove any existing participant selection
    if (this.selectedParticipant) {
      this.selectedParticipant.classList.remove("selected");
      this.selectedParticipant = null;
    }

    // Handle group selection
    if (this.selectedGroup === groupId) {
      // Deselect current group
      this.selectedGroup = null;
      header.classList.remove("selected");
      document
        .querySelectorAll(`.participant-row[data-group-id="${groupId}"]`)
        .forEach((row) => row.classList.remove("highlighted"));
    } else {
      // Deselect previous group if exists
      if (this.selectedGroup) {
        const previousHeader = document.querySelector(
          `.group-header[data-group-id="${this.selectedGroup}"]`,
        );
        if (previousHeader) previousHeader.classList.remove("selected");
        document
          .querySelectorAll(
            `.participant-row[data-group-id="${this.selectedGroup}"]`,
          )
          .forEach((row) => row.classList.remove("highlighted"));
      }

      // Select new group
      this.selectedGroup = groupId;
      header.classList.add("selected");
      document
        .querySelectorAll(`.participant-row[data-group-id="${groupId}"]`)
        .forEach((row) => row.classList.add("highlighted"));
    }
  }

  toggleIndividualSelection(row) {
    // Remove any existing group selection
    if (this.selectedGroup) {
      const groupHeader = document.querySelector(
        `.group-header[data-group-id="${this.selectedGroup}"]`,
      );
      if (groupHeader) groupHeader.classList.remove("selected");
      document
        .querySelectorAll(
          `.participant-row[data-group-id="${this.selectedGroup}"]`,
        )
        .forEach((r) => r.classList.remove("highlighted"));
      this.selectedGroup = null;
    }

    // Handle participant selection
    if (this.selectedParticipant === row) {
      this.selectedParticipant = null;
      row.classList.remove("selected");
    } else {
      if (this.selectedParticipant) {
        this.selectedParticipant.classList.remove("selected");
      }
      this.selectedParticipant = row;
      row.classList.add("selected");
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
    // Recorded status or null — never a guessed default. The server derives
    // the point-adjustment baseline from its own records anyway.
    const previousStatus = this.attendanceData[participantId] || null;

    await this.optimisticManager.execute(
      `attendance-${participantId}-${this.currentDate}`,
      {
        optimisticFn: () => {
          // Update data and UI immediately
          this.attendanceData[participantId] = newStatus;
          this.updateAttendanceDisplay(
            participantId,
            newStatus,
            previousStatus,
          );

          return { previousStatus };
        },

        apiFn: async () => {
          // Make actual API call in background
          return await updateAttendance(
            participantId,
            newStatus,
            this.currentDate,
            previousStatus,
          );
        },

        successFn: async (result) => {
          // Handle offline queued state
          if (result.queued) {
            return; // Keep optimistic state
          }

          // Success: Update cache with new data
          this.app.showMessage(translate("attendance_updated"), "success");
          // Clear API-level cache to ensure fresh data on next fetch
          await deleteCachedData(`attendance_api_${this.currentDate}`);
          // Update UI-level cache with current data
          await this.writeAttendanceCache();
        },

        rollbackFn: ({ previousStatus }, error) => {
          // Rollback to original state on error
          this.attendanceData[participantId] = previousStatus;
          this.updateAttendanceDisplay(
            participantId,
            previousStatus,
            newStatus,
          );
          debugError("Error updating attendance:", error);
          this.app.showMessage(
            error.message || translate("error_updating_attendance"),
            "error",
          );
        },
      },
    );
  }

  async updateGroupStatus(groupId, newStatus) {
    const participantsToUpdate = this.participants.filter(
      (p) => p.group_id == groupId,
    );

    const participantIds = participantsToUpdate.map((p) => p.id);

    // Save recorded previous statuses (null when unmarked) for rollback.
    // Never assume "present": a wrong baseline used to generate phantom
    // point adjustments server-side.
    const previousStatuses = participantIds.reduce((acc, id) => {
      acc[id] = this.attendanceData[id] || null;
      return acc;
    }, {});

    // Optimistically update the UI
    participantIds.forEach((id) => {
      this.attendanceData[id] = newStatus;
      this.updateAttendanceDisplay(id, newStatus, previousStatuses[id]);
    });

    try {
      // Call the API for each participant individually
      const results = await Promise.all(
        participantIds.map((id) =>
          updateAttendance(
            id,
            newStatus,
            this.currentDate,
            previousStatuses[id],
          ),
        ),
      );

      // Check if all updates succeeded
      const allSucceeded = results.every((result) => result.success);

      if (allSucceeded) {
        this.app.showMessage(translate("group_attendance_updated"), "success");
        // Clear API-level cache to ensure fresh data on next fetch
        await deleteCachedData(`attendance_api_${this.currentDate}`);
        // Update UI-level cache with current data
        await this.writeAttendanceCache();
      } else {
        // Rollback failed updates
        results.forEach((result, index) => {
          if (!result.success) {
            const id = participantIds[index];
            this.attendanceData[id] = previousStatuses[id];
            this.updateAttendanceDisplay(id, previousStatuses[id], newStatus);
          }
        });
        this.app.showMessage(
          translate("error_updating_group_attendance"),
          "error",
        );
      }
    } catch (error) {
      // Rollback on error
      debugError("Error updating group attendance:", error);
      participantIds.forEach((id) => {
        this.attendanceData[id] = previousStatuses[id];
        this.updateAttendanceDisplay(id, previousStatuses[id], newStatus);
      });
      this.app.showMessage(
        translate("error_updating_group_attendance"),
        "error",
      );
    }
  }

  /**
   * Mark every participant without a recorded status as present.
   * One-tap replacement for the old implicit "everyone defaults to present"
   * display, but actually persisted.
   */
  async markAllRemainingPresent() {
    const unmarkedIds = this.getUnmarkedParticipantIds();
    if (unmarkedIds.length === 0) {
      return;
    }

    // Optimistically mark all as present
    unmarkedIds.forEach((id) => {
      this.attendanceData[id] = "present";
      this.updateAttendanceDisplay(id, "present", null);
    });

    try {
      const results = await Promise.all(
        unmarkedIds.map((id) =>
          updateAttendance(id, "present", this.currentDate, null),
        ),
      );

      const failedIds = unmarkedIds.filter((_, index) => !results[index].success && !results[index].queued);
      if (failedIds.length === 0) {
        this.app.showMessage(translate("attendance_updated"), "success");
      } else {
        failedIds.forEach((id) => {
          delete this.attendanceData[id];
          this.updateAttendanceDisplay(id, null, "present");
        });
        this.app.showMessage(translate("error_updating_attendance"), "error");
      }
      await deleteCachedData(`attendance_api_${this.currentDate}`);
      await this.writeAttendanceCache();
    } catch (error) {
      debugError("Error marking remaining present:", error);
      unmarkedIds.forEach((id) => {
        delete this.attendanceData[id];
        this.updateAttendanceDisplay(id, null, "present");
      });
      this.app.showMessage(translate("error_updating_attendance"), "error");
    }
  }

  updateAttendanceDisplay(participantId, newStatus, previousStatus) {
    const row = document.querySelector(
      `.participant-row[data-participant-id="${participantId}"]`,
    );
    if (row) {
      const statusSpan = row.querySelector(".participant-status");
      statusSpan.classList.remove(previousStatus || "unmarked");
      statusSpan.classList.add(newStatus || "unmarked");
      statusSpan.textContent = translate(newStatus || "unmarked");
    }
    this.refreshMarkRemainingButton();
  }

  /**
   * Keep the "mark remaining present" button count in sync without a full render
   */
  refreshMarkRemainingButton() {
    const button = document.getElementById("mark-remaining-present");
    const unmarkedCount = this.getUnmarkedParticipantIds().length;
    if (button) {
      if (unmarkedCount === 0) {
        button.remove();
      } else {
        button.textContent = translate("mark_remaining_present").replace("{{count}}", unmarkedCount);
      }
    }
  }

  async changeDate(newDate) {
    this.currentDate = newDate;
    debugLog(`Changing date to ${this.currentDate}`);

    // In camp mode, preserve camp-prepared cache and use it
    if (offlineManager.campMode && offlineManager.isDatePrepared(newDate)) {
      debugLog(`Camp mode: Loading prepared data for ${newDate}`);
      await this.preloadAttendanceData();
    } else {
      // Normal mode: clear caches and fetch fresh
      try {
        await deleteCachedData(`attendance_${this.currentDate}`);
        await deleteCachedData(`attendance_api_${this.currentDate}`);
        debugLog(`Cleared caches for attendance_${this.currentDate}`);
      } catch (e) {
        debugLog(`No cache to clear for attendance_${this.currentDate}`);
      }
      await this.fetchData();
    }

    // The activity context (camp banner, carry-forward source dates)
    // depends on the selected date
    await this.detectActivityContext();
    await this.autoCarryForward();

    // Re-render the entire view with new data
    this.render();
    // Re-attach event listeners
    this.attachEventListeners();
  }

  renderError() {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${translate("error_loading_attendance")}</p>
    `;
    setContent(document.getElementById("app"), errorMessage);
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
      attendance_date: this.currentDate,
    };

    try {
      await this.saveGuest(guest);
      this.guests.push(guest);
      setContent(document.getElementById("guestList"), this.renderGuests());
      document.getElementById("guestName").value = "";
      document.getElementById("guestEmail").value = "";
      this.app.showMessage(translate("guest_added_successfully"), "success");
    } catch (error) {
      debugError("Error saving guest:", error);
      this.app.showMessage(translate("error_saving_guest"), "error");
    }
  }
}
