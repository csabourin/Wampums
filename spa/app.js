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
		.then(function (registration) { })
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
			console.log('Subscription JSON:', subscription.toJSON());

			const subscriptionData = subscription.toJSON();

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
	isOrganizationSettingsFetched: false,
	initCompleted: false,

	async init() {
		console.log("App init started");
		this.createMessageBanner();

		const token = localStorage.getItem("jwtToken");
		if (token) {
			try {
				// Validate token first
				const isValid = await validateToken();
				if (!isValid) {
					// Clear invalid token
					localStorage.removeItem("jwtToken");
					localStorage.removeItem("userRole");
					localStorage.removeItem("userFullName");
					localStorage.removeItem("userId");
				}
			} catch (error) {
				console.error("Token validation failed:", error);
			}
		}

		try {
			this.registerServiceWorker();

			// Check localStorage for organization ID
			const storedOrgId = localStorage.getItem('currentOrganizationId');
			if (storedOrgId) {
				this.organizationId = storedOrgId;
				console.log("Using stored organization ID:", storedOrgId);
			} else {
				// Fetch organization ID if not in localStorage
				try {
					console.log("Fetching organization ID...");
					this.organizationId = await fetchOrganizationId();
					localStorage.setItem('currentOrganizationId', this.organizationId);
					console.log("Organization ID fetched and stored:", this.organizationId);
				} catch (error) {
					console.error("Error fetching organization ID:", error);
					// Set a default organization ID to prevent blocking the app
					this.organizationId = 1;
					localStorage.setItem('currentOrganizationId', this.organizationId);
					console.log("Using default organization ID: 1");
				}
			}

			// Check for JWT token
			const token = localStorage.getItem('jwtToken');
			if (!token && this.organizationId) {
				// If no token exists but we have organization ID, get an organization JWT
				try {
					console.log("No JWT token found, fetching organization JWT...");
					const data = await fetchOrganizationJwt(this.organizationId);
					if (data.success && data.token) {
						localStorage.setItem('jwtToken', data.token);
						console.log("Organization JWT obtained successfully");
					} else {
						console.warn("Failed to get organization JWT:", data);
					}
				} catch (error) {
					console.error("Error getting organization JWT:", error);
				}
			} else {
				console.log("JWT token already exists in localStorage");
			}
			// Try to fetch organization settings, but don't block the app if it fails
			try {
				console.log("Fetching organization settings...");
				await this.fetchOrganizationSettings();
			} catch (error) {
				console.error("Error fetching organization settings:", error);
				// Create default settings to prevent blocking the app
				this.organizationSettings = { organization_info: { name: "Scoutsss" } };
				this.isOrganizationSettingsFetched = true;
				console.log("Using default organization settings");
			}

			this.initLanguageToggle();

			// Check for existing session
			const session = Login.checkSession();
			this.isLoggedIn = session.isLoggedIn;
			this.userRole = session.userRole;
			this.userFullName = session.userFullName;

			console.log("Session checked:", {
				isLoggedIn: this.isLoggedIn,
				userRole: this.userRole,
				userFullName: this.userFullName,
			});

			if (this.isLoggedIn) {
				// User is logged in, proceed with post-login actions
				this.handlePostLoginActions();
			}

			// Initialize router
			console.log("Initializing router...");
			this.router = initRouter(this);

			// Always route to the current path after initialization
			const currentPath = window.location.pathname;
			console.log(`Routing to current path: ${currentPath}`);
			this.router.route(currentPath);

			this.syncOfflineData();
			this.initCompleted = true;
			console.log("App init completed");
		} catch (error) {
			console.error("Initialization error:", error);

			// Create a simple message to inform the user even if initialization fails
			document.getElementById("app").innerHTML = `
				<div class="error-container">
					<h1>Application Error</h1>
					<p>There was a problem loading the application. Please try reloading the page.</p>
					<button onclick="window.location.reload()">Reload</button>
				</div>
			`;
		}
	},

	async fetchOrganizationSettings() {
		console.log("Inside fetchOrganizationSettings, this:", this);
		if (this.isOrganizationSettingsFetched) {
			console.log("Organization settings already fetched, skipping");
			return;
		}
		try {
			console.log("Fetching organization settings (259) ...", this.organizationId);

			const response = await getOrganizationSettings(this.organizationId);
			if (response && response.organization_info || response.data) {
				console.log("Got organization settings: ", JSON.stringify(response));
				// The fix is here - use response.data directly as the settings
				this.organizationSettings = response.data || response;  // This is correct
				this.isOrganizationSettingsFetched = true;
				console.log("Organization settings fetched successfully:", this.organizationSettings);
			} else {
				console.warn("Failed to fetch organization settings:", response?.message || "Unknown error");
				// Set default organization settings
				this.organizationSettings = { organization_info: { name: "Scouts" } };
				this.isOrganizationSettingsFetched = true;
				console.log("Using default organization settings");
			}
		} catch (error) {
			console.error("Error fetching organization settings:", error);
			// Set default organization settings
			this.organizationSettings = { organization_info: { name: "Scouts" } };
			this.isOrganizationSettingsFetched = true;
			console.log("Using default organization settings due to error");
		}
	},

	async loadTranslations() {
		if (Object.keys(this.translations).length > 0) {
			console.log("Translations already loaded, skipping");
			return;
		}
		try {
			console.log("Loading translations...");

			const [enRes, frRes] = await Promise.all([
				fetch('/lang/en.json'), // adapte le chemin selon où sont tes fichiers !
				fetch('/lang/fr.json')
			]);

			// Vérifie si le fetch a réussi
			if (!enRes.ok || !frRes.ok) throw new Error('Failed to fetch translation files.');

			const [enTranslations, frTranslations] = await Promise.all([
				enRes.json(),
				frRes.json()
			]);

			this.translations = {
				en: enTranslations,
				fr: frTranslations
			};
			console.log("Translations loaded successfully", this.translations);
		} catch (error) {
			console.error("Error loading translations:", error);
			// Fallback vide
			this.translations = {
				en: {},
				fr: {}
			};
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
			if (this.router && this.initCompleted) {
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
			});
		});

		// Set initial language
		const savedLang = localStorage.getItem('lang') || 'fr';
		this.setLanguage(savedLang);
		const activeBtn = document.querySelector(`.lang-btn[data-lang="${savedLang}"]`);
		if (activeBtn) {
			activeBtn.classList.add('active');
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
		if (loadingIndicator) {
			loadingIndicator.classList.remove("hidden");
		}
	},

	hideLoading() {
		let loadingIndicator = document.getElementById("loading-indicator");
		if (loadingIndicator) {
			loadingIndicator.classList.add("hidden");
		}
	},

	renderError(message) {
		debugLog("Rendering error:", message);
		const errorContent = `
			<div class="error-container">
				<h1>${this.translate("error")}</h1>
				<p>${message}</p>
				<p><a href="/">${this.translate("back_to_home")}</a></p>
			</div>
		`;
		const appContainer = document.getElementById("app");
		if (appContainer) {
			appContainer.innerHTML = errorContent;
		} else {
			console.error("App container not found");
		}
	},

	translate(key) {
		const lang = this.lang || 'fr';
		if (!this.translations[lang]) {
			console.log(`Failed to translating key: ${key} in language: ${lang}`);
			return key; // Return the key if language translations aren't loaded yet
		}
		return this.translations[lang][key] || key;
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

navigator.serviceWorker.addEventListener('message', function (event) {
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