import {
        saveOfflineData,
        getOfflineData,
        clearOfflineData,
} from "./indexedDB.js";
import { initRouter, Router } from "./router.js";
import { Login } from "./login.js";
import { getOrganizationSettings, fetchOrganizationId, fetchOrganizationJwt } from "./ajax-functions.js";
import { CONFIG } from "./config.js";
import { debugLog, debugError, isDebugMode } from "./utils/DebugUtils.js";
import { getStorage, setStorage, setStorageMultiple } from "./utils/StorageUtils.js";
import { urlBase64ToUint8Array } from "./functions.js";
import updateManager from "./pwa-update-manager.js";
import { initOfflineSupport } from "./offline-init.js";

const debugMode = isDebugMode();

if ("serviceWorker" in navigator) {
        navigator.serviceWorker
                .register("/service-worker.js", { updateViaCache: "none" })
                .then(function (registration) { })
                .catch(function (error) {
                        debugError("Service Worker registration failed:", error);
                });
}

async function registerPushSubscription() {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
                try {
                        const registration = await navigator.serviceWorker.ready;
                        const applicationServerKey = urlBase64ToUint8Array(CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY);

                        const subscription = await registration.pushManager.subscribe({
                                userVisibleOnly: true,
                                applicationServerKey: applicationServerKey,
                        });

                        // Log the full subscription object to see what it contains
                        debugLog('Subscription object:', subscription);
                        debugLog('Subscription JSON:', subscription.toJSON());

                        const subscriptionData = subscription.toJSON();

                        // Send the subscription object to the server
                        await sendSubscriptionToServer(subscriptionData);

                } catch (error) {
                        debugError('Error during push subscription:', error);
                }
        }
}

// Function to send subscription to server (implement this based on your backend)
async function sendSubscriptionToServer(subscription) {
        const p256dh = subscription.keys?.p256dh || null;
        const auth = subscription.keys?.auth || null;

        if (!p256dh || !auth) {
                debugError('Missing p256dh or auth keys in subscription:', subscription);
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

        debugLog('Sending payload to server:', payload);

        try {
                // Retrieve the JWT token from storage
                const token = getStorage('jwtToken'); // Ensure the token is stored correctly after login

                if (!token) {
                        debugError('No token found in localStorage.');
                        throw new Error('No token available');
                }

                const response = await fetch('/api/v1/push-subscription', {
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

                debugLog('Subscription saved on server');
        } catch (error) {
                debugError('Error saving subscription on server:', error);
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
        _settingsPromise: null,

        // Helper to wait for organization settings to be loaded
        async waitForOrganizationSettings() {
                if (this.isOrganizationSettingsFetched && this.organizationSettings) {
                        return this.organizationSettings;
                }
                // If settings are being fetched, wait for that promise
                if (this._settingsPromise) {
                        await this._settingsPromise;
                        return this.organizationSettings;
                }
                // Otherwise fetch them
                await this.fetchOrganizationSettings();
                return this.organizationSettings;
        },

        async init() {
                debugLog("App init started");
                this.createMessageBanner();

                try {
                        // Register service worker in background
                        this.registerServiceWorker();

                        // Initialize language toggle early (synchronous)
                        this.initLanguageToggle();

                        // Check for existing session (synchronous from localStorage)
                        const session = Login.checkSession();
                        this.isLoggedIn = session.isLoggedIn;
                        this.userRole = session.userRole;
                        this.userFullName = session.userFullName;

                        debugLog("Session checked:", {
                                isLoggedIn: this.isLoggedIn,
                                userRole: this.userRole,
                                userFullName: this.userFullName,
                        });

                        // Get organization ID from storage (synchronous)
                        let storedOrgId = getStorage('currentOrganizationId') || getStorage('organizationId');
                        if (storedOrgId && storedOrgId.startsWith('{')) {
                                try {
                                        const parsed = JSON.parse(storedOrgId);
                                        storedOrgId = parsed.organizationId || parsed.id;
                                } catch (e) {
                                        storedOrgId = null;
                                }
                        }
                        this.organizationId = (storedOrgId && storedOrgId !== '[object Object]') ? storedOrgId : 1;

                        // Initialize router IMMEDIATELY (before async operations)
                        debugLog("Initializing router...");
                        this.router = initRouter(this);

                        // Route to current path immediately to show UI fast
                        const currentPath = window.location.pathname;
                        debugLog(`Routing to current path: ${currentPath}`);
                        this.router.route(currentPath);

                        this.initCompleted = true;
                        debugLog("App init completed (fast path)");

                        // Now perform async operations in background (non-blocking)
                        this.initializeBackgroundTasks();

                } catch (error) {
                        debugError("Initialization error:", error);
                        document.getElementById("app").innerHTML = `
                                <div class="error-container">
                                        <h1>${this.translate('application_error') || 'Application Error'}</h1>
                                        <p>${this.translate('error_loading_application') || 'Error loading application'}</p>
                                        <button onclick="window.location.reload()">${this.translate('reload') || 'Reload'}</button>
                                </div>
                        `;
                }
        },

        // Background initialization tasks (non-blocking)
        async initializeBackgroundTasks() {
                try {
                        // Fetch organization ID if needed
                        if (!this.organizationId || this.organizationId === 1) {
                                try {
                                        const orgData = await fetchOrganizationId();
                                        let orgId;
                                        if (typeof orgData === 'object' && orgData.data) {
                                                orgId = orgData.data.organizationId || orgData.data;
                                        } else if (typeof orgData === 'object') {
                                                orgId = orgData.organizationId || orgData.id || orgData;
                                        } else {
                                                orgId = orgData;
                                        }
                                        this.organizationId = orgId;
                                        setStorageMultiple({
                                                currentOrganizationId: orgId,
                                                organizationId: orgId
                                        });
                                        debugLog("Organization ID fetched:", orgId);
                                } catch (error) {
                                        debugError("Error fetching organization ID:", error);
                                }
                        }

                        // Ensure JWT token exists (in background)
                        const token = getStorage('jwtToken');
                        if (!token && this.organizationId) {
                                try {
                                        const data = await fetchOrganizationJwt(this.organizationId);
                                        if (data.success && data.token) {
                                                setStorage('jwtToken', data.token);
                                        }
                                } catch (error) {
                                        debugError("Error getting organization JWT:", error);
                                }
                        }

                        // Load only the current language (lazy load others on demand)
                        const currentLang = this.lang || getStorage('lang', false, CONFIG.DEFAULT_LANG);
                        await this.loadTranslation(currentLang);

                        // Fetch organization settings (in background, with caching)
                        this.fetchOrganizationSettings().catch(error => {
                                debugError("Failed to fetch organization settings:", error);
                                this.organizationSettings = { name: 'Scouts' };
                        });

                        // Handle post-login actions if logged in
                        if (this.isLoggedIn) {
                                this.handlePostLoginActions();
                        }

                        // Initialize offline support
                        initOfflineSupport();
                        this.syncOfflineData();

                } catch (error) {
                        debugError("Background initialization error:", error);
                }
        },

        async fetchOrganizationSettings() {
                debugLog("Inside fetchOrganizationSettings, this:", this);
                if (this.isOrganizationSettingsFetched) {
                        debugLog("Organization settings already fetched, skipping");
                        return;
                }
                
                // Store the promise so other callers can wait for it
                if (!this._settingsPromise) {
                        this._settingsPromise = this._doFetchOrganizationSettings();
                }
                return this._settingsPromise;
        },

        async _doFetchOrganizationSettings() {
                try {
                        debugLog("Fetching organization settings ...", this.organizationId);

                        const response = await getOrganizationSettings(this.organizationId);
                        if (response && response.organization_info || response.data) {
                                debugLog("Got organization settings: ", JSON.stringify(response));
                                // The fix is here - use response.data directly as the settings
                                this.organizationSettings = response.data || response;  // This is correct
                                if (!Array.isArray(this.organizationSettings?.program_sections) || this.organizationSettings.program_sections.length === 0) {
                                        this.organizationSettings = {
                                                ...this.organizationSettings,
                                                program_sections: CONFIG.PROGRAM_SECTIONS.DEFAULT
                                        };
                                }
                                this.isOrganizationSettingsFetched = true;
                                debugLog("Organization settings fetched successfully:", this.organizationSettings);
                        } else {
                                debugLog("Failed to fetch organization settings:", response?.message || "Unknown error");
                                // Set default organization settings
                                this.organizationSettings = { organization_info: { name: "Scouts" }, program_sections: CONFIG.PROGRAM_SECTIONS.DEFAULT };
                                this.isOrganizationSettingsFetched = true;
                                debugLog("Using default organization settings");
                        }
                } catch (error) {
                        debugError("Error fetching organization settings:", error);
                        // Set default organization settings
                        this.organizationSettings = { organization_info: { name: "Scouts" }, program_sections: CONFIG.PROGRAM_SECTIONS.DEFAULT };
                        this.isOrganizationSettingsFetched = true;
                        debugLog("Using default organization settings due to error");
                }
        },

        // Load a single translation file (lazy loading)
        async loadTranslation(langCode) {
                if (this.translations[langCode]) {
                        debugLog(`Translation for ${langCode} already loaded`);
                        return;
                }
                try {
                        debugLog(`Loading translation for ${langCode}...`);
                        const response = await fetch(`/lang/${langCode}.json`);
                        if (!response.ok) {
                                throw new Error(`Failed to fetch translation file for ${langCode}`);
                        }
                        const data = await response.json();
                        this.translations[langCode] = data;
                        debugLog(`Translation for ${langCode} loaded successfully`);
                } catch (error) {
                        debugError(`Error loading translation for ${langCode}:`, error);
                        this.translations[langCode] = {};
                }
        },

        // Load all translations (fallback for backward compatibility)
        async loadTranslations() {
                if (Object.keys(this.translations).length === CONFIG.SUPPORTED_LANGS.length) {
                        debugLog("All translations already loaded, skipping");
                        return;
                }
                try {
                        debugLog("Loading all translations...");

                        const translationFetches = CONFIG.SUPPORTED_LANGS.map(async (langCode) => {
                                if (this.translations[langCode]) {
                                        return [langCode, this.translations[langCode]];
                                }
                                const response = await fetch(`/lang/${langCode}.json`);
                                if (!response.ok) {
                                        throw new Error(`Failed to fetch translation file for ${langCode}`);
                                }
                                const data = await response.json();
                                return [langCode, data];
                        });

                        const resolvedTranslations = await Promise.all(translationFetches);
                        this.translations = Object.fromEntries(resolvedTranslations);
                        debugLog("Translations loaded successfully", Object.keys(this.translations));
                } catch (error) {
                        debugError("Error loading translations:", error);
                        this.translations = CONFIG.SUPPORTED_LANGS.reduce((acc, langCode) => {
                                acc[langCode] = this.translations[langCode] || {};
                                return acc;
                        }, {});
                }
        },


        async handlePostLoginActions() {
                // Dispatch userLoggedIn event for offline support
                const userLoggedInEvent = new CustomEvent('userLoggedIn', {
                        detail: {
                                userRole: this.userRole,
                                userId: this.userId,
                                timestamp: Date.now()
                        }
                });
                window.dispatchEvent(userLoggedInEvent);

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
                        debugError('This browser does not support notifications.');
                }
        },

        toastQueue: [],
        toastTimeout: null,

        showMessage(message, type = 'info') {
                const translatedMessage = translate(message);

                // Add to queue
                this.toastQueue.push({ message: translatedMessage, type });

                // If no toast is currently showing, show the next one
                if (this.toastQueue.length === 1) {
                        this.displayNextToast();
                }
        },

        displayNextToast() {
                if (this.toastQueue.length === 0) return;

                const { message, type } = this.toastQueue[0];
                const container = document.getElementById('toast-container');

                // Clear any existing toast
                container.innerHTML = '';

                // Create toast element
                const toast = document.createElement('div');
                toast.className = `toast toast-${type}`;
                toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
                toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
                toast.setAttribute('aria-atomic', 'true');

                // Create icon
                const icon = document.createElement('span');
                icon.className = 'toast-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.innerHTML = type === 'error' ? '⚠' : '✓';

                // Create message text
                const messageText = document.createElement('span');
                messageText.className = 'toast-message';
                messageText.textContent = message;

                // Create dismiss button
                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'toast-dismiss';
                dismissBtn.setAttribute('aria-label', translate('close'));
                dismissBtn.innerHTML = '×';
                dismissBtn.onclick = () => this.dismissToast();

                // Assemble toast
                toast.appendChild(icon);
                toast.appendChild(messageText);
                toast.appendChild(dismissBtn);
                container.appendChild(toast);

                // Show toast with animation
                requestAnimationFrame(() => {
                        toast.classList.add('toast-show');
                });

                // Auto-dismiss after 5 seconds (longer for accessibility)
                this.toastTimeout = setTimeout(() => {
                        this.dismissToast();
                }, 5000);
        },

        dismissToast() {
                const container = document.getElementById('toast-container');
                const toast = container.querySelector('.toast');

                if (!toast) return;

                // Clear timeout
                if (this.toastTimeout) {
                        clearTimeout(this.toastTimeout);
                        this.toastTimeout = null;
                }

                // Hide with animation
                toast.classList.remove('toast-show');

                setTimeout(() => {
                        // Remove from queue and DOM
                        this.toastQueue.shift();
                        container.innerHTML = '';

                        // Show next toast if any
                        if (this.toastQueue.length > 0) {
                                setTimeout(() => this.displayNextToast(), 300);
                        }
                }, 300);
        },

        createMessageBanner() {
                // Create toast container with ARIA live region
                const container = document.createElement('div');
                container.id = 'toast-container';
                container.setAttribute('aria-live', 'polite');
                container.setAttribute('aria-relevant', 'additions');
                document.body.appendChild(container);
        },

        async setLanguage(lang) {
                const fallbackLang = CONFIG.DEFAULT_LANG;
                const normalizedLang = CONFIG.SUPPORTED_LANGS.includes(lang) ? lang : fallbackLang;

                this.lang = normalizedLang;
                this.language = normalizedLang;
                document.documentElement.lang = normalizedLang;
                setStorage('lang', normalizedLang);
                localStorage.setItem('language', normalizedLang);

                // Load only the required translation (lazy loading)
                await this.loadTranslation(normalizedLang);

                // Update page title
                this.updatePageTitle();

                if (this.router && this.initCompleted) {
                        this.router.reloadCurrentRoute();
                }
        },

        updatePageTitle() {
                const title = this.translate('app_title');
                document.title = `${title} - Wampums`;
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
                const savedLang = getStorage('lang', false, CONFIG.DEFAULT_LANG);
                const normalizedLang = CONFIG.SUPPORTED_LANGS.includes(savedLang) ? savedLang : CONFIG.DEFAULT_LANG;
                this.setLanguage(normalizedLang);
                // Remove active class from all buttons first to avoid duplicates
                toggleButtons.forEach(b => b.classList.remove('active'));
                const activeBtn = document.querySelector(`.lang-btn[data-lang="${normalizedLang}"]`);
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
                                                debugError("Service Worker registration failed:", error);
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
                        debugError("App container not found");
                }
        },

        translate(key) {
                const activeLang = this.lang && this.translations[this.lang] ? this.lang : CONFIG.DEFAULT_LANG;
                const translationSet = this.translations[activeLang] || {};
                const defaultSet = this.translations[CONFIG.DEFAULT_LANG] || {};
                if (!translationSet[key] && !defaultSet[key]) {
                        debugLog(`Missing translation for key: ${key} in language: ${activeLang}`);
                }
                return translationSet[key] || defaultSet[key] || key;
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
                                debugError("Error syncing offline data:", error);
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
                const title = event.data.title || translate('new_notification');
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
