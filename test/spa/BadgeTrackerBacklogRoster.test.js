/**
 * @jest-environment jsdom
 */

/**
 * The unprocessed-achievements backlog awards stars to the youth planned at a
 * past meeting. One who has left the pack since is not on the tracker's roster:
 * they must neither be listed (formerly as "Unknown") nor awarded a star.
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => (key === 'badge_baloo' ? 'True like Baloo' : key)
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));

jest.mock('../../spa/api/api-endpoints.js', () => ({}));

jest.mock('../../spa/api/api-badges.js', () => ({
  saveBadgeHistory: jest.fn()
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canApproveBadges: jest.fn(() => true),
  canManageBadges: jest.fn(() => true),
  canViewBadges: jest.fn(() => true)
}));

import axe from 'axe-core';
import { BadgeTracker } from '../../spa/modules/badges/BadgeTracker.js';
import { saveBadgeHistory } from '../../spa/api/api-badges.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

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
    saveBadgeHistory.mockResolvedValue({ success: true, queued: true, mutationId: 'mutation-a' });

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(modal.isConnected).toBe(true);
    expect(tracker.loadData).not.toHaveBeenCalled();
    expect(tracker.showToast).toHaveBeenCalledWith('offline.savedLocally', 'info');
    // The queued snapshot cannot be edited, so nothing ticked now would be lost on replay.
    expect(modal.querySelector('input[value="5:2"]').disabled).toBe(true);
    expect(modal.querySelector('button[form="badge-history-form"]').disabled).toBe(true);
    expect(document.activeElement).toBe(modal.querySelector('[data-modal-close]'));

    window.dispatchEvent(new CustomEvent('offlineMutationReplayed', {
      detail: { url: '/api/v1/badges/history', method: 'POST', mutationId: 'mutation-other' }
    }));
    await Promise.resolve();
    expect(modal.isConnected).toBe(true);
    expect(tracker.loadData).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('offlineMutationReplayed', {
      detail: { url: '/api/v1/badges/history', method: 'POST', mutationId: 'mutation-a' }
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

  test('a replay confirmed after leaving the screen does not draw over the next one', async () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela', level_count: 2 }];
    tracker.loadData = jest.fn().mockResolvedValue(true);
    tracker.render = jest.fn();
    tracker.attachSearchListener = jest.fn();
    tracker.showToast = jest.fn();
    saveBadgeHistory.mockResolvedValue({ success: true, queued: true, mutationId: 'mutation-b' });

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    tracker.destroy();

    window.dispatchEvent(new CustomEvent('offlineMutationReplayed', {
      detail: { url: '/api/v1/badges/history', method: 'POST', mutationId: 'mutation-b' }
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(tracker.loadData).not.toHaveBeenCalled();
    expect(tracker.render).not.toHaveBeenCalled();
  });

  test('a confirmed save that completes after leaving the screen does not render it again', async () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela', level_count: 2 }];
    tracker.loadData = jest.fn(() => { tracker.destroy(); return Promise.resolve(true); });
    tracker.render = jest.fn();
    tracker.attachSearchListener = jest.fn();
    tracker.showToast = jest.fn();
    saveBadgeHistory.mockResolvedValue({ success: true, data: { inserted: [{ id: 1 }] } });

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(tracker.loadData).toHaveBeenCalledWith(true);
    expect(tracker.render).not.toHaveBeenCalled();
  });

  test('names each badge in the history dialog in the interface language', () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Vrai comme Baloo', translation_key: 'badge_baloo', level_count: 1 }];

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const legends = Array.from(document.querySelectorAll('#badge-history-modal legend')).map((node) => node.textContent);

    expect(legends).toContain('True like Baloo');
    expect(legends).not.toContain('Vrai comme Baloo');
  });

  test('the history dialog cannot be dismissed while its save is in flight', async () => {
    tracker.canManage = true;
    tracker.templates = [{ id: TEMPLATE_ID, name: 'Akela', level_count: 2 }];
    tracker.loadData = jest.fn().mockResolvedValue(true);
    tracker.render = jest.fn();
    tracker.attachSearchListener = jest.fn();
    tracker.showToast = jest.fn();
    let answer;
    saveBadgeHistory.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const modal = document.querySelector('#badge-history-modal');
    modal.querySelector('input[value="5:1"]').checked = true;
    modal.querySelector('#badge-history-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    modal.querySelector('[data-modal-close]').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.isConnected).toBe(true);

    answer({ success: true, data: { inserted: [{ id: 1 }] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(modal.isConnected).toBe(false);
  });

  describe('history dialog accessibility', () => {
    beforeEach(() => {
      tracker.canManage = true;
      tracker.templates = [
        { id: TEMPLATE_ID, name: 'Akela', level_count: 2 },
        { id: 6, name: '<img src=x onerror=alert(1)>', level_count: 1 },
      ];
      tracker.badges = [{ participant_id: ON_ROSTER_ID, badge_template_id: TEMPLATE_ID, etoiles: 1 }];
    });

    test('has no WCAG A/AA violations, with a level already recorded', async () => {
      tracker.openBadgeHistoryModal(ON_ROSTER_ID);
      const overlay = document.querySelector('#badge-history-modal');

      const results = await axe.run(overlay, AXE_OPTIONS);

      expect(results.violations).toEqual([]);
      expect(overlay.querySelector('[role="dialog"]')).not.toBeNull();
      expect(overlay.querySelector('input[value="5:1"]').disabled).toBe(true);
    });

    test('shows a badge name from a person as text, not markup', () => {
      tracker.openBadgeHistoryModal(ON_ROSTER_ID);
      const overlay = document.querySelector('#badge-history-modal');

      expect(overlay.querySelector('img')).toBeNull();
      expect(overlay.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    test('moves focus into the dialog, closes on Escape and returns focus to the opener', () => {
      const opener = document.createElement('button');
      opener.textContent = 'badge_update_history';
      document.body.appendChild(opener);
      opener.focus();

      tracker.openBadgeHistoryModal(ON_ROSTER_ID);
      const overlay = document.querySelector('#badge-history-modal');
      expect(overlay.contains(document.activeElement)).toBe(true);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(overlay.isConnected).toBe(false);
      expect(document.activeElement).toBe(opener);
    });

    test('a click outside the dialog does not discard the ticked levels', () => {
      tracker.openBadgeHistoryModal(ON_ROSTER_ID);
      const overlay = document.querySelector('#badge-history-modal');
      overlay.querySelector('input[value="5:2"]').checked = true;

      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(overlay.isConnected).toBe(true);
      expect(overlay.querySelector('input[value="5:2"]').checked).toBe(true);
    });
  });

  test('offers only the badges of the youth\'s section, and general ones', () => {
    tracker.canManage = true;
    tracker.participants = [{ id: ON_ROSTER_ID, first_name: 'Alix', last_name: 'Tremblay', section: 'louveteaux' }];
    tracker.templates = [
      { id: TEMPLATE_ID, name: 'Akela', section: 'louveteaux', level_count: 1 },
      { id: 6, name: 'Campfire', section: 'general', level_count: 1 },
      { id: 7, name: 'Kayak', section: 'eclaireurs', level_count: 1 },
    ];

    tracker.openBadgeHistoryModal(ON_ROSTER_ID);
    const values = Array.from(document.querySelectorAll('#badge-history-modal input[name="level"]')).map((input) => input.value);

    expect(values).toEqual(['5:1', '6:1']);
  });
});
