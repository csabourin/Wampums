'use strict';
/**
 * Adults' allergies (#1319, third slice): what an adult declares about their own allergies. It
 * belongs to the person, shared by every unit they belong to. Voluntary, and written only by them: no route takes another person's id for a write.
 * A camp's lists show the declarations of its active team members to holders of
 * `camp_allergies.view` (services/campRoster.js). Youth allergies are read from their health forms.
 *
 * @module services/memberAllergies
 */
const RULES = require('../config/member_allergies.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class AllergyDeclarationError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new AllergyDeclarationError(key, status, field);
};

/**
 * Read a declaration from a request body.
 * @param {Object} input - { allergies, carries_epipen?, person_to_notify? }
 * @returns {{allergies: string, carries_epipen: boolean, person_to_notify: string|null}}
 * @throws {AllergyDeclarationError} 400, naming the field
 */
function readDeclaration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    refuse('allergy_declaration_invalid');
  }
  const allergies = typeof input.allergies === 'string' ? input.allergies.trim() : '';
  if (!allergies || allergies.length > RULES.allergies_max_length) {
    refuse('allergy_declaration_allergies_invalid', HTTP_BAD_REQUEST, 'allergies');
  }
  if (input.carries_epipen !== undefined && typeof input.carries_epipen !== 'boolean') {
    refuse('allergy_declaration_invalid', HTTP_BAD_REQUEST, 'carries_epipen');
  }
  let person = null;
  if (input.person_to_notify !== undefined && input.person_to_notify !== null) {
    if (typeof input.person_to_notify !== 'string' || input.person_to_notify.trim().length > RULES.person_to_notify_max_length) {
      refuse('allergy_declaration_person_invalid', HTTP_BAD_REQUEST, 'person_to_notify');
    }
    person = input.person_to_notify.trim() || null;
  }
  return { allergies, carries_epipen: input.carries_epipen === true, person_to_notify: person };
}

/** @throws {AllergyDeclarationError} 404 when the person is not an active member of the unit */
async function assertMember(db, organizationId, userId) {
  const member = await db.query(
    "SELECT 1 FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [organizationId, userId]
  );
  if (!member.rows.length) {
    refuse('allergy_declaration_member_not_found', HTTP_NOT_FOUND);
  }
}

const COLUMNS = 'allergies, carries_epipen, person_to_notify, declared_at';

/**
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId - Always the authenticated person
 * @returns {Promise<Object|null>} Their declaration, or null when they made none
 */
async function readOwnDeclaration(db, organizationId, userId) {
  await assertMember(db, organizationId, userId);
  return (await db.query(
    `SELECT ${COLUMNS} FROM member_allergy_declarations WHERE user_id = $1`,
    [userId]
  )).rows[0] || null;
}

/**
 * Record or replace one's own declaration.
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId - Always the authenticated person
 * @param {Object} input - Request body
 * @returns {Promise<Object>} The declaration as recorded
 */
async function saveOwnDeclaration(db, organizationId, userId, input) {
  const declaration = readDeclaration(input);
  await assertMember(db, organizationId, userId);
  return (await db.query(
    `INSERT INTO member_allergy_declarations (user_id, allergies, carries_epipen, person_to_notify)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET allergies = EXCLUDED.allergies,
       carries_epipen = EXCLUDED.carries_epipen, person_to_notify = EXCLUDED.person_to_notify, declared_at = NOW()
     RETURNING ${COLUMNS}`,
    [userId, declaration.allergies, declaration.carries_epipen, declaration.person_to_notify]
  )).rows[0];
}

/**
 * Withdraw one's own declaration.
 * @returns {Promise<boolean>} Whether there was one
 */
async function removeOwnDeclaration(db, userId) {
  const removed = await db.query('DELETE FROM member_allergy_declarations WHERE user_id = $1', [userId]);
  return removed.rowCount > 0;
}

/**
 * Declarations of several people. The caller restricts them to the unit's active members it may show.
 * @param {Object} db
 * @param {Array<string>} userIds
 * @returns {Promise<Map<string, Object>>} By user id; a member without a declaration is absent
 */
async function declarationsFor(db, userIds) {
  if (!userIds.length) {
    return new Map();
  }
  const rows = (await db.query(
    `SELECT user_id, ${COLUMNS} FROM member_allergy_declarations WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  )).rows;
  return new Map(rows.map(({ user_id: userId, ...declaration }) => [userId, declaration]));
}

module.exports = {
  AllergyDeclarationError, readDeclaration, readOwnDeclaration, saveOwnDeclaration, removeOwnDeclaration, declarationsFor,
};
