/**
 * PWA Update Manager
 *
 * Handles service worker updates and prompts users when a new version is available.
 * This module ensures users are notified of PWA updates and can easily refresh to get the latest version.
 */

import { CONFIG } from "./config.js";
import {
    debugLog,
    debugError,
    debugWarn,
    debugInfo,
} from "./utils/DebugUtils.js";
import { deleteIndexedDB } from "./indexedDB.js";
import { setContent } from "./utils/DOMUtils.js";

class PWAUpdateManager {
    constructor() {
        this.registration = null;
        this.updateAvailable = false;
        this.newWorker = null;
        this.updateCheckInterval = null;
        this.initialized = false;
        this.lastPromptedVersion =
            localStorage.getItem("lastSwVersionPrompt") || null;
        this.pendingVersion = null;
        this.updateAccepted = false;
    }

    /**
     * Initialize the update manager
     */
    async init() {
        if (this.initialized) return;

        if (import.meta.env?.DEV) {
            debugInfo("PWA Update Manager disabled in development mode");
            this.initialized = true;
            return;
        }

        if (!("serviceWorker" in navigator)) {
            debugLog("Service Worker not supported");
            return;
        }

        try {
            // Get service worker registration
            this.registration = await navigator.serviceWorker.ready;

            if (!this.shouldManageRegistration(this.registration)) {
                this.initialized = true;
                return;
            }

            // Set up update listeners
            this.setupUpdateListeners();

            // Check for updates periodically (every 10 minutes)
            this.startUpdateChecks();

            // Listen for messages from service worker
            this.listenForServiceWorkerMessages();

            // Check for update immediately
            await this.checkForUpdate();

            this.initialized = true;
            debugLog("PWA Update Manager initialized");
        } catch (error) {
            debugError("Failed to initialize PWA Update Manager:", error);
        }
    }

    /**
     * Confirm this registration matches the expected service worker script.
     * Skips update checks when a stale or mismatched SW is present.
     * @param {ServiceWorkerRegistration} registration
     * @returns {boolean}
     */
    shouldManageRegistration(registration) {
        if (!registration) return false;

        const expectedPath = CONFIG.SERVICE_WORKER?.PATH;
        if (!expectedPath) return true;

        const scriptUrl =
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL;

        if (!scriptUrl) return true;

        try {
            const scriptPath = new URL(scriptUrl).pathname;
            if (scriptPath === expectedPath) return true;
        } catch (error) {
            // Fall back to a string check when URL parsing fails.
            if (scriptUrl.endsWith(expectedPath)) return true;
        }

        debugWarn(
            "Skipping PWA Update Manager due to unexpected service worker script",
            { scriptUrl, expectedPath },
        );
        return false;
    }

    /**
     * Set up event listeners for service worker updates
     */
    setupUpdateListeners() {
        if (!this.registration) return;

        // Listen for new service worker waiting
        this.registration.addEventListener("updatefound", () => {
            const newWorker = this.registration.installing;

            if (newWorker) {
                newWorker.addEventListener("statechange", async () => {
                    if (
                        newWorker.state === "installed" &&
                        navigator.serviceWorker.controller
                    ) {
                        // Only prompt when the new worker is a different version
                        const newVersion =
                            await this.getServiceWorkerVersion(newWorker);

                        if (this.shouldNotifyVersion(newVersion)) {
                            this.newWorker = newWorker;
                            this.pendingVersion = newVersion;
                            this.updateAvailable = true;
                            this.showUpdatePrompt();
                        } else {
                            // Same version but new bytes (bug fix) - silently activate
                            debugLog(
                                "Service worker updated without version change; activating silently",
                            );
                            newWorker.postMessage({ type: "SKIP_WAITING" });
                        }
                    }
                });
            }
        });

        // Listen for controller change (when new SW takes over)
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            // Only reload if we expected an update
            if (this.updateAccepted) {
                // Show reloading state before reload
                this.updateProgress("reloading");

                // Give a moment for UI to update, then reload
                setTimeout(() => {
                    // Hard reload to bypass browser cache completely
                    window.location.reload(true);
                }, 500);
            }
        });
    }

    /**
     * Listen for messages from the service worker
     */
    listenForServiceWorkerMessages() {
        navigator.serviceWorker.addEventListener("message", (event) => {
            if (event.data.type === "UPDATE_AVAILABLE") {
                debugLog("Update available:", event.data.version);
                if (this.shouldNotifyVersion(event.data.version)) {
                    this.pendingVersion = event.data.version;
                    this.updateAvailable = true;
                    this.showUpdatePrompt();
                }
            }
        });
    }

    /**
     * Check for service worker updates
     */
    async checkForUpdate() {
        if (!this.registration) return;

        try {
            await this.registration.update();

            // Also check the version from service worker
            const version = await this.getServiceWorkerVersion();
            if (
                version &&
                version !== CONFIG.VERSION &&
                this.shouldNotifyVersion(version)
            ) {
                debugLog(
                    `Version mismatch: SW=${version}, APP=${CONFIG.VERSION}`,
                );
                this.pendingVersion = version;
                this.updateAvailable = true;
                this.showUpdatePrompt();
            }
        } catch (error) {
            debugError("Failed to check for updates:", error);
        }
    }

    /**
     * Get the service worker version
     */
    /**
     * Request the version reported by the specified service worker.
     * Defaults to the active controller when no worker is provided.
     */
    async getServiceWorkerVersion(
        targetWorker = navigator.serviceWorker.controller,
    ) {
        if (!targetWorker) return null;

        return new Promise((resolve) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data.type === "VERSION_INFO") {
                    resolve(event.data.version);
                } else {
                    resolve(null);
                }
            };

            targetWorker.postMessage({ type: "GET_VERSION" }, [
                messageChannel.port2,
            ]);

            // Timeout after 2 seconds
            setTimeout(() => resolve(null), 2000);
        });
    }

    /**
     * Start periodic update checks
     */
    startUpdateChecks() {
        // Check for updates every 10 minutes (600000ms) to reduce bandwidth
        this.updateCheckInterval = setInterval(() => {
            this.checkForUpdate();
        }, 600000);

        // Also check when page becomes visible
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.checkForUpdate();
            }
        });

        // Check when online
        window.addEventListener("online", () => {
            this.checkForUpdate();
        });
    }

    /**
     * Stop periodic update checks
     */
    stopUpdateChecks() {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
        }
    }

    /**
     * Show update prompt to user
     */
    showUpdatePrompt() {
        // Don't show multiple prompts
        if (document.getElementById("pwa-update-prompt")) return;

        if (this.pendingVersion) {
            this.markVersionPrompted(this.pendingVersion);
        }

        const prompt = this.createUpdatePromptElement();
        document.body.appendChild(prompt);

        // Auto-show the prompt
        setTimeout(() => {
            prompt.classList.add("show");
        }, 100);
    }

    /**
     * Create the update prompt HTML element
     */
    createUpdatePromptElement() {
        const prompt = document.createElement("div");
        prompt.id = "pwa-update-prompt";
        prompt.className = "pwa-update-prompt";

        const lang =
            localStorage.getItem("lang") ||
            localStorage.getItem("language") ||
            CONFIG.DEFAULT_LANG;

        const messages = {
            fr: {
                title: "Nouvelle version disponible",
                message:
                    "Une nouvelle version de l'application est disponible.",
                update: "Mettre à jour",
                later: "Plus tard",
            },
            en: {
                title: "New version available",
                message: "A new version of the application is available.",
                update: "Update",
                later: "Later",
            },
            uk: {
                title: "Доступна нова версія",
                message: "Доступна нова версія застосунку.",
                update: "Оновити",
                later: "Пізніше",
            },
        };

        const msg =
            messages[lang] || messages[CONFIG.DEFAULT_LANG] || messages.fr;

        setContent(
            prompt,
            `
            <div class="pwa-update-content">
                <div class="pwa-update-icon">🔄</div>
                <div class="pwa-update-text">
                    <h3>${msg.title}</h3>
                    <p>${msg.message}</p>
                </div>
                <div class="pwa-update-actions">
                    <button class="pwa-update-btn pwa-update-btn-primary" id="pwa-update-now">
                        ${msg.update}
                    </button>
                    <button class="pwa-update-btn pwa-update-btn-secondary" id="pwa-update-later">
                        ${msg.later}
                    </button>
                </div>
            </div>
        `,
        );
        // Add event listeners
        prompt
            .querySelector("#pwa-update-now")
            .addEventListener("click", () => {
                this.applyUpdate();
            });

        prompt
            .querySelector("#pwa-update-later")
            .addEventListener("click", () => {
                this.dismissPrompt();
            });

        // Add styles if not already present
        if (!document.getElementById("pwa-update-styles")) {
            this.addStyles();
        }

        return prompt;
    }

    /**
     * Add CSS styles for the update prompt
     */
    addStyles() {
        const style = document.createElement("style");
        style.id = "pwa-update-styles";
        style.textContent = `
            .pwa-update-prompt {
                position: fixed;
                bottom: -300px;
                left: 50%;
                transform: translateX(-50%);
                width: 90%;
                max-width: 500px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                z-index: 10000;
                transition: bottom 0.3s ease-out;
                padding: 20px;
                box-sizing: border-box;
            }

            .pwa-update-prompt.show {
                bottom: 20px;
            }

            .pwa-update-content {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .pwa-update-icon {
                font-size: 48px;
                text-align: center;
            }

            .pwa-update-text {
                text-align: center;
            }

            .pwa-update-text h3 {
                margin: 0 0 8px 0;
                color: #333;
                font-size: 20px;
                font-weight: 600;
            }

            .pwa-update-text p {
                margin: 0 0 4px 0;
                color: #666;
                font-size: 14px;
                line-height: 1.5;
            }

            .pwa-update-actions {
                display: flex;
                gap: 12px;
                justify-content: center;
            }

            .pwa-update-btn {
                flex: 1;
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: inherit;
            }

            .pwa-update-btn-primary {
                background: #4c65ae;
                color: white;
            }

            .pwa-update-btn-primary:hover {
                background: #3d5294;
                transform: translateY(-1px);
            }

            .pwa-update-btn-secondary {
                background: #e0e0e0;
                color: #666;
            }

            .pwa-update-btn-secondary:hover {
                background: #d0d0d0;
            }

            .pwa-update-btn:active {
                transform: translateY(0);
            }

            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .pwa-update-prompt {
                    background: #2d2d2d;
                }

                .pwa-update-text h3 {
                    color: #fff;
                }

                .pwa-update-text p {
                    color: #ccc;
                }

                .pwa-update-btn-secondary {
                    background: #444;
                    color: #ccc;
                }

                .pwa-update-btn-secondary:hover {
                    background: #555;
                }
            }

            /* Mobile adjustments */
            @media (max-width: 600px) {
                .pwa-update-prompt {
                    width: 95%;
                    padding: 16px;
                }

                .pwa-update-actions {
                    flex-direction: column;
                }

                .pwa-update-btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Determine whether we should notify the user about a service worker version.
     * Prevents showing the same version repeatedly when a stale app build is cached.
     * @param {string|null} version
     * @returns {boolean}
     */
    shouldNotifyVersion(version) {
        if (!version) return false;
        if (version === CONFIG.VERSION) return false;
        return version !== this.lastPromptedVersion;
    }

    /**
     * Remember the last version we prompted for to avoid infinite update loops.
     * @param {string} version
     */
    markVersionPrompted(version) {
        this.lastPromptedVersion = version;
        localStorage.setItem("lastSwVersionPrompt", version);
    }

    /**
     * Clear runtime caches (IndexedDB + non-precache Service Worker caches)
     * Preserves the Workbox precache so the SW can still serve the app shell offline.
     * The new SW's activate handler will clean up outdated precache entries.
     */
    async clearAllCaches() {
        try {
            debugLog("Clearing runtime caches for version update...");

            // 1. Clear IndexedDB completely
            try {
                await deleteIndexedDB();
                debugLog("IndexedDB cleared successfully");
            } catch (error) {
                debugWarn("Failed to clear IndexedDB:", error);
            }

            // 2. Clear runtime Service Worker caches (preserve Workbox precache)
            if ("caches" in window) {
                try {
                    const cacheNames = await caches.keys();
                    const runtimeCaches = cacheNames.filter(
                        (name) => !name.includes("precache"),
                    );
                    await Promise.all(
                        runtimeCaches.map((cacheName) =>
                            caches.delete(cacheName),
                        ),
                    );
                    debugLog(
                        "Runtime caches cleared:",
                        runtimeCaches,
                        "Preserved precache entries:",
                        cacheNames.filter((name) =>
                            name.includes("precache"),
                        ),
                    );
                } catch (error) {
                    debugWarn("Failed to clear Service Worker caches:", error);
                }
            }

            debugLog("All runtime caches cleared successfully");
        } catch (error) {
            debugError("Error clearing caches:", error);
            // Don't throw - we still want to proceed with the update
        }
    }

    /**
     * Apply the update
     */
    async applyUpdate() {
        this.updateAccepted = true;

        // Immediately show updating state on the prompt
        this.showUpdatingState();

        // Clear all caches before updating
        await this.clearAllCaches();

        // Update progress
        this.updateProgress("activating");

        if (this.newWorker) {
            // Tell the new service worker to skip waiting
            this.newWorker.postMessage({ type: "SKIP_WAITING" });
        } else if (navigator.serviceWorker.controller) {
            // Fallback: tell current SW to skip waiting
            navigator.serviceWorker.controller.postMessage("skipWaiting");
        }

        // Start safety timeout for reload
        this.startUpdateTimeout();
    }

    /**
     * Transform the update prompt into an updating state with progress
     */
    showUpdatingState() {
        const prompt = document.getElementById("pwa-update-prompt");
        if (!prompt) {
            this.showLoadingIndicator();
            return;
        }

        const lang =
            localStorage.getItem("lang") ||
            localStorage.getItem("language") ||
            CONFIG.DEFAULT_LANG;

        const messages = this.getUpdateMessages(lang);

        setContent(
            prompt,
            `
            <div class="pwa-update-content pwa-updating">
                <div class="pwa-update-spinner"></div>
                <div class="pwa-update-text">
                    <h3>${messages.updating}</h3>
                    <p id="pwa-update-status">${messages.clearingCache}</p>
                </div>
                <div class="pwa-update-progress">
                    <div class="pwa-update-progress-bar">
                        <div class="pwa-update-progress-fill" id="pwa-progress-fill"></div>
                    </div>
                    <div class="pwa-update-steps">
                        <span class="pwa-step active" id="step-cache">1</span>
                        <span class="pwa-step" id="step-activate">2</span>
                        <span class="pwa-step" id="step-reload">3</span>
                    </div>
                </div>
                <p class="pwa-update-warning">${messages.doNotClose}</p>
            </div>
        `,
        );

        // Add updating styles if not present
        this.addUpdatingStyles();

        // Start progress animation
        this.animateProgress(33);
    }

    /**
     * Get localized messages for the update process
     */
    getUpdateMessages(lang) {
        const messages = {
            fr: {
                updating: "Mise à jour en cours...",
                clearingCache: "Effacement du cache...",
                activating: "Activation de la nouvelle version...",
                reloading: "Rechargement de l'application...",
                doNotClose: "Veuillez ne pas fermer cette page",
                almostDone: "Presque terminé...",
            },
            en: {
                updating: "Updating...",
                clearingCache: "Clearing cache...",
                activating: "Activating new version...",
                reloading: "Reloading application...",
                doNotClose: "Please do not close this page",
                almostDone: "Almost done...",
            },
            uk: {
                updating: "Оновлення...",
                clearingCache: "Очищення кешу...",
                activating: "Активація нової версії...",
                reloading: "Перезавантаження застосунку...",
                doNotClose: "Будь ласка, не закривайте цю сторінку",
                almostDone: "Майже готово...",
            },
        };

        return messages[lang] || messages[CONFIG.DEFAULT_LANG] || messages.fr;
    }

    /**
     * Update the progress display
     */
    updateProgress(step) {
        const lang =
            localStorage.getItem("lang") ||
            localStorage.getItem("language") ||
            CONFIG.DEFAULT_LANG;
        const messages = this.getUpdateMessages(lang);

        const statusEl = document.getElementById("pwa-update-status");
        const stepCache = document.getElementById("step-cache");
        const stepActivate = document.getElementById("step-activate");
        const stepReload = document.getElementById("step-reload");

        if (step === "activating") {
            if (statusEl) statusEl.textContent = messages.activating;
            if (stepCache) stepCache.classList.add("completed");
            if (stepActivate) stepActivate.classList.add("active");
            this.animateProgress(66);
        } else if (step === "reloading") {
            if (statusEl) statusEl.textContent = messages.reloading;
            if (stepCache) stepCache.classList.add("completed");
            if (stepActivate) stepActivate.classList.add("completed");
            if (stepReload) stepReload.classList.add("active");
            this.animateProgress(100);
        }
    }

    /**
     * Animate the progress bar to a target percentage
     */
    animateProgress(targetPercent) {
        const fill = document.getElementById("pwa-progress-fill");
        if (fill) {
            fill.style.width = `${targetPercent}%`;
        }
    }

    /**
     * Start a safety timeout for the update process
     */
    startUpdateTimeout() {
        const lang =
            localStorage.getItem("lang") ||
            localStorage.getItem("language") ||
            CONFIG.DEFAULT_LANG;
        const messages = this.getUpdateMessages(lang);

        // After 10 seconds, show "almost done" message
        setTimeout(() => {
            const statusEl = document.getElementById("pwa-update-status");
            if (statusEl && document.getElementById("pwa-update-prompt")) {
                statusEl.textContent = messages.almostDone;
            }
        }, 10000);

        // Safety timeout: if update doesn't complete in 45 seconds, force reload
        setTimeout(() => {
            if (document.getElementById("pwa-update-prompt") || document.getElementById("pwa-update-loader")) {
                debugLog("Update timeout reached, forcing reload...");
                this.updateProgress("reloading");

                // Give a moment for UI to update, then reload
                setTimeout(() => {
                    // Hard reload to bypass browser cache completely
                    window.location.reload(true);
                }, 500);
            }
        }, 45000);
    }

    /**
     * Add CSS styles for the updating state
     */
    addUpdatingStyles() {
        if (document.getElementById("pwa-updating-styles")) return;

        const style = document.createElement("style");
        style.id = "pwa-updating-styles";
        style.textContent = `
            .pwa-updating {
                align-items: center;
            }

            .pwa-update-spinner {
                width: 48px;
                height: 48px;
                border: 4px solid #e0e0e0;
                border-top-color: #4c65ae;
                border-radius: 50%;
                animation: pwa-spin 1s linear infinite;
            }

            @keyframes pwa-spin {
                to { transform: rotate(360deg); }
            }

            .pwa-update-progress {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .pwa-update-progress-bar {
                width: 100%;
                height: 8px;
                background: #e0e0e0;
                border-radius: 4px;
                overflow: hidden;
            }

            .pwa-update-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #4c65ae, #6b82c9);
                border-radius: 4px;
                width: 0%;
                transition: width 0.5s ease-out;
            }

            .pwa-update-steps {
                display: flex;
                justify-content: space-between;
                padding: 0 10%;
            }

            .pwa-step {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: #e0e0e0;
                color: #666;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 600;
                transition: all 0.3s ease;
            }

            .pwa-step.active {
                background: #4c65ae;
                color: white;
                animation: pwa-pulse 1.5s ease-in-out infinite;
            }

            .pwa-step.completed {
                background: #4caf50;
                color: white;
                animation: none;
            }

            @keyframes pwa-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            .pwa-update-warning {
                font-size: 12px;
                color: #999;
                margin: 0;
                font-style: italic;
            }

            /* Dark mode support for updating state */
            @media (prefers-color-scheme: dark) {
                .pwa-update-spinner {
                    border-color: #444;
                    border-top-color: #6b82c9;
                }

                .pwa-update-progress-bar {
                    background: #444;
                }

                .pwa-step {
                    background: #444;
                    color: #ccc;
                }

                .pwa-update-warning {
                    color: #888;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Show loading indicator during update (fallback when prompt doesn't exist)
     */
    showLoadingIndicator() {
        const lang =
            localStorage.getItem("lang") ||
            localStorage.getItem("language") ||
            CONFIG.DEFAULT_LANG;
        const messages = this.getUpdateMessages(lang);

        const loader = document.createElement("div");
        loader.id = "pwa-update-loader";
        setContent(
            loader,
            `
            <div class="pwa-update-loader-content">
                <div class="pwa-update-spinner"></div>
                <div class="pwa-update-loader-text">
                    <h3>${messages.updating}</h3>
                    <p id="pwa-loader-status">${messages.clearingCache}</p>
                </div>
                <p class="pwa-update-warning">${messages.doNotClose}</p>
            </div>
        `,
        );

        // Add loader-specific styles
        this.addLoaderStyles();
        this.addUpdatingStyles();

        document.body.appendChild(loader);

        // Start safety timeout
        this.startUpdateTimeout();
    }

    /**
     * Add styles for the standalone loader
     */
    addLoaderStyles() {
        if (document.getElementById("pwa-loader-styles")) return;

        const style = document.createElement("style");
        style.id = "pwa-loader-styles";
        style.textContent = `
            #pwa-update-loader {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.85);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .pwa-update-loader-content {
                background: white;
                padding: 32px;
                border-radius: 16px;
                text-align: center;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                max-width: 90%;
                width: 320px;
            }

            .pwa-update-loader-text h3 {
                margin: 0 0 8px 0;
                color: #333;
                font-size: 18px;
            }

            .pwa-update-loader-text p {
                margin: 0;
                color: #666;
                font-size: 14px;
            }

            @media (prefers-color-scheme: dark) {
                .pwa-update-loader-content {
                    background: #2d2d2d;
                }

                .pwa-update-loader-text h3 {
                    color: #fff;
                }

                .pwa-update-loader-text p {
                    color: #ccc;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Dismiss the update prompt
     */
    dismissPrompt() {
        this.updateAvailable = false;
        this.updateAccepted = false;
        this.pendingVersion = null;

        const prompt = document.getElementById("pwa-update-prompt");
        if (prompt) {
            prompt.classList.remove("show");
            setTimeout(() => {
                prompt.remove();
            }, 300);
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopUpdateChecks();
        this.dismissPrompt();
    }
}

// Create and export singleton instance
const updateManager = new PWAUpdateManager();
export default updateManager;

// Auto-initialize when module is imported
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        updateManager.init();
    });
} else {
    updateManager.init();
}
