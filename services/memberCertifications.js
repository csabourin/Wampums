'use strict';
/**
 * Adult certifications (#1319, second slice): first aid, wilderness first aid, winter camping.
 *
 * - An adult **declares** their own from their account (`member_certification_declarations`):
 *   the day obtained and, when it has one, the expiry. A declaration never counts by itself.
 * - A manager of volunteers **verifies** it on /volunteers, as they verify a background check: the
 *   verified record is a `volunteer_requirements` row (services/volunteerShifts.js).
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
 * Every certification, with what the person declared and what a manager verified in this unit.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId
 * @returns {Promise<Array<{certification_key: string,
 *   declared: {obtained_on: string, valid_until: string|null, declared_at: string}|null,
 *   verified: {checked_on: string|null, valid_until: string|null, verified_at: string}|null}>>}
 */
async function certificationsOf(db, organizationId, userId) {
  await assertMember(db, organizationId, userId);
  const [declared, verified] = await Promise.all([
    db.query(
      `SELECT certification_key, obtained_on::text AS obtained_on, valid_until::text AS valid_until, declared_at
         FROM member_certification_declarations
        WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    ),
    db.query(
      `SELECT requirement_key, checked_on::text AS checked_on, valid_until::text AS valid_until, verified_at
         FROM volunteer_requirements
        WHERE organization_id = $1 AND user_id = $2 AND requirement_key = ANY($3::text[])`,
      [organizationId, userId, CERTIFICATIONS]
    ),
  ]);
  return CERTIFICATIONS.map((key) => {
    const ownRow = declared.rows.find((row) => row.certification_key === key);
    const verifiedRow = verified.rows.find((row) => row.requirement_key === key);
    return {
      certification_key: key,
      declared: ownRow
        ? { obtained_on: ownRow.obtained_on, valid_until: ownRow.valid_until, declared_at: ownRow.declared_at }
        : null,
      verified: verifiedRow
        ? { checked_on: verifiedRow.checked_on, valid_until: verifiedRow.valid_until, verified_at: verifiedRow.verified_at }
        : null,
    };
  });
}

/**
 * Replace what a person declares for themselves in the unit. What a manager verified is untouched.
 *
 * @param {Object} pool
 * @param {number} organizationId
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
      `DELETE FROM member_certification_declarations
        WHERE organization_id = $1 AND user_id = $2 AND NOT (certification_key = ANY($3::text[]))`,
      [organizationId, userId, keys]
    );
    if (keys.length) {
      await db.query(
        `INSERT INTO member_certification_declarations (organization_id, user_id, certification_key, obtained_on, valid_until)
         SELECT $1, $2, k.key, k.obtained_on, k.valid_until
           FROM UNNEST($3::text[], $4::date[], $5::date[]) AS k(key, obtained_on, valid_until)
         ON CONFLICT (organization_id, user_id, certification_key) DO UPDATE SET
           obtained_on = EXCLUDED.obtained_on, valid_until = EXCLUDED.valid_until, declared_at = NOW()`,
        [organizationId, userId, keys, keys.map((key) => declared[key].obtained_on), keys.map((key) => declared[key].valid_until)]
      );
    }
    return certificationsOf(db, organizationId, userId);
  });
}

/**
 * Certifications of several people for a camp: those verified and valid through its last day,
 * and those declared, valid then, but not verified.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {Array<string>} userIds
 * @param {string} lastDay - YYYY-MM-DD, the camp's last day
 * @returns {Promise<Map<string, {verified: Array<string>, to_verify: Array<string>}>>}
 */
async function certificationsForCamp(db, organizationId, userIds, lastDay) {
  const byUser = new Map(userIds.map((id) => [id, { verified: [], to_verify: [] }]));
  if (!userIds.length) {
    return byUser;
  }
  const rows = (await db.query(
    `SELECT u.user_id, k.key,
            EXISTS (SELECT 1 FROM volunteer_requirements r
                     WHERE r.organization_id = $1 AND r.user_id = u.user_id AND r.requirement_key = k.key
                       AND (r.valid_until IS NULL OR r.valid_until >= $4::date)) AS verified,
            EXISTS (SELECT 1 FROM member_certification_declarations d
                     WHERE d.organization_id = $1 AND d.user_id = u.user_id AND d.certification_key = k.key
                       AND (d.valid_until IS NULL OR d.valid_until >= $4::date)) AS declared
       FROM UNNEST($2::uuid[]) AS u(user_id)
      CROSS JOIN UNNEST($3::text[]) WITH ORDINALITY AS k(key, position)
      ORDER BY u.user_id, k.position`,
    [organizationId, userIds, CERTIFICATIONS, lastDay]
  )).rows;
  rows.forEach((row) => {
    const entry = byUser.get(row.user_id);
    if (!entry) {
      return;
    }
    if (row.verified) {
      entry.verified.push(row.key);
    } else if (row.declared) {
      entry.to_verify.push(row.key);
    }
  });
  return byUser;
}

module.exports = {
  CertificationError, CERTIFICATIONS, FIRST_AID, readDeclarations, certificationsOf, saveOwnDeclarations, certificationsForCamp,
};
