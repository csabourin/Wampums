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

/**
 * Serialize writes about these youths until the transaction ends.
 *
 * Attendance points and honors check what is already recorded before writing.
 * A youth's first mark or honor of the day has no row to lock yet, so two
 * devices (or two tabs replaying one offline outbox) would both find nothing
 * and both write. Locking the youths' enrollment rows makes the second writer
 * wait and read what the first recorded. Rows are locked in id order, so
 * concurrent batches naming the same youths cannot deadlock.
 *
 * @param {Object} client - Client inside an open transaction
 * @param {number} organizationId - The writing unit
 * @param {Array<number|string>} participantIds - Youths about to be written about
 * @returns {Promise<void>}
 */
async function lockParticipantsInUnit(client, organizationId, participantIds) {
  await client.query(
    `SELECT 1 FROM participant_enrollments
      WHERE organization_id = $1 AND participant_id = ANY($2::int[])
      ORDER BY participant_id, scout_year_id
      FOR UPDATE`,
    [organizationId, participantIds]
  );
}

module.exports = { allEnrolledInUnit, lockParticipantsInUnit };
