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
const { splitFullName } = require('../services/accountProvisioning');

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
   * Someone who sees the whole unit needs the permission. Anyone else may act
   * only on a child they have access to: the Parent/Guardian section of their
   * own child's form. The permission alone is not enough for a role limited
   * to its own children, or it would open every family's contacts.
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
    if (holdsPermission && dataScope === 'organization') {
      return true;
    }

    const linked = await pool.query(
      `SELECT 1
       FROM user_participants up
       JOIN participant_organizations po ON po.participant_id = up.participant_id AND po.organization_id = $3
       WHERE up.user_id = $1 AND up.participant_id = $2
       LIMIT 1`,
      [req.user.id, participantId, organizationId]
    );
    return linked.rows.length > 0;
  }

  /**
   * Refuse, naming the permission that would have allowed it.
   *
   * @param {Object} res - Express response
   * @param {string} permissionKey - Permission required
   * @returns {Object} 403 response
   */
  function refuse(res, permissionKey) {
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions',
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
              g.id AS guardian_id, g.nom, g.prenom, g.courriel,
              g.telephone_residence, g.telephone_travail, g.telephone_cellulaire,
              g.is_primary, g.is_emergency_contact
       FROM user_participants up
       JOIN users u ON u.id = up.user_id
       JOIN user_organizations uo
         ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
       LEFT JOIN LATERAL (
         SELECT pg.*
         FROM parents_guardians pg
         WHERE pg.user_uuid = u.id
            OR EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = pg.id AND gu.user_id = u.id)
            OR lower(pg.courriel) = lower(u.email)
         ORDER BY (pg.user_uuid = u.id) DESC NULLS LAST, pg.id
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

    // The people who registered, or were given access to this child, are its
    // parents or guardians too. Those without a contact record linked to the
    // child yet are offered pre-filled from their account, so the form -- and
    // the emergency contacts built from it -- is not empty.
    const linkedIds = new Set(result.rows.map((row) => row.guardian_id));
    const linkedEmails = new Set(result.rows.map((row) => (row.courriel || '').toLowerCase()).filter(Boolean));
    const fromAccounts = (await accountsWithAccess(participant_id, organizationId))
      .filter((account) => !linkedIds.has(account.guardian_id)
        && !linkedEmails.has((account.courriel || account.email || '').toLowerCase()))
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
          courriel: account.courriel || account.email,
          telephone_residence: account.telephone_residence,
          telephone_travail: account.telephone_travail,
          telephone_cellulaire: account.telephone_cellulaire,
          is_primary: account.is_primary,
          is_emergency_contact: account.is_emergency_contact,
          linked: false,
        };
      });

    return success(res, [
      ...result.rows.map((row) => ({ ...row, linked: true })),
      ...fromAccounts,
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
    const { participant_id, guardian_id, nom, prenom, lien, courriel,
      telephone_residence, telephone_travail, telephone_cellulaire,
      is_primary, is_emergency_contact } = req.body;

    if (!participant_id || !nom || !prenom) {
      return error(res, 'Participant ID, nom, and prenom are required', 400);
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

      if (guardian_id) {
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
           WHERE g.id = $1
             AND (g.user_uuid = u.id
                  OR EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = g.id AND gu.user_id = u.id)
                  OR lower(g.courriel) = lower(u.email))
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
        // When the address is that of an account with access to this child,
        // the record is theirs: tie it to the account.
        const result = await client.query(
          `INSERT INTO parents_guardians
           (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary, is_emergency_contact, user_uuid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (
             SELECT u.id
             FROM user_participants up
             JOIN users u ON u.id = up.user_id
             WHERE up.participant_id = $9 AND lower(u.email) = lower($3::varchar)
             LIMIT 1
           ))
           RETURNING id`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary || false, is_emergency_contact || false, participant_id]
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
    const { participant_id, guardian_id } = req.query;

    if (!participant_id || !guardian_id) {
      return error(res, 'Participant ID and Guardian ID are required', 400);
    }

    // Verify the guardian-participant link belongs to this organization
    const linkCheck = await pool.query(
      `SELECT pg.guardian_id FROM participant_guardians pg
       JOIN participants p ON pg.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE pg.guardian_id = $1 AND pg.participant_id = $2 AND po.organization_id = $3`,
      [guardian_id, participant_id, organizationId]
    );

    if (linkCheck.rows.length === 0) {
      return error(res, 'Guardian link not found in this organization', 404);
    }

    await pool.query(
      `DELETE FROM participant_guardians WHERE guardian_id = $1 AND participant_id = $2`,
      [guardian_id, participant_id]
    );

    return success(res, null, 'Guardian removed successfully');
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
