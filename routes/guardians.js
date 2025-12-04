/**
 * Guardian Routes
 *
 * Handles parent/guardian management for participants
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/guardians
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with guardian routes
 */
module.exports = (pool, logger) => {
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
  router.get('/guardians', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      // Verify participant belongs to this organization
      const participantCheck = await pool.query(
        `SELECT id FROM participants WHERE id = $1 AND organization_id = $2`,
        [participantId, organizationId]
      );

      if (participantCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Participant not found in this organization' });
      }

      const result = await pool.query(
        `SELECT pg.*, pg.lien as relationship, g.id, g.nom, g.prenom, g.courriel,
                g.telephone_residence, g.telephone_travail, g.telephone_cellulaire,
                g.is_primary, g.is_emergency_contact
         FROM participant_guardians pg
         JOIN parents_guardians g ON pg.guardian_id = g.id
         JOIN participants p ON pg.participant_id = p.id
         WHERE pg.participant_id = $1 AND p.organization_id = $2`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching guardians:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/save-guardian', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { participant_id, guardian_id, nom, prenom, lien, courriel,
              telephone_residence, telephone_travail, telephone_cellulaire,
              is_primary, is_emergency_contact } = req.body;

      if (!participant_id || !nom || !prenom) {
        return res.status(400).json({ success: false, message: 'Participant ID, nom, and prenom are required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify participant belongs to this organization
        const participantCheck = await client.query(
          `SELECT id FROM participants WHERE id = $1 AND organization_id = $2`,
          [participant_id, organizationId]
        );

        if (participantCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Participant not found in this organization' });
        }

        let guardianIdToLink;

        if (guardian_id) {
          // Verify the guardian is linked to a participant in this organization
          const guardianCheck = await client.query(
            `SELECT pg.guardian_id FROM participant_guardians pg
             JOIN participants p ON pg.participant_id = p.id
             WHERE pg.guardian_id = $1 AND p.organization_id = $2`,
            [guardian_id, organizationId]
          );

          if (guardianCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, message: 'Guardian not found in this organization' });
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
        console.log(`[guardian] Guardian ${guardianIdToLink} saved for participant ${participant_id}`);
        res.json({ success: true, data: { guardian_id: guardianIdToLink }, message: 'Guardian saved successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error saving guardian:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.delete('/remove-guardian', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { participant_id, guardian_id } = req.query;

      if (!participant_id || !guardian_id) {
        return res.status(400).json({ success: false, message: 'Participant ID and Guardian ID are required' });
      }

      // Verify the guardian-participant link belongs to this organization
      const linkCheck = await pool.query(
        `SELECT pg.guardian_id FROM participant_guardians pg
         JOIN participants p ON pg.participant_id = p.id
         WHERE pg.guardian_id = $1 AND pg.participant_id = $2 AND p.organization_id = $3`,
        [guardian_id, participant_id, organizationId]
      );

      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Guardian link not found in this organization' });
      }

      await pool.query(
        `DELETE FROM participant_guardians WHERE guardian_id = $1 AND participant_id = $2`,
        [guardian_id, participant_id]
      );

      console.log(`[guardian] Guardian ${guardian_id} removed from participant ${participant_id}`);
      res.json({ success: true, message: 'Guardian removed successfully' });
    } catch (error) {
      logger.error('Error removing guardian:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
