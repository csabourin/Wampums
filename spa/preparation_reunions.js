import { translate } from "./app.js";
import { 
        getActivitesRencontre, 
        getAnimateurs, 
        getRecentHonors,
        getOrganizationSettings,
        saveReunionPreparation,
        getReunionDates,
        getReunionPreparation,
        fetchFromApi
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
                        await this.fetchAvailableDates();
                        const animateursResponse = await getAnimateurs();
                        // Handle both array response and object response with animateurs property
                        this.animateurs = Array.isArray(animateursResponse) ? animateursResponse : (animateursResponse?.animateurs || []);
                        this.render();
                        await this.fetchData();                 

                        this.reminder = await this.fetchReminder();
                        if (this.reminder) {
                                document.getElementById('reminder-text').value = this.reminder.reminder_text;
                                document.getElementById('reminder-date').value = this.reminder.reminder_date;
                                document.getElementById('recurring-reminder').checked = this.reminder.is_recurring;
                        }

                        const currentMeeting = await this.determineCurrentMeeting();
                        this.currentMeetingData = currentMeeting;

                        if (!currentMeeting || !currentMeeting.activities || currentMeeting.activities.length === 0) {
                                this.selectedActivities = this.initializePlaceholderActivities();
                        } else {
                                this.selectedActivities = currentMeeting.activities;
                        }

                        this.populateForm(currentMeeting);
                } catch (error) {
                        console.error("Error initializing preparation reunions:", error);
                        this.app.showMessage(translate("error_loading_preparation_reunions"), "error");
                }
        }

        async fetchReminder() {
                try {
                        const data = await fetchFromApi(`get_reminder`);
                        return data.success ? data.reminder : null;
                } catch (error) {
                        console.error("Error fetching reminder:", error);
                        return null;
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

        async populateForm(meetingData) {
                if (!meetingData) {
                        this.resetForm();
                        return;
                }

                this.currentDate = meetingData.date;
                document.getElementById("animateur-responsable").value = meetingData.animateur_responsable || '';
                document.getElementById("date").value = meetingData.date || this.currentDate;

                // Handle Louveteau d'honneur
                const louveteauxDHonneur = document.getElementById("louveteau-dhonneur");
                if (Array.isArray(meetingData.louveteau_dhonneur)) {
                        louveteauxDHonneur.innerHTML = meetingData.louveteau_dhonneur.map(honor => `<li>${honor}</li>`).join('');
                } else if (typeof meetingData.louveteau_dhonneur === 'string') {
                        louveteauxDHonneur.innerHTML = `<li>${meetingData.louveteau_dhonneur}</li>`;
                } else {
                        louveteauxDHonneur.innerHTML = this.recentHonors.map(h => `<li>${h.first_name} ${h.last_name}</li>`).join('');
                }

                document.getElementById("endroit").value = meetingData.endroit || this.organizationSettings.organization_info?.endroit || '';

                // Prepopulate the notes and fetch reminders
                const notes = meetingData.notes || '';
                if (this.reminder) {
                        const currentDate = new Date();
                        const reminderDate = new Date(reminder.reminder_date);
                        if (this.reminder.is_recurring || reminderDate >= currentDate) {
                                const reminderText = `\n\n${translate("reminder_text")}: ${this.reminder.reminder_text}`;
                                document.getElementById('notes').value = notes + reminderText;
                        } else {
                                document.getElementById('notes').value = notes;  // Keep the notes without the reminder if it expired
                        }
                } else {
                        document.getElementById('notes').value = notes; // No reminder found
                }

                // Combine default and saved activities
                const defaultActivities = this.initializePlaceholderActivities();
                const loadedActivities = meetingData.activities || [];
                const totalActivities = Math.max(defaultActivities.length, loadedActivities.length);

                this.selectedActivities = [];

                for (let i = 0; i < totalActivities; i++) {
                        const defaultActivity = defaultActivities[i] || {};  // Default activity if available
                        const savedActivity = loadedActivities[i] || {};     // Loaded activity if available

                        this.selectedActivities.push({
                                ...defaultActivity,  // Fill with default values
                                ...savedActivity,    // Overwrite with saved values
                                position: i,         // Ensure position is assigned correctly
                                isDefault: savedActivity.isDefault === undefined ? true : savedActivity.isDefault
                        });
                }

                this.renderActivitiesTable();  // Render the activities with their correct positions
        }

        // Function to dynamically add extra fields if they are present in meetingData but not in the default form
        addExtraField(key, value) {
                // Example of adding a dynamic field as an input (this can be customized based on the field type)
                const formGroup = document.createElement('div');
                formGroup.classList.add('form-group');

                const label = document.createElement('label');
                label.setAttribute('for', key);
                label.textContent = translate(key);  // Assuming a translation function is available

                const input = document.createElement('input');
                input.setAttribute('type', 'text');
                input.setAttribute('id', key);
                input.setAttribute('value', value);
                input.classList.add('dynamic-field');  // Class to identify dynamically added fields

                formGroup.appendChild(label);
                formGroup.appendChild(input);

                // Insert the new field into the form (adjust the position if necessary)
                const form = document.getElementById('reunion-form');
                form.appendChild(formGroup);
        }



        async saveReminderSettings(reminderDate, isRecurring) {
                        const reminderText = document.getElementById('reminder-text').value;

                        const reminderData = {
                                        reminder_text: reminderText,
                                        reminder_date: reminderDate,
                                        is_recurring: isRecurring,
                                        organization_id: this.app.organizationId, // Assuming organizationId is available in this.app
                        };

                        try {
                                        const result = await fetchFromApi('save_reminder', 'POST', reminderData);
                                        this.app.showMessage(translate("reminder_saved_successfully"), "success");
                        } catch (error) {
                                        console.error("Error saving reminder:", error);
                                        this.app.showMessage(translate("error_saving_reminder"), "error");
                        }
        }



         async fetchData() {
                 const settingsResponse = await getOrganizationSettings();
                [this.activities, this.recentHonors] = await Promise.all([
                        getActivitesRencontre(),
                        getRecentHonors()
                ]);

                // Handle both .settings and .data response formats
                this.organizationSettings = settingsResponse.settings || settingsResponse.data || settingsResponse || {};
        }

        async fetchAvailableDates() {
                        const response = await getReunionDates();
                        // Handle both array response and object response with dates property
                        const dates = Array.isArray(response) ? response : (response?.dates || []);
                        // Convert ISO date strings to plain dates and ensure they're strings
                        this.availableDates = dates.map(d => typeof d === 'string' && d.includes('T') ? d.split('T')[0] : d);
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
                 
                                
                                
                                        <div class="date-navigation">
                                                <select id="date-select">
                                                <option value="">${translate("select_date")}</option>
                                                        ${this.availableDates.map(date => 
                                                                `<option value="${date}" ${date === this.currentMeetingData?.date ? 'selected' : ''}>${this.formatDate(date)}</option>`
                                                        ).join('')}
                                                </select>
                                                
                                                
                                        </div>
                                        <p><button id="new-meeting">${translate("new_meeting")}</button></p>
                                
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
                                                <button type="button" id="print-button">${translate("print")}</button> <button type="button" id="toggle-quick-edit">${translate("toggle_quick_edit_mode")}</button>
                                        </div>
                                </form>
<h2>${translate("set_reminder")}</h2>
<form id="reminder-form">
        <div class="form-group">
                <label for="reminder-text">${translate("reminder_text")}:</label>
                <textarea id="reminder-text" rows="3"></textarea>
        </div>

        <div class="form-group">
                <label for="reminder-date">${translate("reminder_date")}:</label>
                <input type="date" id="reminder-date" required>
        </div>

        <div class="form-group">
                <label for="recurring-reminder">
                        <input type="checkbox" id="recurring-reminder">
                        ${translate("recurring_reminder")}
                </label>
        </div>

        <button type="submit">${translate("save_reminder")}</button>
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

        // Function to format the duration into HH:MM
        formatMinutesToHHMM(minutes) {
                        const hours = Math.floor(minutes / 60);
                        const mins = minutes % 60;
                        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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
                        const totalMinutes = activity.estimated_time_max || 0;
                        durationInput.value = this.formatMinutesToHHMM(totalMinutes);

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

        preventEnterKeyDefault() {
                        const inputs = document.querySelectorAll('form, .activity-time, .activity-duration, .activity-select, .activity-responsable, .activity-materiel');

                        inputs.forEach(input => {
                                        input.addEventListener('keydown', (e) => {
                                                        if (e.keyCode === 13) {  // 13 is the Enter key
                                                                        e.preventDefault();  // Prevent form submission
                                                        }
                                        });
                        });
        }

        async handleReminderSubmit(e) {
                e.preventDefault();
                e.stopPropagation();

                const reminderText = document.getElementById('reminder-text').value;
                const reminderDate = document.getElementById('reminder-date').value;
                const isRecurring = document.getElementById('recurring-reminder').checked;

                const reminderData = {
                        reminder_text: reminderText,
                        reminder_date: reminderDate,
                        is_recurring: isRecurring,
                        organization_id: this.app.organizationId, // Get the current organization ID
                };

                try {
                        // Save the reminder using the existing fetchFromApi function
                        const result = await fetchFromApi('save_reminder', 'POST', reminderData);
                        this.app.showMessage(translate("reminder_saved_successfully"), "success");
                } catch (error) {
                        this.app.showMessage(translate("error_saving_reminder"), "error");
                }
        }



        attachEventListeners() {

                 this.preventEnterKeyDefault();
                // Add listeners for form submission, date navigation, activity editing, etc.

                document.getElementById('reminder-form').addEventListener('submit', (e) => this.handleReminderSubmit(e));
                
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

                document.addEventListener("input", (e) => {
                                if (e.target.matches(".activity-select, .activity-responsable, .activity-time, .activity-duration, .activity-materiel")) {
                                                const row = e.target.closest(".activity-row");
                                                console.log("Field input detected:", e.target);  // Debugging log to check if the listener is triggered
                                                row.setAttribute("data-default", "false");
                                                e.target.setAttribute("data-default", "false");
                                }
                });


                        document.addEventListener("submit", (e) => {
                                e.preventDefault();
                                if (e.target.matches("#reunion-form")) {                                
                                this.handleSubmit(e);
                        }
                });

                document.addEventListener("click", (e) => {
                        if (e.target.matches("#print-button")) {
                                this.printPreparation();
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

                // Initial call to set up event listeners
                this.addDurationListeners();
                
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
                // Combine default placeholder activities and loaded activities
                const defaultActivities = this.initializePlaceholderActivities(); // Default placeholders
                const totalActivities = Math.max(this.selectedActivities.length, defaultActivities.length);

                // Merge loaded activities with placeholders, or extend beyond placeholders if needed
                const activitiesToRender = [];
                for (let i = 0; i < totalActivities; i++) {
                        // Check if there's a saved activity at this position
                        const savedActivity = this.selectedActivities[i] || {};  // Loaded activity or empty if missing
                        const defaultActivity = defaultActivities[i] || {};      // Default activity (if available)

                        // Combine saved activity data with default placeholders
                        const activity = {
                                ...defaultActivity,   // Fill with default values
                                ...savedActivity,     // Overwrite with saved data
                                position: i,          // Ensure correct position
                                isDefault: savedActivity.isDefault === undefined ? true : savedActivity.isDefault  // Handle default flag
                        };

                        activitiesToRender.push(activity);
                }

                // Now render exactly the activities that need to be shown, no more, no less
                const activitiesHtml = activitiesToRender.map((activity, index) => {
                        return this.renderActivityRow(activity, index);
                }).join('');

                // Insert the HTML into the activities table
                document.querySelector('#activities-table tbody').innerHTML = activitiesHtml;
                this.addDurationListeners();
        }





        renderActivityRow(a, index) {
                // Convert duration to minutes if it isn't already
                const durationMinutes = parseInt(a.duration.split(':')[0]) * 60 + parseInt(a.duration.split(':')[1]);
                const formattedDuration = this.formatMinutesToHHMM(durationMinutes);  // Format duration into HH:MM

                        // Handle default values for missing fields
                        const isCustomActivity = !this.activities.some(activity => activity.activity === a.activity);
                        const activityName = a.activity || translate("default_activity_name");
                        const time = a.time || '18:30';
                        const duration = a.duration || '00:00';
                        const responsable = a.responsable || translate("default_responsable");
                        const materiel = a.materiel || '';

                        // Render responsable field (dropdown or input)
                        const responsableExists = !a.responsable || this.animateurs.some(animateur => animateur.full_name === a.responsable);
                        const responsableField = responsableExists ? `
                                        <select class="activity-responsable" data-default="${a.isDefault}">
                                                        <option value="">${translate("select_animateur")}</option>
                                                        ${this.animateurs.map(animateur => `
                                                                        <option value="${animateur.full_name}" ${animateur.full_name === a.responsable ? 'selected' : ''}>${animateur.full_name}</option>
                                                        `).join('')}
                                                        <option value="other">${translate("other")}</option>
                                        </select>
                        ` : `
                                        <input type="text" value="${a.responsable}" class="responsable-input" data-default="${a.isDefault}" contenteditable="true">
                        `;

                        return `
                                        <tr class="activity-row" data-id="${a.id || index}" data-position="${a.position || index}" data-default="${a.isDefault}">
                                                        <td><div class="activity-time-container">
                                                                        <input type="time" value="${time}" class="activity-time">
                                                                        <input type="text" value="${duration}" class="activity-duration">
                                                                        </div>
                                                        </td>
                                                        <td>
                                                        <div class="activity-container">
                                                                        <select class="activity-select" data-default="${a.isDefault}">
                                                                                        ${isCustomActivity ? `<option>${activityName}</option>` : ''}
                                                                                        <option value="">${translate("select_activity")}</option>
                                                                                        ${this.activities.map(act => `<option data-id="${act.id}" value="${act.activity}" ${act.activity === a.activity ? 'selected' : ''}>${act.activity}</option>`).join('')}
                                                                        </select>
                                                                        <button type="button" class="edit-activity-btn" title="${translate("edit")}">✎</button>
                                                        </div>
                                                        <div>
                                                        <div class="responsable-container">
                                                                        ${responsableField}
                                                        </div>
                                                        <input type="text" value="${materiel}" class="activity-materiel" placeholder="${translate("materiel")}" data-default="${a.isDefault}">
                                                                </div>
                                                                <div class="actions">
                                                                                <button class="add-row-btn hidden" data-position="${index}">+ ${translate("Add")}</button>
                                                                                <button class="delete-row-btn hidden" data-position="${index}">- ${translate("Delete")}</button>
                                                                </div>
                                                        </td>
                                        </tr>
                        `;
        }

        // Function to parse the time string (HH:MM)
         parseTime(timeString) {
                        const [hours, minutes] = timeString.split(':').map(Number);
                        return { hours, minutes };
        }

        // Function to format time back into HH:MM
        formatTime(hours, minutes) {
                        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        // Function to add duration to a start time
        addDurationToTime(startTime, duration) {
                        const timeParts = this.parseTime(startTime);
                        const durationParts = this.parseTime(duration);

                        let totalMinutes = timeParts.minutes + durationParts.minutes;
                        let totalHours = timeParts.hours + durationParts.hours + Math.floor(totalMinutes / 60);

                        totalMinutes = totalMinutes % 60;
                        totalHours = totalHours % 24;  // Ensure that we don't exceed 24-hour format

                        return this.formatTime(totalHours, totalMinutes);
        }

        // Function to update times for following rows based on the duration of the current row
        updateFollowingTimes(rowIndex) {
                        const rows = document.querySelectorAll('.activity-row');

                        for (let i = rowIndex; i < rows.length - 1; i++) {
                                        const currentRow = rows[i];
                                        const nextRow = rows[i + 1];

                                        const currentEndTime = this.addDurationToTime(
                                                        currentRow.querySelector('.activity-time').value,
                                                        currentRow.querySelector('.activity-duration').value
                                        );

                                        const nextTimeInput = nextRow.querySelector('.activity-time');
                                        nextTimeInput.value = currentEndTime;  // Update the next row's start time
                        }
        }

        // Add event listeners either to all rows (if no newRow is passed) or just the newRow
        addDurationListeners(newRow = null) {
                        const rows = newRow ? [newRow] : document.querySelectorAll('.activity-row');

                        rows.forEach(row => {
                                        const durationInput = row.querySelector('.activity-duration');
                                        const timeInput = row.querySelector('.activity-time');

                                        durationInput.addEventListener('input', (event) => {
                                                        // Format the duration input
                                                        let inputValue = event.target.value;
                                                        let minutes = 0;

                                                        if (inputValue.includes(':')) {
                                                                        const [hours, mins] = inputValue.split(':').map(Number);
                                                                        minutes = hours * 60 + mins;
                                                        } else {
                                                                        minutes = parseInt(inputValue, 10);
                                                        }

                                                        if (!isNaN(minutes)) {
                                                                        event.target.value = this.formatMinutesToHHMM(minutes);
                                                                        const rowIndex = Array.from(document.querySelectorAll('.activity-row')).indexOf(row);
                                                                        this.updateFollowingTimes(rowIndex);
                                                        }
                                        });

                                        timeInput.addEventListener('input', (event) => {
                                                        const rowIndex = Array.from(document.querySelectorAll('.activity-row')).indexOf(row);
                                                        this.updateFollowingTimes(rowIndex);
                                        });
                        });
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
                this.saveActivityInputs();
                        this.renderActivitiesTable();
        }

        deleteActivityRow(position) {
                        this.selectedActivities.splice(position, 1);
                        this.recalculatePositions();
                this.saveActivityInputs();
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

                                                        // Check if the responsable field is a select or an input
                                                        const responsableInput = row.querySelector('.responsable-input');
                                                        const responsableSelect = row.querySelector('.activity-responsable');
                                                        const responsable = responsableInput ? responsableInput.value : responsableSelect ? responsableSelect.value : '';

                                                        console.log('Captured Responsable:', responsable); // Debugging log to verify responsable is captured

                                                        return {
                                                                        ...activity,
                                                                        position: parseInt(row.getAttribute('data-position'), 10),  // Ensure position is an integer
                                                                        id: row.getAttribute('data-id'),
                                                                        time: row.querySelector('.activity-time').value,
                                                                        duration: row.querySelector('.activity-duration').value,
                                                                        activity: row.querySelector('.activity-input')?.value || row.querySelector('.activity-select')?.value,
                                                                        responsable: responsable,  // Capture responsable from either select or input
                                                                        materiel: row.querySelector('.activity-materiel').value,
                                                                        isDefault: false  // Only modified activities are saved
                                                        };
                                        });

                        const formData = {
                                        organization_id: this.app.organizationId,
                                        animateur_responsable: document.getElementById('animateur-responsable').value,
                                        date: document.getElementById('date').value,
                                        louveteau_dhonneur: Array.from(document.getElementById('louveteau-dhonneur').querySelectorAll('li')).map(li => li.textContent),
                                        endroit: document.getElementById('endroit').value,
                                        activities: updatedActivities,  // Only modified activities are saved
                                        notes: document.getElementById('notes').value,
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

        saveActivityInputs() {
                const rows = document.querySelectorAll('.activity-row');
                rows.forEach((row, index) => {
                        const id = row.dataset.id || index;
                        this.selectedActivities[index] = {
                                ...this.selectedActivities[index],
                                id,
                                time: row.querySelector('.activity-time')?.value || '',
                                duration: row.querySelector('.activity-duration')?.value || '',
                                activity: row.querySelector('.activity-select')?.value || row.querySelector('.activity-input')?.value || '',
                                responsable: row.querySelector('.activity-responsable')?.value || row.querySelector('.responsable-input')?.value || '',
                                materiel: row.querySelector('.activity-materiel')?.value || '',
                                isDefault: row.getAttribute('data-default') === 'true'
                        };
                });
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
                                                                                                        line-height: 1.1;
                                                                                        }
                                                                                        .print-preparation { 
                                                                                                        max-width: 800px; 
                                                                                                        margin: 0 auto; 
                                                                                        }
                                                                                        h1, h2 { 
                                                                                                        text-align: center; 
                                                                                                        margin:auto;
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