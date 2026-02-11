/**
 * SyncStatusPanel.js
 *
 * Observable UI panel showing sync state:
 * - Last sync time
 * - Pending outbox count
 * - Current sync phase
 * - Last error
 * - Manual sync / retry button
 *
 * WCAG 2.1 compliant: proper ARIA roles, keyboard accessible, sufficient contrast.
 */

import { debugLog } from '../utils/DebugUtils.js';
import { setContent } from '../utils/DOMUtils.js';
import { getDatabaseStats } from '../data/OfflineDatabase.js';
import { outboxManager } from '../sync/OutboxManager.js';
import { syncEngine } from '../sync/SyncEngine.js';

export class SyncStatusPanel {
  constructor() {
    this.element = null;
    this.isExpanded = false;
    this.stats = {
      outboxPending: 0,
      unresolvedConflicts: 0,
      lastSyncAt: null,
      syncPhase: 'idle',
      isSyncing: false,
      lastError: null,
      avgSyncDuration: 0,
    };
    this.abortController = null;
  }

  /**
   * Initialize the panel: inject styles, create DOM, attach listeners.
   */
  init() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this._injectStyles();
    this._createPanel();
    this._attachEventListeners(signal);
    this._refreshStats();

    debugLog('SyncStatusPanel: Initialized');
  }

  /**
   * Refresh stats from the database.
   */
  async _refreshStats() {
    try {
      const dbStats = await getDatabaseStats();
      const pendingCount = await outboxManager.getPendingCount();
      const metrics = syncEngine.getMetrics();

      this.stats = {
        outboxPending: pendingCount,
        unresolvedConflicts: dbStats.unresolvedConflicts,
        lastSyncAt: metrics.lastSyncAt || dbStats.lastSyncAt,
        syncPhase: metrics.phase,
        isSyncing: metrics.isSyncing,
        lastError: metrics.errors.length > 0
          ? metrics.errors[metrics.errors.length - 1].message
          : null,
        avgSyncDuration: metrics.lastSyncDuration,
      };

      this._updateDisplay();
    } catch (error) {
      debugLog('SyncStatusPanel: Failed to refresh stats', error);
    }
  }

  /**
   * Attach event listeners for sync events.
   */
  _attachEventListeners(signal) {
    window.addEventListener('syncStarted', () => {
      this.stats.isSyncing = true;
      this.stats.syncPhase = 'check';
      this._updateDisplay();
    }, { signal });

    window.addEventListener('syncPhaseChanged', (e) => {
      this.stats.syncPhase = e.detail.phase;
      this._updateDisplay();
    }, { signal });

    window.addEventListener('syncCompleted', (e) => {
      this.stats.isSyncing = false;
      this.stats.syncPhase = 'idle';
      this.stats.lastSyncAt = e.detail.metrics?.lastSyncAt;
      this.stats.avgSyncDuration = e.detail.metrics?.lastSyncDuration || 0;
      this.stats.lastError = null;
      this._refreshStats();
    }, { signal });

    window.addEventListener('syncFailed', (e) => {
      this.stats.isSyncing = false;
      this.stats.syncPhase = 'error';
      this.stats.lastError = e.detail.error;
      this._refreshStats();
    }, { signal });

    // Periodic refresh every 30 seconds
    const intervalId = setInterval(() => this._refreshStats(), 30000);
    signal.addEventListener('abort', () => clearInterval(intervalId));
  }

  /**
   * Inject CSS styles.
   */
  _injectStyles() {
    const styleId = 'sync-status-panel-styles';
    if (document.getElementById(styleId)) return;

    const styles = `
      .sync-status-trigger {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        background: #4c65ae;
        color: #fff;
        font-size: 18px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
        transition: background-color 0.2s;
      }
      .sync-status-trigger:hover,
      .sync-status-trigger:focus-visible {
        background: #3a509a;
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
      .sync-status-trigger[data-syncing="true"] {
        animation: spin 1s linear infinite;
      }
      .sync-status-trigger .badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: #f44336;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        min-width: 18px;
        height: 18px;
        line-height: 18px;
        border-radius: 9px;
        text-align: center;
        padding: 0 4px;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .sync-status-panel {
        position: fixed;
        bottom: 74px;
        right: 20px;
        width: 300px;
        max-height: 400px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 9997;
        display: none;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #333;
        overflow: hidden;
      }
      .sync-status-panel.expanded {
        display: flex;
      }
      .sync-status-panel__header {
        padding: 12px 16px;
        background: #4c65ae;
        color: #fff;
        font-weight: 600;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sync-status-panel__body {
        padding: 12px 16px;
        overflow-y: auto;
        flex: 1;
      }
      .sync-status-panel__row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid #eee;
      }
      .sync-status-panel__row:last-child {
        border-bottom: none;
      }
      .sync-status-panel__label {
        color: #666;
        font-size: 12px;
      }
      .sync-status-panel__value {
        font-weight: 600;
        font-size: 12px;
        text-align: right;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sync-status-panel__value--error {
        color: #f44336;
      }
      .sync-status-panel__value--success {
        color: #4caf50;
      }
      .sync-status-panel__value--syncing {
        color: #ff9800;
      }
      .sync-status-panel__actions {
        padding: 12px 16px;
        border-top: 1px solid #eee;
        display: flex;
        gap: 8px;
      }
      .sync-status-panel__btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }
      .sync-status-panel__btn--primary {
        background: #4c65ae;
        color: #fff;
      }
      .sync-status-panel__btn--primary:hover {
        background: #3a509a;
      }
      .sync-status-panel__btn--primary:disabled {
        background: #999;
        cursor: not-allowed;
      }

      @media (max-width: 768px) {
        .sync-status-trigger {
          bottom: 70px;
          right: 10px;
        }
        .sync-status-panel {
          bottom: 124px;
          right: 10px;
          left: 10px;
          width: auto;
        }
      }
    `;

    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = styles;
    document.head.appendChild(el);
  }

  /**
   * Create the panel DOM elements.
   */
  _createPanel() {
    // Remove existing
    document.getElementById('sync-status-trigger')?.remove();
    document.getElementById('sync-status-panel')?.remove();

    // Trigger button
    const trigger = document.createElement('button');
    trigger.id = 'sync-status-trigger';
    trigger.className = 'sync-status-trigger';
    trigger.setAttribute('aria-label', 'Sync status');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'sync-status-panel');
    trigger.innerHTML = '<span aria-hidden="true">&#x21bb;</span><span class="badge" style="display:none"></span>';
    trigger.addEventListener('click', () => this._togglePanel());
    document.body.appendChild(trigger);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'sync-status-panel';
    panel.className = 'sync-status-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Sync status details');
    setContent(panel, `
      <div class="sync-status-panel__header">
        <span>Sync Status</span>
      </div>
      <div class="sync-status-panel__body">
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Status</span>
          <span class="sync-status-panel__value" data-field="phase">Idle</span>
        </div>
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Pending Changes</span>
          <span class="sync-status-panel__value" data-field="pending">0</span>
        </div>
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Conflicts</span>
          <span class="sync-status-panel__value" data-field="conflicts">0</span>
        </div>
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Last Sync</span>
          <span class="sync-status-panel__value" data-field="lastSync">Never</span>
        </div>
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Duration</span>
          <span class="sync-status-panel__value" data-field="duration">-</span>
        </div>
        <div class="sync-status-panel__row">
          <span class="sync-status-panel__label">Last Error</span>
          <span class="sync-status-panel__value sync-status-panel__value--error" data-field="error">None</span>
        </div>
      </div>
      <div class="sync-status-panel__actions">
        <button class="sync-status-panel__btn sync-status-panel__btn--primary" data-action="sync">
          Sync Now
        </button>
      </div>
    `);
    document.body.appendChild(panel);

    // Sync Now button
    panel.querySelector('[data-action="sync"]').addEventListener('click', async () => {
      await this._triggerSync();
    });

    this.element = panel;
  }

  /**
   * Toggle panel visibility.
   */
  _togglePanel() {
    this.isExpanded = !this.isExpanded;
    const panel = document.getElementById('sync-status-panel');
    const trigger = document.getElementById('sync-status-trigger');

    if (panel) {
      panel.classList.toggle('expanded', this.isExpanded);
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', String(this.isExpanded));
    }

    if (this.isExpanded) {
      this._refreshStats();
    }
  }

  /**
   * Update the display with current stats.
   */
  _updateDisplay() {
    const panel = document.getElementById('sync-status-panel');
    const trigger = document.getElementById('sync-status-trigger');
    if (!panel) return;

    // Phase
    const phaseEl = panel.querySelector('[data-field="phase"]');
    if (phaseEl) {
      const label = this.stats.isSyncing ? `Syncing (${this.stats.syncPhase})` : 'Idle';
      phaseEl.textContent = label;
      phaseEl.className = 'sync-status-panel__value' +
        (this.stats.isSyncing ? ' sync-status-panel__value--syncing' : ' sync-status-panel__value--success');
    }

    // Pending
    const pendingEl = panel.querySelector('[data-field="pending"]');
    if (pendingEl) {
      pendingEl.textContent = String(this.stats.outboxPending);
    }

    // Conflicts
    const conflictsEl = panel.querySelector('[data-field="conflicts"]');
    if (conflictsEl) {
      conflictsEl.textContent = String(this.stats.unresolvedConflicts);
      conflictsEl.className = 'sync-status-panel__value' +
        (this.stats.unresolvedConflicts > 0 ? ' sync-status-panel__value--error' : '');
    }

    // Last sync
    const lastSyncEl = panel.querySelector('[data-field="lastSync"]');
    if (lastSyncEl) {
      lastSyncEl.textContent = this.stats.lastSyncAt
        ? new Date(this.stats.lastSyncAt).toLocaleTimeString()
        : 'Never';
    }

    // Duration
    const durationEl = panel.querySelector('[data-field="duration"]');
    if (durationEl) {
      durationEl.textContent = this.stats.avgSyncDuration > 0
        ? `${Math.round(this.stats.avgSyncDuration)}ms`
        : '-';
    }

    // Error
    const errorEl = panel.querySelector('[data-field="error"]');
    if (errorEl) {
      errorEl.textContent = this.stats.lastError || 'None';
      errorEl.className = 'sync-status-panel__value' +
        (this.stats.lastError ? ' sync-status-panel__value--error' : '');
    }

    // Trigger badge
    if (trigger) {
      trigger.setAttribute('data-syncing', String(this.stats.isSyncing));
      const badge = trigger.querySelector('.badge');
      if (badge) {
        if (this.stats.outboxPending > 0) {
          badge.textContent = String(this.stats.outboxPending);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    // Sync button state
    const syncBtn = panel.querySelector('[data-action="sync"]');
    if (syncBtn) {
      syncBtn.disabled = this.stats.isSyncing || !navigator.onLine;
      syncBtn.textContent = this.stats.isSyncing ? 'Syncing...' : 'Sync Now';
    }
  }

  /**
   * Trigger a manual sync.
   */
  async _triggerSync() {
    try {
      await syncEngine.sync();
    } catch (error) {
      debugLog('SyncStatusPanel: Manual sync failed', error);
    }
    await this._refreshStats();
  }

  /**
   * Destroy the panel and clean up.
   */
  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    document.getElementById('sync-status-trigger')?.remove();
    document.getElementById('sync-status-panel')?.remove();
    this.element = null;
    debugLog('SyncStatusPanel: Destroyed');
  }
}

export const syncStatusPanel = new SyncStatusPanel();
