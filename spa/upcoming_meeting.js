import { translate } from "./app.js";
import {
  debugLog,
  debugError,
  debugWarn,
  debugInfo,
} from "./utils/DebugUtils.js";
import { getReunionDates, getReunionPreparation } from "./ajax-functions.js";
import { formatDate, isToday, parseDate } from "./utils/DateUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";

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
