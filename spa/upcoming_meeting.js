import { translate } from "./app.js";
import { getReunionDates, getReunionPreparation } from "./ajax-functions.js";

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
						console.error("Error initializing upcoming meeting:", error);
						this.app.showMessage(translate("error_loading_upcoming_meeting"), "error");
				}
		}

		async fetchMeetingDates() {
				try {
						this.meetingDates = await getReunionDates();
				} catch (error) {
						console.error("Error fetching meeting dates:", error);
				}
		}

		isDateToday(date) {
				const today = new Date();
				return date.getDate() === today.getDate() &&
							 date.getMonth() === today.getMonth() &&
							 date.getFullYear() === today.getFullYear();
		}

		getClosestMeeting() {
				const today = new Date();
				today.setHours(0, 0, 0, 0);

				// Convert and filter meetings
				const futureMeetings = this.meetingDates
						.map(dateStr => {
								// Create a new date object and set it to midnight
								const meetingDate = new Date(dateStr + 'T00:00:00');
								return {
										date: meetingDate,
										dateStr: dateStr
								};
						})
						.filter(meeting => {
								// Include today's meetings and future meetings
								return this.isDateToday(meeting.date) || meeting.date > today;
						})
						.sort((a, b) => a.date - b.date);

				return futureMeetings.length > 0 ? futureMeetings[0].dateStr : null;
		}

		async fetchMeetingDetails(date) {
				try {
						const response = await getReunionPreparation(date);
						if (response.success && response.preparation) {
								this.meetingDetails = response.preparation;
						} else {
								this.meetingDetails = null;
						}
				} catch (error) {
						console.error("Error fetching meeting details:", error);
						this.meetingDetails = null;
				}
		}

		formatDate(dateString) {
				// Create date object with explicit time set to midnight
				const date = new Date(dateString + 'T00:00:00');
				const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
				return date.toLocaleDateString(this.app.lang, options);
		}

		render() {
				if (!this.closestMeeting) {
						document.getElementById("app").innerHTML = `<p>${translate("no_upcoming_meeting")}</p>`;
						return;
				}

				const meetingDate = this.formatDate(this.closestMeeting);
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