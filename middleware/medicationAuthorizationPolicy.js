'use strict';

const MAX_INTEGER_ID = 2147483647;

/** Parse a participant ID without passing invalid ids to SQL. */
function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= MAX_INTEGER_ID ? id : null;
}

/** Parse the child named by either authorization route. */
function participantId(req) {
  return validId(req.params.participantId ?? req.body?.participant_id);
}

/** Even staff medication permissions apply only to children enrolled in their unit. */
async function medicationParticipantInUnit(req, { pool, organizationId }) {
  const id = participantId(req);
  if (!id) {return false;}
  const writing = req.method !== 'GET';
  const guardianId = writing ? Number(req.body?.guardian_id) : null;
  if (writing && (!Number.isInteger(guardianId) || guardianId <= 0 || guardianId > MAX_INTEGER_ID)) {return false;}
  const result = await pool.query(
    `SELECT 1 FROM participant_enrollments WHERE participant_id = $1 AND organization_id = $2
      AND ($3::int IS NULL OR EXISTS (
        SELECT 1 FROM participant_guardians WHERE participant_id = $1 AND guardian_id = $3
      )) LIMIT 1`,
    [id, organizationId, guardianId]
  );
  return result.rows.length > 0;
}

/**
 * Families may read linked children's authorizations; signing requires the
 * actual guardian named in the request, not merely borrowed family access.
 * @param {Object} req - Authenticated authorization request
 * @param {Object} context - Current unit and database pool
 * @returns {Promise<boolean>} Whether the ownership alternative applies
 */
async function familyMedicationAccess(req, { pool, organizationId }) {
  const id = participantId(req);
  const writing = req.method !== 'GET';
  const guardianId = writing ? Number(req.body?.guardian_id) : null;
  if (!id || (writing && (!Number.isInteger(guardianId) || guardianId <= 0 || guardianId > MAX_INTEGER_ID))) {return false;}
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_participants WHERE participant_id = $1 AND user_id = $2
     ) AND ($5::boolean OR EXISTS (
       SELECT 1 FROM participant_guardians pg
         JOIN parents_guardians g ON g.id = pg.guardian_id
        WHERE pg.participant_id = $1 AND ($4::int IS NULL OR pg.guardian_id = $4)
          AND (g.user_uuid = $2 OR EXISTS (
            SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = pg.guardian_id AND gu.user_id = $2
          ))
     )) AS allowed
     WHERE EXISTS (SELECT 1 FROM participant_enrollments WHERE participant_id = $1 AND organization_id = $3)`,
    [id, req.user.id, organizationId, guardianId, !writing]
  );
  return result.rows[0]?.allowed === true;
}

/**
 * The child a medication list is narrowed to (`?participant_id=`), or null for
 * the whole unit. Read from the query string only, so the policy and the
 * handler can never disagree about which child is meant.
 * @param {Object} req - Request
 * @returns {number|null} Participant ID filter
 */
function listParticipantFilter(req) {
  return req.query?.participant_id === undefined ? null : validId(req.query.participant_id);
}

/**
 * Read policy for the medication lists. Staff holding `medication.view` with an
 * organization-wide scope read the whole unit, or one child of it. Anyone else
 * — a parent, or a linked-scope role holding `medication.view` — must name one
 * child they are linked to, and reads only that child.
 */
const MEDICATION_LIST_READ_POLICY = {
  permissions: ['medication.view'],
  organizationScope: true,
  resourceScope: async (req, { pool, organizationId }) => {
    if (req.query?.participant_id === undefined) {return true;}
    const id = listParticipantFilter(req);
    if (!id) {return false;}
    const result = await pool.query(
      'SELECT 1 FROM participant_enrollments WHERE participant_id = $1 AND organization_id = $2 LIMIT 1',
      [id, organizationId]
    );
    return result.rows.length > 0;
  },
  resourceAccess: async (req, { pool }) => {
    const id = listParticipantFilter(req);
    if (!id) {return false;}
    const result = await pool.query(
      'SELECT 1 FROM user_participants WHERE participant_id = $1 AND user_id = $2 LIMIT 1',
      [id, req.user.id]
    );
    return result.rows.length > 0;
  },
};

module.exports = {
  medicationParticipantInUnit,
  familyMedicationAccess,
  MEDICATION_LIST_READ_POLICY,
  listParticipantFilter
};
