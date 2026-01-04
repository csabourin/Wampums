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

                async getClosestMeeting() {
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

                                if (futureMeetings.length === 0) return null;

                                const firstMeeting = futureMeetings[0];

                                // If the first meeting is today, check if it has ended
                                if (isToday(firstMeeting.dateStr)) {
                                                const hasEnded =
                                                                await this.hasMeetingEnded(
                                                                                firstMeeting.dateStr,
                                                                                now,
                                                                );
                                                if (hasEnded) {
                                                                // Meeting has ended, return the next one if available
                                                                return futureMeetings.length >
                                                                                1
                                                                                ? futureMeetings[1]
                                                                                                  .dateStr
                                                                                : null;
                                                }
                                }

                                return firstMeeting.dateStr;
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

                render() {
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
                                                                                <div class="manage-items">
                                                                                </div>
                                                                </div>
                                                `,
                                                );
                                                return;
                                }

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
                                                                <div class="meeting-details">
                                                                                <p>${meetingDate}</p>
                                                                                <p><strong>${translate("location")}:</strong> ${location}</p>
                                                                </div>
                                                               <div>
                                                                               <ul>${activitiesHtml}</ul>
                                                               </div>
                                                                <div class="manage-items">
                                                                                <a href="/dashboard" aria-label="${translate("back_to_dashboard")}">
                                                                                                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                                                                                                <span>${translate("back_to_dashboard")}</span>
                                                                                </a>
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
