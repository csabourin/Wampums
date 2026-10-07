/**
 * Guardian Routes - REFACTORED FOR SECURITY
 *
 * Handles parent/guardian management for participants.
 * All endpoints require JWT authentication via authenticate middleware.
 * ALL authentication/authorization goes through middleware, not manual JWT verification.
 *
 * ARCHITECTURE:
 * - authenticate middleware: Verifies JWT token, extracts user context
 * - requirePermission middleware: Checks database role/permission mappings
 * - getOrganizationId: Extracts org from token (enforced by authenticate)
 *
 * @module routes/guardians
 */

const express = require('express');
const HTTP_STATUS = { BAD_REQUEST: 400, NOT_FOUND: 404 };
const router = express.Router();

// Import middleware and utilities
const {
  authenticate,
  blockDemoRoles,
  getOrganizationId,
  getUserDataScope,
  requirePermission,
  userHasPermission,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { revokeGuardianAccess } = require('../services/participantAccess');
const { splitFullName } = require('../services/accountProvisioning');

/** Shape of a user id (users.id is a UUID). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest value of a PostgreSQL integer column, which these ids are. */
const MAX_INTEGER_ID = 2147483647;

/**
 * Whether a query or body value is a positive integer id that fits the
 * database's integer columns (as a number or a string of digits). Anything
 * else would reach SQL and fail as a 500.
 *
 * @param {*} value - Value to check
 * @returns {boolean} True for 1, '42'; false for 0, '', 'abc', '1.5', '99999999999'
 */
function isPositiveInteger(value) {
  // Only a number or a string: String([1]) is '1', but node-postgres would
  // send the array as an array literal.
  if (typeof value !== 'number' && typeof value !== 'string') {
    return false;
  }
  const text = String(value);
  return /^[1-9]\d{0,9}$/.test(text) && Number(text) <= MAX_INTEGER_ID;
}

/** Most custom fields one guardian may carry. */
const MAX_CUSTOM_FIELDS = 50;

/** The parent_guardian form's own columns, kept on parents_guardians. */
const CORE_GUARDIAN_FIELDS = new Set([
  'nom', 'prenom', 'lien', 'courriel', 'telephone_residence', 'telephone_travail',
  'telephone_cellulaire', 'is_primary', 'is_emergency_contact',
]);

/**
 * Whether a value is a set of custom form fields: a plain object of plain
 * values (string, number, boolean or null), none of them a core column.
 *
 * @param {*} value - Value to check
 * @returns {boolean} True when it can be stored as given
 */
function isCustomFieldSet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return entries.length <= MAX_CUSTOM_FIELDS && entries.every(([key, field]) =>
    !CORE_GUARDIAN_FIELDS.has(key)
    && (field === null || ['string', 'number', 'boolean'].includes(typeof field)));
}

/**
 * Export route factory function
 * Allows dependency injection of pool
 *
 * @param {Object} pool - Database connection pool
 * @returns {Router} Express router with guardian routes
 */
module.exports = (pool) => {
  /**
   * Whether the caller may read or change the guardians of one child.
   *
   * Someone who sees the whole unit -- staff, including a leader who is also
   * a parent -- needs the permission. A family account (every role limited to
   * its own children) may act only on a child it has access to: the
   * Parent/Guardian section of its own child's form. Access to a child is not
   * enough for staff: they can be assigned to children they have no family
   * tie to. The permission alone is not enough for a family account, or it
   * would open every family's contacts.
   *
   * @param {Object} req - Authenticated request
   * @param {number} participantId - Child
   * @param {number} organizationId - Caller's unit
   * @param {string} permissionKey - 'guardians.view' or 'guardians.manage'
   * @returns {Promise<boolean>} True when allowed
   */
  async function mayActOnGuardians(req, participantId, organizationId, permissionKey) {
    const [holdsPermission, dataScope] = await Promise.all([
      userHasPermission(req, pool, organizationId, permissionKey),
      getUserDataScope(req, pool),
    ]);
    if (dataScope === 'organization') {
      return holdsPermission;
    }

    const linked = await pool.query(
      `SELECT 1
       FROM user_participants up
       JOIN participant_organizations po ON po.participant_id = up.participant_id AND po.organization_id = $3
       JOIN user_organizations uo
         ON uo.user_id = up.user_id AND uo.organization_id = $3 AND uo.status = 'active'
       WHERE up.user_id = $1 AND up.participant_id = $2
         -- A role that still exists and is limited to its own children. A
         -- membership whose roles were all deleted reads as 'linked' scope by
         -- default, and must not pass for a family.
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS family_role_id
           JOIN roles family_role ON family_role.id = family_role_id::integer
           WHERE family_role.data_scope = 'linked'
         )
       LIMIT 1`,
      [req.user.id, participantId, organizationId]
    );
    return linked.rows.length > 0;
  }

  /**
   * Refuse, naming the permission that would have allowed it. Access to the
   * child would also have done, and the message says so.
   *
   * @param {Object} res - Express response
   * @param {string} permissionKey - Permission required
   * @returns {Object} 403 response
   */
  function refuse(res, permissionKey) {
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions or no access to this participant',
      required: [permissionKey],
      missing: [permissionKey],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * The accounts with access to a child in this unit, each with the contact
   * record that belongs to it when there is one (by account, by the older
   * guardian_users mapping, or by address).
   *
   * @param {number} participantId - Child
   * @param {number} organizationId - Unit
   * @returns {Promise<Array>} One row per account
   */
  async function accountsWithAccess(participantId, organizationId) {
    const result = await pool.query(
      `SELECT u.id AS user_id, u.full_name, u.email,
              -- Already among this child's guardians through any record of theirs.
              EXISTS (
                SELECT 1
                FROM participant_guardians linked
                JOIN parents_guardians lg ON lg.id = linked.guardian_id
                WHERE linked.participant_id = up.participant_id
                  AND (lg.user_uuid = u.id
                       OR ((lg.user_uuid IS NULL OR lg.user_uuid = u.id)
                           AND EXISTS (SELECT 1 FROM guardian_users lgu WHERE lgu.guardian_id = lg.id AND lgu.user_id = u.id))
                       OR (lower(lg.courriel) = lower(u.email)
                           AND (lg.user_uuid IS NULL OR lg.user_uuid = u.id)
                           AND NOT EXISTS (
                             SELECT 1 FROM guardian_users other
                             WHERE other.guardian_id = lg.id AND other.user_id IS NOT NULL AND other.user_id <> u.id
                           )
                           -- Nor linked to a child this account cannot see: that is another
                           -- family's contact, whatever address it carries now.
                           AND NOT EXISTS (
                             SELECT 1 FROM participant_guardians elsewhere
                             WHERE elsewhere.guardian_id = lg.id
                               AND NOT EXISTS (
                                 SELECT 1 FROM user_participants seen
                                 WHERE seen.participant_id = elsewhere.participant_id AND seen.user_id = u.id
                               )
                           )))
              ) AS already_linked,
              -- Another account's record already carries this address, and
              -- addresses are unique: offering it would make the save fail.
              EXISTS (
                SELECT 1 FROM parents_guardians taken WHERE lower(taken.courriel) = lower(u.email)
              ) AS address_taken,
              g.id AS guardian_id, g.nom, g.prenom, g.courriel,
              g.telephone_residence, g.telephone_travail, g.telephone_cellulaire,
              g.is_primary, g.is_emergency_contact
       FROM user_participants up
       JOIN users u ON u.id = up.user_id
       JOIN user_organizations uo
         ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
         -- A family account: every role limited to its own children. Access to
         -- a child is not enough; staff -- a leader who is also a parent included,
         -- who sees the whole unit -- can be assigned to children too.
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS family_role_id
           JOIN roles family_role ON family_role.id = family_role_id::integer
           WHERE family_role.data_scope = 'linked'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS staff_role_id
           JOIN roles staff_role ON staff_role.id = staff_role_id::integer
           WHERE staff_role.data_scope IS DISTINCT FROM 'linked'
         )
       LEFT JOIN LATERAL (
         SELECT pg.*
         FROM parents_guardians pg
         WHERE pg.user_uuid = u.id
            -- The older mapping counts only on a record no other account owns
            -- by user_uuid: an address reused by a newer account leaves both.
            OR ((pg.user_uuid IS NULL OR pg.user_uuid = u.id)
                AND EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = pg.id AND gu.user_id = u.id))
            -- An address alone counts only on a record no other account
            -- claims: an address can move to another account.
            OR (lower(pg.courriel) = lower(u.email)
                AND (pg.user_uuid IS NULL OR pg.user_uuid = u.id)
                AND NOT EXISTS (
                  SELECT 1 FROM guardian_users other
                  WHERE other.guardian_id = pg.id AND other.user_id IS NOT NULL AND other.user_id <> u.id
                )
                -- Nor linked to a child this account cannot see: that is another
                -- family's contact, whatever address it carries now.
                AND NOT EXISTS (
                  SELECT 1 FROM participant_guardians elsewhere
                  WHERE elsewhere.guardian_id = pg.id
                    AND NOT EXISTS (
                      SELECT 1 FROM user_participants seen
                      WHERE seen.participant_id = elsewhere.participant_id AND seen.user_id = u.id
                    )
                ))
         ORDER BY (pg.user_uuid = u.id) DESC NULLS LAST,
                  EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = pg.id AND gu.user_id = u.id) DESC,
                  pg.id
         LIMIT 1
       ) g ON true
       WHERE up.participant_id = $1
       ORDER BY u.full_name, u.email`,
      [participantId, organizationId]
    );
    return result.rows;
  }

  /**
   * @swagger
   * /api/guardians:
   *   get:
   *     summary: Get guardians for a participant
   *     description: Retrieve all parent/guardian information for a specific participant
   *     tags: [Guardians]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Guardians retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Participant not found
   */
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id } = req.query;

    if (!participant_id) {
      return error(res, 'Participant ID is required', 400);
    }
    if (!isPositiveInteger(participant_id)) {
      return error(res, 'Participant ID must be a positive integer', 400);
    }

    if (!(await mayActOnGuardians(req, participant_id, organizationId, 'guardians.view'))) {
      return refuse(res, 'guardians.view');
    }

    // Verify participant belongs to this organization
    const participantCheck = await pool.query(
      `SELECT p.id FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE p.id = $1 AND po.organization_id = $2`,
      [participant_id, organizationId]
    );

    if (participantCheck.rows.length === 0) {
      return error(res, 'Participant not found in this organization', 404);
    }

    const result = await pool.query(
      `SELECT pg.guardian_id, pg.participant_id, pg.lien, pg.lien as relationship,
              g.id, g.nom, g.prenom, g.courriel,
              g.telephone_residence, g.telephone_travail, g.telephone_cellulaire,
              g.is_primary, g.is_emergency_contact
       FROM participant_guardians pg
       JOIN parents_guardians g ON pg.guardian_id = g.id
       JOIN participants p ON pg.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE pg.participant_id = $1 AND po.organization_id = $2`,
      [participant_id, organizationId]
    );

    // Other screens (health form, guardian and medication management, the
    // mobile app) read this list as linked contact records, each with an id.
    // They get exactly that.
    if (req.query.include_account_holders !== 'true') {
      return success(res, result.rows);
    }

    // The registration form asks for more: the people who registered, or were
    // given access to this child, are its parents or guardians too. Those
    // without a contact record linked to the child yet are offered pre-filled
    // from their account, so the form -- and the emergency contacts built
    // from it -- is not empty. They may have no id until saved.
    const linkedIds = new Set(result.rows.map((row) => row.guardian_id));
    const fromAccounts = (await accountsWithAccess(participant_id, organizationId))
      .filter((account) => !account.already_linked && !linkedIds.has(account.guardian_id))
      .map((account) => {
        const fallback = splitFullName(account.full_name, account.email);
        return {
          guardian_id: account.guardian_id || null,
          id: account.guardian_id || null,
          participant_id: Number(participant_id),
          lien: null,
          relationship: null,
          nom: account.nom || fallback.nom,
          prenom: account.prenom || fallback.prenom,
          courriel: account.courriel || (account.address_taken ? null : account.email),
          telephone_residence: account.telephone_residence,
          telephone_travail: account.telephone_travail,
          telephone_cellulaire: account.telephone_cellulaire,
          is_primary: account.is_primary,
          is_emergency_contact: account.is_emergency_contact,
          // Which account this entry stands for, so a first save ties the new
          // record to it even if the address was edited on the form.
          account_user_id: account.user_id,
          linked: false,
        };
      });

    // Custom fields saved for these guardians on the child's submission.
    const submission = await pool.query(
      `SELECT submission_data->'guardians' AS guardians
       FROM form_submissions
       WHERE participant_id = $1 AND organization_id = $2 AND form_type = 'parent_guardian'
       ORDER BY id DESC
       LIMIT 1`,
      [participant_id, organizationId]
    );
    const customByGuardian = submission.rows[0]?.guardians || {};
    const withCustomFields = (row) => ({
      ...row,
      custom_fields: (row.guardian_id && customByGuardian[String(row.guardian_id)]) || {},
    });

    return success(res, [
      ...result.rows.map((row) => withCustomFields({ ...row, linked: true })),
      ...fromAccounts.map(withCustomFields),
    ]);
  }));

  /**
   * @swagger
   * /api/save-guardian:
   *   post:
   *     summary: Save guardian
   *     description: Create or update parent/guardian information for a participant
   *     tags: [Guardians]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - participant_id
   *               - nom
   *               - prenom
   *             properties:
   *               participant_id:
   *                 type: integer
   *               guardian_id:
   *                 type: integer
   *                 description: If provided, updates existing guardian
   *               nom:
   *                 type: string
   *               prenom:
   *                 type: string
   *               lien:
   *                 type: string
   *                 description: Relationship to participant
   *               courriel:
   *                 type: string
   *                 format: email
   *               telephone_residence:
   *                 type: string
   *               telephone_travail:
   *                 type: string
   *               telephone_cellulaire:
   *                 type: string
   *               is_primary:
   *                 type: boolean
   *               is_emergency_contact:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Guardian saved successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Participant not found
   */
  router.post('/', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id, guardian_id, account_user_id, custom_fields, nom, prenom, lien, courriel,
      telephone_residence, telephone_travail, telephone_cellulaire,
      is_primary, is_emergency_contact } = req.body;

    if (!participant_id || !nom || !prenom) {
      return error(res, 'Participant ID, nom, and prenom are required', 400);
    }
    // Present at all means it must be valid: 0 or '' is not "no guardian".
    const hasGuardianId = guardian_id !== undefined && guardian_id !== null;
    if (!isPositiveInteger(participant_id) || (hasGuardianId && !isPositiveInteger(guardian_id))) {
      return error(res, 'Participant ID and guardian ID must be positive integers', 400);
    }
    if (custom_fields !== undefined && custom_fields !== null && !isCustomFieldSet(custom_fields)) {
      return error(res, 'Custom fields must be an object of plain values', 400);
    }
    const hasAccountUserId = account_user_id !== undefined && account_user_id !== null;
    if (hasAccountUserId && (typeof account_user_id !== 'string' || !UUID_PATTERN.test(account_user_id))) {
      return error(res, 'Account user ID must be a UUID', 400);
    }

    if (!(await mayActOnGuardians(req, participant_id, organizationId, 'guardians.manage'))) {
      return refuse(res, 'guardians.manage');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify participant belongs to this organization
      const participantCheck = await client.query(
        `SELECT p.id FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE p.id = $1 AND po.organization_id = $2`,
        [participant_id, organizationId]
      );

      if (participantCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Participant not found in this organization', 404);
      }

      let guardianIdToLink;

      if (hasGuardianId) {
        // Only a guardian of this child may be edited from its form: one
        // already linked to it, or the contact record of an account that has
        // access to it (which this save then links).
        const guardianCheck = await client.query(
          `SELECT 1 FROM participant_guardians pg
           WHERE pg.guardian_id = $1 AND pg.participant_id = $2
           UNION ALL
           SELECT 1
           FROM parents_guardians g
           JOIN user_participants up ON up.participant_id = $2
           JOIN users u ON u.id = up.user_id
           JOIN user_organizations uo
             ON uo.user_id = u.id AND uo.organization_id = $3 AND uo.status = 'active'
             -- A family account: every role limited to its own children. Access to
             -- a child is not enough; staff -- a leader who is also a parent included,
             -- who sees the whole unit -- can be assigned to children too.
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS family_role_id
               JOIN roles family_role ON family_role.id = family_role_id::integer
               WHERE family_role.data_scope = 'linked'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS staff_role_id
               JOIN roles staff_role ON staff_role.id = staff_role_id::integer
               WHERE staff_role.data_scope IS DISTINCT FROM 'linked'
             )
           WHERE g.id = $1
             AND (g.user_uuid = u.id
                  OR ((g.user_uuid IS NULL OR g.user_uuid = u.id)
                      AND EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = g.id AND gu.user_id = u.id))
                  OR (lower(g.courriel) = lower(u.email)
                      AND (g.user_uuid IS NULL OR g.user_uuid = u.id)
                      AND NOT EXISTS (
                        SELECT 1 FROM guardian_users other
                        WHERE other.guardian_id = g.id AND other.user_id IS NOT NULL AND other.user_id <> u.id
                      )
                      -- Nor linked to a child this account cannot see: that is another
                      -- family's contact, whatever address it carries now.
                      AND NOT EXISTS (
                        SELECT 1 FROM participant_guardians elsewhere
                        WHERE elsewhere.guardian_id = g.id
                          AND NOT EXISTS (
                            SELECT 1 FROM user_participants seen
                            WHERE seen.participant_id = elsewhere.participant_id AND seen.user_id = u.id
                          )
                      )))
           LIMIT 1`,
          [guardian_id, participant_id, organizationId]
        );

        if (guardianCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Guardian not found for this participant', 403);
        }

        // Update existing guardian
        await client.query(
          `UPDATE parents_guardians
           SET nom = $1, prenom = $2, courriel = $3,
               telephone_residence = $4, telephone_travail = $5, telephone_cellulaire = $6,
               is_primary = $7, is_emergency_contact = $8
           WHERE id = $9`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary || false, is_emergency_contact || false, guardian_id]
        );
        guardianIdToLink = guardian_id;

        // Link it to the child (a record offered from an account is not yet),
        // keeping the relationship already recorded unless a new one is given.
        await client.query(
          `INSERT INTO participant_guardians (guardian_id, participant_id, lien)
           VALUES ($1, $2, $3)
           ON CONFLICT (guardian_id, participant_id)
           DO UPDATE SET lien = COALESCE(EXCLUDED.lien, participant_guardians.lien)`,
          [guardian_id, participant_id, lien || null]
        );
      } else {
        // Insert new guardian
        // A record made for an account with access to this child is theirs:
        // tie it to the account named by the form entry, or else to the one
        // whose address it carries. Either way the account must be an active
        // member of this unit with access to the child.
        const result = await client.query(
          `INSERT INTO parents_guardians
           (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary, is_emergency_contact, user_uuid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (
             SELECT u.id
             FROM user_participants up
             JOIN users u ON u.id = up.user_id
             JOIN user_organizations uo
               ON uo.user_id = u.id AND uo.organization_id = $10 AND uo.status = 'active'
               -- A family account: every role limited to its own children. Access to
               -- a child is not enough; staff -- a leader who is also a parent included,
               -- who sees the whole unit -- can be assigned to children too.
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS family_role_id
                 JOIN roles family_role ON family_role.id = family_role_id::integer
                 WHERE family_role.data_scope = 'linked'
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS staff_role_id
                 JOIN roles staff_role ON staff_role.id = staff_role_id::integer
                 WHERE staff_role.data_scope IS DISTINCT FROM 'linked'
               )
             WHERE up.participant_id = $9
               AND (u.id = $11::uuid
                    OR ($11::uuid IS NULL AND lower(u.email) = lower($3::varchar)))
             LIMIT 1
           ))
           RETURNING id`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary || false, is_emergency_contact || false, participant_id, organizationId,
            hasAccountUserId ? account_user_id : null]
        );
        guardianIdToLink = result.rows[0].id;

        // Link guardian to participant
        await client.query(
          `INSERT INTO participant_guardians (guardian_id, participant_id, lien)
           VALUES ($1, $2, $3)
           ON CONFLICT (guardian_id, participant_id) DO UPDATE SET lien = $3`,
          [guardianIdToLink, participant_id, lien || null]
        );
      }

      // Fields a unit added to the parent_guardian form belong to this child's
      // submission, per guardian (form_submissions is keyed by participant).
      // Saved with the guardian, under the same authorization, so a save is
      // never half done.
      // A supplied set replaces this guardian's fields, even when empty (the
      // unit removed them, or they were cleared); an omitted one leaves them.
      // No submission is created just to hold nothing.
      const hasCustomFields = custom_fields !== undefined && custom_fields !== null;
      if (hasCustomFields) {
        const existing = await client.query(
          `SELECT id FROM form_submissions
           WHERE participant_id = $1 AND organization_id = $2 AND form_type = 'parent_guardian'
           ORDER BY id DESC
           LIMIT 1
           FOR UPDATE`,
          [participant_id, organizationId]
        );
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE form_submissions
             SET submission_data = jsonb_set(
                   COALESCE(submission_data, '{}'::jsonb),
                   '{guardians}',
                   COALESCE(submission_data->'guardians', '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb)
                 ),
                 user_id = $3::uuid,
                 updated_at = NOW()
             WHERE id = $4`,
            [String(guardianIdToLink), JSON.stringify(custom_fields), req.user.id, existing.rows[0].id]
          );
        } else if (Object.keys(custom_fields).length > 0) {
          await client.query(
            `INSERT INTO form_submissions
               (participant_id, organization_id, form_type, submission_data, user_id, status, submitted_at)
             VALUES ($1, $2, 'parent_guardian',
                     jsonb_build_object('guardians', jsonb_build_object($3::text, $4::jsonb)),
                     $5::uuid, 'submitted', NOW())`,
            [participant_id, organizationId, String(guardianIdToLink), JSON.stringify(custom_fields), req.user.id]
          );
        }
      }

      await client.query('COMMIT');
      return success(res, { guardian_id: guardianIdToLink }, 'Guardian saved successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      // Contact records are keyed by address.
      if (err.code === '23505') {
        return error(res, 'A parent or guardian with this email already exists', 409);
      }
      return error(res, 'Internal server error', 500);
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/remove-guardian:
   *   delete:
   *     summary: Remove guardian from participant
   *     description: Unlink a guardian from a participant
   *     tags: [Guardians]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: guardian_id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Guardian removed successfully
   *       400:
   *         description: Missing required parameters
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Guardian link not found
   */
  router.delete('/', authenticate, blockDemoRoles, requirePermission('guardians.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id: participantId, guardian_id: guardianId } = req.query;

    if (!participantId || !guardianId) {
      return error(res, 'Participant ID and Guardian ID are required', HTTP_STATUS.BAD_REQUEST);
    }

    if (!isPositiveInteger(participantId) || !isPositiveInteger(guardianId)) {
      return error(res, 'Participant and guardian IDs must be positive integers', HTTP_STATUS.BAD_REQUEST);
    }
    if (!(await mayActOnGuardians(req, participantId, organizationId, 'guardians.manage'))) {
      return refuse(res, 'guardians.manage');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const linkCheck = await client.query(
        `SELECT pg.guardian_id FROM participant_guardians pg
          WHERE pg.guardian_id = $1 AND pg.participant_id = $2
            AND EXISTS (SELECT 1 FROM participant_enrollments pe
                         WHERE pe.participant_id = pg.participant_id AND pe.organization_id = $3)
          FOR UPDATE`,
        [guardianId, participantId, organizationId]
      );
      if (linkCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Guardian link not found in this organization', HTTP_STATUS.NOT_FOUND);
      }
      await client.query(
        `DELETE FROM participant_guardians WHERE guardian_id = $1 AND participant_id = $2`,
        [guardianId, participantId]
      );
      await revokeGuardianAccess(client, { participantId, guardianId });
      const remaining = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM user_participants up
             JOIN user_organizations uo ON uo.user_id = up.user_id AND uo.organization_id = $3
            WHERE up.participant_id = $2 AND up.user_id IN (
              SELECT user_uuid FROM parents_guardians WHERE id = $1
              UNION SELECT user_id FROM guardian_users WHERE guardian_id = $1
            )
         ) AS access_remaining`,
        [guardianId, participantId, organizationId]
      );
      await client.query('COMMIT');
      return success(res, { access_remaining: remaining.rows[0].access_remaining }, 'Guardian removed successfully');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/guardians/form-submission:
   *   post:
   *     summary: Save guardian form submission
   *     tags: [Guardians]
   *     security:
   *       - bearerAuth: []
   */
  router.post('/form-submission', authenticate, blockDemoRoles, requirePermission('guardians.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id, form_type, submission_data } = req.body;

    // This may be a generic form data payload depending on how it's called
    // We provide a generic success response if fields are missing, or proper insert if they are present.
    if (!participant_id || !form_type || !submission_data) {
      return success(res, null, 'Guardian form submission received');
    }

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO form_submissions (participant_id, organization_id, form_type, submission_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (participant_id, form_type)
         DO UPDATE SET submission_data = $4, updated_at = CURRENT_TIMESTAMP`,
        [participant_id, organizationId, form_type, submission_data]
      );
      return success(res, null, 'Guardian form submitted successfully');
    } finally {
      client.release();
    }
  }));

  return router;
};
