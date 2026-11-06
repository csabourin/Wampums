'use strict';
/**
 * Camp review (#1257, first slice): what a camp's review noted, and how much
 * weight each note carries.
 *
 * - A **note** is liked, less liked or to improve, said at a moment of the
 *   camp (the youth's council, the team's evening, the team after the camp).
 *   It is collective: it names no youth.
 * - A **vote** ("+1") says someone else said the same. Its weight is 1 plus its
 *   votes. There is no vote against: a disagreement is another note.
 * - Both carry an id the device chose. Writing a note or a vote is therefore
 *   idempotent, so a change replayed from the offline outbox lands once, and
 *   undoing a vote removes exactly that one. Removing what is already gone
 *   succeeds: the outcome the person asked for holds.
 * - An edit names the version it was made against; a stale one is refused
 *   (409). Repeating an edit already applied succeeds, so a lost response
 *   replayed is not refused.
 *
 * Every read and write is filtered by the camp's unit: a camp shared by two
 * units keeps two reviews.
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

const NOTE_COLUMNS = `n.id, n.meeting_id, n.category, n.moment, n.day::text AS day, n.theme, n.note_text AS text,
       n.version, n.created_at, n.updated_at,
       COALESCE((SELECT json_agg(json_build_object('id', v.id, 'mine', v.created_by IS NOT DISTINCT FROM $3::uuid)
                                ORDER BY v.created_at, v.id)
                   FROM camp_review_votes v
                  WHERE v.organization_id = n.organization_id AND v.note_id = n.id), '[]'::json) AS votes`;

/**
 * @param {Object} row - A note read with NOTE_COLUMNS
 * @returns {Object} The note as the API answers it, with its weight
 */
function shapeNote(row) {
  const votes = Array.isArray(row.votes) ? row.votes : [];
  return {
    id: row.id,
    category: row.category,
    moment: row.moment,
    day: row.day || null,
    theme: row.theme || null,
    text: row.text,
    version: Number(row.version),
    weight: 1 + votes.length,
    votes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
 * @param {string} noteId - UUID of the note
 * @param {string} userId - The reader, to mark their own votes
 * @returns {Promise<?Object>} The note's row, or null
 */
async function findNote(db, organizationId, noteId, userId) {
  const { rows } = await db.query(
    `SELECT ${NOTE_COLUMNS} FROM camp_review_notes n WHERE n.organization_id = $1 AND n.id = $2`,
    [organizationId, noteId, userId]);
  return rows[0] || null;
}

/**
 * A camp's review: the camp and every note, heaviest first within the order of
 * the categories.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @param {string} userId - The reader, to mark their own votes
 * @returns {Promise<{camp: Object, notes: Object[]}>}
 */
async function readCampReview(db, organizationId, meetingId, userId) {
  const camp = await findCamp(db, organizationId, meetingId);
  const { rows } = await db.query(
    `SELECT ${NOTE_COLUMNS} FROM camp_review_notes n
      WHERE n.organization_id = $1 AND n.meeting_id = $2
      ORDER BY n.created_at, n.id`,
    [organizationId, meetingId, userId]);
  return {
    camp: {
      id: Number(camp.id), theme: camp.theme, date_from: camp.date_from, date_to: camp.date_to,
      activity_id: camp.activity_id === null ? null : Number(camp.activity_id), is_cancelled: Boolean(camp.is_cancelled),
    },
    notes: rows.map(shapeNote),
  };
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
  && (row.day || null) === note.day && (row.theme || null) === note.theme && row.text === note.text;

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
 * @returns {Promise<{note: Object, created: boolean}>}
 */
async function saveNote(db, organizationId, userId, meetingId, noteId, body) {
  const camp = await findCamp(db, organizationId, meetingId);
  const note = readNote(body, camp);
  const locked = await db.query(
    'SELECT meeting_id, version FROM camp_review_notes WHERE organization_id = $1 AND id = $2 FOR UPDATE',
    [organizationId, noteId]);
  let existing = locked.rows[0] ? await findNote(db, organizationId, noteId, userId) : null;
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
      return { note: shapeNote(await findNote(db, organizationId, noteId, userId)), created: true };
    }
    // Written meanwhile by the same device's other request: judge it as an existing note.
    existing = await findNote(db, organizationId, noteId, userId);
  }
  if (Number(existing.meeting_id) !== Number(meetingId)) {
    refuse('camp_review_note_conflict', HTTP_CONFLICT);
  }
  if (sameContent(existing, note)) {
    return { note: shapeNote(existing), created: false };
  }
  if (note.expectedVersion === null || note.expectedVersion !== Number(existing.version)) {
    refuse('camp_review_note_conflict', HTTP_CONFLICT);
  }
  await db.query(
    `UPDATE camp_review_notes
        SET category = $3, moment = $4, day = $5, theme = $6, note_text = $7, version = version + 1, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, noteId, note.category, note.moment, note.day, note.theme, note.text]);
  return { note: shapeNote(await findNote(db, organizationId, noteId, userId)), created: false };
}

/**
 * Remove a note and its votes. Removing a note already gone succeeds.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @returns {Promise<{deleted: boolean}>}
 */
async function deleteNote(db, organizationId, meetingId, noteId) {
  await findCamp(db, organizationId, meetingId);
  const { rowCount } = await db.query(
    'DELETE FROM camp_review_notes WHERE organization_id = $1 AND meeting_id = $2 AND id = $3',
    [organizationId, meetingId, noteId]);
  return { deleted: rowCount > 0 };
}

/**
 * Add a "+1" to a note, with the id the device chose. Repeating it counts once.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - Who gives it
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID the device chose
 * @returns {Promise<{note: Object}>} The note, with its new weight
 */
async function addVote(db, organizationId, userId, meetingId, noteId, voteId) {
  await findCamp(db, organizationId, meetingId);
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
  const note = await findNote(db, organizationId, noteId, userId);
  if (!note || Number(note.meeting_id) !== Number(meetingId)) {
    refuse('camp_review_note_not_found', HTTP_NOT_FOUND);
  }
  return { note: shapeNote(note) };
}

/**
 * Undo a "+1". Undoing one already gone, or on a note already removed, succeeds.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {string} userId - The reader, to mark their own votes
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID of the vote
 * @returns {Promise<{note: ?Object}>} The note, with its new weight, or null when it is gone
 */
async function removeVote(db, organizationId, userId, meetingId, noteId, voteId) {
  await findCamp(db, organizationId, meetingId);
  await db.query(
    `DELETE FROM camp_review_votes v
      USING camp_review_notes n
      WHERE v.organization_id = $1 AND v.id = $2 AND v.note_id = $3
        AND n.organization_id = v.organization_id AND n.id = v.note_id AND n.meeting_id = $4`,
    [organizationId, voteId, noteId, meetingId]);
  const note = await findNote(db, organizationId, noteId, userId);
  return { note: note && Number(note.meeting_id) === Number(meetingId) ? shapeNote(note) : null };
}

module.exports = {
  CampReviewError, RULES, readCampReview, readNote, saveNote, deleteNote, addVote, removeVote,
};
