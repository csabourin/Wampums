import {
	saveOfflineData,
	getOfflineData,
	clearOfflineData,
} from "./indexedDB.js";
import { initRouter, Router } from "./router.js";
import { Login } from "./login.js";
import { getOrganizationSettings, fetchOrganizationId } from "./ajax-functions.js";

const debugMode =
	window.location.hostname === "localhost" ||
	window.location.hostname.includes("replit.dev")
		? true
		: false;

function debugLog(...args) {
	if (debugMode) {
		console.log(...args);
	}
}

function debugError(...args) {
	if (debugMode) {
		console.error(...args);
	}
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker
		.register("/service-worker.js")
		.then(function (registration) {})
		.catch(function (error) {
			console.error("Service Worker registration failed:", error);
		});
}



// Add this function to your app object or as a separate utility function
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - base64String.length % 4) % 4);
	const base64 = (base64String + padding)
		.replace(/\-/g, '+')
		.replace(/_/g, '/');

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

async function registerPushSubscription() {
	if ('serviceWorker' in navigator && 'PushManager' in window) {
		try {
			const registration = await navigator.serviceWorker.ready;
			const applicationServerKey = urlBase64ToUint8Array('BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE');

			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: applicationServerKey,
			});

			// Log the full subscription object to see what it contains
			console.log('Subscription object:', subscription);
			console.log('Subscription object:', subscription.toJSON());

			const subscriptionData =subscription.toJSON()

			// Send the subscription object to the server
			await sendSubscriptionToServer(subscriptionData);

		} catch (error) {
			console.error('Error during push subscription:', error);
		}
	}
}




// Function to send subscription to server (implement this based on your backend)
async function sendSubscriptionToServer(subscription) {
	const p256dh = subscription.keys?.p256dh || null;
	const auth = subscription.keys?.auth || null;

	if (!p256dh || !auth) {
		console.error('Missing p256dh or auth keys in subscription:', subscription);
		return;
	}

	const payload = {
		endpoint: subscription.endpoint,
		expirationTime: subscription.expirationTime,
		keys: {
			p256dh: p256dh,
			auth: auth
		}
	};

	console.log('Sending payload to server:', payload);

	try {
		// Retrieve the JWT token from localStorage
		const token = localStorage.getItem('jwtToken'); // Ensure the token is stored correctly after login

		if (!token) {
			console.error('No token found in localStorage.');
			throw new Error('No token available');
		}

		const response = await fetch('/save-subscription.php', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}` // Include the JWT token in the Authorization header
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error('Failed to save subscription on server');
		}

		console.log('Subscription saved on server');
	} catch (error) {
		console.error('Error saving subscription on server:', error);
	}
}




// Call this function when you want to register for push notifications
// For example, you might call this after a user logs in or gives permission


export const app = {
	isLoggedIn: false,
	userRole: null,
	userFullName: null,
	lang: null,
	currentPage: "",
	translations: {},
	db: null,
	router: null,
	organizationSettings: null, 
	organizationId: null,
	isOrganizationSettingsFetched:false,

	 async init() {
		 this.initialLoad = true;
		debugLog("App init started");
		 console.count("App init started");
			this.createMessageBanner();
		try {
			this.registerServiceWorker();

			// Fetch organization settings early on during initialization
			try {
				this.organizationId = await fetchOrganizationId();
				localStorage.setItem('currentOrganizationId', this.organizationId);
			} catch (error) {
				console.error("Error fetching organization ID:", error);
			}
			await this.fetchOrganizationSettings();
			 this.initLanguageToggle();


			// Check localStorage
			debugLog("LocalStorage at init:", {
				jwtToken: localStorage.getItem("jwtToken"),
				userRole: localStorage.getItem("userRole"),
				userFullName: localStorage.getItem("userFullName"),
			});

			// Check for existing session
			const session = Login.checkSession();
			this.isLoggedIn = session.isLoggedIn;
			this.userRole = session.userRole;
			this.userFullName = session.userFullName;

						debugLog("Session checked:", {
				isLoggedIn: this.isLoggedIn,
				userRole: this.userRole,
				userFullName: this.userFullName,
			});
			if (this.isLoggedIn) {
							// User is logged in, proceed with post-login actions
							this.handlePostLoginActions();
			}

			

			this.router = initRouter(this);

					 // Instead of immediately navigating, let the router handle the initial route
							if (!this.initialLoad) {
									this.router.route(window.location.pathname);
									this.initialLoad = true;
							}

							this.syncOfflineData();
							console.log("App init completed");
					} catch (error) {
							console.error("Initialization error:", error);
					}
			},

	async fetchOrganizationSettings() {
			if (this.isOrganizationSettingsFetched) return; // Prevent multiple fetch calls

			try {
					debugLog("Fetching organization settings...");
					const response = await getOrganizationSettings();
					if (response.success) {
							this.organizationSettings = response.settings;
							this.isOrganizationSettingsFetched = true;  // Mark as fetched
							debugLog("Organization settings fetched:", this.organizationSettings);
					} else {
							debugError("Failed to fetch organization settings:", response.message);
					}
			} catch (error) {
					debugError("Error fetching organization settings:", error);
			}
	},

	async loadTranslations() {
			if (Object.keys(this.translations).length > 0) return; // Skip if already loaded

			try {
					const response = await fetch("/get_translations.php");
					this.translations = await response.json();
					debugLog("Translations loaded:", this.translations);
			} catch (error) {
					console.error("Error loading translations:", error);
					this.translations = {};
			}
	},
	
	async handlePostLoginActions() {
					if ('Notification' in window) {
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
	},

	showMessage(message, type = 'info') {
		const banner = document.getElementById('message-banner');
		banner.textContent = translate(message);
		banner.style.backgroundColor = type === 'error' ? '#d9534f' : '#5bc0de';
		banner.style.bottom = '0';

		setTimeout(() => {
			banner.style.bottom = '-50px';
		}, 3000);
	},

	createMessageBanner() {
		const banner = document.createElement('div');
		banner.id = 'message-banner';
		banner.style.cssText = `
			position: fixed;
			bottom: -50px;
			left: 0;
			right: 0;
			background-color: #333;
			color: white;
			text-align: center;
			padding: 10px;
			transition: bottom 0.3s;
			z-index: 1000;
		`;
		document.body.appendChild(banner);
	},

	setLanguage(lang) {
			this.lang = lang;
			document.documentElement.lang = lang;
			localStorage.setItem('lang', lang);
			this.loadTranslations().then(() => {
					if (this.router) {
							this.router.reloadCurrentRoute();
					}
			});
	},

	initLanguageToggle() {
			const toggleButtons = document.querySelectorAll('.lang-btn');
			toggleButtons.forEach(btn => {
					btn.addEventListener('click', () => {
							const newLang = btn.dataset.lang;
							this.setLanguage(newLang);
							toggleButtons.forEach(b => b.classList.remove('active'));
							btn.classList.add('active');
							this.router.reloadCurrentRoute();
					});
			});

			// Set initial language
			const savedLang = localStorage.getItem('lang') || 'fr';
			this.setLanguage(savedLang);
			document.querySelector(`.lang-btn[data-lang="${savedLang}"]`).classList.add('active');
	},

	async loadTranslations() {
		debugLog("Loading translations");
		try {
			const response = await fetch("/get_translations.php");
			this.translations = await response.json();
			debugLog("Translations loaded:", this.translations);
		} catch (error) {
			console.error("Error loading translations:", error);
			this.translations = {};
		}
	},

	async registerServiceWorker() {
		if ("serviceWorker" in navigator) {
			window.addEventListener("load", () => {
				navigator.serviceWorker
					.register("/service-worker.js")
					.then((registration) => {
						debugLog(
							"Service Worker registered with scope:",
							registration.scope
						);
					})
					.catch((error) => {
						console.error("Service Worker registration failed:", error);
					});
			});
		}
	},

	showLoading() {
		let loadingIndicator = document.getElementById("loading-indicator");
		loadingIndicator.classlList.remove("hidden");
	},

	hideLoading() {
		let loadingIndicator = document.getElementById("loading-indicator");
		loadingIndicator.classList.add("hidden");
	},

	renderError(message) {
		debugLog("Rendering error:", message);
		const errorContent = `
			<h1>${this.translate("error")}</h1>
			<p>${message}</p>
			<p><a href="/">${this.translate("back_to_home")}</a></p>
		`;
		document.getElementById("app").innerHTML = errorContent;
	},

	translate(key) {
			const lang = this.lang || 'fr';
			return this.translations[lang]?.[key] || key;
	},
	
		async syncOfflineData() {
		if (navigator.onLine) {
			try {
				// Ensure database is initialized
				const offlineData = await getOfflineData();
				if (offlineData.length > 0) {
					debugLog("Syncing offline data:", offlineData);
					await clearOfflineData(); // Clear the offline data after sync
				}
			} catch (error) {
				console.error("Error syncing offline data:", error);
			}
		}
	},

	showOfflineNotification(status) {
		const offlineIndicator = document.getElementById("offline-indicator");
		if (offlineIndicator) {
			if (status === "offline") {
				offlineIndicator.classList.remove("hidden");
			} else {
				offlineIndicator.classList.add("hidden");
			}
		}
	},
};

navigator.serviceWorker.addEventListener('message', function(event) {
	if (event.data && event.data.type === 'PUSH_ALERT') {
		const title = event.data.title || 'New Notification';
		const body = event.data.body || '';
		alert(`${title}\n\n${body}`);
	}
});

window.addEventListener("online", () => {
	debugLog("App is online");
	app.showOfflineNotification("online");
	document.body.classList.remove("offline");
	// Use app object instead of this
	app.syncOfflineData();
});

window.addEventListener("offline", () => {
	debugLog("App is offline");
	document.body.classList.add("offline");
	app.showOfflineNotification("offline");
});

// Check initial online status
if (!navigator.onLine) {
	document.body.classList.add("offline");
	app.showOfflineNotification("offline");
} else {
	app.showOfflineNotification("online");
}

app.init();
export const translate = app.translate.bind(app);
