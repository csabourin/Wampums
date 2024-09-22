import { fetchParticipants } from "./ajax-functions.js";
import { translate } from "./app.js";
import { urlBase64ToUint8Array, hexStringToUint8Array, base64UrlEncode } from './functions.js';

export class ParentDashboard {
	constructor(app) {
		this.app = app;
		this.participants = [];
	}

	async init() {
		try {
			console.log("ParentDashboard init, app:", this.app);
			await this.fetchParticipants();
			this.render();
			this.attachEventListeners();
		} catch (error) {
			console.error("Error initializing parent dashboard:", error);
			this.app.renderError(translate("error_loading_parent_dashboard"));
		}
	}

	async fetchParticipants() {
		this.participants = await fetchParticipants();
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

		const content = `
			<div class="parent-dashboard">
				<h1>${translate("bienvenue")} ${this.app.userFullName}</h1>
				<h2>6e A St-Paul d'Aylmer</h2>
				${backLink}
				<nav>
					<ul class="dashboard-menu">
						<li><a href="/formulaire_inscription" class="dashboard-button">${translate("ajouter_participant")}</a></li>
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
			return `<li>${translate("no_participants")}</li>`;
		}

		return this.participants
			.map(
				(participant) => `
						<li class="participant-item">
								<div class="participant-name">${participant.first_name} ${
					participant.last_name
				}</div>
								<div class="participant-actions">
										<a href="/formulaire_inscription/${
											participant.id
										}">${translate("modifier")}</a>
										<a href="/fiche_sante/${participant.id}">
												${participant.has_fiche_sante ? "✅" : "❌"}
												${translate("fiche_sante")}
										</a>
										<a href="/acceptation_risque/${participant.id}">
												${participant.has_acceptation_risque ? "✅" : "❌"}
												${translate("acceptation_risque")}
										</a>
										<a href="#/badge_form/${participant.id}">${translate(
					"badge_progress"
				)}</a>
								</div>
						</li>
				`
			)
			.join("");
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