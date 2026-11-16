/**
 * @jest-environment jsdom
 */

/**
 * The letter to parents drawn from the camp (#1321): what the camp still lacks, who the letter
 * reaches, both versions to edit, saving, sending once confirmed, sending again where it failed,
 * reading only without the rights, names shown as text, and WCAG A/AA.
 *
 * @module test/spa/CampLetter
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn() }));
jest.mock('../../spa/api/api-camp-plans.js', () => ({
  getCampLetter: jest.fn(), saveCampLetterDraft: jest.fn(), sendCampLetter: jest.fn(), retryCampLetter: jest.fn(),
}));

const { getCampLetter, saveCampLetterDraft, sendCampLetter, retryCampLetter } = require('../../spa/api/api-camp-plans.js');
const { hasPermission, isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { confirm } = require('../../spa/utils/DialogUtils.js');
const { CampLetter } = require('../../spa/modules/camp-plan/CampLetter.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);

/** A camp letter as the server answers it, with what a test needs changed. */
function letter(overrides = {}) {
  return { success: true, data: {
    camp: { id: 12, name: 'Camp d’été', date_from: '2027-07-04', date_to: '2027-07-06', activity_id: 30, is_cancelled: false },
    facts: {},
    missing: ['return_time', 'emergency_phone'],
    draft: { saved: false, updated_at: null,
      fr: { subject: 'Camp d’été : ce qu’il faut savoir', body_html: '<p>Bonjour</p>' },
      en: { subject: 'Summer camp: what to know', body_html: '<p>Hello</p>' } },
    proposed: {
      fr: { subject: 'Proposé', body_html: '<p>Proposée</p>' },
      en: { subject: 'Proposed', body_html: '<p>Proposed</p>' },
    },
    audience: { families: 9, children: 11, without_address: [{ id: 4, first_name: 'Léa', last_name: 'Tremblay' }] },
    sent: [],
    ...overrides,
  } };
}

let app; let screen;
async function open(response = letter()) {
  getCampLetter.mockResolvedValue(response);
  app = { lang: 'fr', showMessage: jest.fn() };
  screen = new CampLetter(app, { meetingId: 12 });
  await screen.init();
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  hasPermission.mockReturnValue(true);
  isDemoUser.mockReturnValue(false);
});

afterEach(() => screen?.destroy());

test('the letter opens with the back link, what the camp lacks with where to complete it, and who it reaches', async () => {
  await open();
  const page = $('.camp-letter');
  expect(page.firstElementChild.tagName).toBe('A');
  expect(page.firstElementChild.getAttribute('href')).toBe('/camp-permit/12');
  expect($('h1').textContent).toBe('camp_letter_title');
  const missing = [...document.querySelectorAll('.camp-letter__missing li')].map((item) => item.textContent.trim());
  expect(missing[0]).toContain('camp_letter_missing_return_time');
  expect($('.camp-letter__missing a[href="/camp-site/12"]').textContent).toBe('camp_letter_fix_site');
  expect(document.body.textContent).toContain('camp_letter_audience_other');
  expect(document.body.textContent).toContain('camp_letter_without_address_one');
  expect($('#camp-letter-subject-fr').value).toBe('Camp d’été : ce qu’il faut savoir');
  expect($('#camp-letter-body-en').textContent).toBe('Hello');
  expect((await axe.run($('#app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('names typed by people are shown as text', async () => {
  await open(letter({
    camp: { id: 12, name: '<img src=x onerror=alert(1)>', date_from: '2027-07-04', date_to: '2027-07-06', activity_id: 30 },
    audience: { families: 1, children: 1, without_address: [{ id: 4, first_name: '<b>Léa</b>', last_name: 'Tremblay' }] },
  }));
  expect($('#app img')).toBeNull();
  expect($('#app b')).toBeNull();
  expect($('.camp-letter__names').textContent).toContain('<b>Léa</b>');
});

test('saving sends both versions as edited', async () => {
  saveCampLetterDraft.mockResolvedValue(letter({ draft: { ...letter().data.draft, saved: true, updated_at: '2027-06-01T12:00:00Z' } }));
  await open();
  $('#camp-letter-subject-en').value = 'Summer camp';
  $('#camp-letter-save').click();
  await flush();
  expect(saveCampLetterDraft).toHaveBeenCalledWith(12, {
    subject_fr: 'Camp d’été : ce qu’il faut savoir', body_fr_html: '<p>Bonjour</p>',
    subject_en: 'Summer camp', body_en_html: '<p>Hello</p>',
  });
  expect(app.showMessage).toHaveBeenCalledWith('camp_letter_saved', 'success');
  expect($('#camp-letter-state').textContent).toBe('camp_letter_draft_saved');
});

test('an empty subject is refused before sending, its field marked and focus on the message', async () => {
  await open();
  $('#camp-letter-subject-fr').value = ' ';
  $('#camp-letter-save').click();
  await flush();
  expect(saveCampLetterDraft).not.toHaveBeenCalled();
  expect($('#camp-letter-subject-fr').getAttribute('aria-invalid')).toBe('true');
  expect($('#camp-letter-subject-fr').getAttribute('aria-describedby')).toBe('camp-letter-error');
  expect(document.activeElement).toBe($('#camp-letter-error'));
  // Typing clears it.
  $('#camp-letter-subject-fr').dispatchEvent(new Event('input', { bubbles: true }));
  expect($('#camp-letter-error').hidden).toBe(true);
});

test('sending asks first, naming how many addresses; declining sends nothing', async () => {
  confirm.mockResolvedValue(false);
  await open();
  $('#camp-letter-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'camp_letter_send_confirm_other' }));
  expect(sendCampLetter).not.toHaveBeenCalled();
});

test('a sent letter lists its version, and one that failed somewhere is sent again there', async () => {
  confirm.mockResolvedValue(true);
  const sent = [{ version_number: 1, sent_at: '2027-06-02T12:00:00Z', sent_by_name: 'Ada Lovelace', sent: 7, failed: 2, unknown: 0 }];
  sendCampLetter.mockResolvedValue(letter({ sent }));
  retryCampLetter.mockResolvedValue(letter({ sent: [{ ...sent[0], sent: 9, failed: 0 }] }));
  await open();
  $('#camp-letter-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
  expect(sendCampLetter).toHaveBeenCalledWith(12, expect.objectContaining({ subject_fr: 'Camp d’été : ce qu’il faut savoir' }));
  // Not every address was reached: never "sent" alone.
  expect(app.showMessage).toHaveBeenCalledWith('camp_letter_sent_with_problems', 'info');
  expect($('.camp-letter__sent').textContent).toContain('camp_letter_sent_version');
  $('[data-retry="1"]').click();
  await flush();
  expect(retryCampLetter).toHaveBeenCalledWith(12, 1);
  expect($('[data-retry]')).toBeNull();
});

test('sending to the addresses not reached keeps the letter being edited, and is offered for a family added since', async () => {
  const version = { version_number: 1, sent_at: '2027-06-02T12:00:00Z', sent_by_name: 'Ada Lovelace', sent: 9, failed: 0, unknown: 0, unreached: 1 };
  retryCampLetter.mockResolvedValue(letter({ sent: [{ ...version, sent: 10, unreached: 0 }] }));
  await open(letter({ sent: [version] }));
  // Nothing failed, but one family of the camp was never written to: the action is offered.
  expect($('[data-retry="1"]')).not.toBeNull();
  $('#camp-letter-subject-fr').value = 'Unsaved edit';
  $('[data-retry="1"]').click();
  await flush();
  expect(retryCampLetter).toHaveBeenCalledWith(12, 1);
  expect($('#camp-letter-subject-fr').value).toBe('Unsaved edit');
  expect($('[data-retry]')).toBeNull();
  expect(app.showMessage).toHaveBeenCalledWith('camp_letter_retried', 'success');
});

test('starting again from the camp asks first, then puts the proposed letter back', async () => {
  confirm.mockResolvedValue(true);
  await open();
  $('#camp-letter-reset').click();
  await flush();
  expect($('#camp-letter-subject-fr').value).toBe('Proposé');
  expect($('#camp-letter-body-en').textContent).toBe('Proposed');
  expect(document.activeElement).toBe($('#camp-letter-subject-fr'));
});

test('without meetings.manage, or as a demo account, the letter is read only; without communications.send it is not sent', async () => {
  hasPermission.mockImplementation((key) => key !== 'meetings.manage');
  await open();
  expect($('#camp-letter-save')).toBeNull();
  expect($('#camp-letter-subject-fr').disabled).toBe(true);
  expect($('#camp-letter-body-fr').getAttribute('aria-disabled')).toBe('true');
  screen.destroy();

  hasPermission.mockImplementation((key) => key !== 'communications.send');
  await open();
  expect($('#camp-letter-save')).not.toBeNull();
  expect($('button[type="submit"]')).toBeNull();
  screen.destroy();

  hasPermission.mockReturnValue(true);
  isDemoUser.mockReturnValue(true);
  await open();
  expect($('#camp-letter-save')).toBeNull();
});

test('a failed load offers a retry, never an empty letter', async () => {
  getCampLetter.mockRejectedValueOnce(new Error('offline'));
  app = { lang: 'fr', showMessage: jest.fn() };
  screen = new CampLetter(app, { meetingId: 12 });
  await screen.init();
  expect($('[role="alert"]')).not.toBeNull();
  expect($('#camp-letter-form')).toBeNull();
  getCampLetter.mockResolvedValue(letter());
  $('#camp-letter-retry').click();
  await flush();
  expect($('#camp-letter-form')).not.toBeNull();
});
