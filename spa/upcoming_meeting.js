import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { getReunionDates, getReunionPreparation } from "./ajax-functions.js";
import { formatDate, isToday } from "./utils/DateUtils.js";

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
                                                this.closestMeeting = this.getClosestMeeting();
                                                if (this.closestMeeting) {
                                                                await this.fetchMeetingDetails(this.closestMeeting);
                                                }
                                                this.render();
                                } catch (error) {
                                                debugError("Error initializing upcoming meeting:", error);
                                                this.app.showMessage(translate("error_loading_upcoming_meeting"), "error");
                                }
                }

                async fetchMeetingDates() {
                                try {
                                                const response = await getReunionDates();
                                                // Handle both array response and object response with dates property
                                                this.meetingDates = Array.isArray(response) ? response : (response?.dates || []);
                                } catch (error) {
                                                debugError("Error fetching meeting dates:", error);
                                }
                }

                getClosestMeeting() {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);

                                // Convert and filter meetings
                                const futureMeetings = this.meetingDates
                                                .map(dateStr => {
                                                                // Handle both ISO format and plain date strings
                                                                const meetingDate = new Date(dateStr);
                                                                meetingDate.setHours(0, 0, 0, 0);
                                                                // Get plain date string in YYYY-MM-DD format for display
                                                                const plainDateStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
                                                                return {
                                                                                date: meetingDate,
                                                                                dateStr: plainDateStr
                                                                };
                                                })
                                                .filter(meeting => {
                                                                // Include today's meetings and future meetings
                                                                return isToday(meeting.dateStr) || meeting.date > today;
                                                })
                                                .sort((a, b) => a.date - b.date);

                                return futureMeetings.length > 0 ? futureMeetings[0].dateStr : null;
                }

                async fetchMeetingDetails(date) {
                                try {
                                                const response = await getReunionPreparation(date);
                                                if (response.success && response.preparation) {
                                                                this.meetingDetails = response.preparation;
                                                                // Parse the activities JSON string if it's a string
                                                                if (typeof this.meetingDetails.activities === 'string') {
                                                                        this.meetingDetails.activities = JSON.parse(this.meetingDetails.activities);
                                                                }
                                                } else {
                                                                this.meetingDetails = null;
                                                }
                                } catch (error) {
                                                debugError("Error fetching meeting details:", error);
                                                this.meetingDetails = null;
                                }
                }

                render() {
                                if (!this.closestMeeting) {
                                                document.getElementById("app").innerHTML = `<p>${translate("no_upcoming_meeting")}</p>`;
                                                return;
                                }

                                const meetingDate = formatDate(this.closestMeeting, this.app.lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                                const location = this.meetingDetails?.endroit || translate("no_location_specified");
                                const activities = this.meetingDetails?.activities || [];
                                const activitiesHtml = activities.length > 0
                                                ? activities.map(a => `<li>${a.time} - ${a.activity}</li>`).join('')
                                                : `<li>${translate("no_activities_scheduled")}</li>`;

                                const content = `
                                                <div class="upcoming-meeting">
                                                                <h1>${translate("upcoming_meeting")}</h1>
                                                                <div class="meeting-details">
                                                                                <p>${meetingDate}</p>
                                                                                <p><strong>${translate("location")}:</strong> ${location}</p>
                                                                </div>
                                                                <div>
                                                                                <ul>${activitiesHtml}</ul>
                                                                </div>
                                                                <div class="manage-items">
                                                                                <a href="/dashboard" class="button">${translate("back_to_dashboard")}</a>
                                                                                <a href="/preparation-reunion?date=${this.closestMeeting}" class="button">${translate("preparation_reunions")}</a>
                                                                </div>
                                                </div>
                                `;

                                document.getElementById("app").innerHTML = content;
                }
}