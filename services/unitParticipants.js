'use strict';

/**
 * Whether children named in a write belong to the unit writing it.
 *
 * Writes that name a child by id (attendance, honors) must check it: a child
 * of another unit could otherwise be recorded here, and reads that join
 * `participants` by id would then show that child's name to this unit.
 *
 * @module services/unitParticipants
 */

/**
 * @param {Object} db - Pool or client
 * @param {number} organizationId - The writing unit
 * @param {Array<number|string>} participantIds - Ids named by the request
 * @returns {Promise<boolean>} True when every id is enrolled in the unit, in any year
 */
async function allEnrolledInUnit(db, organizationId, participantIds) {
  const ids = [...new Set(participantIds.map((id) => String(id)))];
  if (!ids.length) {
    return true;
  }
  const result = await db.query(
    `SELECT DISTINCT participant_id FROM participant_enrollments
      WHERE organization_id = $1 AND participant_id = ANY($2::int[])`,
    [organizationId, ids]
  );
  const enrolled = new Set(result.rows.map((row) => String(row.participant_id)));
  return ids.every((id) => enrolled.has(id));
}

module.exports = { allEnrolledInUnit };
