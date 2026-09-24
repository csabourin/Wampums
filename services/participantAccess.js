'use strict';

/**
 * Participant access — who may see a child, and why.
 *
 * `user_participants` answers "can this person see this child?" and nothing
 * else. That was enough while access only ever grew. It stops being enough the
 * day access has to shrink selectively: when a co-parent link is revoked, the
 * access that link granted must go, and access the same person holds for an
 * independent reason — they are the child's registered guardian, or an admin
 * linked them — must stay. A table with one row per pair cannot tell those
 * apart.
 *
 * So every grant is recorded in `participant_access_grants` with its source,
 * and `user_participants` becomes what it always effectively was: a cache of
 * "has at least one live grant". This module is the only place both are
 * written, so they cannot drift.
 *
 * @module services/participantAccess
 */

/** Why a person may see a child. Mirrors the check constraint on the table. */
const ACCESS_SOURCE = {
  DIRECT: 'direct',
  GUARDIAN: 'guardian',
  ADMIN: 'admin',
  FAMILY_LINK: 'family_link',
};

/**
 * Record one reason a person may see a child, and make sure they can.
 *
 * Idempotent per reason: granting the same access for the same reason twice
 * leaves one live grant. Granting it for a second, different reason adds a
 * second grant, which is the point — each reason can later be withdrawn on its
 * own.
 *
 * @param {Object} client - Client, normally inside the caller's transaction
 * @param {Object} grant - What is being granted
 * @param {number} grant.participantId - Child
 * @param {string} grant.userId - Person gaining access
 * @param {string} grant.sourceType - One of {@link ACCESS_SOURCE}
 * @param {string|number|null} [grant.sourceId] - The family link, guardian or
 *   admin the grant comes from
 * @param {string|null} [grant.grantedBy] - Who caused the grant
 * @returns {Promise<void>} Resolves once both tables agree
 */
async function grantParticipantAccess(client, {
  participantId,
  userId,
  sourceType,
  sourceId = null,
  grantedBy = null,
}) {
  if (!Object.values(ACCESS_SOURCE).includes(sourceType)) {
    throw new Error(`Unknown participant access source: ${sourceType}`);
  }

  await client.query(
    `INSERT INTO participant_access_grants
       (participant_id, user_id, source_type, source_id, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (participant_id, user_id, source_type, COALESCE(source_id, ''))
       WHERE revoked_at IS NULL
     DO NOTHING`,
    [participantId, userId, sourceType, sourceId === null ? null : String(sourceId), grantedBy]
  );

  await client.query(
    `INSERT INTO user_participants (participant_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (participant_id, user_id) DO NOTHING`,
    [participantId, userId]
  );
}

module.exports = {
  ACCESS_SOURCE,
  grantParticipantAccess,
};
