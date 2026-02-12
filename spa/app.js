import {
        saveOfflineData,
        getOfflineData,
        clearOfflineData,
} from "./indexedDB.js";
import { initRouter, Router } from "./router.js";
import { Login } from "./login.js";
import { getOrganizationSettings, getPublicOrganizationSettings, fetchOrganizationId, fetchOrganizationJwt } from "./ajax-functions.js";
import { makeApiRequest } from "./api/api-core.js";
import { CONFIG } from "./config.js";
import { debugLog, debugError, debugWarn, isDebugMode } from "./utils/DebugUtils.js";
import { getStorage, setStorage, setStorageMultiple } from "./utils/StorageUtils.js";
import { urlBase64ToUint8Array } from "./functions.js";
import updateManager from "./pwa-update-manager.js";
import { initOfflineSupport } from "./offline-init.js";
import { setContent, clearElement, createElement } from "./utils/DOMUtils.js";

const debugMode = isDebugMode();

// Service worker registration: vite-plugin-pwa injects registration at build time,
// with a fallback in registerServiceWorker() if the injection is missing.

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

                await makeApiRequest('v1/push-subscription', {
                        method: 'POST',
                        body: payload
                });

                debugLog('Subscription saved on server');
        } catch (error) {
                debugError('Error saving subscription on server:', error);
        }
}

export const app = {
        isLoggedIn: false,
        userRole: null, // Primary role (for backward compatibility)
        userRoles: [], // All user roles
        userPermissions: [], // All user permissions
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
                        // Check for existing session (synchronous from localStorage)
                        const session = Login.checkSession();
                        this.isLoggedIn = session.isLoggedIn;
                        this.userRole = session.userRole;
                        this.userRoles = session.userRoles || [];
                        this.userPermissions = session.userPermissions || [];
                        this.userFullName = session.userFullName;

                        debugLog("Session checked:", {
                                isLoggedIn: this.isLoggedIn,
                                userRole: this.userRole,
                                userFullName: this.userFullName,
                        });

                        // CRITICAL: Get organization ID FIRST - everything depends on it
                        let storedOrgId = getStorage('currentOrganizationId') || getStorage('organizationId');
                        if (storedOrgId && storedOrgId.startsWith('{')) {
                                try {
                                        const parsed = JSON.parse(storedOrgId);
                                        storedOrgId = parsed.organizationId || parsed.id;
                                } catch (e) {
                                        storedOrgId = null;
                                }
                        }

                        // If no valid org ID in storage, fetch it NOW (blocking but fast)
                        if (!storedOrgId || storedOrgId === '[object Object]') {
                                try {
                                        debugLog("Fetching organization ID (required)...");
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
                                        if (!navigator.onLine) {
                                                debugWarn("Offline: proceeding without organization ID");
                                                this.organizationId = null;
                                        } else {
                                                throw error;
                                        }
                                }
                        } else {
                                this.organizationId = storedOrgId;
                                debugLog("Using stored organization ID:", storedOrgId);
                        }

                        // CRITICAL: Load current language translations BEFORE routing to prevent flicker
                        const currentLang = this.lang || getStorage('lang', false, CONFIG.DEFAULT_LANG);
                        const normalizedLang = CONFIG.SUPPORTED_LANGS.includes(currentLang) ? currentLang : CONFIG.DEFAULT_LANG;
                        this.lang = normalizedLang;
                        this.language = normalizedLang;
                        document.documentElement.lang = normalizedLang;
                        debugLog(`Loading translations for ${normalizedLang} before routing...`);
                        try {
                                await this.loadTranslation(normalizedLang);
                                debugLog(`Translations loaded for ${normalizedLang}`);
                        } catch (error) {
                                debugWarn("Failed to load translations offline:", error);
                        }

                        // Initialize router IMMEDIATELY (now that we have org ID and translations)
                        debugLog("Initializing router...");
                        this.router = initRouter(this);

                        // Route to current path immediately to show UI fast
                        const currentPath = window.location.pathname;
                        debugLog(`Routing to current path: ${currentPath}`);
                        this.router.route(currentPath);

                        this.initCompleted = true;
                        debugLog("App init completed (fast path)");

                        // Add settings icon if logged in
                        if (this.isLoggedIn) {
                                this.addSettingsIcon();
                        }

                        // Now perform remaining async operations in background (non-blocking)
                        this.initializeBackgroundTasks();

                } catch (error) {
                        debugError("Initialization error:", error);
                        this.renderError(this.translate('error_loading_application'), {
                                titleKey: 'application_error',
                                showReload: true,
                                actions: [
                                        { labelKey: 'go_to_homepage', href: CONFIG.UI.HOMEPAGE_URL }
                                ]
                        });
                }
        },

        // Background initialization tasks (non-blocking)
        // Organization ID and translations are already loaded in init() - these are lower priority tasks
        async initializeBackgroundTasks() {
                try {
                        // Ensure JWT token exists (in background)
                        const token = getStorage('jwtToken');
                        if (!token && this.organizationId) {
                                try {
                                        debugLog("Fetching organization JWT...");
                                        const data = await fetchOrganizationJwt(this.organizationId);
                                        if (data.success && data.token) {
                                                setStorage('jwtToken', data.token);
                                                debugLog("Organization JWT obtained");
                                        }
                                } catch (error) {
                                        debugError("Error getting organization JWT:", error);
                                }
                        }

                        // Fetch organization settings (in background, with caching)
                        this.fetchOrganizationSettings().catch(error => {
                                debugError("Failed to fetch organization settings:", error);
                                this.organizationSettings = { name: 'Scouts' };
                        });

                        // Handle post-login actions if logged in
                        if (this.isLoggedIn) {
                                this.handlePostLoginActions();
                        }

                        // Ensure service worker is registered (fallback if vite-plugin-pwa injection missed)
                        this.registerServiceWorker();

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

                        // PERFORMANCE OPTIMIZATION: Reuse early fetch if available
                        // This prevents duplicate API calls and improves performance
                        let response;
                        if (window.earlyOrgSettingsFetch) {
                                debugLog("Reusing early organization settings fetch");
                                response = await window.earlyOrgSettingsFetch;
                                window.earlyOrgSettingsFetch = null; // Clear it after use
                        }

                        if (!response) {
                                response = await getOrganizationSettings(this.organizationId);
                        }
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
                                const permission = await Notification.requestPermission();
                                if (permission === 'granted') {
                                        registerPushSubscription();
                                }
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
                clearElement(container);

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
                setContent(icon, type === 'error' ? '⚠' : '✓');
                // Create message text
                const messageText = document.createElement('span');
                messageText.className = 'toast-message';
                messageText.textContent = message;

                // Create dismiss button
                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'toast-dismiss';
                dismissBtn.setAttribute('aria-label', translate('close'));
                setContent(dismissBtn, '×');
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
                        clearElement(container);

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

        /**
         * Add settings icon to the page (top right)
         */
        addSettingsIcon() {
                // Remove existing icon if any
                this.removeSettingsIcon();

                // Create settings icon element
                const settingsIcon = createElement('a', {
                        className: 'settings-icon',
                        text: '⚙️',
                        attributes: {
                                href: '/account-info',
                                'aria-label': this.translate('settings') || 'Settings',
                                id: 'global-settings-icon'
                        }
                });

                // Add to body
                document.body.appendChild(settingsIcon);
                debugLog('Settings icon added');
        },

        /**
         * Remove settings icon from the page
         */
        removeSettingsIcon() {
                const existingIcon = document.getElementById('global-settings-icon');
                if (existingIcon) {
                        existingIcon.remove();
                        debugLog('Settings icon removed');
                }
        },

        async registerServiceWorker() {
                if (!('serviceWorker' in navigator)) {
                        debugLog('Service workers not supported');
                        return;
                }

                // Skip in development — src-sw.js is an uncompiled source file that
                // only works after vite-plugin-pwa compiles it during `vite build`.
                if (import.meta.env?.DEV) {
                        debugLog('Service worker registration skipped in development');
                        return;
                }

                try {
                        // Check if a service worker is already registered (e.g. by vite-plugin-pwa)
                        const existingReg = await navigator.serviceWorker.getRegistration();
                        if (existingReg) {
                                debugLog('Service worker already registered:', existingReg.scope);
                                return;
                        }

                        // Fallback: register the service worker explicitly
                        const swPath = CONFIG.SERVICE_WORKER?.PATH || '/src-sw.js';
                        const registration = await navigator.serviceWorker.register(swPath, { scope: '/' });
                        debugLog('Service worker registered:', registration.scope);
                } catch (error) {
                        debugError('Service worker registration failed:', error);
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

        renderError(message, options = {}) {
                const {
                        titleKey = 'error',
                        actions = null,
                        showReload = false
                } = options;

                const appContainer = document.getElementById("app");
                if (!appContainer) {
                        debugError("App container not found");
                        return;
                }

                clearElement(appContainer);

                const container = createElement('div', { className: 'error-container' });
                const title = createElement('h1', { text: this.translate(titleKey) });
                const messageText = createElement('p', { text: message });
                container.appendChild(title);
                container.appendChild(messageText);

                const actionItems = actions || [{ labelKey: 'back_to_home', href: '/' }];
                if (actionItems.length || showReload) {
                        const actionsWrapper = createElement('div', { className: 'error-actions' });

                        if (showReload) {
                                const reloadButton = createElement('button', {
                                        text: this.translate('reload'),
                                        className: 'btn'
                                });
                                reloadButton.addEventListener('click', () => window.location.reload());
                                actionsWrapper.appendChild(reloadButton);
                        }

                        actionItems.forEach(action => {
                                const link = createElement('a', {
                                        text: this.translate(action.labelKey),
                                        className: 'btn',
                                        attributes: { href: action.href }
                                });
                                actionsWrapper.appendChild(link);
                        });

                        container.appendChild(actionsWrapper);
                }

                appContainer.appendChild(container);
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

// PERFORMANCE OPTIMIZATION: Start fetching organization settings as early as possible
// This allows the fetch to run in parallel with app initialization instead of sequentially
// The fetch starts immediately when this module loads, before app.init() completes
const storedOrgId = getStorage('currentOrganizationId') || getStorage('organizationId');
if (storedOrgId && storedOrgId !== '[object Object]' && !storedOrgId.startsWith('{')) {
        debugLog("Starting early organization settings fetch for better performance");

        // Check if user is logged in to determine which endpoint to use
        const jwtToken = getStorage('jwtToken');
        const isLoggedIn = !!jwtToken;

        // Determine if we are on a public page (where we shouldn't force auth)
        const publicPages = ['/login', '/reset-password', '/register', '/permission-slip'];
        const isPublicPage = publicPages.some(path => window.location.pathname.startsWith(path));

        // Use public endpoint for unauthenticated users OR if on a public page
        // to avoid 401 errors that might trigger redirects
        window.earlyOrgSettingsFetch = (isLoggedIn && !isPublicPage)
                ? getOrganizationSettings(storedOrgId).catch(error => {
                        debugError("Early org settings fetch failed, will retry later:", error);
                        return null;
                })
                : getPublicOrganizationSettings().catch(error => {
                        debugError("Early public org settings fetch failed, will retry later:", error);
                        return null;
                });
}

app.init();
export const translate = app.translate.bind(app);
