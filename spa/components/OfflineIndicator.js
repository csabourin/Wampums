/**
 * OfflineIndicator.js
 *
 * Visual UI component that displays offline status and pending sync count.
 * Shows a fixed-position indicator at bottom-left when offline.
 * Automatically subscribes to OfflineManager events for real-time updates.
 */

import { debugLog } from '../utils/DebugUtils.js';

/**
 * OfflineIndicator Component
 * Displays connection status and pending sync count
 */
export class OfflineIndicator {
    constructor() {
        this.element = null;
        this.pendingCount = 0;
        this.isOffline = !navigator.onLine;
        this.isSyncing = false;
    }

    /**
     * Initialize the indicator and inject styles
     */
    init() {
        debugLog('OfflineIndicator: Initializing');
        this.injectStyles();
        this.createIndicator();
        this.updateDisplay();
        
        // Listen for OfflineManager events
        window.addEventListener('offlineStatusChanged', (e) => {
            debugLog('OfflineIndicator: Received offlineStatusChanged event', e.detail);
            this.isOffline = e.detail.isOffline;
            this.updateDisplay();
        });

        window.addEventListener('pendingCountChanged', (e) => {
            debugLog('OfflineIndicator: Received pendingCountChanged event', e.detail);
            this.pendingCount = e.detail.count;
            this.updateDisplay();
        });

        window.addEventListener('syncStatusChanged', (e) => {
            debugLog('OfflineIndicator: Received syncStatusChanged event', e.detail);
            this.isSyncing = e.detail.isSyncing;
            this.updateDisplay();
        });

        // Listen for native online/offline events as fallback
        window.addEventListener('online', () => {
            debugLog('OfflineIndicator: Browser online event');
            this.isOffline = false;
            this.updateDisplay();
        });

        window.addEventListener('offline', () => {
            debugLog('OfflineIndicator: Browser offline event');
            this.isOffline = true;
            this.updateDisplay();
        });
    }

    /**
     * Inject CSS styles for the indicator
     */
    injectStyles() {
        const styleId = 'offline-indicator-styles';
        
        // Don't inject if already present
        if (document.getElementById(styleId)) {
            return;
        }

        const styles = `
            .offline-indicator {
                position: fixed;
                bottom: 20px;
                left: 20px;
                background-color: #f44336;
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
                display: none;
                align-items: center;
                gap: 12px;
                z-index: 9999;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: transform 0.3s ease, opacity 0.3s ease;
            }

            .offline-indicator.visible {
                display: flex;
            }

            .offline-indicator.syncing {
                background-color: #ff9800;
            }

            .offline-indicator-icon {
                font-size: 20px;
                line-height: 1;
            }

            .offline-indicator-text {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .offline-indicator-status {
                font-weight: 600;
                font-size: 14px;
            }

            .offline-indicator-count {
                font-size: 12px;
                opacity: 0.9;
            }

            .offline-indicator-badge {
                background-color: rgba(255, 255, 255, 0.3);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: bold;
                min-width: 20px;
                text-align: center;
            }

            /* Mobile adjustments - above mobile navigation */
            /* Note: 70px assumes standard mobile nav height of 50-60px.
               Adjust if navigation height changes. */
            @media (max-width: 768px) {
                .offline-indicator {
                    bottom: 70px;
                    left: 10px;
                    right: 10px;
                    padding: 10px 14px;
                    font-size: 13px;
                }

                .offline-indicator-icon {
                    font-size: 18px;
                }

                .offline-indicator-status {
                    font-size: 13px;
                }

                .offline-indicator-count {
                    font-size: 11px;
                }
            }

            /* Animation for entering */
            @keyframes slideInUp {
                from {
                    transform: translateY(100px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }

            .offline-indicator.visible {
                animation: slideInUp 0.3s ease;
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
        
        debugLog('OfflineIndicator: Styles injected');
    }

    /**
     * Create the indicator DOM element
     */
    createIndicator() {
        this.element = document.createElement('div');
        this.element.className = 'offline-indicator';
        this.element.setAttribute('role', 'status');
        this.element.setAttribute('aria-live', 'polite');
        this.element.setAttribute('aria-atomic', 'true');

        this.element.innerHTML = `
            <span class="offline-indicator-icon" aria-hidden="true">⚠️</span>
            <div class="offline-indicator-text">
                <span class="offline-indicator-status"></span>
                <span class="offline-indicator-count"></span>
            </div>
            <span class="offline-indicator-badge"></span>
        `;

        document.body.appendChild(this.element);
        debugLog('OfflineIndicator: Element created');
    }

    /**
     * Update the indicator display based on current state
     */
    updateDisplay() {
        if (!this.element) {
            return;
        }

        const statusElement = this.element.querySelector('.offline-indicator-status');
        const countElement = this.element.querySelector('.offline-indicator-count');
        const badgeElement = this.element.querySelector('.offline-indicator-badge');
        const iconElement = this.element.querySelector('.offline-indicator-icon');

        // Show indicator when offline or syncing
        const shouldShow = this.isOffline || this.isSyncing || this.pendingCount > 0;
        
        if (shouldShow) {
            this.element.classList.add('visible');
        } else {
            this.element.classList.remove('visible');
        }

        // Update classes for styling
        if (this.isSyncing) {
            this.element.classList.add('syncing');
            this.element.style.backgroundColor = '#ff9800';
            iconElement.textContent = '🔄';
        } else if (this.isOffline) {
            this.element.classList.remove('syncing');
            this.element.style.backgroundColor = '#f44336';
            iconElement.textContent = '⚠️';
        } else {
            this.element.classList.remove('syncing');
            this.element.style.backgroundColor = '#4caf50';
            iconElement.textContent = '✓';
        }

        // Update text content
        if (this.isSyncing) {
            statusElement.textContent = this.getTranslation('status.syncing');
            countElement.textContent = '';
        } else if (this.isOffline) {
            statusElement.textContent = this.getTranslation('status.offline');
            if (this.pendingCount > 0) {
                countElement.textContent = this.getTranslation('sync.pending').replace('{{count}}', this.pendingCount);
            } else {
                countElement.textContent = '';
            }
        } else {
            statusElement.textContent = this.getTranslation('connection.restored');
            countElement.textContent = '';
        }

        // Update badge
        if (this.pendingCount > 0) {
            badgeElement.textContent = this.pendingCount;
            badgeElement.style.display = 'block';
        } else {
            badgeElement.style.display = 'none';
        }

        // Update ARIA label
        let ariaLabel = statusElement.textContent;
        if (this.pendingCount > 0) {
            ariaLabel += `, ${this.getTranslation('sync.pending').replace('{{count}}', this.pendingCount)}`;
        }
        this.element.setAttribute('aria-label', ariaLabel);
    }

    /**
     * Get translation for a key
     * Falls back to English if translation not found
     * @param {string} key - Translation key
     * @returns {string} Translated text
     */
    getTranslation(key) {
        // Try to get from global app translations if available
        if (window.app && typeof window.app.translate === 'function') {
            return window.app.translate(key);
        }

        // Fallback translations
        const fallbacks = {
            'status.offline': 'Offline',
            'status.syncing': 'Syncing...',
            'sync.pending': '{{count}} change(s) pending',
            'sync.complete': 'All changes synced',
            'sync.failed': 'Some changes failed to sync',
            'connection.restored': 'Connection restored',
            'connection.lost': 'You are offline'
        };

        return fallbacks[key] || key;
    }

    /**
     * Manually update the pending count
     * @param {number} count - Number of pending items
     */
    setPendingCount(count) {
        this.pendingCount = count;
        this.updateDisplay();
    }

    /**
     * Manually set offline status
     * @param {boolean} isOffline - Whether app is offline
     */
    setOfflineStatus(isOffline) {
        this.isOffline = isOffline;
        this.updateDisplay();
    }

    /**
     * Manually set syncing status
     * @param {boolean} isSyncing - Whether app is syncing
     */
    setSyncingStatus(isSyncing) {
        this.isSyncing = isSyncing;
        this.updateDisplay();
    }

    /**
     * Destroy the indicator and clean up
     */
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        debugLog('OfflineIndicator: Destroyed');
    }
}
