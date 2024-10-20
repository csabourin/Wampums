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

	// Fetch available meeting dates
	async fetchMeetingDates() {
		try {
			this.meetingDates = await getReunionDates();
		} catch (error) {
			console.error("Error fetching meeting dates:", error);
		}
	}

	// Get the closest meeting date from today or later
	getClosestMeeting() {
		const today = new Date().setHours(0, 0, 0, 0); // Get today's date without time

		// Sort the dates in ascending order (earliest to latest)
		const sortedDates = this.meetingDates
			.map(date => new Date(date)) // Convert to Date objects for comparison
			.filter(date => date.getTime() >= today) // Only future or today's meetings
			.sort((a, b) => a - b); // Sort by closest date first

		return sortedDates.length > 0 ? sortedDates[0].toISOString().split('T')[0] : null;
	}

	// Fetch the details for the selected meeting
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

	// Function to format the date in an easy-to-read format
	formatDate(dateString) {
		const [year, month, day] = dateString.split('-').map(Number);
		const date = new Date(year, month - 1, day);
		const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
		return date.toLocaleDateString(this.app.lang, options);
	}

	// Render the UI for the closest upcoming meeting
	render() {
		if (!this.closestMeeting) {
			document.getElementById("app").innerHTML = `<p>${translate("no_upcoming_meeting")}</p>`;
			return;
		}

		const meetingDate = this.formatDate(this.closestMeeting);
		const animateur = this.meetingDetails?.animateur_responsable || translate("no_animateur_assigned");
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

		// Insert the content into the app container
		document.getElementById("app").innerHTML = content;
}
}
