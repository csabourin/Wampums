/**
 * PWA Update Manager
 *
 * Handles service worker updates and prompts users when a new version is available.
 * This module ensures users are notified of PWA updates and can easily refresh to get the latest version.
 */

import { CONFIG } from './config.js';
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";

class PWAUpdateManager {
    constructor() {
        this.registration = null;
        this.updateAvailable = false;
        this.newWorker = null;
        this.updateCheckInterval = null;
        this.initialized = false;
    }

    /**
     * Initialize the update manager
     */
    async init() {
        if (this.initialized) return;

        if (!('serviceWorker' in navigator)) {
            debugLog('Service Worker not supported');
            return;
        }

        try {
            // Get service worker registration
            this.registration = await navigator.serviceWorker.ready;

            // Set up update listeners
            this.setupUpdateListeners();

            // Check for updates periodically (every 60 seconds)
            this.startUpdateChecks();

            // Listen for messages from service worker
            this.listenForServiceWorkerMessages();

            // Check for update immediately
            await this.checkForUpdate();

            this.initialized = true;
            debugLog('PWA Update Manager initialized');
        } catch (error) {
            debugError('Failed to initialize PWA Update Manager:', error);
        }
    }

    /**
     * Set up event listeners for service worker updates
     */
    setupUpdateListeners() {
        if (!this.registration) return;

        // Listen for new service worker waiting
        this.registration.addEventListener('updatefound', () => {
            const newWorker = this.registration.installing;

            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New service worker is waiting to activate
                        this.newWorker = newWorker;
                        this.updateAvailable = true;
                        this.showUpdatePrompt();
                    }
                });
            }
        });

        // Listen for controller change (when new SW takes over)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            // Only reload if we expected an update
            if (this.updateAvailable) {
                window.location.reload();
            }
        });
    }

    /**
     * Listen for messages from the service worker
     */
    listenForServiceWorkerMessages() {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'UPDATE_AVAILABLE') {
                debugLog('Update available:', event.data.version);
                this.updateAvailable = true;
                this.showUpdatePrompt();
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
            if (version && version !== CONFIG.VERSION) {
                debugLog(`Version mismatch: SW=${version}, APP=${CONFIG.VERSION}`);
                this.updateAvailable = true;
                this.showUpdatePrompt();
            }
        } catch (error) {
            debugError('Failed to check for updates:', error);
        }
    }

    /**
     * Get the service worker version
     */
    async getServiceWorkerVersion() {
        if (!navigator.serviceWorker.controller) return null;

        return new Promise((resolve) => {
            const messageChannel = new MessageChannel();

            messageChannel.port1.onmessage = (event) => {
                if (event.data.type === 'VERSION_INFO') {
                    resolve(event.data.version);
                } else {
                    resolve(null);
                }
            };

            navigator.serviceWorker.controller.postMessage(
                { type: 'GET_VERSION' },
                [messageChannel.port2]
            );

            // Timeout after 2 seconds
            setTimeout(() => resolve(null), 2000);
        });
    }

    /**
     * Start periodic update checks
     */
    startUpdateChecks() {
        // Check for updates every 60 seconds
        this.updateCheckInterval = setInterval(() => {
            this.checkForUpdate();
        }, 60000);

        // Also check when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkForUpdate();
            }
        });

        // Check when online
        window.addEventListener('online', () => {
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
        if (document.getElementById('pwa-update-prompt')) return;

        const prompt = this.createUpdatePromptElement();
        document.body.appendChild(prompt);

        // Auto-show the prompt
        setTimeout(() => {
            prompt.classList.add('show');
        }, 100);
    }

    /**
     * Create the update prompt HTML element
     */
    createUpdatePromptElement() {
        const prompt = document.createElement('div');
        prompt.id = 'pwa-update-prompt';
        prompt.className = 'pwa-update-prompt';

        const lang = localStorage.getItem('language') || 'fr';

        const messages = {
            fr: {
                title: 'Nouvelle version disponible',
                message: 'Une nouvelle version de l\'application est disponible.',
                update: 'Mettre à jour',
                later: 'Plus tard'
            },
            en: {
                title: 'New version available',
                message: 'A new version of the application is available.',
                update: 'Update',
                later: 'Later'
            }
        };

        const msg = messages[lang] || messages.fr;

        prompt.innerHTML = `
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
        `;

        // Add event listeners
        prompt.querySelector('#pwa-update-now').addEventListener('click', () => {
            this.applyUpdate();
        });

        prompt.querySelector('#pwa-update-later').addEventListener('click', () => {
            this.dismissPrompt();
        });

        // Add styles if not already present
        if (!document.getElementById('pwa-update-styles')) {
            this.addStyles();
        }

        return prompt;
    }

    /**
     * Add CSS styles for the update prompt
     */
    addStyles() {
        const style = document.createElement('style');
        style.id = 'pwa-update-styles';
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
     * Apply the update
     */
    applyUpdate() {
        if (this.newWorker) {
            // Tell the new service worker to skip waiting
            this.newWorker.postMessage({ type: 'SKIP_WAITING' });
        } else if (navigator.serviceWorker.controller) {
            // Fallback: tell current SW to skip waiting
            navigator.serviceWorker.controller.postMessage('skipWaiting');
        }

        this.dismissPrompt();

        // Show loading indicator
        this.showLoadingIndicator();
    }

    /**
     * Show loading indicator during update
     */
    showLoadingIndicator() {
        const loader = document.createElement('div');
        loader.id = 'pwa-update-loader';
        loader.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 24px 32px;
                border-radius: 12px;
                z-index: 10001;
                text-align: center;
            ">
                <div style="font-size: 32px; margin-bottom: 12px;">⏳</div>
                <div>Mise à jour en cours...</div>
            </div>
        `;
        document.body.appendChild(loader);
    }

    /**
     * Dismiss the update prompt
     */
    dismissPrompt() {
        const prompt = document.getElementById('pwa-update-prompt');
        if (prompt) {
            prompt.classList.remove('show');
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
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateManager.init();
    });
} else {
    updateManager.init();
}
