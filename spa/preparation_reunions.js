import { translate } from "./app.js";
import { 
	getActivitesRencontre, 
	getAnimateurs, 
	getRecentHonors,
	getOrganizationSettings,
	saveReunionPreparation,
	getReunionDates,
	getReunionPreparation
} from "./ajax-functions.js";

export class PreparationReunions {
	constructor(app) {
		this.app = app;
		this.activities = [];
		this.animateurs = [];
		this.recentHonors = [];
		this.organizationSettings = {};
		this.selectedActivities = [];
		this.availableDates = [];
		this.currentDate = null;
	}

	async init() {
			try {
					await this.fetchData();
					await this.fetchAvailableDates();

					// Fetch or determine the current meeting data
					const currentMeeting = await this.determineCurrentMeeting();
					this.currentMeetingData = currentMeeting;

					// If no saved data or empty activities, initialize with placeholder activities
					if (!currentMeeting || !currentMeeting.activities || currentMeeting.activities.length === 0) {
							this.selectedActivities = this.initializePlaceholderActivities();
					} else {
							this.selectedActivities = currentMeeting.activities;
					}

					// Render the form
					this.render();
					this.populateForm(currentMeeting);
			} catch (error) {
					console.error("Error initializing preparation reunions:", error);
					this.app.showMessage(translate("error_loading_preparation_reunions"), "error");
			}
	}


	async fetchMeetingData(date) {
			try {
					const response = await getReunionPreparation(date);
					if (response.success && response.preparation) {
							// Parse the activities JSON string
							if (typeof response.preparation.activities === 'string') {
									response.preparation.activities = JSON.parse(response.preparation.activities);
							}
							return response.preparation;
					}
					return null;
			} catch (error) {
					console.error("Error fetching meeting data:", error);
					return null;
			}
	}

	resetForm() {
			document.getElementById("animateur-responsable").value = '';
			document.getElementById("date").value = this.currentDate;
			document.getElementById("louveteau-dhonneur").innerHTML = '';
			document.getElementById("endroit").value = this.organizationSettings.organization_info?.endroit || '';
			document.getElementById("notes").value = '';
			this.selectedActivities = this.initializePlaceholderActivities().map(activity => ({...activity, isDefault: true}));
			this.renderActivitiesTable();
	}

	populateForm(meetingData) {
			if (!meetingData) {
					this.resetForm();
					return;
			}

			this.currentDate = meetingData.date;
			document.getElementById("animateur-responsable").value = meetingData.animateur_responsable || '';
			document.getElementById("date").value = meetingData.date || this.currentDate;

			const louveteauxDHonneur = document.getElementById("louveteau-dhonneur");
			if (Array.isArray(meetingData.louveteau_dhonneur)) {
					louveteauxDHonneur.innerHTML = meetingData.louveteau_dhonneur.map(honor => `<li>${honor}</li>`).join('');
			} else if (typeof meetingData.louveteau_dhonneur === 'string') {
					louveteauxDHonneur.innerHTML = `<li>${meetingData.louveteau_dhonneur}</li>`;
			} else {
					louveteauxDHonneur.innerHTML = this.recentHonors.map(h => `<li>${h.first_name} ${h.last_name}</li>`).join('');
			}

			document.getElementById("endroit").value = meetingData.endroit || this.organizationSettings.organization_info?.endroit || '';
			document.getElementById("notes").value = meetingData.notes || '';

			// Use the activities from meetingData directly and ensure position is properly handled
			if (meetingData.activities && meetingData.activities.length > 0) {
					this.selectedActivities = meetingData.activities.map((savedActivity) => {
							const defaultActivity = this.initializePlaceholderActivities().find(a => a.position === savedActivity.position) || {};

							// Use saved activity, and only fall back to defaults if necessary
							return {
									...defaultActivity,  // Defaults can fill any missing fields
									...savedActivity,    // Saved data overrides defaults
									position: parseInt(savedActivity.position, 10),  // Ensure position is an integer
									isDefault: savedActivity.isDefault === undefined ? false : savedActivity.isDefault  // Default to false if modified
							};
					});
			} else {
					// Fallback to default activities if none are saved
					this.selectedActivities = this.initializePlaceholderActivities().map(activity => ({
							...activity,
							isDefault: true
					}));
			}

			this.renderActivitiesTable();  // Render the activities with the correct positions
	}


	 async fetchData() {
		 const settingsResponse = await getOrganizationSettings();
		[this.activities, this.animateurs, this.recentHonors] = await Promise.all([
			getActivitesRencontre(),
			getAnimateurs(),
			getRecentHonors(),
		]);

		this.organizationSettings = settingsResponse.settings || {};
	}

	async fetchAvailableDates() {
			this.availableDates = await getReunionDates();
			if (this.availableDates.length > 0) {
					this.currentDate = this.availableDates[0];
			} else {
					this.currentDate = this.getNextMeetingDate();
					this.availableDates.push(this.currentDate);
			}
	}

	async determineCurrentMeeting() {
			const now = new Date();
			const meetingDate = this.getNextMeetingDate();
			const plannedMeeting = await this.fetchMeetingData(meetingDate);

			if (!plannedMeeting) {
					// Populate default values if no data is found
					this.selectedActivities = this.initializePlaceholderActivities();

					// Set the default animateur_responsable (if available)
					const defaultAnimateur = this.animateurs.find(a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable);
					return {
							animateur_responsable: defaultAnimateur?.id || '',
							date: meetingDate,
							louveteau_dhonneur: this.recentHonors.map(h => `${h.first_name} ${h.last_name}`).join(', '),
							endroit: this.organizationSettings.organization_info?.endroit || '',
							activities: this.selectedActivities,
							notes: ''
					};
			}
			return plannedMeeting;
	}




	getNextMeetingDate() {
			const today = new Date();
			const meetingDay = this.organizationSettings.organization_info?.meeting_day || 'Tuesday'; // Default to Tuesday if not set
			const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const meetingDayIndex = daysOfWeek.indexOf(meetingDay);
			const todayIndex = today.getDay();

			// Calculate days until the next meeting day
			let daysUntilNextMeeting = (meetingDayIndex - todayIndex + 7) % 7;

			// If today is the meeting day and it's after 8 PM, set the next meeting to the following week
			if (daysUntilNextMeeting === 0 && today.getHours() >= 20) {
					daysUntilNextMeeting = 7;
			}

			const nextMeeting = new Date(today);
			nextMeeting.setDate(today.getDate() + daysUntilNextMeeting);

			// Construct the date string in 'YYYY-MM-DD' format
			const year = nextMeeting.getFullYear();
			const month = String(nextMeeting.getMonth() + 1).padStart(2, '0');
			const day = String(nextMeeting.getDate()).padStart(2, '0');

			return `${year}-${month}-${day}`;
	}

	initializePlaceholderActivities() {
			const placeholders = [
					{ position: 0, time: "18:45", duration: "00:10", activity: "Accueil des louveteaux", type: "Préparation" },
					{ position: 1, time: "18:55", duration: "00:30", activity: "Grand Jeu", type: "Jeu" },
					{ position: 2, time: "19:25", duration: "00:05", activity: "Trêve de l'eau", type: "Pause" },
					{ position: 3, time: "19:30", duration: "00:20", activity: "Technique", type: "Technique" },
					{ position: 4, time: "19:50", duration: "00:20", activity: "Discussion", type: "Discussion" },
					{ position: 5, time: "20:10", duration: "00:30", activity: "Jeu court", type: "Jeu" },
					{ position: 6, time: "20:40", duration: "00:05", activity: "Prière et départ", type: "Conclusion" }
			];

				return placeholders.map((ph, index) => {
						const matchingActivity = this.activities.find(a => a.type === ph.type) || {};
						return {
								...matchingActivity,
								...ph,
								id: `default-${index}`,
								responsable: "",
								materiel: "",
								isDefault: true,
								position: index
						};
				});
		}

	render() {
		const nextMeetingDate = this.currentMeetingData?.date || this.getNextMeetingDate();
		const defaultAnimateur = this.animateurs.find(a => a.full_name === this.organizationSettings.organization_info?.animateur_responsable);

		const content = `
			<div class="preparation-reunions">
				<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
				<h1>${translate("preparation_reunions")}</h1>
				<p><button id="new-meeting">${translate("new_meeting")}</button></p>
				 
				<details>
									<summary>${translate("Navigation")}</summary>
					<div class="date-navigation">
						<button id="next-meeting">‹ ${translate("previous_meeting")}</button>
						<select id="date-select">
							${this.availableDates.map(date => 
								`<option value="${date}" ${date === this.currentMeetingData?.date ? 'selected' : ''}>${this.formatDate(date)}</option>`
							).join('')}
						</select>
						<button id="prev-meeting">${translate("next_meeting")} ›</button>
						
					</div>
				</details>
				<form id="reunion-form">
					<div class="form-row">
						<div class="form-group">
							<label for="animateur-responsable">${translate("animateur_responsable")}:</label>
							<select id="animateur-responsable" required>
								<option value="">${translate("select_animateur")}</option>
								${this.animateurs.map(a => `<option value="${a.id}" ${a.id === (defaultAnimateur?.id || '') ? 'selected' : ''}>${a.full_name}</option>`).join('')}
							</select>
						</div>
						<div class="form-group">
							<label for="date">${translate("date")}:</label>
							<input type="date" id="date" value="${nextMeetingDate}" required>
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label for="louveteau-dhonneur">${translate("louveteau_dhonneur")}:</label>
							<ul id="louveteau-dhonneur" class="louveteau-list" contenteditable="true">
								${this.recentHonors.map(h => `<li>${h.first_name} ${h.last_name}</li>`).join('')}
							</ul>
						</div>
						<div class="form-group">
							<label for="endroit">${translate("endroit")}:</label>
							<input type="text" id="endroit" value="${this.organizationSettings.organization_info?.endroit || ''}" required>
						</div>
					</div>
					<table id="activities-table">
						<thead>
							<tr>
								<th>${translate("heure_et_duree")}</th>
								<th>${translate("activite_responsable_materiel")}</th>
							</tr>
						</thead>
						<tbody>
							<!-- Activities will be populated here -->
						</tbody>
					</table>
					<div class="form-group">
						<label for="notes">${translate("notes")}:</label>
						<textarea id="notes" rows="4"></textarea>
					</div>
					<div class="form-actions">
						<button type="submit">${translate("save")}</button>
						<button type="button" id="print-button">${translate("print")}</button> <button id="toggle-quick-edit">${translate("toggle_quick_edit_mode")}</button>
					</div>
				</form>
				<p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
			</div>
			<div id="description-modal" class="modal hidden">
					<div class="modal-content">
							<span class="close">&times;</span>
							<p id="description-text"></p>
					</div>
			</div>

		`;

		// Insert the HTML into the DOM
		document.getElementById("app").innerHTML = content;

		// Now that the DOM is ready, render the activities table
		this.renderActivitiesTable();

		// Attach event listeners after rendering the form
			this.attachEventListeners();
	}

	toggleQuickEditMode() {
			const rows = document.querySelectorAll('.activity-row');
			rows.forEach(row => {
					row.classList.toggle('compact-view');
					row.querySelector('.add-row-btn').classList.toggle('hidden');
					row.querySelector('.delete-row-btn').classList.toggle('hidden');
			});
	}

updateActivityDetails(selectElement) {
    // Get the selected option
    const selectedOption = selectElement.options[selectElement.selectedIndex];

    // Retrieve the activity ID from the data-id attribute
    const activityId = selectedOption.getAttribute('data-id');

    // Find the corresponding activity from this.activities using the activity ID
    const activity = this.activities.find(a => a.id == activityId);

    if (activity) {
        const row = selectElement.closest('.activity-row');
        const durationInput = row.querySelector('.activity-duration');
        const materielInput = row.querySelector('.activity-materiel');
        let descriptionButton = row.querySelector('.description-btn'); // Check if button already exists

        // Log the values of materiel and duration for debugging
        console.log("Selected Activity:", activity.activity);
        console.log("Duration (min-max):", activity.estimated_time_min, "-", activity.estimated_time_max);
        console.log("Material:", activity.material);

        // Update the fields with the activity data or set defaults
        durationInput.value = `${activity.estimated_time_min || ''}-${activity.estimated_time_max || ''} min`;
        materielInput.value = activity.material || '';

        // Handle the description button
        if (activity.description) {
            // If a description exists and no button is present, create the button
            if (!descriptionButton) {
                descriptionButton = document.createElement('button');
                descriptionButton.classList.add('description-btn');
                descriptionButton.textContent = '?';
                descriptionButton.setAttribute('data-description', activity.description);
									selectElement.insertAdjacentElement('afterend', descriptionButton); // Add the button next to the select
            } else {
                // If the button already exists, just update the description data
                descriptionButton.setAttribute('data-description', activity.description);
                descriptionButton.style.display = 'inline'; // Ensure it's visible
            }
        } else if (descriptionButton) {
            // If no description, remove the button if it exists
            descriptionButton.style.display = 'none';
        }

        // Mark as modified
        row.setAttribute('data-default', 'false');
        selectElement.setAttribute('data-default', 'false');
    }
}





	attachEventListeners() {
		// Add listeners for form submission, date navigation, activity editing, etc.

		document.querySelector('#activities-table').addEventListener('change', (e) => {
			if (e.target.classList.contains('activity-select')) {
					this.updateActivityDetails(e.target);
			}
		});

		 // Event listener for description modal
			document.querySelector('#activities-table').addEventListener('click', (e) => {
					if (e.target.classList.contains('description-btn')) {
						e.preventDefault(); // Prevent the form from submitting
						e.stopPropagation(); // Stop the event from bubbling up
							const description = e.target.getAttribute('data-description');
							this.showDescriptionModal(description);
					}
			});

			document.querySelector('.modal .close').addEventListener('click', () => {
					this.hideDescriptionModal();
			});

			window.addEventListener('click', (e) => {
					if (e.target.classList.contains('modal')) {
							this.hideDescriptionModal();
					}
			});
		

		document.getElementById('toggle-quick-edit').addEventListener('click', this.toggleQuickEditMode.bind(this));

		document.getElementById('activities-table').addEventListener('click', (e) => {
				if (e.target.matches('.add-row-btn')) {
						this.addActivityRow(e.target.dataset.position);
				} else if (e.target.matches('.delete-row-btn')) {
						this.deleteActivityRow(e.target.dataset.position);
				}
		});
		
		document.addEventListener("click", (e) => {
			if (e.target.matches("#activities-table .edit-activity-btn")) {
				this.toggleActivityEdit(e.target.closest("tr").dataset.id);
			}
		});

		document.addEventListener("change", (e) => {
				if (e.target.matches(".activity-select, .activity-responsable, .activity-time, .activity-duration, .activity-materiel")) {
						const row = e.target.closest(".activity-row");
						row.setAttribute("data-default", "false");
						e.target.setAttribute("data-default", "false");
				}
		});

			document.addEventListener("submit", (e) => {
			if (e.target.matches("#reunion-form")) {
				e.preventDefault();
				this.handleSubmit(e);
			}
		});

		document.addEventListener("click", (e) => {
			if (e.target.matches("#print-button")) {
				this.printPreparation();
			} else if (e.target.matches("#prev-meeting")) {
				this.navigateMeeting(-1);
			} else if (e.target.matches("#next-meeting")) {
				this.navigateMeeting(1);
			} else if (e.target.matches("#new-meeting")) {
				this.createAndLoadNewMeeting();
			}
		});

		document.querySelector('#activities-table').addEventListener('change', (e) => {
				if (e.target.classList.contains('activity-select')) {
						e.target.setAttribute('data-default', 'false');
						e.target.closest('.activity-row').setAttribute('data-default', 'false');
				} else if (e.target.classList.contains('activity-responsable')) {
						if (e.target.value === 'other') {
								this.switchResponsableToInput(e.target);
						} else {
								e.target.setAttribute('data-default', 'false');
								e.target.closest('.activity-row').setAttribute('data-default', 'false');
						}
				}
		});

		document.addEventListener("change", (e) => {
			if (e.target.matches("#date-select")) {
				this.loadMeeting(e.target.value);
			}
		});

		document.querySelector('#activities-table').addEventListener('change', (e) => {
			if (e.target.classList.contains('activity-select') || e.target.classList.contains('activity-responsable')) {
					e.target.setAttribute('data-default', 'false');
					e.target.closest('.activity-row').setAttribute('data-default', 'false');
			}
		});

		document.querySelector('#activities-table').addEventListener('input', (e) => {
			if (e.target.classList.contains('activity-time') || 
					e.target.classList.contains('activity-duration') || 
					e.target.classList.contains('activity-materiel')) {
					e.target.setAttribute('data-default', 'false');
					e.target.closest('.activity-row').setAttribute('data-default', 'false');
			}
		});

		document.querySelector('#activities-table').addEventListener('click', (e) => {
				if (e.target.classList.contains('edit-activity-btn')) {
						this.toggleActivityEdit(e.target.closest('.activity-row'));
				} else if (e.target.classList.contains('edit-responsable-btn')) {
						this.toggleResponsableEdit(e.target.closest('.activity-row'));
				}
		});
		
	}

	// Show modal with description
	showDescriptionModal(description) {
			document.getElementById('description-text').textContent = description;
			document.getElementById('description-modal').style.display = 'block';
	}

	// Hide modal
	hideDescriptionModal() {
			document.getElementById('description-modal').style.display = 'none';
	}


renderActivitiesTable() {
    const activitiesHtml = this.selectedActivities.map((a, index) => {
        if (Object.keys(a).length === 0) {
            // This is a placeholder for a default activity
            const defaultActivity = this.initializePlaceholderActivities()[index];
            return this.renderActivityRow(defaultActivity, index, true);
        } else {
            return this.renderActivityRow(a, index, false);
        }
    }).join('');

    document.querySelector('#activities-table').innerHTML = activitiesHtml;
}

	renderActivityRow(a, index) {
			const isCustomActivity = !this.activities.some(activity => activity.activity === a.activity);

			// Check if the responsable (animateur) exists in the animateurs list
			const responsableExists = this.animateurs.some(animateur => animateur.full_name === a.responsable);

			// If responsable doesn't exist, render a text field; otherwise, render a select field
			const responsableField = responsableExists ? `
					<select class="activity-responsable" data-default="${a.isDefault}">
							<option value="">${translate("select_animateur")}</option>
							${this.animateurs.map(animateur => `
									<option value="${animateur.full_name}" ${animateur.full_name === a.responsable ? 'selected' : ''}>${animateur.full_name}</option>
							`).join('')}
							<option value="other">${translate("other")}</option>
					</select>
			` : `
					<input type="text" value="${a.responsable}" class="responsable-input" data-default="${a.isDefault}" readonly>
			`;

			// Modal trigger for the description
			const descriptionIcon = a.description ? `<button class="description-btn" data-description="${a.description}">?</button>` : '';

			return `
					<div class="activity-row" data-id="${a.id || index}" data-position="${a.position || index}" data-default="${a.isDefault}">
							<div class="activity-time-container">
									<input type="time" value="${a.time || ''}" class="activity-time">
									<input type="text" value="${a.duration || ''}" class="activity-duration">
							</div>
							<div class="activity-container">
									<select class="activity-select" data-default="${a.isDefault}">
											${isCustomActivity ? `<option>${a.activity}</option>` : ''}
											<option value="">${translate("select_activity")}</option>
											${this.activities.map(act => `<option data-id="${act.id}" value="${act.activity}" ${act.activity === a.activity ? 'selected' : ''}>${act.activity}</option>`).join('')}
									</select>
									${descriptionIcon}
									<button type="button" class="edit-activity-btn" title="${translate("edit")}">✎</button>
							</div>
							<div class="responsable-container">
									${responsableField}
							</div>
							<input type="text" value="${a.materiel || ''}" class="activity-materiel" placeholder="${translate("materiel")}" data-default="${a.isDefault}">
							<div class="actions">
									<button class="add-row-btn hidden" data-position="${index}">+ ${translate("Add")}</button>
									<button class="delete-row-btn hidden" data-position="${index}">- ${translate("Delete")}</button>
							</div>
					</div>
			`;
	}


	addActivityRow(position) {
			// Insert a new activity row at the specified position
			const newActivity = {
					position: parseInt(position) + 1,
					time: "",
					duration: "",
					activity: "",
					responsable: "",
					materiel: "",
					isDefault: false,
			};

			this.selectedActivities.splice(newActivity.position, 0, newActivity);
			this.recalculatePositions();
			this.renderActivitiesTable();
	}

	deleteActivityRow(position) {
			this.selectedActivities.splice(position, 1);
			this.recalculatePositions();
			this.renderActivitiesTable();
	}

	recalculatePositions() {
			this.selectedActivities.forEach((activity, index) => {
					activity.position = index;
			});
	}

navigateDate(weekOffset) {
		const currentDate = new Date(document.getElementById("date").value);
		currentDate.setDate(currentDate.getDate() + (weekOffset * 7));
		const newDate = currentDate.toISOString().split('T')[0];
		document.getElementById("date").value = newDate;
		this.loadMeeting(newDate);
}

async loadMeeting(date) {
		try {
				const meetingData = await this.fetchMeetingData(date);
				if (meetingData) {
						this.populateForm(meetingData);
				} else {
						this.resetForm();
				}
		} catch (error) {
				console.error("Error loading meeting data:", error);
				this.app.showMessage(translate("error_loading_meeting_data"), "error");
		}
}

	toggleActivityEdit(row) {
			const container = row.querySelector('.activity-container');
			const select = container.querySelector('.activity-select');
			if (select) {
					const input = document.createElement('input');
					input.type = 'text';
					input.className = 'activity-input';
					input.value = select.options[select.selectedIndex].text;
					input.setAttribute('data-default', 'false');
					container.replaceChild(input, select);
					row.setAttribute('data-default', 'false');
			}
	}

	switchResponsableToInput(select) {
			const container = select.closest('.responsable-container');
			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'responsable-input';
			input.setAttribute('data-default', 'false');
			input.placeholder = translate("enter_responsable_name");
			container.replaceChild(input, select);
			input.focus();
			container.closest('.activity-row').setAttribute('data-default', 'false');
	}

	updateActivity(id, newActivityId) {
		const index = this.selectedActivities.findIndex(a => a.id === parseInt(id));
		const newActivity = this.activities.find(a => a.id === parseInt(newActivityId));
		if (index !== -1 && newActivity) {
			this.selectedActivities[index] = { ...this.selectedActivities[index], ...newActivity };
			this.render();
		}
	}

	saveActivityEdit(id) {
			const row = document.querySelector(`tr[data-id="${id}"] .activity-container`);
			const input = row.querySelector('.activity-input');
			const newValue = input.value;

			// Update the activity text in selectedActivities
			const index = this.selectedActivities.findIndex(a => a.id === parseFloat(id));
			if (index !== -1) {
					this.selectedActivities[index].activity = newValue;
			}

			// Re-render the table with the new value
			this.renderActivitiesTable();
	}

	updateActivityText(id, newText) {
		const index = this.selectedActivities.findIndex(a => a.id === parseInt(id));
		if (index !== -1) {
			this.selectedActivities[index].activity = newText;
		}
	}

	async loadMeeting(date) {
			this.currentDate = date;
			try {
					const meetingData = await this.fetchMeetingData(date);
					if (meetingData) {
							this.currentMeetingData = meetingData;
					} else {
							this.currentMeetingData = this.createNewMeeting(date);
					}
					this.render();
					this.populateForm(this.currentMeetingData);
			} catch (error) {
					console.error("Error loading meeting data:", error);
					this.app.showMessage(translate("error_loading_meeting_data"), "error");
			}
	}

	createNewMeeting(date = null) {
			const newDate = date || this.getNextMeetingDate();
			if (!this.availableDates.includes(newDate)) {
					this.availableDates.push(newDate);
					this.availableDates.sort((a, b) => new Date(b) - new Date(a));
			}
			this.currentDate = newDate;
			this.selectedActivities = this.initializePlaceholderActivities();
			return {
					date: newDate,
					animateur_responsable: '',
					louveteau_dhonneur: '',
					endroit: this.organizationSettings.organization_info?.endroit || '',
					activities: this.selectedActivities,
					notes: ''
			};
	}

	navigateMeeting(direction) {
			const currentIndex = this.availableDates.indexOf(this.currentDate);
			const newIndex = currentIndex + direction;
			if (newIndex >= 0 && newIndex < this.availableDates.length) {
					const newDate = this.availableDates[newIndex];
					this.loadMeeting(newDate);
			} else if (direction > 0) {
					// If trying to go beyond the last date, create a new meeting
					this.createAndLoadNewMeeting();
			}
	}

	async createAndLoadNewMeeting() {
			const newMeetingData = this.createNewMeeting();
			this.currentMeetingData = newMeetingData;
			this.render();
			this.populateForm(newMeetingData);
	}

	formatDate(dateString) {
			const [year, month, day] = dateString.split('-').map(Number);  // Split the date string into year, month, and day
			const date = new Date(year, month - 1, day);  // Create a new Date object (month is 0-indexed)

			const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
			return date.toLocaleDateString(this.app.lang, options);  // Format the date
	}

	async handleSubmit(e) {
			e.preventDefault();
			e.stopPropagation();

			const activitiesContainer = document.querySelector('#activities-table');

			// Filter activities that have been modified (isDefault is false)
		const updatedActivities = Array.from(activitiesContainer.querySelectorAll('.activity-row'))
		.filter(row => row.getAttribute('data-default') === 'false')
		.map((row) => {
				const index = row.getAttribute('data-id').split('-')[1];
				const activity = this.selectedActivities[index];
				return {
						...activity,
						position: parseInt(row.getAttribute('data-position'), 10),  // Ensure position is an integer
						id: row.getAttribute('data-id'),
						time: row.querySelector('.activity-time').value,
						duration: row.querySelector('.activity-duration').value,
						activity: row.querySelector('.activity-input')?.value || row.querySelector('.activity-select')?.value,
						responsable: row.querySelector('.responsable-input')?.value || row.querySelector('.activity-responsable')?.value,
						materiel: row.querySelector('.activity-materiel').value,
						isDefault: false  // Only modified activities are saved
				};
		});

			const formData = {
					organization_id: this.app.organizationId,
					animateur_responsable: document.getElementById("animateur-responsable").value,
					date: document.getElementById("date").value,
					louveteau_dhonneur: Array.from(document.getElementById("louveteau-dhonneur").querySelectorAll('li')).map(li => li.textContent),
					endroit: document.getElementById("endroit").value,
					activities: updatedActivities,  // Only modified activities are saved
					notes: document.getElementById("notes").value,
			};

			try {
					await saveReunionPreparation(formData);
					this.app.showMessage(translate("reunion_preparation_saved"), "success");
					await this.fetchAvailableDates();
			} catch (error) {
					console.error("Error saving reunion preparation:", error);
					this.app.showMessage(translate("error_saving_reunion_preparation"), "error");
			}

			return false;
	}




	addActivityListeners() {
		const activitiesTable = document.getElementById("activities-table");
		activitiesTable.addEventListener('input', (e) => {
			if (e.target.classList.contains('activity-time') || 
				e.target.classList.contains('activity-duration') ||
				e.target.classList.contains('activity-select') || 
				e.target.classList.contains('activity-responsable') ||
				e.target.classList.contains('activity-materiel')) {

				const row = e.target.closest('tr');
				const id = row.dataset.id;
				const activityIndex = this.selectedActivities.findIndex(a => a.id === parseFloat(id));

				// Ensure the activity is updated in real-time
				if (activityIndex !== -1) {
					const updatedActivity = {
						...this.selectedActivities[activityIndex],
						time: row.querySelector('.activity-time')?.value || '',
						duration: row.querySelector('.activity-duration')?.value || '',
						activity: row.querySelector('.activity-select')?.value || '',
						responsable: row.querySelector('.activity-responsable')?.value || '',
						materiel: row.querySelector('.activity-materiel')?.value || ''
					};
					this.selectedActivities[activityIndex] = updatedActivity;
					console.log(`Updated activity: ${JSON.stringify(updatedActivity)}`);
				}
			}
		});
	}

	printPreparation() {
			const louveteauxDHonneur = document.getElementById("louveteau-dhonneur").innerHTML;
			const printContent = `
					<div class="print-preparation">
							<h1>6e MEUTE A - ST-PAUL D'AYLMER</h1>
							<h2>RÉUNION HEBDOMADAIRE</h2>
							<div class="print-header">
									<p><strong>Animateur responsable:</strong> ${document.getElementById("animateur-responsable").options[document.getElementById("animateur-responsable").selectedIndex].text}</p>
									<p><strong>Date:</strong> ${document.getElementById("date").value}</p>
							</div>
							<div class="print-header">
									<p><strong>Louveteau d'honneur:</strong></p>
									<ul>
											${louveteauxDHonneur}
									</ul>
									<p><strong>Endroit:</strong> ${document.getElementById("endroit").value}</p>
							</div>
							<table>
									<thead>
											<tr>
													<th>HEURE</th>
													<th>Durée</th>
													<th>DESCRIPTION</th>
													<th>RESPONSABLE</th>
													<th>MATÉRIEL</th>
											</tr>
									</thead>
									<tbody>
											${this.selectedActivities.map(a => `
													<tr>
															<td>${a.time}</td>
															<td>${a.duration}</td>
															<td>${a.activity}</td>
															<td>${a.responsable || ''}</td>
															<td>${a.materiel || ''}</td>
													</tr>
											`).join('')}
									</tbody>
							</table>
							<div class="print-notes">
									<h3>Notes:</h3>
									<p>${document.getElementById("notes").value}</p>
									<div class="handwritten-notes">
											<div class="note-line"></div>
											<div class="note-line"></div>
									</div>
							</div>
							<div class="print-next-week">
									<h3>Semaine Prochaine:</h3>
									<div class="handwritten-notes">
											<div class="note-line"></div>
											<div class="note-line"></div>
									</div>
							</div>
					</div>
			`;

			const printWindow = window.open('', '_blank');
			printWindow.document.write(`
					<html>
							<head>
									<title>Réunion Hebdomadaire</title>
									<style>
											body { 
													font-family: Arial, sans-serif; 
													line-height: 1.8;
											}
											.print-preparation { 
													max-width: 800px; 
													margin: 0 auto; 
											}
											h1, h2 { 
													text-align: center; 
											}
											.print-header { 
													display: flex; 
													justify-content: space-between; 
											}
											table { 
													width: 100%; 
													border-collapse: collapse; 
													margin-top: 20px; 
											}
											th, td { 
													border: 1px solid black; 
													padding: 5px; 
													text-align: left; 
											}
											.print-notes, .print-next-week { 
													margin-top: 20px; 
											}
											.handwritten-notes {
													margin-top: 10px;
											}
											.note-line {
													height: 1.8em;
													border-bottom: 1px solid #ccc;
													margin-bottom: 10px;
											}
											@media print {
													body { 
															font-size: 12pt; 
													}
													.print-preparation {
															max-width: 100%;
													}
											}
									</style>
							</head>
							<body>
									${printContent}
							</body>
					</html>
			`);
			printWindow.document.close();
			printWindow.print();
	}

}