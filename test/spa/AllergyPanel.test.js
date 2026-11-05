/**
 * @jest-environment jsdom
 */

/**
 * "My allergies" on the account page (#1319): an adult declares their own allergies, whether they
 * carry an auto-injector and whom to notify; they may withdraw it, after confirming. Nothing is
 * reported as saved when it was not. The section meets WCAG A/AA.
 *
 * @module test/spa/AllergyPanel
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/api/api-member-allergies.js', () => ({
  getMyAllergies: jest.fn(), saveMyAllergies: jest.fn(), removeMyAllergies: jest.fn(),
}));

const api = require('../../spa/api/api-member-allergies.js');
const { isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { AllergyPanel } = require('../../spa/modules/member-allergies/AllergyPanel.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const DECLARED = { allergies: 'Arachides', carries_epipen: true, person_to_notify: 'Léa Tremblay, 555-0100', declared_at: '2026-10-01T12:00:00Z' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let panel; let app;

async function mount() {
  panel = new AllergyPanel(app);
  await panel.mount(document.getElementById('my-allergies'));
  await flush();
}
const submit = () => $('#allergy-declaration-form').dispatchEvent(new Event('submit', { cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"><section id="my-allergies" aria-labelledby="allergy-declaration-heading"></section></main>';
  app = { lang: 'fr', showMessage: jest.fn() };
  isDemoUser.mockReturnValue(false);
  confirmDestructive.mockReset();
  api.getMyAllergies.mockReset().mockResolvedValue({ success: true, data: null });
  api.saveMyAllergies.mockReset().mockImplementation((body) => Promise.resolve({ success: true, data: { ...body, declared_at: '2026-11-05T12:00:00Z' } }));
  api.removeMyAllergies.mockReset().mockResolvedValue({ success: true, data: null });
});

afterEach(() => panel?.destroy());

test('with nothing declared, the section says so and offers no withdrawal', async () => {
  await mount();
  expect($('#allergy-declaration-heading').textContent).toBe('allergy_declaration_title');
  expect($('#allergy-declaration-status').textContent).toBe('allergy_declaration_status_none');
  expect($('#allergy-declaration-remove')).toBeNull();
});

test('a declaration is sent as typed, trimmed, and the section then shows it as declared', async () => {
  await mount();
  $('#allergy-declaration-allergies').value = '  Pénicilline  ';
  $('#allergy-declaration-epipen').click();
  $('#allergy-declaration-person').value = ' Ada Lovelace, 555-0100 ';
  submit();
  await flush();
  expect(api.saveMyAllergies).toHaveBeenCalledWith({ allergies: 'Pénicilline', carries_epipen: true, person_to_notify: 'Ada Lovelace, 555-0100' });
  expect(app.showMessage).toHaveBeenCalledWith('allergy_declaration_saved', 'success');
  expect($('#allergy-declaration-status').textContent).toBe('allergy_declaration_status_declared');
  expect($('#allergy-declaration-remove')).not.toBeNull();
});

test('an empty declaration is refused next to its field, before anything is sent', async () => {
  await mount();
  submit();
  await flush();
  const field = $('#allergy-declaration-allergies');
  expect(api.saveMyAllergies).not.toHaveBeenCalled();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(field.getAttribute('aria-describedby')).toContain('allergy-declaration-allergies-error');
  expect($('#allergy-declaration-allergies-error').textContent).toBe('allergy_declaration_allergies_invalid');
  expect(document.activeElement).toBe(field);
  field.value = 'Latex';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  expect($('#allergy-declaration-allergies-error').textContent).toBe('');
});

test('a server refusal about a field stays next to that field, never reported as saved', async () => {
  api.saveMyAllergies.mockRejectedValue(Object.assign(new Error('refused'), {
    status: 400, errors: [{ path: 'person_to_notify', msg: 'allergy_declaration_person_invalid' }],
  }));
  await mount();
  $('#allergy-declaration-allergies').value = 'Latex';
  submit();
  await flush();
  await flush();
  expect($('#allergy-declaration-person').getAttribute('aria-invalid')).toBe('true');
  expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
});

test('withdrawing asks first; declining changes nothing', async () => {
  api.getMyAllergies.mockResolvedValue({ success: true, data: DECLARED });
  confirmDestructive.mockResolvedValue(false);
  await mount();
  $('#allergy-declaration-remove').click();
  await flush();
  expect(confirmDestructive).toHaveBeenCalled();
  expect(api.removeMyAllergies).not.toHaveBeenCalled();
  confirmDestructive.mockResolvedValue(true);
  $('#allergy-declaration-remove').click();
  await flush();
  await flush();
  expect(api.removeMyAllergies).toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith('allergy_declaration_removed', 'success');
  expect($('#allergy-declaration-status').textContent).toBe('allergy_declaration_status_none');
  expect(document.activeElement).toBe($('#allergy-declaration-status'));
});

test('what was declared is shown as text', async () => {
  api.getMyAllergies.mockResolvedValue({ success: true, data: { ...DECLARED, allergies: HOSTILE, person_to_notify: HOSTILE } });
  await mount();
  expect(document.querySelector('#app img')).toBeNull();
  expect($('#allergy-declaration-allergies').value).toBe(HOSTILE);
  expect($('#allergy-declaration-person').value).toBe(HOSTILE);
});

test('a demo account sees its section but is offered no change', async () => {
  isDemoUser.mockReturnValue(true);
  await mount();
  expect(document.querySelector('#allergy-declaration-form button')).toBeNull();
  expect($('#allergy-declaration-allergies').disabled).toBe(true);
  expect(document.body.textContent).toContain('allergy_declaration_demo');
});

test('a failed load explains itself and offers a retry', async () => {
  api.getMyAllergies.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  await mount();
  expect($('#my-allergies [role="alert"]')).not.toBeNull();
  expect($('#allergy-declaration-form')).toBeNull();
  $('#allergy-declaration-retry').click();
  await flush();
  expect($('#allergy-declaration-form')).not.toBeNull();
});

test('the section meets WCAG A/AA', async () => {
  api.getMyAllergies.mockResolvedValue({ success: true, data: DECLARED });
  await mount();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
