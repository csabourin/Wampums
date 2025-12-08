/**
 * Form Routes
 *
 * Handles form submissions, form structures, risk acceptance, and health forms
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/forms
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with form routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/form-submission:
   *   get:
   *     summary: Get form submission for a participant
   *     description: Retrieve the most recent form submission for a specific participant and form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Form submission retrieved successfully
   *       400:
   *         description: Missing required parameters
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Access denied
   */
  router.get('/form-submission', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { participant_id, form_type } = req.query;

      if (!participant_id || !form_type) {
        return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
      }

      // Role-based access control
      const userRole = decoded.role || decoded.user_role;

      // Verify access to this participant
      if (userRole !== 'admin' && userRole !== 'animation') {
        // For parents, check if they have access to this participant
        const accessCheck = await pool.query(
          `SELECT 1 FROM user_participants
           WHERE user_id = $1 AND participant_id = $2`,
          [decoded.user_id, participant_id]
        );

        if (accessCheck.rows.length === 0) {
          return res.status(403).json({ success: false, message: 'Access denied to this participant' });
        }
      }

      // Get form submission with participant basic information
      const result = await pool.query(
        `SELECT fs.*,
                p.first_name, p.last_name, p.date_naissance
         FROM form_submissions fs
         JOIN participants p ON fs.participant_id = p.id
         WHERE fs.participant_id = $1 AND fs.organization_id = $2 AND fs.form_type = $3
         ORDER BY fs.updated_at DESC
         LIMIT 1`,
        [participant_id, organizationId, form_type]
      );

      if (result.rows.length > 0) {
        const submission = result.rows[0];
        // Merge submission_data with participant basic info for frontend compatibility
        const formData = {
          ...submission.submission_data,
          first_name: submission.first_name,
          last_name: submission.last_name,
          date_naissance: submission.date_naissance || submission.date_of_birth,
          participant_id: submission.participant_id
        };

        res.json({
          success: true,
          data: submission,
          form_data: formData // Add form_data for frontend compatibility
        });
      } else {
        // No submission found, but return participant basic info for new forms
        const participantResult = await pool.query(
          `SELECT first_name, last_name, date_naissance, id
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE p.id = $1 AND po.organization_id = $2`,
          [participant_id, organizationId]
        );

        if (participantResult.rows.length > 0) {
          const participant = participantResult.rows[0];
          const formData = {
            first_name: participant.first_name,
            last_name: participant.last_name,
            date_naissance: participant.date_naissance,
            participant_id: participant.id
          };

          res.json({
            success: true,
            data: null,
            form_data: formData,
            message: 'No submission found, returning participant basic info'
          });
        } else {
          res.json({ success: true, data: null, form_data: {}, message: 'No submission or participant found' });
        }
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form submission:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/save-form-submission:
   *   post:
   *     summary: Save form submission
   *     description: Create or update a form submission for a participant
   *     tags: [Forms]
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
   *               - form_type
   *               - submission_data
   *             properties:
   *               participant_id:
   *                 type: integer
   *               form_type:
   *                 type: string
   *               submission_data:
   *                 type: object
   *     responses:
   *       200:
   *         description: Form saved successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  router.post('/save-form-submission', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { participant_id, form_type, submission_data } = req.body;

      if (!participant_id || !form_type || !submission_data) {
        return res.status(400).json({ success: false, message: 'Participant ID, form_type, and submission_data are required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Check if a submission already exists
        const existingResult = await client.query(
          `SELECT id FROM form_submissions
           WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3`,
          [participant_id, organizationId, form_type]
        );

        let result;
        if (existingResult.rows.length > 0) {
          // Update existing submission
          result = await client.query(
            `UPDATE form_submissions
             SET submission_data = $1, updated_at = NOW(), user_id = $2
             WHERE participant_id = $3 AND organization_id = $4 AND form_type = $5
             RETURNING *`,
            [JSON.stringify(submission_data), decoded.user_id, participant_id, organizationId, form_type]
          );
        } else {
          // Insert new submission
          result = await client.query(
            `INSERT INTO form_submissions
             (participant_id, organization_id, form_type, submission_data, user_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [participant_id, organizationId, form_type, JSON.stringify(submission_data), decoded.user_id]
          );
        }

        await client.query('COMMIT');
        console.log(`[form] Form ${form_type} saved for participant ${participant_id}`);
        res.json({ success: true, data: result.rows[0], message: 'Form saved successfully' });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving form submission:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/organization-form-formats:
   *   get:
   *     summary: Get organization form formats
   *     description: Retrieve all form formats configured for the organization
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Form formats retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/organization-form-formats', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const result = await pool.query(
        `SELECT * FROM organization_form_formats
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Transform the data into an object keyed by form_type for easier lookup
      const formatsObject = {};
      result.rows.forEach(row => {
        formatsObject[row.form_type] = {
          ...row,
          form_structure: typeof row.form_structure === 'string'
            ? JSON.parse(row.form_structure)
            : row.form_structure
        };
      });

      res.json({ success: true, data: formatsObject });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form formats:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/form-types:
   *   get:
   *     summary: Get available form types
   *     description: Retrieve list of public form types available for the organization
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of form types
   *       401:
   *         description: Unauthorized
   */
  router.get('/form-types', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        "SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public' ORDER BY form_type",
        [organizationId]
      );

      res.json({
        success: true,
        data: result.rows.map(row => row.form_type)
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form types:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/form-structure:
   *   get:
   *     summary: Get form structure for a specific form type
   *     description: Retrieve the structure/schema for a specific form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Form structure
   *       400:
   *         description: Form type is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Form structure not found
   */
  router.get('/form-structure', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type } = req.query;

      if (!form_type) {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        "SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
        [form_type, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Form structure not found' });
      }

      res.json({
        success: true,
        data: JSON.parse(result.rows[0].form_structure)
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form structure:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/form-submissions-list:
   *   get:
   *     summary: Get form submissions for a specific form type
   *     description: Retrieve all submissions or a specific participant's submission for a form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Form submissions
   *       400:
   *         description: Form type is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: No submission data found
   */
  router.get('/form-submissions-list', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type, participant_id } = req.query;

      if (!form_type) {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      if (participant_id) {
        const result = await pool.query(
          "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
          [participant_id, form_type, organizationId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'No submission data found' });
        }

        const submissionData = result.rows[0].submission_data;
        res.json({
          success: true,
          data: typeof submissionData === 'string' ? JSON.parse(submissionData) : submissionData
        });
      } else {
        const result = await pool.query(
          `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
           FROM form_submissions fs
           JOIN participant_organizations po ON fs.participant_id = po.participant_id
           JOIN participants p ON fs.participant_id = p.id
           WHERE po.organization_id = $1 AND fs.form_type = $2
           ORDER BY p.first_name, p.last_name`,
          [organizationId, form_type]
        );

        res.json({
          success: true,
          data: result.rows.map(row => ({
            participant_id: row.participant_id,
            first_name: row.first_name,
            last_name: row.last_name,
            submission_data: typeof row.submission_data === 'string'
              ? JSON.parse(row.submission_data)
              : row.submission_data
          }))
        });
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form submissions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/form-submissions:
   *   get:
   *     summary: Get form submissions (alias endpoint)
   *     description: Alias endpoint for backwards compatibility with frontend
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Form submissions
   *       400:
   *         description: Form type is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/form-submissions', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type, participant_id } = req.query;

      if (!form_type) {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      if (participant_id) {
        const result = await pool.query(
          "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
          [participant_id, form_type, organizationId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'No submission data found' });
        }

        const submissionData = result.rows[0].submission_data;
        res.json({
          success: true,
          data: typeof submissionData === 'string' ? JSON.parse(submissionData) : submissionData
        });
      } else {
        const result = await pool.query(
          `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
           FROM form_submissions fs
           JOIN participant_organizations po ON fs.participant_id = po.participant_id
           JOIN participants p ON fs.participant_id = p.id
           WHERE po.organization_id = $1 AND fs.form_type = $2
           ORDER BY p.first_name, p.last_name`,
          [organizationId, form_type]
        );

        res.json({
          success: true,
          data: result.rows.map(row => ({
            participant_id: row.participant_id,
            first_name: row.first_name,
            last_name: row.last_name,
            submission_data: typeof row.submission_data === 'string'
              ? JSON.parse(row.submission_data)
              : row.submission_data
          }))
        });
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form submissions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/risk-acceptance:
   *   get:
   *     summary: Get risk acceptance for a participant
   *     description: Retrieve risk acceptance/waiver information for a participant
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Risk acceptance data
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Risk acceptance not found
   */
  router.get('/risk-acceptance', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { participant_id } = req.query;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT * FROM acceptation_risque WHERE participant_id = $1`,
        [participant_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Risk acceptance not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching risk acceptance:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/risk-acceptance:
   *   post:
   *     summary: Save risk acceptance for a participant
   *     description: Create or update risk acceptance/waiver for a participant
   *     tags: [Forms]
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
   *             properties:
   *               participant_id:
   *                 type: integer
   *               groupe_district:
   *                 type: string
   *               accepte_risques:
   *                 type: boolean
   *               accepte_covid19:
   *                 type: boolean
   *               participation_volontaire:
   *                 type: boolean
   *               declaration_sante:
   *                 type: boolean
   *               declaration_voyage:
   *                 type: boolean
   *               nom_parent_tuteur:
   *                 type: string
   *               date_signature:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Risk acceptance saved
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.post('/risk-acceptance', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const {
        participant_id,
        groupe_district,
        accepte_risques,
        accepte_covid19,
        participation_volontaire,
        declaration_sante,
        declaration_voyage,
        nom_parent_tuteur,
        date_signature
      } = req.body;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `INSERT INTO acceptation_risque
         (participant_id, groupe_district, accepte_risques, accepte_covid19,
          participation_volontaire, declaration_sante, declaration_voyage,
          nom_parent_tuteur, date_signature)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (participant_id)
         DO UPDATE SET
           groupe_district = EXCLUDED.groupe_district,
           accepte_risques = EXCLUDED.accepte_risques,
           accepte_covid19 = EXCLUDED.accepte_covid19,
           participation_volontaire = EXCLUDED.participation_volontaire,
           declaration_sante = EXCLUDED.declaration_sante,
           declaration_voyage = EXCLUDED.declaration_voyage,
           nom_parent_tuteur = EXCLUDED.nom_parent_tuteur,
           date_signature = EXCLUDED.date_signature
         RETURNING *`,
        [participant_id, groupe_district, accepte_risques, accepte_covid19,
         participation_volontaire, declaration_sante, declaration_voyage,
         nom_parent_tuteur, date_signature]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving risk acceptance:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/health-forms:
   *   post:
   *     summary: Save health form for a participant
   *     description: Create or update health form information for a participant
   *     tags: [Forms]
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
   *             properties:
   *               participant_id:
   *                 type: integer
   *               nom_fille_mere:
   *                 type: string
   *               medecin_famille:
   *                 type: string
   *               nom_medecin:
   *                 type: string
   *               probleme_sante:
   *                 type: string
   *               allergie:
   *                 type: string
   *               epipen:
   *                 type: boolean
   *               medicament:
   *                 type: string
   *               limitation:
   *                 type: string
   *               vaccins_a_jour:
   *                 type: boolean
   *               blessures_operations:
   *                 type: string
   *               niveau_natation:
   *                 type: string
   *               doit_porter_vfi:
   *                 type: boolean
   *               regles:
   *                 type: string
   *               renseignee:
   *                 type: string
   *     responses:
   *       200:
   *         description: Health form saved successfully
   *       400:
   *         description: Missing participant_id
   *       401:
   *         description: Unauthorized
   */
  router.post('/health-forms', async (req, res) => {
    const client = await pool.connect();

    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const {
        participant_id,
        nom_fille_mere,
        medecin_famille,
        nom_medecin,
        probleme_sante,
        allergie,
        epipen,
        medicament,
        limitation,
        vaccins_a_jour,
        blessures_operations,
        niveau_natation,
        doit_porter_vfi,
        regles,
        renseignee
      } = req.body;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Missing participant_id' });
      }

      await client.query('BEGIN');

      // Check if health form already exists
      const checkResult = await client.query(
        'SELECT id FROM fiche_sante WHERE participant_id = $1',
        [participant_id]
      );

      const exists = checkResult.rows.length > 0;

      if (exists) {
        // Update existing record
        await client.query(
          `UPDATE fiche_sante SET
            nom_fille_mere = $1,
            medecin_famille = $2,
            nom_medecin = $3,
            probleme_sante = $4,
            allergie = $5,
            epipen = $6,
            medicament = $7,
            limitation = $8,
            vaccins_a_jour = $9,
            blessures_operations = $10,
            niveau_natation = $11,
            doit_porter_vfi = $12,
            regles = $13,
            renseignee = $14,
            updated_at = NOW()
           WHERE participant_id = $15`,
          [
            nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
            allergie, epipen, medicament, limitation, vaccins_a_jour,
            blessures_operations, niveau_natation, doit_porter_vfi,
            regles, renseignee, participant_id
          ]
        );
      } else {
        // Insert new record
        await client.query(
          `INSERT INTO fiche_sante
           (nom_fille_mere, medecin_famille, nom_medecin, probleme_sante, allergie,
            epipen, medicament, limitation, vaccins_a_jour, blessures_operations,
            niveau_natation, doit_porter_vfi, regles, renseignee, participant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
            allergie, epipen, medicament, limitation, vaccins_a_jour,
            blessures_operations, niveau_natation, doit_porter_vfi,
            regles, renseignee, participant_id
          ]
        );
      }

      await client.query('COMMIT');

      res.json({ success: true, message: 'Health form saved successfully' });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      await client.query('ROLLBACK');
      logger.error('Error saving health form:', error);
      res.status(500).json({ success: false, message: 'Error saving health form: ' + error.message });
    } finally {
      client.release();
    }
  });

  return router;
};
