/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: jest.fn(() => 'one-account') }));
jest.mock('../../spa/api/api-member-profile.js', () => ({ getMyProfile: jest.fn(), saveMyProfile: jest.fn(), getMyHealth: jest.fn(), saveMyHealth: jest.fn() }));
import { getMyProfile, saveMyProfile, getMyHealth, saveMyHealth } from '../../spa/api/api-member-profile.js';
import { isDemoUser } from '../../spa/utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../spa/utils/OfflineCacheKeys.js';
import { ProfilePanel } from '../../spa/modules/member-profile/ProfilePanel.js';
const flush = () => new Promise((done) => setTimeout(done, 0));
let panel; let app;
const $ = (q) => document.querySelector(q);
async function mount(health = false) {
  panel = new ProfilePanel(app, { health });
  await panel.mount(document.querySelector('section'));
}
const submit = () => $('form').dispatchEvent(new Event('submit', { cancelable: true }));
beforeEach(() => {
  jest.clearAllMocks();
  isDemoUser.mockReturnValue(false); buildScopedCacheKey.mockReturnValue('one-account');
  document.body.innerHTML = '<main><section></section></main>';
  app = { showMessage: jest.fn() };
  getMyProfile.mockResolvedValue({ success: true, data: { share_camp_contacts: false } });
  getMyHealth.mockResolvedValue({ success: true, data: null });
  saveMyProfile.mockImplementation((data) => Promise.resolve({ success: true, data }));
  saveMyHealth.mockImplementation((data) => Promise.resolve({ success: true, data }));
});
afterEach(() => panel?.destroy());
test('a new profile shares nothing until the member chooses to and saves', async () => {
  await mount();
  expect($('[name=share_camp_contacts]').checked).toBe(false);
  $('[name=phone]').value = '555-0100';
  $('[name=share_camp_contacts]').click();
  submit(); await flush();
  expect(saveMyProfile).toHaveBeenCalledWith(expect.objectContaining({ phone: '555-0100', share_camp_contacts: true }));
  expect(app.showMessage).toHaveBeenCalledWith('member_profile_saved', 'success');
});
test('the member can revoke consent without deleting their phone', async () => {
  getMyProfile.mockResolvedValue({ data: { phone: '555-0100', share_camp_contacts: true } });
  await mount(); $('[name=share_camp_contacts]').click(); submit(); await flush();
  expect(saveMyProfile).toHaveBeenCalledWith(expect.objectContaining({ phone: '555-0100', share_camp_contacts: false }));
});
test('health is an optional self-written form and links to the existing allergies section', async () => {
  await mount(true); $('[name=health_conditions]').value = '  None  '; submit(); await flush();
  expect(saveMyHealth).toHaveBeenCalledWith({ health_conditions: 'None', medications: null, support_needs: null });
  expect($('a').getAttribute('href')).toBe('#my-allergies');
  expect(app.showMessage).toHaveBeenCalledWith('member_health_saved', 'success');
});
test('a failed save keeps the person’s entries and offers a focused error, never success', async () => {
  saveMyProfile.mockRejectedValue(new Error('network'));
  await mount(); $('[name=phone]').value = '555-0100'; submit(); await flush();
  expect($('[name=phone]').value).toBe('555-0100');
  expect($('[data-profile-error]').hidden).toBe(false);
  expect(document.activeElement).toBe($('[data-profile-error]'));
  expect(app.showMessage).not.toHaveBeenCalled();
  expect($('fieldset').disabled).toBe(false);
});
test('an unconfirmed queued write is never described as saved', async () => {
  saveMyProfile.mockResolvedValue({ queued: true });
  await mount(); submit(); await flush();
  expect(app.showMessage).not.toHaveBeenCalled();
  expect($('[data-profile-error]').hidden).toBe(false);
});
test('a load failure offers retry, which loads the form', async () => {
  getMyProfile.mockRejectedValueOnce(new Error('network'));
  await mount(); $('[data-profile-retry]').click(); await flush();
  expect($('form')).not.toBeNull();
});
test('a demo account cannot write contacts or health', async () => {
  isDemoUser.mockReturnValue(true); await mount(); submit(); await flush();
  expect($('fieldset').disabled).toBe(true);
  expect(saveMyProfile).not.toHaveBeenCalled();
});
test('a pending write cannot be sent twice', async () => {
  let finish;
  saveMyProfile.mockReturnValue(new Promise((done) => { finish = done; }));
  await mount(); submit(); submit(); expect(saveMyProfile).toHaveBeenCalledTimes(1);
  finish({ success: true, data: {} }); await flush();
});
test('a response from a former account cannot replace the current screen', async () => {
  let finish; getMyProfile.mockReturnValue(new Promise((done) => { finish = done; }));
  panel = new ProfilePanel(app); const mounting = panel.mount(document.querySelector('section'));
  buildScopedCacheKey.mockReturnValue('another-account');
  document.body.innerHTML = '<main>Next account</main>';
  finish({ data: { phone: 'private' } }); await mounting;
  expect(document.body.textContent).toBe('Next account');
});
test.each([false, true])('personal forms escape supplied text and meet axe accessibility checks (health: %s)', async (health) => {
  getMyProfile.mockResolvedValue({ data: { emergency_contact_name: '"><img src=x onerror=alert(1)>' } });
  getMyHealth.mockResolvedValue({ data: { medications: '</textarea><img src=x onerror=alert(1)>' } });
  await mount(health);
  expect($('img')).toBeNull();
  const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations).toEqual([]);
});
