/**
 * Camp review routes (#1257): who may read and write a camp's review, and how
 * refusals read. The service is mocked; the rules themselves are covered on a
 * real database in camp-reviews.integration.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

jest.mock('../services/campReviews', () => {
  const actual = jest.requireActual('../services/campReviews');
  return {
    ...actual,
    readCampReview: jest.fn(), saveNote: jest.fn(), deleteNote: jest.fn(), addVote: jest.fn(), removeVote: jest.fn(),
    sortNote: jest.fn(), mergeNote: jest.fn(), unmergeNote: jest.fn(), setReviewStatus: jest.fn(),
  };
});
jest.mock('../services/campReviewHistory', () => ({ ...jest.requireActual('../services/campReviewHistory'), readCampReviewHistory: jest.fn(), readCampReviewLessons: jest.fn() }));
const history = require('../services/campReviewHistory');
const service = require('../services/campReviews');

process.env.JWT_SECRET_KEY = 'fictional-camp-reviews-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const NOTE_ID = '0b9c2f4e-8d1a-4c3b-9e5f-1a2b3c4d5e6f';
const VOTE_ID = '7d6e5f4a-3b2c-4d1e-8f9a-0b1c2d3e4f5a';
const UNIT_ID = 7;
let permissions; let roles;
const query = jest.fn((sql, params) => {
  if (sql.includes('AS authorization_permissions')) { return authorizationContextRow({ permissions, roles }); }
  if (sql.includes('SELECT organization_id FROM user_organizations')) { return { rows: [{ organization_id: UNIT_ID }] }; }
  if (sql.includes('p.permission_key = $3')) { return { rows: permissions.includes(params?.[2]) ? [{ held: 1 }] : [] }; }
  return { rows: [] };
});
const client = { query, release: jest.fn() };
const pool = { query, connect: jest.fn(() => Promise.resolve(client)) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/camp-reviews', require('../routes/camp-reviews')(pool));
const token = () => jwt.sign({ user_id: USER_ID, organizationId: UNIT_ID }, process.env.JWT_SECRET_KEY);
const call = (method, path, body) => {
  const req = request(app)[method](`/api/v1/camp-reviews${path}`).set('Authorization', `Bearer ${token()}`);
  return body ? req.send(body) : req;
};
const NOTE = { category: 'liked', moment: 'youth_council', text: 'Le grand jeu de nuit' };
const WRITES = [
  ['put', `/camps/12/notes/${NOTE_ID}`, NOTE],
  ['delete', `/camps/12/notes/${NOTE_ID}`],
  ['put', `/camps/12/notes/${NOTE_ID}/votes/${VOTE_ID}`, {}],
  ['delete', `/camps/12/notes/${NOTE_ID}/votes/${VOTE_ID}`],
  ['patch', `/camps/12/notes/${NOTE_ID}`, { outcome: 'keep', expected_version: 1 }],
  ['put', `/camps/12/notes/${NOTE_ID}/merge`, { into: VOTE_ID, expected_version: 1 }],
  ['delete', `/camps/12/notes/${NOTE_ID}/merge`],
  ['put', '/camps/12/status', { status: 'closed', expected_version: 0 }],
];

beforeEach(() => {
  jest.clearAllMocks();
  history.readCampReviewHistory.mockResolvedValue({ camps: [], sites: [], total: 0 });
  history.readCampReviewLessons.mockResolvedValue({ notes: [], target: { id: 12 }, total: 0 });
  permissions = ['camp_reviews.view', 'camp_reviews.manage'];
  roles = [{ role_name: 'animation', display_name: 'Leader', data_scope: 'organization' }];
  service.readCampReview.mockResolvedValue({ camp: { id: 12 }, notes: [] });
  service.saveNote.mockResolvedValue({ note: { id: NOTE_ID, weight: 1 }, created: true });
  service.deleteNote.mockResolvedValue({ deleted: true });
  service.addVote.mockResolvedValue({ note: { id: NOTE_ID, weight: 2 } });
  service.removeVote.mockResolvedValue({ note: { id: NOTE_ID, weight: 1 } });
  service.sortNote.mockResolvedValue({ note: { id: NOTE_ID, outcome: 'keep' } });
  service.mergeNote.mockResolvedValue({ note: { id: VOTE_ID, weight: 2 } });
  service.unmergeNote.mockResolvedValue({ note: { id: NOTE_ID, weight: 1 } });
  service.setReviewStatus.mockResolvedValue({ review: { status: 'closed', version: 2 } });
});

test('without a token, nothing is read or written', async () => {
  for (const [method, path, body] of [['get', '/camps/12'], ...WRITES]) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await request(app)[method](`/api/v1/camp-reviews${path}`).send(body);
    expect(response.status).toBe(401);
  }
  expect(service.readCampReview).not.toHaveBeenCalled();
});

test('a leader reads the authenticated unit’s review of a camp, whatever unit the request names', async () => {
  const response = await call('get', '/camps/12?organization_id=99');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(service.readCampReview).toHaveBeenCalledWith(pool, UNIT_ID, 12, USER_ID);
});

test('reading takes camp_reviews.view, and the refusal says so', async () => {
  permissions = [];
  const response = await call('get', '/camps/12');
  expect(response.status).toBe(403);
  expect(response.body.required).toEqual(['camp_reviews.view']);
  expect(response.body.missing).toEqual(['camp_reviews.view']);
});

test('noting, removing, giving and undoing a +1 take camp_reviews.manage', async () => {
  permissions = ['camp_reviews.view'];
  for (const [method, path, body] of WRITES) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['camp_reviews.manage']);
  }
  expect(service.saveNote).not.toHaveBeenCalled();
  expect(service.addVote).not.toHaveBeenCalled();
});

test('a new note answers 201, the same note written again 200', async () => {
  service.saveNote.mockResolvedValueOnce({ note: { id: NOTE_ID, weight: 1 }, notes: [{ id: NOTE_ID, weight: 1 }], created: true });
  const created = await call('put', `/camps/12/notes/${NOTE_ID}`, NOTE);
  expect(created.status).toBe(201);
  expect(created.body.data.note.id).toBe(NOTE_ID);
  expect(created.body.data.notes).toEqual([{ id: NOTE_ID, weight: 1 }]);
  expect(service.saveNote).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, NOTE_ID, NOTE);

  service.saveNote.mockResolvedValue({ note: { id: NOTE_ID, weight: 1 }, created: false });
  expect((await call('put', `/camps/12/notes/${NOTE_ID}`, NOTE)).status).toBe(200);
});

test('a vote returns the complete confirmed list, including a note detached elsewhere', async () => {
  const detachedId = '11111111-1111-4111-8111-111111111111';
  const rows = [
    { ...NOTE, id: NOTE_ID, meeting_id: 12, version: 1, votes: [{ id: VOTE_ID }] },
    { ...NOTE, id: detachedId, meeting_id: 12, version: 3, votes: [] },
  ];
  const db = { query: jest.fn((sql) => {
    if (sql.includes('FROM year_plan_meetings')) {
      return Promise.resolve({ rows: [{ id: 12 }] });
    }
    if (sql.includes('SELECT status FROM camp_reviews')) {
      return Promise.resolve({ rows: [{ status: 'open' }] });
    }
    if (sql.includes('FROM camp_review_notes n') && sql.includes('ORDER BY n.created_at')) {
      return Promise.resolve({ rows });
    }
    if (sql.includes('RETURNING note_id')) {
      return Promise.resolve({ rows: [{ note_id: NOTE_ID }] });
    }
    return Promise.resolve({ rows: [] });
  }) };
  const actual = jest.requireActual('../services/campReviews');
  const answer = await actual.addVote(db, UNIT_ID, USER_ID, 12, NOTE_ID, VOTE_ID);
  expect(answer.note).toMatchObject({ id: NOTE_ID, weight: 2 });
  expect(answer.notes.map((entry) => entry.id)).toEqual([NOTE_ID, detachedId]);
  expect(answer.notes[1]).toMatchObject({ version: 3, merged: [] });
});

test('a +1 and its undo reach the service with the ids the device chose', async () => {
  const added = await call('put', `/camps/12/notes/${NOTE_ID}/votes/${VOTE_ID}`, {});
  expect(added.status).toBe(200);
  expect(added.body.data.note.weight).toBe(2);
  expect(service.addVote).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, NOTE_ID, VOTE_ID);

  expect((await call('delete', `/camps/12/notes/${NOTE_ID}/votes/${VOTE_ID}`)).status).toBe(200);
  expect(service.removeVote).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, NOTE_ID, VOTE_ID);
});

test('a demo account writes nothing: notes are free text', async () => {
  roles = [{ role_name: 'demoadmin', display_name: 'Demo', data_scope: 'organization' }];
  for (const [method, path, body] of WRITES) {
    // eslint-disable-next-line no-await-in-loop -- each refusal is checked in turn
    const response = await call(method, path, body);
    expect(response.status).toBe(403);
    expect(response.body.isDemo).toBe(true);
  }
  expect(service.saveNote).not.toHaveBeenCalled();
  expect(service.deleteNote).not.toHaveBeenCalled();
});

test('a malformed camp, note or vote id is a 400, not a write', async () => {
  expect((await call('get', '/camps/12abc')).status).toBe(400);
  expect((await call('put', `/camps/2147483648/notes/${NOTE_ID}`, NOTE)).status).toBe(400);
  expect((await call('put', '/camps/12/notes/not-a-uuid', NOTE)).status).toBe(400);
  expect((await call('put', `/camps/12/notes/${NOTE_ID}/votes/42`, {})).status).toBe(400);
  expect((await call('patch', '/camps/12/notes/42', { outcome: 'keep' })).status).toBe(400);
  expect((await call('put', '/camps/12abc/status', { status: 'closed' })).status).toBe(400);
  expect(service.sortNote).not.toHaveBeenCalled();
  expect(service.setReviewStatus).not.toHaveBeenCalled();
  expect(service.saveNote).not.toHaveBeenCalled();
  expect(service.addVote).not.toHaveBeenCalled();
});

test('a refusal reads as its translation key, naming the field it concerns', async () => {
  service.saveNote.mockRejectedValue(new service.CampReviewError('camp_review_invalid_category', 400, 'category'));
  const response = await call('put', `/camps/12/notes/${NOTE_ID}`, { ...NOTE, category: 'meh' });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('camp_review_invalid_category');
  expect(response.body.errors).toEqual([{ path: 'category', location: 'body', msg: 'camp_review_invalid_category' }]);

  service.readCampReview.mockRejectedValue(new service.CampReviewError('camp_review_camp_not_found', 404));
  expect((await call('get', '/camps/12')).status).toBe(404);
});

describe('a note is checked field by field before anything is written', () => {
  const camp = { date_from: '2026-07-10', date_to: '2026-07-12' };
  test.each([
    [{ ...NOTE, category: 'meh' }, 'camp_review_invalid_category'],
    [{ ...NOTE, moment: 'later' }, 'camp_review_invalid_moment'],
    [{ ...NOTE, text: '   ' }, 'camp_review_text_required'],
    [{ ...NOTE, text: 'x'.repeat(281) }, 'camp_review_text_too_long'],
    [{ ...NOTE, theme: 'weather' }, 'camp_review_invalid_theme'],
    [{ ...NOTE, day: '2026-07-13' }, 'camp_review_invalid_day'],
    [{ ...NOTE, day: '13/07/2026' }, 'camp_review_invalid_day'],
    [{ ...NOTE, expected_version: 0 }, 'camp_review_invalid_version'],
  ])('%j is refused with %s', (body, key) => {
    expect(() => service.readNote(body, camp)).toThrow(key);
  });

  test('a valid note is trimmed, and an empty topic or day reads as none', () => {
    expect(service.readNote({ ...NOTE, text: '  Le feu de camp  ', theme: '', day: '' }, camp)).toEqual({
      category: 'liked', moment: 'youth_council', day: null, theme: null, text: 'Le feu de camp', expectedVersion: null,
    });
    expect(service.readNote({ ...NOTE, moment: 'team_daily', day: '2026-07-11', expected_version: 2 }, camp))
      .toMatchObject({ day: '2026-07-11', expectedVersion: 2 });
  });
});

test('sorting, merging and closing reach the service inside one transaction each, for the authenticated unit', async () => {
  const sort = { outcome: 'fix', action_text: 'Deux chaudrons', expected_version: 1 };
  expect((await call('patch', `/camps/12/notes/${NOTE_ID}`, sort)).status).toBe(200);
  expect(service.sortNote).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, NOTE_ID, sort);
  expect((await call('put', `/camps/12/notes/${NOTE_ID}/merge`, { into: VOTE_ID })).body.data.note.id).toBe(VOTE_ID);
  expect((await call('delete', `/camps/12/notes/${NOTE_ID}/merge`)).status).toBe(200);
  expect(service.unmergeNote).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, NOTE_ID);
  const closed = await call('put', '/camps/12/status?organization_id=99', { status: 'closed', expected_version: 0 });
  expect(closed.body.data.review.status).toBe('closed');
  expect(service.setReviewStatus).toHaveBeenCalledWith(client, UNIT_ID, USER_ID, 12, { status: 'closed', expected_version: 0 });
});

test('a closed review answers its refusal as a translation key', async () => {
  service.saveNote.mockRejectedValue(new service.CampReviewError('camp_review_closed', 409));
  const response = await call('put', `/camps/12/notes/${NOTE_ID}`, NOTE);
  expect(response.status).toBe(409);
  expect(response.body.message).toBe('camp_review_closed');
});


describe('history across scout years', () => {
  test('history and lessons require a token and the review permission', async () => {
    for (const path of ['/history', '/camps/12/lessons']) {
      // eslint-disable-next-line no-await-in-loop -- check both public entry points
      expect((await request(app).get(`/api/v1/camp-reviews${  path}`)).status).toBe(401);
    }
    permissions = [];
    for (const path of ['/history', '/camps/12/lessons']) {
      // eslint-disable-next-line no-await-in-loop -- check both permission refusals
      const response = await call('get', path);
      expect(response.status).toBe(403);
      expect(response.body.required).toContain('camp_reviews.view');
      expect(response.body.missing).toContain('camp_reviews.view');
    }
    expect(history.readCampReviewHistory).not.toHaveBeenCalled();
    expect(history.readCampReviewLessons).not.toHaveBeenCalled();
  });

  test('the authenticated unit scopes the history even when another unit or year is requested', async () => {
    const response = await call('get', '/history?organization_id=999&scout_year_id=42&season=winter&page=2&limit=5');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(history.readCampReviewHistory).toHaveBeenCalledWith(pool, UNIT_ID,
      { siteId: null, season: 'winter', accommodation: null, page: 2, limit: 5 });
    expect(response.body.pagination).toMatchObject({ page: 2, limit: 5, total: 0 });
  });

  test.each(['site_id=0', 'site_id=12x', 'site_id=2147483648', 'season=unknown', 'season[]=winter', 'accommodation=tree', 'page=-1', 'limit=51', 'limit=1.5'])('a malformed filter is refused: %s', async (filter) => {
    expect((await call('get', `/history?${  filter}`)).status).toBe(400);
    expect(history.readCampReviewHistory).not.toHaveBeenCalled();
  });

  test('a foreign target is not found and an invalid target never reaches the service', async () => {
    expect((await call('get', '/camps/12abc/lessons')).status).toBe(400);
    expect(history.readCampReviewLessons).not.toHaveBeenCalled();
    history.readCampReviewLessons.mockRejectedValueOnce(new service.CampReviewError('camp_review_camp_not_found', 404));
    expect((await call('get', '/camps/99/lessons')).status).toBe(404);
  });
});
