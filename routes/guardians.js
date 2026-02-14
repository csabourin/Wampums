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
const { authenticate, getOrganizationId, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

/**
 * Export route factory function
 * Allows dependency injection of pool
 *
 * @param {Object} pool - Database connection pool
 * @returns {Router} Express router with guardian routes
 */
module.exports = (pool) => {
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
  router.get('/', authenticate, requirePermission('guardians.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id } = req.query;

    if (!participant_id) {
      return error(res, 'Participant ID is required', 400);
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

    return success(res, result.rows);
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
  router.post('/', authenticate, requirePermission('guardians.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { participant_id, guardian_id, nom, prenom, lien, courriel,
      telephone_residence, telephone_travail, telephone_cellulaire,
      is_primary, is_emergency_contact } = req.body;

    if (!participant_id || !nom || !prenom) {
      return error(res, 'Participant ID, nom, and prenom are required', 400);
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
        // Verify the guardian is linked to a participant in this organization
        const guardianCheck = await client.query(
          `SELECT pg.guardian_id FROM participant_guardians pg
           JOIN participants p ON pg.participant_id = p.id
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE pg.guardian_id = $1 AND po.organization_id = $2`,
          [guardian_id, organizationId]
        );

        if (guardianCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Guardian not found in this organization', 403);
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

        // Update the relationship if provided
        if (lien) {
          await client.query(
            `UPDATE participant_guardians SET lien = $1 WHERE guardian_id = $2 AND participant_id = $3`,
            [lien, guardian_id, participant_id]
          );
        }
      } else {
        // Insert new guardian
        const result = await client.query(
          `INSERT INTO parents_guardians
           (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary, is_emergency_contact)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary || false, is_emergency_contact || false]
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
      throw err;
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
  router.delete('/', authenticate, requirePermission('guardians.manage'), asyncHandler(async (req, res) => {
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

  return router;
};
