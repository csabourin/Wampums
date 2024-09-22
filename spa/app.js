import {
	initializeDB,
	saveOfflineData,
	getOfflineData,
	clearOfflineData,
} from "./indexedDB.js";
import { initRouter, Router } from "./router.js";
import { Login } from "./login.js";

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

// news-accordion
document.addEventListener('DOMContentLoaded', function() {
		const accordion = document.querySelector('.news-accordion');
		const accordionHeader = accordion.querySelector('.news-accordion-header');
		const accordionContent = accordion.querySelector('.news-accordion-content');

		// Function to toggle accordion
		function toggleAccordion() {
				accordion.classList.toggle('open');
				saveAccordionState();
		}

		// Function to save accordion state
		function saveAccordionState() {
				localStorage.setItem('newsAccordionOpen', accordion.classList.contains('open'));
				localStorage.setItem('lastNewsTimestamp', accordion.dataset.latestTimestamp);
		}

		// Function to load accordion state
	function loadAccordionState() {
			const isOpen = localStorage.getItem('newsAccordionOpen');
			const lastTimestamp = localStorage.getItem('lastNewsTimestamp');
			const latestNewsTimestamp = accordion.dataset.latestTimestamp;

			// Open accordion if no localStorage key exists or if there's new news
			if (isOpen === null || (lastTimestamp && latestNewsTimestamp > lastTimestamp)) {
					accordion.classList.add('open');
			} else if (isOpen === 'true') {
					accordion.classList.add('open');
			}
	}

		// Add click event listener to header
		accordionHeader.addEventListener('click', toggleAccordion);

		// Load initial state
		loadAccordionState();
});


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


const app = {
	isLoggedIn: false,
	userRole: null,
	userFullName: null,
	lang: "fr", // Default language
	currentPage: "",
	translations: {},
	db: null,
	router: null,

	 async init() {
		debugLog("App init started");
		 console.count("App init started");
			this.createMessageBanner();
		try {
			this.db = await initializeDB();
			await this.loadTranslations();
			this.registerServiceWorker();


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
			this.router.route(window.location.pathname);

			this.syncOfflineData();
			debugLog("App init completed");
		} catch (error) {
			console.error("Initialization error:", error);
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

	registerServiceWorker() {
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
		return this.translations[key] || key;
	},
	
		async syncOfflineData() {
		if (navigator.onLine) {
			try {
				// Ensure database is initialized
				const db = await initializeDB();

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

document.addEventListener("DOMContentLoaded", () => {
	debugLog("DOMContentLoaded event fired");
	app.init();
});

export const translate = app.translate.bind(app);
