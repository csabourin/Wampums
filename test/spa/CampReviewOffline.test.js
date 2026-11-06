/** @jest-environment jsdom */

/**
 * A camp's review without a network (#1257): notes and "+1"s wait in the
 * shared outbox for this account and unit, are shown over the copy kept on
 * this device until the server confirms them, are sent in the order they
 * were made, and a confirmed replay updates that copy even with the screen
 * closed. Also: which notes seem to say the same thing.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: 'http://localhost', CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000 }, UI: {} }, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/modules/offline/OfflineAssets.js', () => ({ verifyOfflineAssets: jest.fn(() => Promise.resolve(true)) }));
import { OfflineManager } from '../../spa/modules/OfflineManager.js';
import { getOfflineData } from '../../spa/indexedDB.js';
import {
  storeCampReviewSnapshot, getCampReviewSnapshot, pendingCampReviewChanges, overlayPending, applyAnswer, parseCampReviewWrite,
  applyCampReviewWrite, storeCampReviewState,
} from '../../spa/modules/camp-review/CampReviewOffline.js';
import { similarNotes, reviewWords } from '../../spa/modules/camp-review/CampReviewMatching.js';
import { removeCampReviewVoteOnline, removeCampReviewVote } from '../../spa/api/api-camp-reviews.js';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const VOTE_ID = '22222222-2222-4222-8222-222222222222';
const NOTE_URL = `http://localhost/api/v1/camp-reviews/camps/12/notes/${NOTE_ID}`;
const VOTE_URL = `${NOTE_URL}/votes/${VOTE_ID}`;
const CAMP = { id: 12, theme: 'Camp', date_from: '2026-07-10', date_to: '2026-07-12' };
const SWIM = { id: NOTE_ID, category: 'liked', moment: 'youth_council', day: null, theme: null, text: 'La baignade', version: 1, weight: 1, votes: [] };
const BODY = { category: 'liked', moment: 'youth_council', text: 'La baignade' };
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(data) });
let manager;

beforeEach(() => {
  jest.clearAllMocks();
  global.indexedDB = new IDBFactory();
  localStorage.clear();
  localStorage.setItem('userId', 'fictional-leader');
  localStorage.setItem('currentOrganizationId', '1');
  localStorage.setItem('jwtToken', 'fictional-token');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  global.fetch = jest.fn();
  manager = new OfflineManager();
});
afterEach(() => delete navigator.onLine);

const queue = (url, method, body = null) => manager.queueMutation(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

test('a note and its +1 wait for the network without authentication tokens, in the order they were made', async () => {
  await queue(NOTE_URL, 'PUT', BODY);
  await queue(VOTE_URL, 'PUT', {});
  const records = await getOfflineData();
  expect(records).toHaveLength(2);
  expect(records[0].data.headers.Authorization).toBeUndefined();
  const changes = await pendingCampReviewChanges(12);
  expect(changes.map(({ method, noteId, voteId }) => [method, noteId, voteId])).toEqual([['PUT', NOTE_ID, null], ['PUT', NOTE_ID, VOTE_ID]]);
  const [note] = overlayPending([], changes);
  expect(note).toMatchObject({ id: NOTE_ID, text: 'La baignade', weight: 2, pending: true });
  expect(await pendingCampReviewChanges(13)).toEqual([]);
});

test('changes waiting for one account or unit are not shown to another', async () => {
  await queue(NOTE_URL, 'PUT', BODY);
  localStorage.setItem('currentOrganizationId', '2');
  expect(await pendingCampReviewChanges(12)).toEqual([]);
});

test('a +1 waiting on a note others were merged into keeps their weight', () => {
  const parent = { ...SWIM, votes: [{ id: 'v0', mine: false }], merged: [{ ...SWIM, id: 'child', weight: 2 }], weight: 4 };
  expect(overlayPending([parent], [{ method: 'PUT', noteId: NOTE_ID, voteId: VOTE_ID, body: {} }])[0].weight).toBe(5);
});

test('an undone +1 and a removed note leave the view at once', () => {
  const confirmed = [{ ...SWIM, votes: [{ id: VOTE_ID, mine: true }], weight: 2 }];
  expect(overlayPending(confirmed, [{ method: 'DELETE', noteId: NOTE_ID, voteId: VOTE_ID }])[0]).toMatchObject({ weight: 1, votes: [] });
  expect(overlayPending(confirmed, [{ method: 'DELETE', noteId: NOTE_ID, voteId: null }])).toEqual([]);
  // The confirmed notes themselves are never changed.
  expect(confirmed[0].votes).toHaveLength(1);
});

test('a confirmed replay updates the copy kept on this device, even with the screen closed', async () => {
  await storeCampReviewSnapshot(12, { camp: CAMP, notes: [] });
  await queue(NOTE_URL, 'PUT', BODY);
  await queue(VOTE_URL, 'PUT', {});
  global.fetch
    .mockResolvedValueOnce(jsonResponse({ success: true, data: { note: SWIM } }, 201))
    .mockResolvedValueOnce(jsonResponse({ success: true, data: { note: { ...SWIM, weight: 2, votes: [{ id: VOTE_ID, mine: true }] } } }));
  expect((await manager.replayPendingMutations()).replayed).toBe(2);
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([NOTE_URL, VOTE_URL]);
  expect((await getCampReviewSnapshot(12)).data.notes).toEqual([{ ...SWIM, weight: 2, votes: [{ id: VOTE_ID, mine: true }] }]);
  expect(await getOfflineData()).toEqual([]);
});

test('a refused change is dropped and announced; the copy, which never held it, stays', async () => {
  await storeCampReviewSnapshot(12, { camp: CAMP, notes: [SWIM] });
  await queue(`${NOTE_URL}/votes/${VOTE_ID}`, 'PUT', {});
  global.fetch.mockResolvedValue(jsonResponse({ success: false, message: 'camp_review_note_not_found' }, 404));
  const events = [];
  const handler = (event) => events.push(event.detail);
  window.addEventListener('offlineMutationRejected', handler);
  const outcome = await manager.replayPendingMutations();
  window.removeEventListener('offlineMutationRejected', handler);
  expect(outcome.rejected).toEqual([expect.objectContaining({ kind: 'camp_review', status: 404 })]);
  expect(events).toHaveLength(1);
  expect((await getCampReviewSnapshot(12)).data.notes).toEqual([SWIM]);
  expect(manager.describeRejected(outcome.rejected)).toContain('sync.rejected_kind_camp_review');
});

test('a confirmed write updates the copy kept here, keeping its expiry; without a copy, nothing is stored', async () => {
  await storeCampReviewSnapshot(12, { camp: CAMP, notes: [] });
  const { expiresAt } = await getCampReviewSnapshot(12);
  await applyCampReviewWrite(12, { method: 'PUT', noteId: NOTE_ID, voteId: null }, { note: SWIM });
  const after = await getCampReviewSnapshot(12);
  expect(after.data.notes).toEqual([SWIM]);
  expect(after.expiresAt).toBeLessThanOrEqual(expiresAt + 1000);
  await applyCampReviewWrite(13, { method: 'PUT', noteId: NOTE_ID, voteId: null }, { note: SWIM });
  expect(await getCampReviewSnapshot(13)).toBeNull();
});

test('removing a note others were merged into keeps them, on their own', () => {
  const child = { ...SWIM, id: '44444444-4444-4444-8444-444444444444', text: 'Baignade', weight: 2 };
  const parent = { ...SWIM, weight: 3, merged: [child] };
  expect(applyAnswer([parent], { method: 'DELETE', noteId: SWIM.id, voteId: null }, { deleted: true }))
    .toEqual([{ ...child, merged: [] }]);
});

test('closing or reopening the review is recorded in the copy kept here, never in another session\'s', async () => {
  await storeCampReviewSnapshot(12, { camp: CAMP, review: { status: 'open', version: 1 }, notes: [SWIM] });
  await storeCampReviewState(12, { status: 'closed', version: 2 });
  expect((await getCampReviewSnapshot(12)).data).toMatchObject({ review: { status: 'closed', version: 2 }, notes: [SWIM] });
  await storeCampReviewState(13, { status: 'closed', version: 2 });
  expect(await getCampReviewSnapshot(13)).toBeNull();
});

test('a +1 removed while sorting is never kept for later, unlike one undone at the campfire', async () => {
  await expect(removeCampReviewVoteOnline(12, NOTE_ID, VOTE_ID)).rejects.toMatchObject({ code: 'online_required' });
  expect(await getOfflineData()).toEqual([]);
  expect(await removeCampReviewVote(12, NOTE_ID, VOTE_ID)).toMatchObject({ queued: true });
  expect(await getOfflineData()).toHaveLength(1);
});

test('a copy from another account, unit or camp is never read', async () => {
  await storeCampReviewSnapshot(12, { camp: CAMP, notes: [SWIM] });
  expect(await getCampReviewSnapshot(13)).toBeNull();
  localStorage.setItem('userId', 'another-leader');
  expect(await getCampReviewSnapshot(12)).toBeNull();
});

test('an answer is applied to the notes it concerns', () => {
  const other = { ...SWIM, id: '33333333-3333-4333-8333-333333333333' };
  expect(applyAnswer([other], { method: 'PUT', noteId: NOTE_ID, voteId: null }, { note: SWIM })).toEqual([other, SWIM]);
  expect(applyAnswer([SWIM, other], { method: 'DELETE', noteId: NOTE_ID, voteId: null }, { deleted: true })).toEqual([other]);
  // An undone +1 on a note removed meanwhile removes the note.
  expect(applyAnswer([SWIM], { method: 'DELETE', noteId: NOTE_ID, voteId: VOTE_ID }, { note: null })).toEqual([]);
  expect(parseCampReviewWrite('/api/v1/camp-reviews/camps/12')).toBeNull();
  expect(parseCampReviewWrite(VOTE_URL)).toEqual({ meetingId: 12, noteId: NOTE_ID, voteId: VOTE_ID });
});

test('only review writes naming a note may wait in the outbox', async () => {
  await expect(queue('http://localhost/api/v1/camp-reviews/camps/12', 'PUT', {})).rejects.toThrow();
  await expect(queue(`${NOTE_URL}/votes/not-an-id`, 'PUT', {})).rejects.toThrow();
  expect(await getOfflineData()).toEqual([]);
});

describe('notes that seem to say the same thing', () => {
  const notes = [
    { id: 'a', category: 'liked', text: 'La baignade au lac', weight: 3 },
    { id: 'b', category: 'liked', text: 'Le grand jeu de nuit', weight: 1 },
    { id: 'c', category: 'disliked', text: 'La baignade trop froide', weight: 1 },
  ];
  test('words compare without case, accents or a plural, and short words are ignored', () => {
    expect(reviewWords('Élan, LES Baignades!')).toEqual(['elan', 'les', 'baignades']);
    expect(similarNotes('les BAIGNADES', notes, 'liked').map((note) => note.id)).toEqual(['a']);
    expect(similarNotes('le jeu', notes, 'liked').map((note) => note.id)).toEqual(['b']);
    expect(similarNotes('de la', notes, 'liked')).toEqual([]);
  });
  test('only the chosen category is searched, and the closest come first', () => {
    expect(similarNotes('baignade froide', notes, 'disliked').map((note) => note.id)).toEqual(['c']);
    expect(similarNotes('grand lac', notes, 'liked').map((note) => note.id)).toEqual(['a', 'b']);
  });
});
