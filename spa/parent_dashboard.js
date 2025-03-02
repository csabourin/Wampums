import { getCurrentOrganizationId, fetchParticipants, getOrganizationFormFormats, getOrganizationSettings } from "./ajax-functions.js";
import { translate } from "./app.js";
import { urlBase64ToUint8Array, hexStringToUint8Array, base64UrlEncode } from './functions.js';

export class ParentDashboard {
	constructor(app) {
		this.app = app;
		this.participants = [];
		this.formStructures = {};
	}

	async init() {
		try {
			await this.fetchParticipants();
			await this.fetchFormFormats();
			this.render();
			this.attachEventListeners();
			 this.checkAndShowLinkParticipantsDialog();
		} catch (error) {
			console.error("Error initializing parent dashboard:", error);
			this.app.renderError(translate("error_loading_parent_dashboard"));
		}
	}

	checkAndShowLinkParticipantsDialog() {
			const guardianParticipants = JSON.parse(localStorage.getItem("guardianParticipants"));
			if (guardianParticipants && guardianParticipants.length > 0) {
					this.showLinkParticipantsDialog(guardianParticipants);
					localStorage.removeItem("guardianParticipants"); // Clear after showing
			}
	}

	showLinkParticipantsDialog(guardianParticipants) {
			const dialogContent = `
					<h2>${translate("link_existing_participants")}</h2>
					<p>${translate("existing_participants_found")}</p>
					<form id="link-participants-form">
							${guardianParticipants.map(participant => `
									<label>
											<input type="checkbox" name="link_participants" value="${participant.participant_id}">
											${participant.first_name} ${participant.last_name}
									</label>
							`).join('')}
							<button type="submit">${translate("link_selected_participants")}</button> 							<button id="cancel" type="button">${translate("cancel")}</button>
					</form>
			`;

			const dialog = document.createElement('div');
			dialog.innerHTML = dialogContent;
			dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border: 1px solid black; z-index: 1000;';
			document.body.appendChild(dialog);

		document.querySelector('#cancel').addEventListener('click', () => {
				dialog.remove();
		});

			document.getElementById('link-participants-form').addEventListener('submit', async (e) => {
					e.preventDefault();
					const formData = new FormData(e.target);
					const selectedParticipants = formData.getAll('link_participants');

					try {
							const response = await fetch('/api.php?action=link_user_participants', {
									method: 'POST',
									headers: {
											'Content-Type': 'application/json',
											'Authorization': `Bearer ${localStorage.getItem('jwtToken')}`
									},
									body: JSON.stringify({ participant_ids: selectedParticipants })
							});
							const result = await response.json();
							if (result.success) {
									this.app.showMessage(translate("participants_linked_successfully"));
									await this.fetchParticipants(); // Refresh the participants list
									this.render(); // Re-render the dashboard
							} else {
									this.app.showMessage(translate("error_linking_participants"), "error");
							}
					} catch (error) {
							console.error("Error linking participants:", error);
							this.app.showMessage(translate("error_linking_participants"), "error");
					}

					document.body.removeChild(dialog);
			});
	}

	async fetchParticipants() {
			try {
					const response = await fetchParticipants(getCurrentOrganizationId());

					// Use a Map to store unique participants
					const uniqueParticipants = new Map();

					response.forEach(participant => {
							// If this participant isn't in our Map yet, add them
							if (!uniqueParticipants.has(participant.id)) {
									uniqueParticipants.set(participant.id, participant);
							}
					});

					// Convert the Map values back to an array
					this.participants = Array.from(uniqueParticipants.values());

					console.log("Fetched participants:", this.participants);
			} catch (error) {
					console.error("Error fetching participants:", error);
					this.participants = [];
			}
	}

	async fetchFormFormats() {
		const response = await getOrganizationFormFormats();
		if (response && typeof response === 'object') {
			this.formFormats = response;
		} else {
			console.error("Invalid form formats response:", response);
		}
	}

	async fetchOrganizationInfo() {
		try {
			// Fetch all organization settings
			const response = await getOrganizationSettings();

			// Check if the response is successful and contains settings
			if (response && response.success && response.settings) {
				// Get the organization_info setting
				const organizationInfo = response.settings.organization_info;

				// If the setting exists, extract the name, otherwise set a default
				if (organizationInfo && organizationInfo.name) {
					this.organizationName = organizationInfo.name;
				} else {
					this.organizationName = translate("organization_name_default");
				}
			} else {
				console.error("Invalid organization info response:", response);
			}
		} catch (error) {
			console.error("Error fetching organization info:", error);
		}
	}

	async fetchUserFullName() {
		// If userFullName is not set, fetch it from the server
		if (!this.app.userFullName) {
			try {
				const response = await fetch("/api.php?action=get_user_full_name");
				const data = await response.json();
				if (data.success) {
					this.app.userFullName = data.fullName;
				} else {
					console.error("Failed to fetch user full name:", data.message);
				}
			} catch (error) {
				console.error("Error fetching user full name:", error);
			}
		}
	}

	render() {
		 const organizationName = this.app.organizationSettings?.organization_info?.name || "Scouts";
		const notificationButton = this.shouldShowNotificationButton()
			? `<li>
					<button id="enableNotifications" class="dashboard-button">
						${translate("enable_notifications")}
					</button>
				</li>`
			: ''; // Only render the button if needed

		const installButton = `<li>
					<button id="installPwaButton" style="display: none;" class="dashboard-button">
						${translate("install_app")}
					</button>
				</li>`; // Initially hidden

		// Check if the user role is admin or animation
		const backLink = this.app.userRole === "admin" || this.app.userRole === "animation"
			? `<a href="/dashboard">${translate("back_to_dashboard")}</a>`
			: ``;

		// Dynamically replace the title with the organization name
		const content = `
			<div class="parent-dashboard">
				<h1>${translate("bienvenue")} ${this.app.userFullName}</h1>
				<h2>${organizationName}</h2>
				${backLink}
				<nav>
					<ul class="dashboard-menu">
						<li><a href="/formulaire-inscription" class="dashboard-button">${translate("ajouter_participant")}</a></li>
						${this.renderParticipantsList()}
						${notificationButton}
						${installButton}
						<li><a href="/logout" class="dashboard-button logout-button">${translate("deconnexion")}</a></li>
					</ul>
				</nav>
			</div>
		`;
		document.getElementById("app").innerHTML = content;
	}


	// Check notification permission and decide whether to show the button
	shouldShowNotificationButton() {
		if ('Notification' in window) {
		return Notification.permission === "default" || Notification.permission === "denied";
		} return false;
	}

	renderParticipantsList() {
		if (!Array.isArray(this.participants) || this.participants.length === 0) {
			return `<p>${translate("no_participants")}</p>`;
		}

		return this.participants.map(participant => `
			<div class="participant-card">
				<h3>${participant.first_name} ${participant.last_name}</h3>
				<a href="/formulaire-inscription/${participant.id}" class="dashboard-button">${translate("modifier")}</a>
				<div class="participant-actions">
				${this.renderFormButtons(participant)}
				</div>
			</div>
		`).join("");
	}

renderFormButtons(participant) {
    console.log("Forms type: ", this.formFormats);

    return Object.keys(this.formFormats)
        .filter(formType => {
            // Exclude 'participant_registration' and 'parent_guardian' for all users
            if (formType === 'participant_registration' || formType === 'parent_guardian') {
                return false; // Hide these forms
            }
            return true; // Show all other forms
        })
        .map(formType => {
            const formLabel = translate(formType);
            const isCompleted = participant[`has_${formType}`] === 1 || participant[`has_${formType}`] === true;
            const status = isCompleted ? "✅" : "❌";
            
            return `
                <a href="/dynamic-form/${formType}/${participant.id}">
                    ${status} ${formLabel}
                </a>
            `;
        })
			.join("") + `
				<a href="/badge-form/${participant.id}">
					${translate('manage_badge_progress')}
				</a>
			`;
}




	attachEventListeners() {
		const notificationButton = document.getElementById('enableNotifications');
		if (notificationButton) {
			notificationButton.addEventListener('click', async () => {
				await this.requestNotificationPermission();
			});
		}

		// Install PWA button logic
		const installButton = document.getElementById('installPwaButton');
		let deferredPrompt;

		window.addEventListener('beforeinstallprompt', (e) => {
			console.log('beforeinstallprompt event fired');
			// Prevent the default prompt
			e.preventDefault();
			deferredPrompt = e;

			// Show the install button
			installButton.style.display = 'block';

			// Add click event to the install button
			installButton.addEventListener('click', async () => {
				if (deferredPrompt) {
					// Show the install prompt
					deferredPrompt.prompt();

					// Check the user's response
					const choiceResult = await deferredPrompt.userChoice;
					if (choiceResult.outcome === 'accepted') {
						console.log('User accepted the install prompt');
					} else {
						console.log('User dismissed the install prompt');
					}

					// Clear the deferredPrompt so it can’t be reused
					deferredPrompt = null;

					// Hide the install button after interaction
					installButton.style.display = 'none';
				}
			});
		});

		window.addEventListener('appinstalled', () => {
			console.log('App has been installed');
		});
	}



  async requestNotificationPermission() {
		if ('Notification' in window) {
			// Proceed with Notification logic
			if (Notification.permission === 'granted') {
				registerPushSubscription();
			} else if (Notification.permission === 'default') {
				Notification.requestPermission().then((permission) => {
					if (permission === 'granted') {
						registerPushSubscription();
					}
				});
			}
		} else {
			console.error('This browser does not support notifications.');
		}

  }

	 async registerPushSubscription() {
			if ('serviceWorker' in navigator && 'PushManager' in window) {
				try {
					const registration = await navigator.serviceWorker.ready;
					const applicationServerKey = urlBase64ToUint8Array('BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE');
					const subscription = await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: applicationServerKey,
					});

					console.log('Push subscription:', subscription);

					// Send subscription to your server to save it
					await fetch('/save-subscription', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(subscription),
					});
				} catch (error) {
					console.error('Error registering for push notifications:', error);
				}
			}
		}

		renderError() {
			const errorMessage = `
				<h1>${translate("error")}</h1>
				<p>${translate("error_loading_parent_dashboard")}</p>
			`;
			document.getElementById("app").innerHTML = errorMessage;
		}
	}