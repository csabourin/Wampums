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

  // One statement, so the grant and the cache row it backs are written together
  // even by a caller that holds no transaction.
  await client.query(
    `WITH grant_row AS (
       INSERT INTO participant_access_grants
         (participant_id, user_id, source_type, source_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (participant_id, user_id, source_type, COALESCE(source_id, ''))
         WHERE revoked_at IS NULL
       DO NOTHING
     )
     INSERT INTO user_participants (participant_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (participant_id, user_id) DO NOTHING`,
    [participantId, userId, sourceType, sourceId === null ? null : String(sourceId), grantedBy]
  );
}

/**
 * Drop `user_participants` rows whose last reason just went away.
 *
 * Called after any revocation, for exactly the pairs it touched. A pair that
 * still holds another live grant keeps its row; that survival is the whole
 * reason grants carry a source.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Array<{participant_id: number, user_id: string}>} pairs - Pairs whose
 *   grants changed
 * @returns {Promise<number>} How many pairs lost access entirely
 */
async function pruneUnbackedAccess(client, pairs) {
  if (pairs.length === 0) {
    return 0;
  }

  const result = await client.query(
    `DELETE FROM user_participants up
      USING unnest($1::int[], $2::uuid[]) AS touched(participant_id, user_id)
      WHERE up.participant_id = touched.participant_id
        AND up.user_id = touched.user_id
        AND NOT EXISTS (
          SELECT 1 FROM participant_access_grants g
           WHERE g.participant_id = up.participant_id
             AND g.user_id = up.user_id
             AND g.revoked_at IS NULL
        )`,
    [pairs.map((pair) => pair.participant_id), pairs.map((pair) => pair.user_id)]
  );
  return result.rowCount;
}

/**
 * Withdraw every grant that came from one source — one family link, say.
 *
 * Access the same people hold for any other reason is untouched: only the
 * grants this source made are revoked, and a `user_participants` row goes only
 * if nothing else still backs it.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} source - What is being withdrawn
 * @param {string} source.sourceType - One of {@link ACCESS_SOURCE}
 * @param {string|number} source.sourceId - The link, guardian or admin
 * @returns {Promise<{revoked: number, removed: number}>} Grants revoked, and
 *   pairs that lost access altogether
 */
async function revokeGrantsFromSource(client, { sourceType, sourceId }) {
  const revoked = await client.query(
    `UPDATE participant_access_grants
        SET revoked_at = now()
      WHERE source_type = $1
        AND source_id = $2
        AND revoked_at IS NULL
      RETURNING participant_id, user_id`,
    [sourceType, String(sourceId)]
  );

  const removed = await pruneUnbackedAccess(client, revoked.rows);
  return { revoked: revoked.rowCount, removed };
}

/**
 * Take one person's access to one child away completely, whatever it rested on.
 *
 * This is the administrator's "this person should not see this child", and it
 * means exactly that: every live grant for the pair is revoked, family links
 * included, so the access cannot quietly survive through a reason the admin
 * never saw.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} pair - Who and which child
 * @param {number} pair.participantId - Child
 * @param {string} pair.userId - Person
 * @returns {Promise<boolean>} Whether the person had any access to remove
 */
async function revokeAllAccessForPair(client, { participantId, userId }) {
  const removed = await client.query(
    `WITH revoked AS (
       UPDATE participant_access_grants
          SET revoked_at = now()
        WHERE participant_id = $1 AND user_id = $2 AND revoked_at IS NULL
     )
     DELETE FROM user_participants
      WHERE participant_id = $1 AND user_id = $2
      RETURNING user_id`,
    [participantId, userId]
  );
  return removed.rows.length > 0;
}

/**
 * Take a person's access to every child of one unit away, for "replace all of
 * this person's links" in that unit.
 *
 * Limited to children enrolled in the unit, in any year. A youth can belong to
 * more than one unit, and an administrator here has no say over this person's
 * access to children elsewhere.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} scope - Who, and which unit
 * @param {string} scope.userId - Person
 * @param {number} scope.organizationId - Unit
 * @returns {Promise<number>} Children the person lost access to
 */
async function revokeAllAccessInUnit(client, { userId, organizationId }) {
  const removed = await client.query(
    `WITH in_unit AS (
       SELECT DISTINCT participant_id
         FROM participant_enrollments
        WHERE organization_id = $2
     ),
     revoked AS (
       UPDATE participant_access_grants g
          SET revoked_at = now()
        WHERE g.user_id = $1
          AND g.revoked_at IS NULL
          AND g.participant_id IN (SELECT participant_id FROM in_unit)
     )
     DELETE FROM user_participants up
      WHERE up.user_id = $1
        AND up.participant_id IN (SELECT participant_id FROM in_unit)
      RETURNING up.participant_id`,
    [userId, organizationId]
  );
  return removed.rows.length;
}

/**
 * The children in a unit that a person holds for a reason of their own.
 *
 * "Of their own" excludes family-link grants. When two people link, each
 * shares the children *they* hold — not children a third parent shared with
 * them through another link. Without this, access would travel along a chain
 * of links to people the first parent never agreed to.
 *
 * Enrollment in any year counts. In September many returning children are not
 * yet on the new roster, and they are still this family's children.
 *
 * @param {Object} client - Database client
 * @param {string} userId - Person
 * @param {number} organizationId - Unit
 * @returns {Promise<Array<number>>} Participant IDs
 */
async function listOwnChildrenInUnit(client, userId, organizationId) {
  const result = await client.query(
    `SELECT DISTINCT g.participant_id
       FROM participant_access_grants g
      WHERE g.user_id = $1
        AND g.revoked_at IS NULL
        AND g.source_type <> 'family_link'
        AND EXISTS (
          SELECT 1 FROM participant_enrollments pe
           WHERE pe.participant_id = g.participant_id
             AND pe.organization_id = $2
        )`,
    [userId, organizationId]
  );
  return result.rows.map((row) => row.participant_id);
}

/**
 * Whether a child and an account both belong to a unit, so that linking them is
 * that unit's business.
 *
 * Enrollment is checked across every year, not through the
 * `participant_organizations` view, which only shows the active one.
 *
 * @param {Object} client - Database client
 * @param {Object} scope - What to check
 * @param {number} scope.organizationId - The caller's unit
 * @param {number|string} scope.participantId - Child
 * @param {string} scope.userId - Account
 * @returns {Promise<boolean>} True when both ends are in the unit
 */
async function isAssociationInUnit(client, { organizationId, participantId, userId }) {
  const scope = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM participant_enrollments
          WHERE participant_id = $1 AND organization_id = $2
       ) AS participant_in_org,
       EXISTS (
         SELECT 1 FROM user_organizations
          WHERE user_id = $3 AND organization_id = $2
       ) AS user_in_org`,
    [participantId, organizationId, userId]
  );
  return scope.rows[0].participant_in_org && scope.rows[0].user_in_org;
}

module.exports = {
  ACCESS_SOURCE,
  grantParticipantAccess,
  revokeGrantsFromSource,
  revokeAllAccessForPair,
  revokeAllAccessInUnit,
  listOwnChildrenInUnit,
  isAssociationInUnit,
};
