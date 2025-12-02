// activity-widget.js
import {translate} from "./app.js";
import { getReunionPreparation } from "./ajax-functions.js";
export class ActivityWidget {
	constructor(app) {
		console.log('ActivityWidget constructor called');
		console.log('App object:', app);
		this.app = app;
		this.currentActivities = [];
		this.init();
	}

	async init() {
		// Clear any previous intervals before setting a new one
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
		}

		console.log('ActivityWidget init called');
		console.log('Is logged in:', this.app.isLoggedIn);
		console.log('User role:', this.app.userRole);

		if (!this.app.isLoggedIn || !this.isAuthorized()) {
			console.log('User not logged in or not authorized, widget will not be displayed');
			return;
		}

		await this.fetchCurrentActivities();

		if (this.currentActivities.length === 0 || !this.isPreparationToday()) {
			console.log('No activities found for today, stopping widget.');
			return;
		}

		this.renderWidget();
		this.updateActivityWidget();

		this.updateInterval = setInterval(() => {
			this.updateActivityWidget();
		}, 60000);
	}



	isAuthorized() {
		return this.app.userRole === 'admin' || this.app.userRole === 'animation';
	}

	async fetchCurrentActivities() {
		try {
			const data = await getReunionPreparation(new Date().toISOString().split('T')[0]);
			console.log('Fetched reunion preparation data:', data);

			if (data.success && data.preparation && data.preparation.activities && data.preparation.date) {
				this.currentActivities = data.preparation.activities;
				this.preparationDate = new Date(data.preparation.date + 'T00:00:00');
				console.log('Current activities set:', this.currentActivities);
				console.log('Preparation date:', this.preparationDate);

				// Validate the parsed date
				if (isNaN(this.preparationDate.getTime())) {
					console.error('Invalid date format received:', data.preparation.date);
					this.currentActivities = [];
					this.preparationDate = null;
				}
			} else {
				console.log('No activities found in the fetched data or missing date field');
				this.currentActivities = [];
				this.preparationDate = null;
			}
		} catch (error) {
			console.error("Error fetching current activities:", error);
			this.currentActivities = [];
			this.preparationDate = null;
		}
	}


	getStartOfWeek(date) {
		const d = new Date(date);
		const day = d.getDay();
		const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
		return new Date(d.setDate(diff));
	}

	getEndOfWeek(date) {
		const d = new Date(date);
		const day = d.getDay();
		const diff = d.getDate() - day + 7; // Add 7 to get the end of the week
		return new Date(d.setDate(diff));
	}

	renderWidget() {
		const widgetContainer = document.createElement('div');
		widgetContainer.id = 'activity-widget';
		widgetContainer.style.display = 'none';  // Initially hidden
		widgetContainer.classList.add('activity-widget');

		widgetContainer.innerHTML = `
			<div class="current-activity">
				<h3 id="current-activity-title">${translate('current_activity')}</h3>
				<p id="time-until-next"></p>
			</div>
		`;

		document.body.insertBefore(widgetContainer, document.body.firstChild);  // Place the widget at the top of the body
	}

	updateActivityWidget() {
		console.log(translate('updating_activity_widget'));
		console.log(translate('current_activities'), this.currentActivities);
		console.log(translate('preparation_date'), this.preparationDate);
		if (this.currentActivities.length === 0 || !this.preparationDate) {
			console.log(translate('no_activities_found_or_preparation_date_not_set'));
			return;
		}
		const currentTime = new Date();
		console.log(translate('current_time'), currentTime);
		let currentActivity = null;
		let nextActivity = null;

		this.currentActivities.forEach((activity, index) => {
			const activityStartTime = this.combineDateTime(this.preparationDate, activity.time);
			const durationMinutes = parseInt(activity.duration);
			const activityEndTime = this.addMinutes(activityStartTime, durationMinutes);

			console.log(`${translate('activity')}: ${translate(activity.activity)}, ${translate('start')}: ${activityStartTime}, ${translate('end')}: ${activityEndTime}`);

			if (currentTime >= activityStartTime && currentTime < activityEndTime) {
				currentActivity = activity;
				nextActivity = this.currentActivities[index + 1] || null;  // Set next activity
			} else if (currentTime < activityStartTime && !nextActivity) {
				nextActivity = activity;
			}
		});

		const widget = document.getElementById('activity-widget');
		if (!this.isPreparationToday()) {
			console.log(translate('preparation_not_today'));
			widget.style.display = 'none';
			return;
		}

		if (currentActivity) {
			console.log(translate('current_activity_found'), currentActivity);
			widget.style.display = 'block';
			document.getElementById('current-activity-title').textContent = `${translate('current_activity')}: ${translate(currentActivity.activity)}`;
			const timeUntilNext = this.getTimeUntilNext(currentTime, nextActivity);

			if (nextActivity) {
				document.getElementById('time-until-next').textContent = `${translate('time_until_next')}: ${timeUntilNext} (${translate('next_activity')}: ${translate(nextActivity.activity)})`;
			} else {
				document.getElementById('time-until-next').textContent = `${translate('time_until_next')}: ${timeUntilNext}`;
			}

		} else if (nextActivity) {
			console.log(translate('next_activity_found'), nextActivity);
			widget.style.display = 'block';
			document.getElementById('current-activity-title').textContent = `${translate('next_activity')}: ${translate(nextActivity.activity)}`;
			document.getElementById('time-until-next').textContent = `${translate('starts_in')}: ${this.getTimeUntilNext(currentTime, nextActivity)}`;
		} else {
			console.log(translate('no_current_or_upcoming_activities_found'));
			widget.style.display = 'none';
		}
	}

	isPreparationToday() {
		const today = new Date();
		return this.preparationDate.getDate() === today.getDate() &&
					 this.preparationDate.getMonth() === today.getMonth() &&
					 this.preparationDate.getFullYear() === today.getFullYear();
	}

	combineDateTime(date, timeString) {
		const [hours, minutes] = timeString.split(':').map(Number);

		if (isNaN(hours) || isNaN(minutes)) {
			console.error('Invalid time string:', timeString);
			return new Date(NaN); // Return invalid date to trigger error handling
		}

		const combinedDate = new Date(date);
		combinedDate.setHours(hours, minutes, 0, 0);

		if (isNaN(combinedDate.getTime())) {
			console.error('Invalid combined date for', timeString, combinedDate);
			return new Date(NaN); // Return invalid date to trigger error handling
		}

		console.log(`Combined date for ${timeString}:`, combinedDate);
		return combinedDate;
	}


	getTimeUntilNext(currentTime, nextActivity) {
		if (!nextActivity) return translate('no_next_activity');

		const nextActivityStart = this.combineDateTime(this.preparationDate, nextActivity.time);

		// Check if nextActivityStart is valid
		if (isNaN(nextActivityStart.getTime())) {
			return translate('invalid_next_activity_time');
		}

		const timeDiff = (nextActivityStart - currentTime) / 1000;
		const days = Math.floor(timeDiff / (24 * 60 * 60));
		const hours = Math.floor((timeDiff % (24 * 60 * 60)) / 3600);
		const minutes = Math.floor((timeDiff % 3600) / 60);
		const seconds = Math.floor(timeDiff % 60);

		if (days > 0) {
			return `${days}${translate('d')} ${hours}${translate('h')} ${minutes}${translate('m')}`;
		} else if (hours > 0) {
			return `${hours}${translate('h')} ${minutes}${translate('m')} ${seconds}${translate('s')}`;
		} else {
			return `${minutes}${translate('m')} ${seconds}${translate('s')}`;
		}
	}


	getTimeFromString(timeString) {
		const [hours, minutes] = timeString.split(':').map(Number);
		const date = new Date();
		date.setHours(hours, minutes, 0, 0);
		console.log(`Parsed time for ${timeString}:`, date);
		return date;
	}

	addMinutes(time, minutes) {
		return new Date(time.getTime() + minutes * 60000);
	}
}
