/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: {} }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr' }, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));
jest.mock('../../spa/api/api-members.js', () => ({ updateMyNickname: jest.fn() }));
jest.mock('../../spa/modules/push/PushSubscription.js', () => ({ enablePushNotifications: jest.fn(), disablePushNotifications: jest.fn(), PushSetupError: class extends Error {} }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canViewActivities: () => true, isParent: jest.fn(() => false), holdsFamilyRole: () => false, isDemoUser: () => false }));
jest.mock('../../spa/api/api-member-profile.js', () => ({ getMyProfile: jest.fn(), getMyHealth: jest.fn(), saveMyProfile: jest.fn(), saveMyHealth: jest.fn() }));
const mockCalendar = jest.fn((container) => { container.innerHTML = '<h2 id="calendar-feed-heading">Calendar</h2>'; });
const mockCertifications = jest.fn((container) => { container.innerHTML = '<h2 id="certifications-heading">Certifications</h2><label>Dates<input id="test-certification-date"></label>'; });
const mockAllergies = jest.fn((container) => { container.innerHTML = '<h2 id="allergy-declaration-heading">Allergies</h2><label>Allergies<input id="test-allergy-input"></label>'; });
jest.mock('../../spa/modules/calendar-feed/CalendarFeedPanel.js', () => ({ CALENDAR_FEED_ANCHOR: 'calendar-feed', CalendarFeedPanel: jest.fn().mockImplementation(() => ({ mount: mockCalendar, destroy: jest.fn() })) }));
jest.mock('../../spa/modules/certifications/CertificationsPanel.js', () => ({ CERTIFICATIONS_ANCHOR: 'certifications', CertificationsPanel: jest.fn().mockImplementation(() => ({ mount: mockCertifications, destroy: jest.fn() })) }));
jest.mock('../../spa/modules/member-allergies/AllergyPanel.js', () => ({ ALLERGY_ANCHOR: 'my-allergies', AllergyPanel: jest.fn().mockImplementation(() => ({ mount: mockAllergies, destroy: jest.fn() })) }));

import { AccountInfoModule } from '../../spa/modules/account-info.js';
import { isParent } from '../../spa/utils/PermissionUtils.js';
import { getMyProfile, getMyHealth } from '../../spa/api/api-member-profile.js';
import { makeApiRequest } from '../../spa/api/api-core.js';

let page; let app;
const flush = () => new Promise((done) => setTimeout(done, 0));
const $ = (query) => document.querySelector(query);
const visibleSection = () => $('[data-account-section]:not([hidden])').dataset.accountSection;
async function draw(url = '/account-info') {
  window.history.replaceState(null, '', url);
  page = new AccountInfoModule(app);
  page.userData = { full_name: 'Ada Fiction', email: 'ada@example.test', nickname: 'Fox', roles: ['u7_internal_role'] };
  page.render(); page.attachEventListeners(); await flush();
}
beforeEach(() => {
  jest.clearAllMocks(); isParent.mockReturnValue(false);
  document.body.innerHTML = '<main id="app"></main>';
  app = { lang: 'fr', showMessage: jest.fn(), getUnitLanguages: () => ({ available: ['fr', 'en'] }) };
  getMyProfile.mockResolvedValue({ data: { phone: '555-0100', share_camp_contacts: false } });
  getMyHealth.mockResolvedValue({ data: null });
});
afterEach(() => page?.destroy());

test('the account opens on contact details, with four task choices, no raw roles and logout immediately available', async () => {
  await draw();
  expect(visibleSection()).toBe('profile');
  expect(document.querySelectorAll('[data-account-section-link]')).toHaveLength(4);
  expect($('h1').textContent).toBe('account_info_title');
  expect(document.body.textContent).not.toContain('u7_internal_role');
  expect($('#logout-btn').closest('[hidden]')).toBeNull();
  expect(getMyProfile).toHaveBeenCalledTimes(1);
  expect(getMyHealth).not.toHaveBeenCalled();
  expect(mockCertifications).not.toHaveBeenCalled(); expect(mockCalendar).not.toHaveBeenCalled();
  expect($('#my-profile-emergency').open).toBe(false);
  expect($('#my-profile-sharing').open).toBe(false);
});

test('switching tasks keeps the same form nodes, pending entries and open details', async () => {
  await draw(); const name = $('#fullname-input'); const phone = $('[name=phone]');
  name.value = 'Draft identity'; phone.value = '555-0199'; $('#my-profile-emergency').open = true;
  $('[data-account-section-link=health]').click(); await flush();
  expect(visibleSection()).toBe('health');
  expect(document.activeElement).toBe($('#account-heading-health'));
  const allergy = $('#test-allergy-input'); allergy.value = 'Pending allergy';
  $('[data-account-section-link=profile]').click(); await flush();
  expect($('#fullname-input')).toBe(name); expect(name.value).toBe('Draft identity');
  expect($('[name=phone]')).toBe(phone); expect(phone.value).toBe('555-0199');
  expect($('#my-profile-emergency').open).toBe(true);
  $('[data-account-section-link=health]').click(); await flush();
  expect($('#test-allergy-input')).toBe(allergy); expect(allergy.value).toBe('Pending allergy');
  expect(mockAllergies).toHaveBeenCalledTimes(1);
});

test.each([
  ['my-profile', 'profile', null], ['my-health', 'health', 'account-health'],
  ['my-allergies', 'health', 'account-health'], ['certifications', 'health', 'account-certifications'],
  ['calendar-feed', 'preferences', 'account-calendar'],
])('a direct #%s link opens the right task and reveals its target', async (anchor, section, disclosure) => {
  await draw(`/account-info#${anchor}`);
  expect(visibleSection()).toBe(section);
  if (disclosure) { expect(document.getElementById(disclosure).open).toBe(true); }
  expect(document.getElementById(anchor).closest('[hidden]')).toBeNull();
});

test('a parent-only account has no adult health task and an unavailable section falls back to Profile', async () => {
  isParent.mockReturnValue(true); await draw('/account-info?section=health');
  expect(visibleSection()).toBe('profile');
  expect($('[data-account-section-link=health]')).toBeNull();
  expect($('#my-health')).toBeNull(); expect(getMyHealth).not.toHaveBeenCalled();
});

test('changing the time format does not redraw or discard unrelated entries', async () => {
  await draw(); const name = $('#fullname-input'); name.value = 'Unsaved name';
  page.showSection('preferences'); await flush();
  const select = $('#time-format-select'); select.value = '12h'; select.dispatchEvent(new Event('change'));
  expect($('#fullname-input')).toBe(name); expect(name.value).toBe('Unsaved name');
});

test('a translated redraw preserves the active task, drafts and disclosures', async () => {
  await draw('/account-info?section=security');
  $('#account-password').open = true; $('#new-password-input').value = 'FictionalDraft2026!';
  page.render(); page.attachEventListeners(); await flush();
  expect(visibleSection()).toBe('security'); expect($('#account-password').open).toBe(true);
  expect($('#new-password-input').value).toBe('FictionalDraft2026!');
});

test('a name save updates the account summary without replacing an unrelated draft', async () => {
  await draw(); const phone = $('[name=phone]'); phone.value = '555-0188';
  makeApiRequest.mockResolvedValue({ success: true, data: { full_name: 'New Fictional Name' } });
  $('#fullname-input').value = 'New Fictional Name';
  $('#fullname-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  expect($('[data-account-name]').textContent).toBe('New Fictional Name');
  expect($('[name=phone]')).toBe(phone); expect(phone.value).toBe('555-0188');
});

test('a loading failure offers retry and a response after leaving never overwrites another page', async () => {
  await draw(); page.renderError('Account could not load');
  expect($('[role=alert]').textContent).toBe('Account could not load'); expect($('#account-retry')).not.toBeNull();
  page.destroy(); document.getElementById('app').textContent = 'Next screen'; page.render();
  expect(document.getElementById('app').textContent).toBe('Next screen');
});

test('untrusted identity values remain text and the profile task passes axe', async () => {
  await draw(); page.userData.full_name = '<img src=x onerror=alert(1)>'; page.render(); await flush();
  expect($('img')).toBeNull(); expect($('[data-account-name]').textContent).toContain('<img');
  const result = await axe.run(document.getElementById('app'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations).toEqual([]);
});
