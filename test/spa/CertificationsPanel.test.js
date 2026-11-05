/**
 * @jest-environment jsdom
 */

/**
 * "My certifications" on the account page (#1319): an adult declares the certifications they
 * hold, with the day obtained and an optional expiry. Each line says whether a manager verified
 * it; a declaration alone never reads as verified. The section meets WCAG A/AA.
 *
 * @module test/spa/CertificationsPanel
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/api/api-member-certifications.js', () => ({
  getMyCertifications: jest.fn(), saveMyCertifications: jest.fn(), getMemberCertifications: jest.fn(),
}));

const api = require('../../spa/api/api-member-certifications.js');
const { isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { CertificationsPanel } = require('../../spa/modules/certifications/CertificationsPanel.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let panel; let app;

function records() {
  return [
    { certification_key: 'first_aid_certificate', declared: { obtained_on: '2025-03-01', valid_until: '2028-03-01' },
      verified: { checked_on: '2025-03-01', valid_until: '2028-03-01' } },
    { certification_key: 'wilderness_first_aid', declared: { obtained_on: '2026-01-10', valid_until: null }, verified: null },
    { certification_key: 'winter_camping', declared: null, verified: null },
  ];
}

async function mount() {
  panel = new CertificationsPanel(app);
  await panel.mount(document.getElementById('certifications'));
  await flush();
}

const submit = () => $('#certifications-form').dispatchEvent(new Event('submit', { cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"><section id="certifications" aria-labelledby="certifications-heading"></section></main>';
  app = { lang: 'fr', showMessage: jest.fn() };
  isDemoUser.mockReturnValue(false);
  api.getMyCertifications.mockReset().mockResolvedValue({ success: true, data: records() });
  api.saveMyCertifications.mockReset().mockResolvedValue({ success: true, data: records() });
});

afterEach(() => panel?.destroy());

test('each certification says where it stands; a declaration alone never reads as verified', async () => {
  await mount();
  expect($('#certifications-heading').textContent).toBe('certifications_title');
  expect($('#certification-first_aid_certificate-status').textContent).toBe('certifications_status_verified_until');
  expect($('#certification-wilderness_first_aid-status').textContent).toBe('certifications_status_declared');
  expect($('#certification-winter_camping-status').textContent).toBe('certifications_status_none');
});

test('dates are offered only for a certification one holds', async () => {
  await mount();
  expect($('#certification-winter_camping-held').checked).toBe(false);
  expect($('#certification-winter_camping-obtained').disabled).toBe(true);
  $('#certification-winter_camping-held').click();
  expect($('#certification-winter_camping-obtained').disabled).toBe(false);
  expect($('#certification-winter_camping-until').disabled).toBe(false);
});

test('saving sends the complete set of declarations, and says a manager will verify them', async () => {
  await mount();
  $('#certification-wilderness_first_aid-held').click();
  $('#certification-winter_camping-held').click();
  $('#certification-winter_camping-obtained').value = '2024-01-15';
  submit();
  await flush();
  expect(api.saveMyCertifications).toHaveBeenCalledWith({
    first_aid_certificate: { obtained_on: '2025-03-01', valid_until: '2028-03-01' },
    winter_camping: { obtained_on: '2024-01-15', valid_until: null },
  });
  expect(app.showMessage).toHaveBeenCalledWith('certifications_saved', 'success');
});

test('a certification held without a day obtained is refused next to its field, before anything is sent', async () => {
  await mount();
  $('#certification-winter_camping-held').click();
  submit();
  await flush();
  const field = $('#certification-winter_camping-obtained');
  expect(api.saveMyCertifications).not.toHaveBeenCalled();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(field.getAttribute('aria-describedby')).toContain('certification-winter_camping-obtained-error');
  expect($('#certification-winter_camping-obtained-error').textContent).toBe('certification_obtained_on_invalid');
  expect(document.activeElement).toBe(field);
  field.value = '2024-01-15';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  expect($('#certification-winter_camping-obtained-error').textContent).toBe('');
});

test('an expiry before the day obtained is refused next to the expiry', async () => {
  await mount();
  $('#certification-wilderness_first_aid-until').value = '2025-01-01';
  submit();
  await flush();
  expect(api.saveMyCertifications).not.toHaveBeenCalled();
  expect($('#certification-wilderness_first_aid-until').getAttribute('aria-invalid')).toBe('true');
});

test('a server refusal about a field is shown next to that field', async () => {
  api.saveMyCertifications.mockRejectedValue(Object.assign(new Error('refused'), {
    status: 400, errors: [{ path: 'declared.first_aid_certificate.obtained_on', msg: 'certification_obtained_on_invalid' }],
  }));
  await mount();
  submit();
  await flush();
  await flush();
  expect($('#certification-first_aid_certificate-obtained').getAttribute('aria-invalid')).toBe('true');
  expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
});

test('any other failed save is announced in the section, never as saved', async () => {
  api.saveMyCertifications.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
  await mount();
  submit();
  await flush();
  await flush();
  const summary = $('#certifications-error');
  expect(summary.hidden).toBe(false);
  expect(summary.getAttribute('role')).toBe('alert');
  expect(document.activeElement).toBe(summary);
  expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
});

test('a demo account sees its certifications but is offered no change', async () => {
  isDemoUser.mockReturnValue(true);
  await mount();
  expect(document.querySelector('#certifications-form button[type="submit"]')).toBeNull();
  expect(document.body.textContent).toContain('certifications_demo');
  expect($('#certification-winter_camping-held').disabled).toBe(true);
});

test('a failed load explains itself and offers a retry', async () => {
  api.getMyCertifications.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  await mount();
  expect($('#certifications [role="alert"]')).not.toBeNull();
  expect($('#certifications-form')).toBeNull();
  $('#certifications-retry').click();
  await flush();
  expect($('#certifications-form')).not.toBeNull();
});

test('the section meets WCAG A/AA', async () => {
  await mount();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
