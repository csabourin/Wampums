/**
 * @jest-environment jsdom
 */

/**
 * The unprocessed-achievements backlog awards stars to the youth planned at a
 * past meeting. One who has left the pack since is not on the tracker's roster:
 * they must neither be listed (formerly as "Unknown") nor awarded a star.
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  saveBadgeHistory: jest.fn()
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canApproveBadges: jest.fn(() => true),
  canManageBadges: jest.fn(() => true),
  canViewBadges: jest.fn(() => true)
}));

import { BadgeTracker } from '../../spa/modules/badges/BadgeTracker.js';
import { saveBadgeHistory } from '../../spa/api/api-endpoints.js';

const TEMPLATE_ID = 5;
const ON_ROSTER_ID = 1;
const LEFT_ID = 2;

describe('Badge tracker backlog', () => {
  let tracker;

  beforeEach(() => {
    document.body.textContent = '';
    tracker = new BadgeTracker({});
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela' }];
    tracker.participants = [{ id: ON_ROSTER_ID, first_name: 'Alix', last_name: 'Tremblay' }];
    tracker.unprocessedMeetings = [{
      id: 10,
      date: '2026-09-15',
      activities: [{
        id: 20,
        badge_template_id: TEMPLATE_ID,
        star_type: 'proie',
        participant_ids: [ON_ROSTER_ID, LEFT_ID]
      }]
    }];
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  test('lists and targets only the youth on the roster', async () => {
    await tracker.openUnprocessedModal();

    const row = document.querySelector('.award-row');
    expect(row.textContent).toContain('Alix Tremblay');
    expect(row.textContent).not.toContain('Unknown');

    const checkbox = row.querySelector('.award-confirm-checkbox');
    expect(JSON.parse(checkbox.dataset.participants)).toEqual([ON_ROSTER_ID]);
  });

  test('backfills multiple selected badge levels for one youth in a single history save', async () => {
    tracker.templates = [
      { id: TEMPLATE_ID, name: 'Akela', level_count: 3 },
      { id: 6, name: 'Baloo', level_count: 2 }
    ];
    tracker.canManage = true;
    tracker.badges = [{ participant_id: ON_ROSTER_ID, badge_template_id: TEMPLATE_ID, etoiles: 1, status: 'approved' }];
    tracker.loadData = jest.fn().mockResolvedValue(true);
    tracker.render = jest.fn();
    tracker.attachSearchListener = jest.fn();
    tracker.showToast = jest.fn();
    saveBadgeHistory.mockResolvedValue({ success: true, data: { inserted: [{}, {}], skipped: [] } });

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);

    const modal = document.querySelector('#badge-history-modal');
    expect(modal.textContent).toContain('badge_update_history_help');
    expect(modal.querySelector('input[value="5:1"]').disabled).toBe(true);
    modal.querySelector('input[value="5:2"]').checked = true;
    modal.querySelector('input[value="6:1"]').checked = true;
    modal.querySelector('#badge-history-date').value = '2025-05-10';
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();
    expect(saveBadgeHistory).toHaveBeenCalledWith({
      participant_id: ON_ROSTER_ID,
      date: '2025-05-10',
      star_type: 'proie',
      entries: [
        { badge_template_id: TEMPLATE_ID, level: 2 },
        { badge_template_id: 6, level: 1 }
      ]
    });
    expect(tracker.loadData).toHaveBeenCalledWith(true);
  });

  test('keeps queued history open until offline replay confirms the save', async () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela', level_count: 2 }];
    tracker.loadData = jest.fn().mockResolvedValue(true);
    tracker.render = jest.fn();
    tracker.attachSearchListener = jest.fn();
    tracker.showToast = jest.fn();
    saveBadgeHistory.mockResolvedValue({ success: true, queued: true });

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(modal.isConnected).toBe(true);
    expect(tracker.loadData).not.toHaveBeenCalled();
    expect(tracker.showToast).toHaveBeenCalledWith('offline.savedLocally', 'info');

    window.dispatchEvent(new CustomEvent('offlineMutationReplayed', {
      detail: { url: '/api/v1/badges/history', method: 'POST' }
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(tracker.loadData).toHaveBeenCalledWith(true);
    expect(document.querySelector('#badge-history-modal')).toBeNull();
    expect(tracker.showToast).toHaveBeenLastCalledWith('1 badge_history_saved', 'success');
  });

  test('explains a refused history save and keeps the form open to retry', async () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela', level_count: 2 }];
    tracker.loadData = jest.fn();
    tracker.showToast = jest.fn();
    saveBadgeHistory.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(modal.isConnected).toBe(true);
    expect(tracker.loadData).not.toHaveBeenCalled();
    expect(tracker.showToast).toHaveBeenCalledWith(expect.not.stringMatching(/Forbidden/), 'error');
    expect(tracker.showToast).not.toHaveBeenCalledWith('error', 'error');
    expect(modal.querySelector('button[form="badge-history-form"]').disabled).toBe(false);
  });
});
