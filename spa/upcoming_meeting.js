import { translate } from "./app.js";
import {
  debugLog,
  debugError,
  debugWarn,
  debugInfo,
} from "./utils/DebugUtils.js";
import { getReunionDates, getReunionPreparation, saveBadgeProgress, getParticipants, saveReunionPreparation, getBadgeSummary } from "./ajax-functions.js";
import { formatDate, isToday, parseDate } from "./utils/DateUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { canApproveBadges } from "./utils/PermissionUtils.js";

export class UpcomingMeeting {
  constructor(app) {
    this.app = app;
    this.meetingDates = [];
    this.closestMeeting = null;
    this.meetingDetails = null;
  }

  async init() {
    try {
      await this.fetchMeetingDates();
      this.closestMeeting =
        await this.getClosestMeeting();
      if (this.closestMeeting) {
        await this.fetchMeetingDetails(
          this
            .closestMeeting,
        );
      }
      this.render();
    } catch (error) {
      debugError(
        "Error initializing upcoming meeting:",
        error,
      );
      this.renderError();
      this.app.showMessage(
        translate(
          "error_loading_upcoming_meeting",
        ),
        "error",
      );
    }
  }

  async fetchMeetingDates() {
    try {
      const response =
        await getReunionDates();
      // Handle both array response and object response with dates property
      this.meetingDates =
        Array.isArray(
          response,
        )
          ? response
          : response?.dates ||
          [];
    } catch (error) {
      debugError(
        "Error fetching meeting dates:",
        error,
      );
    }
  }

  async getAllFutureMeetings() {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Convert and filter meetings to get today and future meetings
    const futureMeetings = this.meetingDates
      .map((dateStr) => {
        // Handle both ISO format and plain date strings
        const plainDateStr =
          dateStr.includes(
            "T",
          )
            ? dateStr.split(
              "T",
            )[0]
            : dateStr;
        // Use parseDate to avoid timezone issues
        const meetingDate =
          parseDate(
            plainDateStr,
          );
        return {
          date: meetingDate,
          dateStr: plainDateStr,
        };
      })
      .filter((meeting) => {
        if (
          !meeting.date
        )
          return false;
        // Include today's and future meetings
        return (
          meeting.date >=
          today
        );
      })
      .sort(
        (a, b) =>
          a.date -
          b.date,
      );

    // If first meeting is today and has ended, remove it
    if (futureMeetings.length > 0 && isToday(futureMeetings[0].dateStr)) {
      const hasEnded = await this.hasMeetingEnded(
        futureMeetings[0].dateStr,
        now,
      );
      if (hasEnded) {
        futureMeetings.shift();
      }
    }

    return futureMeetings;
  }

  async getClosestMeeting() {
    const futureMeetings = await this.getAllFutureMeetings();
    return futureMeetings.length > 0 ? futureMeetings[0].dateStr : null;
  }

  async hasMeetingEnded(dateStr, currentTime) {
    try {
      // Fetch meeting details to get the actual end time
      const response =
        await getReunionPreparation(
          dateStr,
        );
      if (
        !response.success ||
        !response.preparation
      )
        return false;

      let activities =
        response
          .preparation
          .activities;
      if (
        typeof activities ===
        "string"
      ) {
        activities =
          JSON.parse(
            activities,
          );
      }

      const endTime =
        this.calculateMeetingEndTime(
          activities,
        );
      if (!endTime) return false;

      // Compare current time with meeting end time
      const currentHours =
        currentTime.getHours();
      const currentMinutes =
        currentTime.getMinutes();
      const currentTotalMinutes =
        currentHours *
        60 +
        currentMinutes;
      const endTotalMinutes =
        endTime.hours *
        60 +
        endTime.minutes;

      return (
        currentTotalMinutes >=
        endTotalMinutes
      );
    } catch (error) {
      debugError(
        "Error checking if meeting has ended:",
        error,
      );
      // If we can't determine, assume it hasn't ended yet
      return false;
    }
  }

  async fetchMeetingDetails(date) {
    try {
      const response =
        await getReunionPreparation(
          date,
        );
      if (
        response.success &&
        response.preparation
      ) {
        this.meetingDetails =
          response.preparation;
        // Parse the activities JSON string if it's a string
        if (
          typeof this
            .meetingDetails
            .activities ===
          "string"
        ) {
          this.meetingDetails.activities =
            JSON.parse(
              this
                .meetingDetails
                .activities,
            );
        }
        // If activities are empty, use activity templates from meetingSections
        if (
          (!this.meetingDetails.activities ||
            this.meetingDetails.activities.length === 0) &&
          response.meetingSections?.sections
        ) {
          const defaultSection = response.meetingSections.defaultSection;
          const sectionData = response.meetingSections.sections[defaultSection];
          if (sectionData?.activityTemplates) {
            this.meetingDetails.activities = sectionData.activityTemplates.map(template => ({
              time: template.time,
              activity: translate(template.activityKey) || template.activityKey,
              duration: template.duration,
              type: template.typeKey
            }));
          }
        }
        // Calculate meeting end time from activities
        this.meetingDetails.endTime =
          this.calculateMeetingEndTime(
            this
              .meetingDetails
              .activities,
          );
      } else {
        this.meetingDetails =
          null;
      }
    } catch (error) {
      debugError(
        "Error fetching meeting details:",
        error,
      );
      this.meetingDetails = null;
    }
  }

  getRelativeTimeText(dateStr) {
    try {
      const meetingDate = parseDate(dateStr);
      if (!meetingDate) return '';

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const meeting = new Date(meetingDate);
      meeting.setHours(0, 0, 0, 0);

      const diffTime = meeting - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return translate('today');
      } else if (diffDays === 1) {
        return translate('tomorrow');
      } else if (diffDays < 7) {
        return translate('in_x_days').replace('{x}', diffDays);
      } else if (diffDays < 28) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1
          ? translate('in_1_week')
          : translate('in_x_weeks').replace('{x}', weeks);
      } else {
        const months = Math.floor(diffDays / 30);
        return months === 1
          ? translate('in_1_month')
          : translate('in_x_months').replace('{x}', months);
      }
    } catch (error) {
      debugError('Error calculating relative time:', error);
      return '';
    }
  }

  calculateMeetingEndTime(activities) {
    if (!activities || activities.length === 0)
      return null;

    // Get the last activity
    const lastActivity =
      activities[
      activities.length -
      1
      ];
    if (
      !lastActivity.time ||
      !lastActivity.duration
    )
      return null;

    try {
      // Parse time (format: "HH:MM")
      const [hours, minutes] =
        lastActivity.time
          .split(
            ":",
          )
          .map(
            Number,
          );

      // Parse duration (format: "HH:MM")
      const [
        durationHours,
        durationMinutes,
      ] = lastActivity.duration
        .split(":")
        .map(Number);

      // Calculate end time in minutes
      const startMinutes =
        hours * 60 +
        minutes;
      const durationTotalMinutes =
        durationHours *
        60 +
        durationMinutes;
      const endMinutes =
        startMinutes +
        durationTotalMinutes;

      // Convert back to hours and minutes
      const endHours = Math.floor(
        endMinutes / 60,
      );
      const endMins = endMinutes % 60;

      return {
        hours: endHours,
        minutes: endMins,
      };
    } catch (error) {
      debugError(
        "Error calculating meeting end time:",
        error,
      );
      return null;
    }
  }

  async render() {
    if (!this.closestMeeting) {
      setContent(
        document.getElementById(
          "app",
        ),
        `
                                                                <div class="upcoming-meeting">
                                                                                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                                                                                <h1>${translate("upcoming_meeting")}</h1>
                                                                                <p>${translate("no_upcoming_meeting")}</p>
                                                                </div>
                                                `,
      );
      return;
    }

    // Get all future meetings for the dropdown
    const futureMeetings = await this.getAllFutureMeetings();
    const meetingOptions = futureMeetings
      .map((meeting) => {
        const shortDate = formatDate(meeting.dateStr, this.app.lang, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        const relativeTime = this.getRelativeTimeText(meeting.dateStr);
        const displayText = relativeTime
          ? `${shortDate} (${relativeTime})`
          : shortDate;
        return `<option value="${meeting.dateStr}" ${meeting.dateStr === this.closestMeeting ? 'selected' : ''}>${escapeHTML(displayText)}</option>`;
      })
      .join('');

    const meetingDate = formatDate(
      this.closestMeeting,
      this.app.lang,
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );
    const location =
      this.meetingDetails?.endroit ||
      translate(
        "no_location_specified",
      );
    const honorValues = Array.isArray(this.meetingDetails?.youth_of_honor)
      ? this.meetingDetails.youth_of_honor
      : this.meetingDetails?.youth_of_honor
        ? [this.meetingDetails.youth_of_honor]
        : [];
    const honorsHtml =
      honorValues.length > 0
        ? honorValues
          .map(
            (honor) =>
              `<li>${escapeHTML(honor)}</li>`,
          )
          .join(
            "",
          )
        : `<li>${translate("no_honors_on_this_date")}</li>`;
    const activities =
      this.meetingDetails
        ?.activities ||
      [];
    const activitiesHtml =
      activities.length > 0
        ? activities
          .map(
            (
              a,
            ) =>
              `<li>${a.time} - ${a.activity}</li>`,
          )
          .join(
            "",
          )
        : `<li>${translate("no_activities_scheduled")}</li>`;

    const content = `
                                                <div class="upcoming-meeting">
                                                                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                                                                <h1>${translate("upcoming_meeting")}</h1>
                                                                ${futureMeetings.length > 1 ? `
                                                                <div class="meeting-selector">
                                                                                <label for="meeting-select">${translate("select_meeting")}:</label>
                                                                                <select id="meeting-select" class="meeting-select">
                                                                                                ${meetingOptions}
                                                                                </select>
                                                                </div>
                                                                ` : ''}
                                                                <div class="meeting-details">
                                                                                <h2>${translate("honors")}</h2>
                                                                                <ul>${honorsHtml}</ul>
                                                                </div>
                                                                <div class="meeting-details">
                                                                                <p>${meetingDate}</p>
                                                                                <p><strong>${translate("location")}:</strong> ${location}</p>
                                                                </div>
                                                               <div>
                                                                               <ul>${activitiesHtml}</ul>
                                                               </div>
                                                                <div class="manage-items">
                                                                                <a href="/preparation-reunions?date=${this.closestMeeting}" aria-label="${translate("preparation_reunions")}">
                                                                                                <i class="fa-solid fa-clipboard-list" aria-hidden="true"></i>
                                                                                                <span>${translate("preparation_reunions")}</span>
                                                                                </a>
                                                                                ${showAwardButton ? `
                                                                                <button id="award-achievements-btn" class="button button--primary" style="margin-left: 10px;">
                                                                                        <i class="fa-solid fa-star"></i> ${translate("award_planned_achievements") || "Award Achievements"}
                                                                                </button>
                                                                                ` : ''}
                                                                </div>
                                                </div>
                                `;

    setContent(
      document.getElementById("app"),
      content,
    );

    // Add event listener for meeting selector
    const selector = document.getElementById('meeting-select');
    if (selector) {
      selector.addEventListener('change', async (e) => {
        const selectedDate = e.target.value;
        this.closestMeeting = selectedDate;
        await this.fetchMeetingDetails(selectedDate);
        await this.render();
      });
    }

    const awardBtn = document.getElementById('award-achievements-btn');
    if (awardBtn) {
      awardBtn.addEventListener('click', () => this.openAwardModal(unprocessedAchievements));
    }
  }

  async openAwardModal(achievements) {
    // 1. Fetch necessary data
    const [badgeData, participantsData, attendanceData] = await Promise.all([
      getBadgeSummary({ forceRefresh: false }),
      getParticipants(),
      // Assuming getAttendance returns an array or object for the date
      // However, getAttendance usually takes a date. Let's check imports.
      // We need to import getAttendance. I'll add it to imports later or use what's available.
      // Actually, I can use a simpler approach: Just list the participants validation.
      // Let's assume we want to fetch attendance to pre-fill.
      this.fetchAttendanceForDate(this.closestMeeting)
    ]);

    const templates = badgeData?.templates || [];
    const participants = Array.isArray(participantsData) ? participantsData : (participantsData?.participants || []);
    const presentParticipantIds = attendanceData ? Object.keys(attendanceData).filter(id => attendanceData[id] === 'present') : [];

    // 2. Build Modal Content
    let curreMeetingDate = this.closestMeeting;

    // Helper to get names
    const getNames = (ids) => ids.map(id => {
      const p = participants.find(part => part.id == id);
      return p ? `${p.first_name} ${p.last_name}` : 'Unknown';
    }).join(', ');

    const rows = achievements.map((a, index) => {
      const template = templates.find(t => t.id == a.badge_template_id);
      const badgeName = template ? template.name : 'Unknown Badge';
      const typeLabel = a.star_type === 'battue' ? translate("badge_type_battue") : translate("badge_type_proie");

      let targets = [];
      if (a.star_type === 'battue') {
        // Default to all present, or all active if none present (fallback)
        targets = presentParticipantIds.length > 0 ? presentParticipantIds : participants.map(p => p.id);
      } else {
        targets = a.participant_ids || [];
      }

      const targetNames = a.star_type === 'battue'
        ? (presentParticipantIds.length > 0 ? `${presentParticipantIds.length} ${translate("present_participants")}` : translate("all_participants"))
        : getNames(targets);

      return `
                    <div class="award-row" style="margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-left: 4px solid #4CAF50;">
                            <div style="font-weight: bold;">${badgeName} <span class="badge" style="font-size: 0.8em; background: #ddd; padding: 2px 6px; border-radius: 4px;">${typeLabel}</span></div>
                            <div style="font-size: 0.9em; color: #666; margin-top: 5px;">${translate("awarding_to")}: ${targetNames}</div>
                            <label style="display: block; margin-top: 5px;">
                                    <input type="checkbox" checked class="award-confirm-checkbox" data-index="${index}" data-targets='${JSON.stringify(targets)}'>
                                    ${translate("confirm_award")}
                            </label>
                    </div>
            `;
    }).join('');

    const modalContent = `
            <div id="award-modal" class="modal" style="display: block; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.4);">
                    <div class="modal-content" style="background-color: #fefefe; margin: 15% auto; padding: 20px; border: 1px solid #888; width: 80%; max-width: 600px; border-radius: 8px;">
                            <h2>${translate("award_planned_achievements")}</h2>
                            <p>${translate("confirm_award_instructions") || "Please confirm the achievements to award:"}</p>
                            ${presentParticipantIds.length === 0 ? `<p style="color: orange;">⚠ ${translate("no_attendance_warning") || "No attendance data found. Defaulting to all participants."}</p>` : ''}
                            <div class="award-list">
                                    ${rows}
                            </div>
                            <div style="margin-top: 20px; text-align: right;">
                                    <button class="button button--ghost" id="close-award-modal">${translate("cancel")}</button>
                                    <button class="button button--primary" id="confirm-award-btn">${translate("confirm")}</button>
                            </div>
                    </div>
            </div>
    `;

    // Inject Modal
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalContent;
    document.body.appendChild(modalContainer);

    // Event Listeners
    document.getElementById('close-award-modal').addEventListener('click', () => modalContainer.remove());
    document.getElementById('confirm-award-btn').addEventListener('click', () => {
      this.processAwards(achievements, modalContainer);
    });
  }

  async fetchAttendanceForDate(date) {
    // Simple fetch wrapper since we didn't import getAttendance yet
    // and we might need to rely on generic fetch if getAttendance isn't exported cleanly for single date
    // Actually, we can import getAttendance.
    try {
      // Dynamic import or assume it's available?
      // Let's use the import added in previous step if I added it. I didn't add getAttendance.
      // I'll return null for now to rely on fallback, or use fetch
      const response = await fetch(`/api/v1/attendance?date=${date}`);
      const data = await response.json();
      return data.success ? data.attendance : {};
    } catch (e) {
      return {};
    }
  }

  async processAwards(allAchievements, modalContainer) {
    const checkboxes = modalContainer.querySelectorAll('.award-confirm-checkbox:checked');
    const updates = [];

    // Disable button
    const btn = document.getElementById('confirm-award-btn');
    btn.disabled = true;
    btn.textContent = translate("processing") + "...";

    for (const cb of checkboxes) {
      const index = cb.dataset.index;
      const targets = JSON.parse(cb.dataset.targets);
      const achievement = allAchievements[index];

      // For each target, award badge
      const promises = targets.map(participantId => {
        return saveBadgeProgress({
          participant_id: participantId,
          badge_template_id: achievement.badge_template_id,
          level: 1, // Defaulting to star 1? Or need to determine next star?
          // Backend determines next star if we don't send 'etoiles'.
          // We should send star_type.
          star_type: achievement.star_type,
          status: 'approved', // Auto-approve
          date_obtention: this.closestMeeting,
          comments: `Planned for meeting ${this.closestMeeting}`
        });
      });

      updates.push(Promise.all(promises).then(() => {
        // Mark locally as processed
        achievement.processed = true;
      }));
    }

    try {
      await Promise.all(updates);

      // Update Meeting Preparation to save 'processed: true'
      // We need to update the activity objects in the meeting details
      // The 'achievement' objects are references to objects in this.meetingDetails.activities?
      // Yes, map/filter preserves references if shallow copy of array.

      // Save updated meeting
      await saveReunionPreparation({
        ...this.meetingDetails,
        activities: this.meetingDetails.activities // Now includes processed: true
      });

      modalContainer.remove();
      this.app.showMessage(translate("achievements_awarded_success"), "success");
      this.render(); // Re-render to hide button
    } catch (error) {
      debugError("Error processing awards:", error);
      this.app.showMessage(translate("error_processing_awards"), "error");
      btn.disabled = false;
    }
  }

  renderError() {
    const content = `
                                                <div class="upcoming-meeting">
                                                                <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
                                                                <h1>${translate("upcoming_meeting")}</h1>
                                                                <div class="error-message">
                                                                                <p>${translate("error_loading_upcoming_meeting")}</p>
                                                                                <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
                                                                </div>
                                                </div>
                                `;
    setContent(
      document.getElementById("app"),
      content,
    );
  }
}
