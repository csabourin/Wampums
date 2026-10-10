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

jest.mock('../../spa/api/api-endpoints.js', () => ({}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canApproveBadges: jest.fn(() => true),
  canManageBadges: jest.fn(() => true),
  canViewBadges: jest.fn(() => true)
}));

import { BadgeTracker } from '../../spa/badge_tracker.js';

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
});
