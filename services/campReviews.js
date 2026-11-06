'use strict';
/**
 * Camp review (#1257): what a camp's review noted, how much weight each note
 * carries, and what the unit keeps or fixes from it.
 *
 * - A **note** is liked, less liked or to improve, said at a moment of the
 *   camp (the youth's council, the team's evening, the team after the camp).
 *   It is collective: it names no youth.
 * - A **vote** ("+1") says someone else said the same. There is no vote
 *   against: a disagreement is another note.
 * - A note may be **merged** into another that says the same thing (two
 *   devices noted it separately). It keeps its words and votes; the note it
 *   joins carries its weight. One level deep: merging into a merged note, or
 *   merging a note others joined, is refused, so weights never chain.
 *   Weight = 1 + votes, plus the weight of every note merged into it.
 * - After the camp, each note is **sorted**: to keep (a good move to repeat)
 *   or to fix, with a short action.
 * - **Closing** the review freezes it: every change is refused (409
 *   `camp_review_closed`) until it is reopened.
 * - Notes and votes carry an id the device chose. Writing either is
 *   idempotent, so a change replayed from the offline outbox lands once, and
 *   undoing a vote removes exactly that one. Removing what is already gone
 *   succeeds. Sorting, merging and closing are online only.
 * - An edit names the version it was made against; a stale one is refused
 *   (409). Repeating an edit already applied succeeds, so a lost response
 *   replayed is not refused.
 *
 * Every read and write is filtered by the camp's unit: a camp shared by two
 * units keeps two reviews. Writes run inside the caller's transaction.
 *
 * @module services/campReviews
 */
const RULES = require('../config/camp_reviews.json');
const { isCalendarDate } = require('../utils/calendar-date');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** Postgres foreign-key violation: a vote's note was deleted meanwhile. */
const PG_FOREIGN_KEY_VIOLATION = '23503';
const OUTCOMES = ['keep', 'fix'];
const STATUSES = ['open', 'closed'];

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class CampReviewError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CampReviewError(key, status, field);
};

const CAMP_SQL = `SELECT m.id, m.theme, m.meeting_date::text AS date_from,
       COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
       m.activity_id, m.is_cancelled
  FROM year_plan_meetings m
  LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id AND a.is_active = TRUE
 WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`;

const NOTES_SQL = `SELECT n.id, n.meeting_id, n.category, n.moment, n.day::text AS day, n.theme, n.note_text AS text,
       n.outcome, n.action_text, n.merged_into_id, n.version, n.created_at, n.updated_at,
       COALESCE((SELECT json_agg(json_build_object(
                    'id', v.id, 'mine', v.created_by IS NOT DISTINCT FROM $3::uuid,
                    'by', u.full_name, 'created_at', v.created_at) ORDER BY v.created_at, v.id)
                   FROM camp_review_votes v
                   LEFT JOIN users u ON u.id = v.created_by
                  WHERE v.organization_id = n.organization_id AND v.note_id = n.id), '[]'::json) AS votes
  FROM camp_review_notes n
 WHERE n.organization_id = $1 AND n.meeting_id = $2
 ORDER BY n.created_at, n.id`;

/**
 * @param {Object} row - A note read with NOTES_SQL
 * @returns {Object} The note as the API answers it, without what was merged into it
 */
function shapeOne(row) {
  return {
    id: row.id,
    category: row.category,
    moment: row.moment,
    day: row.day || null,
    theme: row.theme || null,
    text: row.text,
    outcome: row.outcome || null,
    action_text: row.action_text || null,
    version: Number(row.version),
    votes: Array.isArray(row.votes) ? row.votes : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Nest each merged note in the note it joined, and weigh them.
 *
 * @param {Object[]} rows - The camp's notes, read with NOTES_SQL
 * @returns {Object[]} The notes not merged into another, each with `merged` and `weight`
 */
function assemble(rows) {
  const children = new Map();
  rows.filter((row) => row.merged_into_id).forEach((row) => {
    const list = children.get(row.merged_into_id) || [];
    list.push(row);
    children.set(row.merged_into_id, list);
  });
  return rows.filter((row) => !row.merged_into_id).map((row) => {
    const merged = (children.get(row.id) || []).map((child) => {
      const note = shapeOne(child);
      return { ...note, weight: 1 + note.votes.length };
    });
    const note = shapeOne(row);
    return { ...note, merged, weight: 1 + note.votes.length + merged.reduce((sum, child) => sum + child.weight, 0) };
  });
}

/**
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} The camp, or a 404 refusal
 */
async function findCamp(db, organizationId, meetingId) {
  const { rows } = await db.query(CAMP_SQL, [organizationId, meetingId]);
  if (!rows[0]) {
    refuse('camp_review_camp_not_found', HTTP_NOT_FOUND);
  }
  return rows[0];
}

/**
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @returns {Promise<{status: string, version: number, closed_at: ?string}>} The review's state; open without a row
 */
async function reviewState(db, organizationId, meetingId) {
  const { rows } = await db.query(
    `SELECT r.status, r.version, r.closed_at, u.full_name AS closed_by_name
       FROM camp_reviews r LEFT JOIN users u ON u.id = r.closed_by
      WHERE r.organization_id = $1 AND r.meeting_id = $2`,
    [organizationId, meetingId]);
  const row = rows[0];
  return row
    ? { status: row.status, version: Number(row.version), closed_at: row.closed_at, closed_by: row.closed_by_name || null }
    : { status: 'open', version: 0, closed_at: null, closed_by: null };
}

/**
 * Check the camp exists and its review is open, holding the review's row so a
 * concurrent closing waits for this write (or this write for it).
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} The camp
 */
async function openCamp(db, organizationId, meetingId) {
  const camp = await findCamp(db, organizationId, meetingId);
  await db.query(
    'INSERT INTO camp_reviews (organization_id, meeting_id) VALUES ($1, $2) ON CONFLICT (organization_id, meeting_id) DO NOTHING',
    [organizationId, meetingId]);
  const { rows } = await db.query(
    'SELECT status FROM camp_reviews WHERE organization_id = $1 AND meeting_id = $2 FOR SHARE',
    [organizationId, meetingId]);
  if (rows[0]?.status === 'closed') {
    refuse('camp_review_closed', HTTP_CONFLICT);
  }
  return camp;
}

/**
 * @param {Object} db - pg pool or client
 * @returns {Promise<{rows: Object[], notes: Object[]}>} The camp's rows, and its notes assembled
 */
async function readNotes(db, organizationId, meetingId, userId) {
  const { rows } = await db.query(NOTES_SQL, [organizationId, meetingId, userId]);
  return { rows, notes: assemble(rows) };
}

/**
 * The note as the screen shows it after a write: the note itself, or the note
 * it was merged into.
 *
 * @returns {Promise<?Object>} Null when it is gone
 */
async function noteAfterWrite(db, organizationId, meetingId, userId, noteId) {
  const { rows, notes } = await readNotes(db, organizationId, meetingId, userId);
  const row = rows.find((entry) => entry.id === noteId);
  if (!row) {
    return null;
  }
  return notes.find((note) => note.id === (row.merged_into_id || row.id)) || null;
}

/**
 * A camp's review: the camp, whether it is closed, and every note not merged
 * into another (each with those merged into it), in the order they were noted.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @param {string} userId - The reader, to mark their own votes
 * @returns {Promise<{camp: Object, review: Object, notes: Object[]}>}
 */
async function readCampReview(db, organizationId, meetingId, userId) {
  const camp = await findCamp(db, organizationId, meetingId);
  const [review, { notes }] = await Promise.all([
    reviewState(db, organizationId, meetingId),
    readNotes(db, organizationId, meetingId, userId),
  ]);
  return {
    camp: {
      id: Number(camp.id), theme: camp.theme, date_from: camp.date_from, date_to: camp.date_to,
      activity_id: camp.activity_id === null ? null : Number(camp.activity_id), is_cancelled: Boolean(camp.is_cancelled),
    },
    review,
    notes,
  };
}

/** @returns {?number} A positive integer version, null when absent, or a 400 refusal */
function readVersion(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!(Number.isInteger(value) && value >= 0)) {
    refuse('camp_review_invalid_version', HTTP_BAD_REQUEST, 'expected_version');
  }
  return value;
}

/**
 * Check a note field by field before anything is written.
 *
 * @param {Object} body - The request body
 * @param {Object} camp - The camp it belongs to
 * @returns {{category: string, moment: string, day: ?string, theme: ?string, text: string, expectedVersion: ?number}}
 */
function readNote(body, camp) {
  const input = body && typeof body === 'object' ? body : {};
  if (!RULES.CATEGORIES.includes(input.category)) {
    refuse('camp_review_invalid_category', HTTP_BAD_REQUEST, 'category');
  }
  if (!RULES.MOMENTS.includes(input.moment)) {
    refuse('camp_review_invalid_moment', HTTP_BAD_REQUEST, 'moment');
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) {
    refuse('camp_review_text_required', HTTP_BAD_REQUEST, 'text');
  }
  if (text.length > RULES.TEXT_MAX) {
    refuse('camp_review_text_too_long', HTTP_BAD_REQUEST, 'text');
  }
  const theme = input.theme === null || input.theme === undefined || input.theme === '' ? null : input.theme;
  if (theme !== null && !RULES.THEMES.includes(theme)) {
    refuse('camp_review_invalid_theme', HTTP_BAD_REQUEST, 'theme');
  }
  const day = input.day === null || input.day === undefined || input.day === '' ? null : input.day;
  if (day !== null && (!isCalendarDate(day) || day < camp.date_from || day > camp.date_to)) {
    refuse('camp_review_invalid_day', HTTP_BAD_REQUEST, 'day');
  }
  const expected = input.expected_version;
  if (expected !== undefined && expected !== null && !(Number.isInteger(expected) && expected >= 1)) {
    refuse('camp_review_invalid_version', HTTP_BAD_REQUEST, 'expected_version');
  }
  return { category: input.category, moment: input.moment, day, theme, text,
    expectedVersion: expected === undefined || expected === null ? null : expected };
}

/** @returns {boolean} Whether a stored note already says what the request says */
const sameContent = (row, note) => row.category === note.category && row.moment === note.moment
  && (row.day || null) === note.day && (row.theme || null) === note.theme && row.note_text === note.text;

/**
 * Lock one note of the unit.
 * @returns {Promise<?Object>} Its row, or null
 */
async function lockNote(db, organizationId, noteId) {
  const { rows } = await db.query(
    `SELECT id, meeting_id, category, moment, day::text AS day, theme, note_text, outcome, action_text, merged_into_id, version
       FROM camp_review_notes WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [organizationId, noteId]);
  return rows[0] || null;
}

/**
 * Create a note with the id the device chose, or edit it.
 *
 * Without `expected_version`, the request creates the note; repeating it
 * returns the note unchanged. With it, the request edits the note made against
 * that version. Either way, a request whose content is already stored
 * succeeds, so a replay whose first answer was lost is not refused.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who writes it
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID the device chose
 * @param {Object} body - { category, moment, day?, theme?, text, expected_version? }
 * @returns {Promise<{note: Object, created: boolean}>} The note as shown (or the note it was merged into)
 */
async function saveNote(db, organizationId, userId, meetingId, noteId, body) {
  const camp = await openCamp(db, organizationId, meetingId);
  const note = readNote(body, camp);
  let existing = await lockNote(db, organizationId, noteId);
  if (!existing) {
    if (note.expectedVersion !== null) {
      refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
    }
    const inserted = await db.query(
      `INSERT INTO camp_review_notes (organization_id, id, meeting_id, category, moment, day, theme, note_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, id) DO NOTHING
       RETURNING id`,
      [organizationId, noteId, meetingId, note.category, note.moment, note.day, note.theme, note.text, userId]);
    if (inserted.rows[0]) {
      return { note: await noteAfterWrite(db, organizationId, meetingId, userId, noteId), created: true };
    }
    // Written meanwhile by the same device's other request: judge it as an existing note.
    existing = await lockNote(db, organizationId, noteId);
  }
  if (Number(existing.meeting_id) !== Number(meetingId)) {
    refuse('camp_review_note_conflict', HTTP_CONFLICT);
  }
  if (!sameContent(existing, note)) {
    if (note.expectedVersion === null || note.expectedVersion !== Number(existing.version)) {
      refuse('camp_review_note_conflict', HTTP_CONFLICT);
    }
    if (existing.category !== note.category) {
      // Merged notes share one category: neither a merged note nor a note others joined changes its own.
      const { rows: joined } = await db.query(
        'SELECT 1 FROM camp_review_notes WHERE organization_id = $1 AND merged_into_id = $2 LIMIT 1', [organizationId, noteId]);
      if (existing.merged_into_id || joined.length) {
        refuse('camp_review_merge_category', HTTP_CONFLICT, 'category');
      }
    }
    await db.query(
      `UPDATE camp_review_notes
          SET category = $3, moment = $4, day = $5, theme = $6, note_text = $7, version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, noteId, note.category, note.moment, note.day, note.theme, note.text]);
  }
  return { note: await noteAfterWrite(db, organizationId, meetingId, userId, noteId), created: false };
}

/**
 * Remove a note and its votes. Notes merged into it stand on their own again.
 * Removing a note already gone succeeds.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @returns {Promise<{deleted: boolean}>}
 */
async function deleteNote(db, organizationId, meetingId, noteId) {
  await openCamp(db, organizationId, meetingId);
  const note = await lockNote(db, organizationId, noteId);
  if (!note || Number(note.meeting_id) !== Number(meetingId)) {
    return { deleted: false };
  }
  await db.query(
    'UPDATE camp_review_notes SET merged_into_id = NULL, version = version + 1, updated_at = NOW() WHERE organization_id = $1 AND merged_into_id = $2',
    [organizationId, noteId]);
  await db.query('DELETE FROM camp_review_notes WHERE organization_id = $1 AND id = $2', [organizationId, noteId]);
  return { deleted: true };
}

/**
 * Add a "+1" to a note, with the id the device chose. Repeating it counts once.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who gives it
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID the device chose
 * @returns {Promise<{note: Object}>} The note as shown, with its new weight
 */
async function addVote(db, organizationId, userId, meetingId, noteId, voteId) {
  await openCamp(db, organizationId, meetingId);
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO camp_review_votes (organization_id, id, note_id, created_by)
       SELECT n.organization_id, $3, n.id, $4
         FROM camp_review_notes n
        WHERE n.organization_id = $1 AND n.meeting_id = $2 AND n.id = $5
       ON CONFLICT (organization_id, id) DO NOTHING
       RETURNING note_id`,
      [organizationId, meetingId, voteId, userId, noteId]);
  } catch (err) {
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
    }
    throw err;
  }
  if (!inserted.rows[0]) {
    const { rows } = await db.query(
      'SELECT note_id FROM camp_review_votes WHERE organization_id = $1 AND id = $2',
      [organizationId, voteId]);
    if (rows[0] && rows[0].note_id !== noteId) {
      refuse('camp_review_vote_conflict', HTTP_CONFLICT);
    }
  }
  const note = await noteAfterWrite(db, organizationId, meetingId, userId, noteId);
  if (!note) {
    refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
  }
  return { note };
}

/**
 * Remove a "+1": the one just given by mistake, or one picked while sorting.
 * Removing one already gone, or on a note already removed, succeeds.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - The reader, to mark their own votes
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID of the vote
 * @returns {Promise<{note: ?Object}>} The note as shown, with its new weight, or null when it is gone
 */
async function removeVote(db, organizationId, userId, meetingId, noteId, voteId) {
  await openCamp(db, organizationId, meetingId);
  await db.query(
    `DELETE FROM camp_review_votes v
      USING camp_review_notes n
      WHERE v.organization_id = $1 AND v.id = $2 AND v.note_id = $3
        AND n.organization_id = v.organization_id AND n.id = v.note_id AND n.meeting_id = $4`,
    [organizationId, voteId, noteId, meetingId]);
  return { note: await noteAfterWrite(db, organizationId, meetingId, userId, noteId) };
}

/**
 * Lock a note of this camp for a change made while sorting.
 * @returns {Promise<Object>} Its row, or a refusal (404 elsewhere or gone, 409 stale)
 */
async function lockForSorting(db, organizationId, meetingId, noteId, expectedVersion) {
  const note = await lockNote(db, organizationId, noteId);
  if (!note || Number(note.meeting_id) !== Number(meetingId)) {
    refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
  }
  if (expectedVersion !== null && expectedVersion !== Number(note.version)) {
    refuse('camp_review_note_conflict', HTTP_CONFLICT);
  }
  return note;
}

/**
 * Sort a note: to keep or to fix, with a short action. Clearing both leaves it unsorted.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who sorts it
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {{outcome: ?string, action_text?: ?string, expected_version: number}} body
 * @returns {Promise<{note: Object}>}
 */
async function sortNote(db, organizationId, userId, meetingId, noteId, body) {
  const input = body && typeof body === 'object' ? body : {};
  const outcome = input.outcome === null || input.outcome === undefined || input.outcome === '' ? null : input.outcome;
  if (outcome !== null && !OUTCOMES.includes(outcome)) {
    refuse('camp_review_invalid_outcome', HTTP_BAD_REQUEST, 'outcome');
  }
  const action = typeof input.action_text === 'string' ? input.action_text.trim() : '';
  if (action.length > RULES.TEXT_MAX) {
    refuse('camp_review_action_too_long', HTTP_BAD_REQUEST, 'action_text');
  }
  const expected = readVersion(input.expected_version);
  if (expected === null) {
    refuse('camp_review_invalid_version', HTTP_BAD_REQUEST, 'expected_version');
  }
  await openCamp(db, organizationId, meetingId);
  const note = await lockForSorting(db, organizationId, meetingId, noteId, expected);
  if (note.merged_into_id) {
    refuse('camp_review_note_merged', HTTP_CONFLICT);
  }
  await db.query(
    `UPDATE camp_review_notes SET outcome = $3, action_text = $4, version = version + 1, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, noteId, outcome, action || null]);
  return { note: await noteAfterWrite(db, organizationId, meetingId, userId, noteId) };
}

/**
 * Merge a note into another of the same category that says the same thing.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who merges
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - The note merged
 * @param {{into: string, expected_version: number}} body - The note it joins, and the merged note's version
 * @returns {Promise<{note: Object}>} The note it joined, with its new weight
 */
async function mergeNote(db, organizationId, userId, meetingId, noteId, body) {
  const input = body && typeof body === 'object' ? body : {};
  const into = typeof input.into === 'string' ? input.into.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(into) || into === noteId) {
    refuse('camp_review_invalid_merge', HTTP_BAD_REQUEST, 'into');
  }
  const expected = readVersion(input.expected_version);
  await openCamp(db, organizationId, meetingId);
  // Lock both notes in one order, so two opposite merges cannot wait on each other.
  const [first, second] = [noteId, into].sort();
  const locked = {
    [first]: await lockNote(db, organizationId, first),
    [second]: await lockNote(db, organizationId, second),
  };
  const note = locked[noteId];
  const target = locked[into];
  if (!note || Number(note.meeting_id) !== Number(meetingId) || !target || Number(target.meeting_id) !== Number(meetingId)) {
    refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
  }
  if (expected !== null && expected !== Number(note.version)) {
    refuse('camp_review_note_conflict', HTTP_CONFLICT);
  }
  if (note.merged_into_id === into) {
    return { note: await noteAfterWrite(db, organizationId, meetingId, userId, into) };
  }
  if (note.category !== target.category) {
    refuse('camp_review_merge_category', HTTP_CONFLICT, 'into');
  }
  const { rows: joined } = await db.query(
    'SELECT 1 FROM camp_review_notes WHERE organization_id = $1 AND merged_into_id = $2 LIMIT 1', [organizationId, noteId]);
  if (note.merged_into_id || target.merged_into_id || joined.length) {
    refuse('camp_review_merge_nested', HTTP_CONFLICT, 'into');
  }
  await db.query(
    `UPDATE camp_review_notes SET merged_into_id = $3, version = version + 1, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, noteId, into]);
  return { note: await noteAfterWrite(db, organizationId, meetingId, userId, into) };
}

/**
 * Undo a merge: the note stands on its own again, with its votes.
 *
 * @param {Object} db - pg client inside a transaction
 * @returns {Promise<{note: Object}>} The note, on its own
 */
async function unmergeNote(db, organizationId, userId, meetingId, noteId) {
  await openCamp(db, organizationId, meetingId);
  const note = await lockForSorting(db, organizationId, meetingId, noteId, null);
  if (note.merged_into_id) {
    await db.query(
      `UPDATE camp_review_notes SET merged_into_id = NULL, version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, noteId]);
  }
  return { note: await noteAfterWrite(db, organizationId, meetingId, userId, noteId) };
}

/**
 * Close the review, freezing it, or reopen it.
 *
 * @param {Object} db - pg client inside a transaction
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who closes or reopens it
 * @param {number} meetingId - The planned camp
 * @param {{status: string, expected_version: number}} body - The new state, and the version it was decided on
 * @returns {Promise<{review: Object}>}
 */
async function setReviewStatus(db, organizationId, userId, meetingId, body) {
  const input = body && typeof body === 'object' ? body : {};
  if (!STATUSES.includes(input.status)) {
    refuse('camp_review_invalid_status', HTTP_BAD_REQUEST, 'status');
  }
  const expected = readVersion(input.expected_version);
  if (expected === null) {
    refuse('camp_review_invalid_version', HTTP_BAD_REQUEST, 'expected_version');
  }
  await findCamp(db, organizationId, meetingId);
  await db.query(
    'INSERT INTO camp_reviews (organization_id, meeting_id, version) VALUES ($1, $2, 1) ON CONFLICT (organization_id, meeting_id) DO NOTHING',
    [organizationId, meetingId]);
  const { rows } = await db.query(
    'SELECT status, version FROM camp_reviews WHERE organization_id = $1 AND meeting_id = $2 FOR UPDATE',
    [organizationId, meetingId]);
  const current = rows[0];
  if (current.status === input.status) {
    return { review: await reviewState(db, organizationId, meetingId) };
  }
  // A review never closed before is at version 0 for the reader: its row was only just made.
  const version = Number(current.version);
  if (expected !== version && !(expected === 0 && version === 1 && current.status === 'open')) {
    refuse('camp_review_status_conflict', HTTP_CONFLICT);
  }
  await db.query(
    `UPDATE camp_reviews
        SET status = $3::varchar, version = version + 1, updated_at = NOW(),
            closed_at = CASE WHEN $3::varchar = 'closed' THEN NOW() ELSE NULL END,
            closed_by = CASE WHEN $3::varchar = 'closed' THEN $4::uuid ELSE NULL END
      WHERE organization_id = $1 AND meeting_id = $2`,
    [organizationId, meetingId, input.status, userId]);
  return { review: await reviewState(db, organizationId, meetingId) };
}

module.exports = {
  CampReviewError, RULES, readCampReview, readNote, saveNote, deleteNote, addVote, removeVote,
  sortNote, mergeNote, unmergeNote, setReviewStatus,
};
