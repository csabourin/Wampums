'use strict';
/**
 * Adult certifications (#1319, second slice): first aid, wilderness first aid, winter camping.
 *
 * - They belong to the person (`member_certifications`), not to a unit. An adult **declares** each
 *   once from their account: the day obtained and, when it has one, the expiry. A declaration never
 *   counts by itself.
 * - A manager of volunteers of any unit the person belongs to **verifies** it (on /volunteers); the
 *   verification then holds in every unit. Changing the dates withdraws it.
 * - The camp lists read both: a verified certification valid through the camp's last day counts;
 *   a declaration still unverified is listed to verify.
 *
 * Keys: config/certifications.json (a subset of the requirement keys of
 * config/volunteer_shifts.json). Only the fact and the dates are kept, never a document.
 *
 * @module services/memberCertifications
 */
const transaction = require('../utils/transaction');
const { isCalendarDate } = require('../utils/calendar-date');
const RULES = require('../config/certifications.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
/** Length of a YYYY-MM-DD calendar date in an ISO timestamp. */
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/** Certification keys, in the order screens list them. */
const CERTIFICATIONS = RULES.certifications;
/** Certifications that make someone the camp's first aider. */
const FIRST_AID = RULES.first_aid;

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class CertificationError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CertificationError(key, status, field);
};

/** @returns {string} A day as YYYY-MM-DD, in UTC */
const isoDay = (date) => date.toISOString().slice(0, ISO_DATE_LENGTH);

/**
 * Read a person's complete set of declarations from a request body, before any transaction opens.
 * `{ declared: { <key>: { obtained_on, valid_until? } } }`: keys left out are no longer declared.
 * The day obtained is required, not in the future nor more than `oldest_years` ago; the expiry,
 * when given, is not before it.
 *
 * @param {Object} input - Request body
 * @param {Date} now
 * @returns {Object<string, {obtained_on: string, valid_until: string|null}>}
 * @throws {CertificationError} 400, naming the field
 */
function readDeclarations(input, now) {
  const declared = input?.declared;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    refuse('certification_invalid');
  }
  const today = isoDay(now);
  const oldestDate = new Date(now);
  oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - RULES.oldest_years);
  const oldest = isoDay(oldestDate);
  const result = {};
  Object.entries(declared).forEach(([key, entry]) => {
    if (!CERTIFICATIONS.includes(key)) {
      refuse('certification_unknown', HTTP_BAD_REQUEST, 'declared');
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      refuse('certification_invalid', HTTP_BAD_REQUEST, `declared.${key}`);
    }
    const obtainedOn = entry.obtained_on;
    if (!isCalendarDate(obtainedOn) || obtainedOn > today || obtainedOn < oldest) {
      refuse('certification_obtained_on_invalid', HTTP_BAD_REQUEST, `declared.${key}.obtained_on`);
    }
    const validUntil = entry.valid_until === undefined || entry.valid_until === '' ? null : entry.valid_until;
    if (validUntil !== null && (!isCalendarDate(validUntil) || validUntil < obtainedOn)) {
      refuse('certification_valid_until_invalid', HTTP_BAD_REQUEST, `declared.${key}.valid_until`);
    }
    result[key] = { obtained_on: obtainedOn, valid_until: validUntil };
  });
  return result;
}

/**
 * @throws {CertificationError} 404 when the person is not an active member of the unit
 */
async function assertMember(db, organizationId, userId, { lock = false } = {}) {
  const member = await db.query(
    `SELECT 1 FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND status = 'active'${lock ? ' FOR SHARE' : ''}`,
    [organizationId, userId]
  );
  if (!member.rows.length) {
    refuse('certification_member_not_found', HTTP_NOT_FOUND);
  }
}

/**
 * Every certification, with what the person declared and whether it was verified. Both belong to
 * the person: a verification made in any of their units holds in all of them.
 *
 * @param {Object} db
 * @param {number} organizationId - The unit reading them; the person must be its active member
 * @param {string} userId
 * @returns {Promise<Array<{certification_key: string,
 *   declared: {obtained_on: string, valid_until: string|null, declared_at: string}|null,
 *   verified: {valid_until: string|null, verified_at: string}|null}>>}
 */
async function certificationsOf(db, organizationId, userId) {
  await assertMember(db, organizationId, userId);
  const rows = (await db.query(
    `SELECT certification_key, obtained_on::text AS obtained_on, valid_until::text AS valid_until, declared_at, verified_at
       FROM member_certifications WHERE user_id = $1`,
    [userId]
  )).rows;
  return CERTIFICATIONS.map((key) => {
    const row = rows.find((entry) => entry.certification_key === key);
    return {
      certification_key: key,
      declared: row ? { obtained_on: row.obtained_on, valid_until: row.valid_until, declared_at: row.declared_at } : null,
      verified: row?.verified_at ? { valid_until: row.valid_until, verified_at: row.verified_at } : null,
    };
  });
}

/**
 * Replace what a person declares. A declaration whose dates change loses its verification, so a
 * verified certificate cannot be extended by editing it; one left as it was keeps it.
 *
 * @param {Object} pool
 * @param {number} organizationId - The unit the person is signed in to
 * @param {string} userId - Always the authenticated person
 * @param {Object} input - Request body: { declared }
 * @returns {Promise<Array<Object>>} The person's certifications as they now are
 */
function saveOwnDeclarations(pool, organizationId, userId, input) {
  const declared = readDeclarations(input, new Date());
  const keys = Object.keys(declared);
  return transaction(pool, async (db) => {
    await assertMember(db, organizationId, userId, { lock: true });
    await db.query(
      'DELETE FROM member_certifications WHERE user_id = $1 AND NOT (certification_key = ANY($2::text[]))',
      [userId, keys]
    );
    if (keys.length) {
      await db.query(
        `INSERT INTO member_certifications AS c (user_id, certification_key, obtained_on, valid_until)
         SELECT $1, k.key, k.obtained_on, k.valid_until
           FROM UNNEST($2::text[], $3::date[], $4::date[]) AS k(key, obtained_on, valid_until)
         ON CONFLICT (user_id, certification_key) DO UPDATE SET
           obtained_on = EXCLUDED.obtained_on, valid_until = EXCLUDED.valid_until, declared_at = NOW(),
           verified_at = CASE WHEN (c.obtained_on, c.valid_until) IS NOT DISTINCT FROM (EXCLUDED.obtained_on, EXCLUDED.valid_until)
                              THEN c.verified_at END,
           verified_by = CASE WHEN (c.obtained_on, c.valid_until) IS NOT DISTINCT FROM (EXCLUDED.obtained_on, EXCLUDED.valid_until)
                              THEN c.verified_by END,
           verified_in_organization_id = CASE WHEN (c.obtained_on, c.valid_until) IS NOT DISTINCT FROM (EXCLUDED.obtained_on, EXCLUDED.valid_until)
                              THEN c.verified_in_organization_id END`,
        [userId, keys, keys.map((key) => declared[key].obtained_on), keys.map((key) => declared[key].valid_until)]
      );
    }
    return certificationsOf(db, organizationId, userId);
  });
}

/**
 * A manager of volunteers verifies a declared certification, or withdraws its verification. The
 * person must be an active member of the manager's unit; the verification then holds everywhere.
 *
 * @param {Object} pool
 * @param {number} organizationId - The manager's unit
 * @param {string} managerId
 * @param {string} userId - The person
 * @param {string} key - Certification key
 * @param {Object} input - Request body: { verified: boolean }
 * @returns {Promise<Array<Object>>} The person's certifications as they now are
 */
function verifyCertification(pool, organizationId, managerId, userId, key, input) {
  if (!CERTIFICATIONS.includes(key)) {
    refuse('certification_unknown', HTTP_NOT_FOUND);
  }
  if (typeof input?.verified !== 'boolean') {
    refuse('certification_invalid', HTTP_BAD_REQUEST, 'verified');
  }
  return transaction(pool, async (db) => {
    await assertMember(db, organizationId, userId, { lock: true });
    const updated = await db.query(
      `UPDATE member_certifications SET
         verified_at = CASE WHEN $3 THEN NOW() END,
         verified_by = CASE WHEN $3 THEN $4::uuid END,
         verified_in_organization_id = CASE WHEN $3 THEN $5::int END
       WHERE user_id = $1 AND certification_key = $2`,
      [userId, key, input.verified, managerId, organizationId]
    );
    if (!updated.rowCount) {
      refuse('certification_not_declared', HTTP_NOT_FOUND);
    }
    return certificationsOf(db, organizationId, userId);
  });
}

/**
 * Certifications of several people for a camp: those verified and valid through its last day,
 * and those declared, valid then, but not verified. The caller restricts the people to its unit.
 *
 * @param {Object} db
 * @param {Array<string>} userIds
 * @param {string} lastDay - YYYY-MM-DD, the camp's last day
 * @returns {Promise<Map<string, {verified: Array<string>, to_verify: Array<string>}>>}
 */
async function certificationsForCamp(db, userIds, lastDay) {
  const byUser = new Map(userIds.map((id) => [id, { verified: [], to_verify: [] }]));
  if (!userIds.length) {
    return byUser;
  }
  const rows = (await db.query(
    `SELECT user_id, certification_key, verified_at IS NOT NULL AS verified
       FROM member_certifications
      WHERE user_id = ANY($1::uuid[]) AND (valid_until IS NULL OR valid_until >= $2::date)`,
    [userIds, lastDay]
  )).rows;
  CERTIFICATIONS.forEach((key) => rows.filter((row) => row.certification_key === key).forEach((row) => {
    const entry = byUser.get(row.user_id);
    entry?.[row.verified ? 'verified' : 'to_verify'].push(key);
  }));
  return byUser;
}

module.exports = {
  CertificationError, CERTIFICATIONS, FIRST_AID, readDeclarations, certificationsOf, saveOwnDeclarations, verifyCertification,
  certificationsForCamp,
};
