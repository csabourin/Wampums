'use strict';

const MAX_INTEGER_ID = 2147483647;

/** Parse the child named by either authorization route without passing invalid ids to SQL. */
function participantId(req) {
  const id = Number(req.params.participantId ?? req.body?.participant_id);
  return Number.isInteger(id) && id > 0 && id <= MAX_INTEGER_ID ? id : null;
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

module.exports = { medicationParticipantInUnit, familyMedicationAccess };
