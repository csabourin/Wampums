/**
 * @jest-environment jsdom
 */

/**
 * A camp's review (#1257), noted at the speed of speech.
 *
 * Held here: the notes read by category, heaviest first, their words shown as
 * text; Enter adds a note, the field empties and keeps the focus, and the
 * category stays chosen; a note that seems already said is offered for a +1,
 * which can be undone from the message that follows, kept while it holds the
 * focus; a change waiting for the network is shown as waiting, never as
 * saved; a failure gives the words back; without a network the copy kept on
 * this device is shown, and notes can still be added without one; a reader
 * sees no form; the screen meets WCAG A/AA; a late answer does not draw over
 * the next screen.
 *
 * @module test/spa/CampReview
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true),
  isDemoUser: jest.fn(() => false),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ hasActiveDialog: () => false, confirmDestructive: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../spa/api/api-camp-reviews.js', () => ({
  getCampReview: jest.fn(), saveCampReviewNote: jest.fn(), deleteCampReviewNote: jest.fn(),
  addCampReviewVote: jest.fn(), removeCampReviewVote: jest.fn(),
}));

let mockScope = 'scope:unit-1';
jest.mock('../../spa/modules/camp-review/CampReviewOffline.js', () => {
  const actual = jest.requireActual('../../spa/modules/camp-review/CampReviewOffline.js');
  return {
    ...actual,
    currentCampReviewScope: () => mockScope,
    storeCampReviewSnapshot: jest.fn(() => Promise.resolve('camp_review_snapshot_12')),
    getCampReviewSnapshot: jest.fn(() => Promise.resolve(null)),
    pendingCampReviewChanges: jest.fn(() => Promise.resolve([])),
  };
});

const offline = require('../../spa/modules/camp-review/CampReviewOffline.js');
const api = require('../../spa/api/api-camp-reviews.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { CampReview } = require('../../spa/modules/camp-review/CampReview.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const CAMP = { id: 12, theme: 'Camp d’automne', date_from: '2026-07-10', date_to: '2026-07-12', activity_id: 7, is_cancelled: false };
const SWIM = { id: '11111111-1111-4111-8111-111111111111', category: 'liked', moment: 'youth_council', day: null, theme: 'activity',
  text: 'La baignade au lac', version: 1, weight: 3, votes: [{ id: 'v1', mine: false }, { id: 'v2', mine: false }] };
const NIGHT = { id: '22222222-2222-4222-8222-222222222222', category: 'liked', moment: 'youth_council', day: null, theme: null,
  text: 'Le grand jeu de nuit', version: 1, weight: 1, votes: [] };
const DISHES = { id: '33333333-3333-4333-8333-333333333333', category: 'improve', moment: 'team_daily', day: '2026-07-11', theme: null,
  text: 'Moins de vaisselle', version: 1, weight: 2, votes: [{ id: 'v3', mine: true }] };

let uuids = 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let app;
let screen;

async function open() {
  screen = new CampReview(app, { meetingId: 12 });
  await screen.init();
  await flush();
  return screen;
}

/** Type into the note field, as a person would. */
function type(text) {
  const input = $('#camp-review-text');
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Press Enter in the field: the form submits. */
async function enter() {
  $('#camp-review-form').requestSubmit();
  await flush();
  await flush();
}

const notesIn = (category) => $$(`.camp-review__group--${category} .camp-review__note-text`).map((node) => node.textContent);

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'fr' };
  uuids = 0;
  crypto.randomUUID = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuids).padStart(12, '0')}`;
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getCampReview.mockResolvedValue({ success: true, data: { camp: CAMP, notes: [NIGHT, SWIM, DISHES] } });
  api.saveCampReviewNote.mockImplementation((_meeting, id, body) => Promise.resolve({
    success: true, data: { note: { id, ...body, version: 1, weight: 1, votes: [] } },
  }));
  api.addCampReviewVote.mockImplementation((_meeting, noteId, voteId) => Promise.resolve({
    success: true, data: { note: { ...SWIM, id: noteId, weight: SWIM.weight + 1, votes: [...SWIM.votes, { id: voteId, mine: true }] } },
  }));
  api.removeCampReviewVote.mockImplementation((_meeting, noteId) => Promise.resolve({ success: true, data: { note: { ...SWIM, id: noteId } } }));
  api.deleteCampReviewNote.mockResolvedValue({ success: true, data: { deleted: true } });
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => true);
  confirmDestructive.mockClear();
  mockScope = 'scope:unit-1';
  offline.storeCampReviewSnapshot.mockClear();
  offline.getCampReviewSnapshot.mockReset();
  offline.getCampReviewSnapshot.mockResolvedValue(null);
  offline.pendingCampReviewChanges.mockReset();
  offline.pendingCampReviewChanges.mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  jest.useRealTimers();
  screen?.destroy();
});

describe('reading the review', () => {
  test('notes are grouped by category, heaviest first, with their weight in words', async () => {
    await open();
    expect($('.back-link, a[href="/camp-readiness/12"]')).not.toBeNull();
    expect($('h1').textContent).toBe('camp_review_title');
    expect(notesIn('liked')).toEqual(['La baignade au lac', 'Le grand jeu de nuit']);
    expect(notesIn('improve')).toEqual(['Moins de vaisselle']);
    expect($('.camp-review__group--liked .sr-only').textContent).toBe('camp_review_weight');
    expect($('.camp-review__group--disliked .empty-state').textContent).toBe('camp_review_empty_manage');
    // Kept on this device for the days without a network.
    expect(offline.storeCampReviewSnapshot).toHaveBeenCalledWith(12, { camp: CAMP, notes: [NIGHT, SWIM, DISHES] }, undefined, 'scope:unit-1');
  });

  test('a note’s words are shown as text, never as markup', async () => {
    api.getCampReview.mockResolvedValue({ success: true, data: { camp: { ...CAMP, theme: '<b>Camp</b>' },
      notes: [{ ...NIGHT, text: '<img src=x onerror=alert(1)>' }] } });
    await open();
    expect($('.camp-review img, .camp-review b')).toBeNull();
    expect(notesIn('liked')).toEqual(['<img src=x onerror=alert(1)>']);
    expect($('[data-review-vote]').getAttribute('aria-label')).toBe('camp_review_vote_label');
  });

  test('someone who may only read sees the notes and no way to change them', async () => {
    hasPermission.mockImplementation((key) => key === 'camp_reviews.view');
    await open();
    expect($('#camp-review-form')).toBeNull();
    expect($('[data-review-vote], [data-review-delete]')).toBeNull();
    expect(notesIn('liked')).toHaveLength(2);
    expect($('.camp-review__group--disliked .empty-state').textContent).toBe('camp_review_empty');
  });

  test('a failed load says so, with a retry, never as an empty review', async () => {
    api.getCampReview.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await open();
    expect($('[role="alert"]')).not.toBeNull();
    expect($('.camp-review__group')).toBeNull();
    $('#camp-review-retry').click();
    await flush();
    await flush();
    expect(notesIn('liked')).toHaveLength(2);
  });

  test('the screen has no WCAG A/AA violation', async () => {
    await open();
    type('baignade');
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('noting at the speed of speech', () => {
  test('Enter adds the note; the field empties, keeps the focus, and the category stays chosen', async () => {
    await open();
    $('input[name="camp-review-category"][value="disliked"]').click();
    type('  Le réveil trop tôt ');
    await enter();

    expect(api.saveCampReviewNote).toHaveBeenCalledWith(12, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', {
      category: 'disliked', moment: 'team_after', text: 'Le réveil trop tôt', day: null, theme: null,
    });
    const input = $('#camp-review-text');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect($('#camp-review-status').textContent).toBe('camp_review_note_added');
    expect(notesIn('disliked')).toEqual(['Le réveil trop tôt']);
    expect($('input[name="camp-review-category"]:checked').value).toBe('disliked');

    type('Les moustiques');
    await enter();
    expect(api.saveCampReviewNote.mock.calls[1][2]).toMatchObject({ category: 'disliked', text: 'Les moustiques' });
  });

  test('the team’s evening note names one of the camp’s days', async () => {
    await open();
    const moment = $('#camp-review-moment');
    moment.value = 'team_daily';
    moment.dispatchEvent(new Event('change', { bubbles: true }));
    const day = $('#camp-review-day');
    expect([...day.options].map((option) => option.value)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12']);
    day.value = '2026-07-11';
    day.dispatchEvent(new Event('change', { bubbles: true }));
    type('Trop de temps libre');
    await enter();
    expect(api.saveCampReviewNote.mock.calls[0][2]).toMatchObject({ moment: 'team_daily', day: '2026-07-11' });
  });

  test('an empty note is refused at the field, and the message clears as the person types', async () => {
    await open();
    type('   ');
    await enter();
    expect(api.saveCampReviewNote).not.toHaveBeenCalled();
    const error = $('#camp-review-text-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect($('#camp-review-text').getAttribute('aria-describedby')).toContain('camp-review-text-error');
    type('Le feu');
    expect(error.hidden).toBe(true);
  });

  test('a note the server refuses gives its words back, with the reason at the field', async () => {
    api.saveCampReviewNote.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 400, data: { message: 'camp_review_text_too_long' } }));
    await open();
    type('Le souper aux hot-dogs');
    await enter();
    expect($('#camp-review-text').value).toBe('Le souper aux hot-dogs');
    expect($('#camp-review-text-error').hidden).toBe(false);
    expect(notesIn('liked')).not.toContain('Le souper aux hot-dogs');
  });

  test('a note kept for later is shown as waiting to be sent, never as saved', async () => {
    api.saveCampReviewNote.mockImplementation((_meeting, noteId, body) => {
      offline.pendingCampReviewChanges.mockResolvedValue([{ method: 'PUT', noteId, voteId: null, body, mutationId: 'm1' }]);
      return Promise.resolve({ success: true, queued: true });
    });
    await open();
    type('La chasse au trésor');
    await enter();
    const pending = $$('.camp-review__note.is-pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].textContent).toContain('La chasse au trésor');
    expect(pending[0].textContent).toContain('camp_review_pending');
    expect($('#camp-review-status').textContent).toBe('camp_review_note_queued');
  });
});

describe('the same idea, said again', () => {
  test('a note that seems already said is offered; +1 weighs it instead of a new note, and can be undone', async () => {
    await open();
    type('les baignades');
    const offer = $('[data-review-suggestion]');
    expect(offer.dataset.reviewSuggestion).toBe(SWIM.id);
    expect($('.camp-review__suggestions').textContent).toContain('La baignade au lac');

    offer.click();
    await flush();
    await flush();
    expect(api.addCampReviewVote).toHaveBeenCalledWith(12, SWIM.id, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
    expect(api.saveCampReviewNote).not.toHaveBeenCalled();
    expect($('#camp-review-text').value).toBe('');
    expect(document.activeElement).toBe($('#camp-review-text'));
    expect($('.camp-review__group--liked .camp-review__weight').textContent).toBe('×4');
    expect($('#camp-review-status').textContent).toBe('camp_review_vote_added');

    const undo = $('#camp-review-undo');
    expect(undo.hidden).toBe(false);
    undo.click();
    await flush();
    await flush();
    expect(api.removeCampReviewVote).toHaveBeenCalledWith(12, SWIM.id, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
    expect($('.camp-review__group--liked .camp-review__weight').textContent).toBe('×3');
    expect(undo.hidden).toBe(true);
  });

  test('a suggestion only comes from the chosen category', async () => {
    await open();
    $('input[name="camp-review-category"][value="improve"]').click();
    type('baignade');
    expect($('[data-review-suggestion]')).toBeNull();
    type('vaisselle');
    expect($('[data-review-suggestion]').dataset.reviewSuggestion).toBe(DISHES.id);
  });

  test('+1 from the list keeps the focus on its button', async () => {
    await open();
    const button = $(`[data-review-vote="${NIGHT.id}"]`);
    button.focus();
    button.click();
    await flush();
    await flush();
    expect(api.addCampReviewVote).toHaveBeenCalledWith(12, NIGHT.id, expect.any(String));
    expect(document.activeElement.dataset.reviewVote).toBe(NIGHT.id);
  });

  test('the offer to undo stays while it holds the focus, and goes once it leaves', async () => {
    await open();
    $(`[data-review-vote="${NIGHT.id}"]`).click();
    await flush();
    await flush();
    jest.useFakeTimers();
    const undo = $('#camp-review-undo');
    undo.focus();
    jest.advanceTimersByTime(60000);
    expect(undo.hidden).toBe(false);
    undo.blur();
    jest.advanceTimersByTime(60000);
    expect(undo.hidden).toBe(true);
  });

  test('removing a note asks first, and declining changes nothing', async () => {
    await open();
    confirmDestructive.mockResolvedValueOnce(false);
    $(`[data-review-delete="${NIGHT.id}"]`).click();
    await flush();
    expect(api.deleteCampReviewNote).not.toHaveBeenCalled();

    $(`[data-review-delete="${NIGHT.id}"]`).click();
    await flush();
    await flush();
    expect(api.deleteCampReviewNote).toHaveBeenCalledWith(12, NIGHT.id);
    expect(notesIn('liked')).toEqual(['La baignade au lac']);
    expect(document.activeElement).toBe($('#camp-review-text'));
  });
});

describe('without a network', () => {
  test('the copy kept on this device is shown, with the changes waiting to be sent', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    offline.getCampReviewSnapshot.mockResolvedValue({ preparedAt: Date.UTC(2026, 6, 10, 20), data: { camp: CAMP, notes: [SWIM] } });
    offline.pendingCampReviewChanges.mockResolvedValue([
      { method: 'PUT', noteId: NIGHT.id, voteId: null, body: { category: 'liked', moment: 'youth_council', text: 'Le grand jeu de nuit' } },
      { method: 'PUT', noteId: SWIM.id, voteId: 'v9', body: {} },
    ]);
    await open();
    expect(api.getCampReview).not.toHaveBeenCalled();
    expect($('.camp-review__offline').textContent).toBe('camp_review_offline_copy');
    expect(notesIn('liked')).toEqual(['La baignade au lac', 'Le grand jeu de nuit']);
    expect($('.camp-review__group--liked .camp-review__weight').textContent).toBe('×4');
    expect($$('.camp-review__note.is-pending')).toHaveLength(2);
  });

  test('with nothing kept here, notes can still be added, and the page says what is missing', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    api.saveCampReviewNote.mockResolvedValue({ success: true, queued: true });
    await open();
    expect($('.camp-review__offline').textContent).toBe('camp_review_not_on_device');
    expect($('#camp-review-form')).not.toBeNull();
    type('Le coucher de soleil');
    await enter();
    expect(api.saveCampReviewNote).toHaveBeenCalledWith(12, expect.any(String),
      expect.objectContaining({ moment: 'team_after', text: 'Le coucher de soleil' }));
  });

  test('a change sent or refused later reloads the review in place', async () => {
    await open();
    api.getCampReview.mockResolvedValue({ success: true, data: { camp: CAMP, notes: [NIGHT] } });
    type('en cours');
    window.dispatchEvent(new CustomEvent('offlineMutationRejected', { detail: { kind: 'camp_review' } }));
    await flush();
    await flush();
    expect(notesIn('liked')).toEqual(['Le grand jeu de nuit']);
    expect($('#camp-review-text').value).toBe('en cours');
  });
});

test('a change waiting behind another is never sent once the account or unit has changed', async () => {
  let release;
  api.saveCampReviewNote.mockImplementationOnce((_meeting, id, body) => new Promise((resolve) => {
    release = () => resolve({ success: true, data: { note: { id, ...body, version: 1, weight: 1, votes: [] } } });
  }));
  await open();
  type('Première note');
  $('#camp-review-form').requestSubmit();
  type('Deuxième note');
  $('#camp-review-form').requestSubmit();
  await flush();
  mockScope = 'scope:another-account';
  release();
  await flush();
  await flush();
  expect(api.saveCampReviewNote).toHaveBeenCalledTimes(1);
});

test('a page opened from the device copy keeps that copy current once the network is back', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  offline.getCampReviewSnapshot.mockResolvedValue({ preparedAt: Date.now(), data: { camp: CAMP, notes: [SWIM] } });
  await open();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  type('Le coucher de soleil');
  await enter();
  const [, stored] = offline.storeCampReviewSnapshot.mock.calls.at(-1);
  expect(stored.notes.map((note) => note.text)).toEqual(['La baignade au lac', 'Le coucher de soleil']);
});

test('a page with nothing kept on the device never stores a partial copy as if it were whole', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await open();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  type('Le coucher de soleil');
  await enter();
  expect(offline.storeCampReviewSnapshot).not.toHaveBeenCalled();
});

test('an answer arriving after the screen was left does not draw over the next one', async () => {
  let resolve;
  api.getCampReview.mockReturnValue(new Promise((done) => { resolve = done; }));
  screen = new CampReview(app, { meetingId: 12 });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'next screen';
  resolve({ success: true, data: { camp: CAMP, notes: [NIGHT] } });
  await loading;
  expect(document.getElementById('app').textContent).toBe('next screen');
});
