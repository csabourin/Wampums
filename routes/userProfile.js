/**
 * User Profile Management Routes
 *
 * Handles user profile operations: viewing and updating personal information
 * All endpoints in this module are prefixed with /api/v1/users/me
 *
 * @module routes/userProfile
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

// Import middleware
const { authenticate, blockDemoRoles } = require('../middleware/auth');
const { success, error: errorResponse, asyncHandler } = require('../middleware/response');
const {
  validateEmail,
  validateFullName,
  validatePassword,
  checkValidation,
  normalizeEmailInput,
  validateCurrentPassword,
  validateNewPasswordForChange
} = require('../middleware/validation');
const { RATE_LIMITS } = require('../config/constants');

// Rate limiter for password change - prevent brute force
const isProduction = process.env.NODE_ENV === 'production';
const passwordChangeLimiter = rateLimit({
  windowMs: RATE_LIMITS.PROFILE_UPDATE_WINDOW_MS,
  max: isProduction ? RATE_LIMITS.PROFILE_UPDATE_MAX_PROD : RATE_LIMITS.PROFILE_UPDATE_MAX_DEV,
  message: { success: false, message: 'Too many password change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for email change - moderate protection
const emailChangeLimiter = rateLimit({
  windowMs: RATE_LIMITS.EMAIL_CHANGE_WINDOW_MS,
  max: isProduction ? RATE_LIMITS.EMAIL_CHANGE_MAX_PROD : RATE_LIMITS.EMAIL_CHANGE_MAX_DEV,
  message: { success: false, message: 'Too many email change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Retrieve participant IDs linked to a user within an organization
 * @param {Object} pool - Database connection pool
 * @param {string} userId - Authenticated user's UUID
 * @param {number} organizationId - Organization scope
 * @returns {Promise<number[]>} Array of participant IDs
 */
async function getLinkedParticipantIds(pool, userId, organizationId) {
  const participantResult = await pool.query(
    `SELECT up.participant_id
     FROM user_participants up
     JOIN participant_organizations po ON up.participant_id = po.participant_id
     WHERE up.user_id = $1 AND po.organization_id = $2`,
    [userId, organizationId]
  );

  return participantResult.rows.map((row) => row.participant_id);
}

/**
 * Validate guardian phone inputs to avoid unsafe values
 * Allows digits, spaces, parentheses, periods, dashes, and plus signs
 * @param {string|undefined|null} value - Raw phone input
 * @returns {{isValid: boolean, sanitized: string|null}} Validation result
 */
function validateGuardianPhone(value) {
  if (value === undefined || value === null || value === '') {
    return { isValid: true, sanitized: null };
  }

  const trimmed = String(value).trim();
  const phonePattern = /^[0-9+().\-\s]{0,20}$/;

  return {
    isValid: phonePattern.test(trimmed),
    sanitized: trimmed || null,
  };
}

/**
 * Sanitize generic text input to prevent HTML injection
 * @param {string|undefined|null} value - Raw text input
 * @returns {string} Sanitized text
 */
function sanitizeTextInput(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/[<>]/g, '').trim();
}

/**
 * Build guardian profile payload for the authenticated user
 * Prefers guardians linked by email or explicit user_uuid mapping; falls back to the first guardian on any linked participant
 * @param {Object} pool - Database connection pool
 * @param {string} userId - Authenticated user's UUID
 * @param {number} organizationId - Organization scope
 * @returns {Promise<{guardian: Object|null, participantIds: number[], userEmail: string|null}>}
 */
async function buildGuardianProfile(pool, userId, organizationId) {
  const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);

  if (userResult.rows.length === 0) {
    return { guardian: null, participantIds: [], userEmail: null };
  }

  const userEmail = userResult.rows[0].email;
  const participantIds = await getLinkedParticipantIds(pool, userId, organizationId);

  if (participantIds.length === 0) {
    return { guardian: null, participantIds, userEmail };
  }

  const guardianResult = await pool.query(
    `SELECT g.id, g.nom, g.prenom, g.courriel, g.telephone_residence, g.telephone_travail,
            g.telephone_cellulaire, g.is_primary, g.is_emergency_contact, COALESCE(pg.lien, g.old_lien) AS lien
     FROM parents_guardians g
     JOIN participant_guardians pg ON pg.guardian_id = g.id
     JOIN participants p ON pg.participant_id = p.id
     WHERE pg.participant_id = ANY($1::int[])
       AND (LOWER(g.courriel) = LOWER($2) OR g.user_uuid = $3::uuid)
     ORDER BY g.is_primary DESC NULLS LAST, g.id ASC
     LIMIT 1`,
    [participantIds, userEmail, userId]
  );

  if (guardianResult.rows.length > 0) {
    return { guardian: guardianResult.rows[0], participantIds, userEmail };
  }

  const fallbackGuardian = await pool.query(
    `SELECT g.id, g.nom, g.prenom, g.courriel, g.telephone_residence, g.telephone_travail,
            g.telephone_cellulaire, g.is_primary, g.is_emergency_contact, COALESCE(pg.lien, g.old_lien) AS lien
     FROM parents_guardians g
     JOIN participant_guardians pg ON pg.guardian_id = g.id
     JOIN participants p ON pg.participant_id = p.id
     WHERE pg.participant_id = ANY($1::int[])
     ORDER BY g.is_primary DESC NULLS LAST, g.id ASC
     LIMIT 1`,
    [participantIds]
  );

  return {
    guardian: fallbackGuardian.rows[0] || null,
    participantIds,
    userEmail,
  };
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with user profile routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/v1/users/me:
   *   get:
   *     summary: Get current user information
   *     description: Retrieve authenticated user's profile information
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User information retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                     full_name:
   *                       type: string
   *                     email:
   *                       type: string
   *                     role:
   *                       type: string
   *                     language_preference:
   *                       type: string
   *       401:
   *         description: Unauthorized
   */
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.language_preference, u.whatsapp_phone_number,
              jsonb_agg(DISTINCT r.role_name) as roles
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
       LEFT JOIN roles r ON r.id = role_id_text::integer
       WHERE u.id = $1 AND uo.organization_id = $2
       GROUP BY u.id, u.full_name, u.email, u.language_preference, u.whatsapp_phone_number`,
      [userId, organizationId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'User not found', 404);
    }

    return success(res, result.rows[0], 'User information retrieved successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/me/guardian-profile:
   *   get:
   *     summary: Get guardian profile for authenticated parent user
   *     description: Retrieve guardian contact information tied to the authenticated user's linked participants
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Guardian profile retrieved successfully
   *       400:
   *         description: No linked participants found
   *       401:
   *         description: Unauthorized
   */
  router.get('/guardian-profile', authenticate, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    const profile = await buildGuardianProfile(pool, userId, organizationId);

    if (!profile.userEmail) {
      return errorResponse(res, 'User not found', 404);
    }

    if (profile.participantIds.length === 0) {
      return errorResponse(res, 'No linked participants found for guardian profile', 400);
    }

    return success(res, profile, 'Guardian profile retrieved successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/me/name:
   *   patch:
   *     summary: Update user's full name
   *     description: Update the authenticated user's full name
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fullName
   *             properties:
   *               fullName:
   *                 type: string
   *                 minLength: 2
   *                 maxLength: 100
   *     responses:
   *       200:
   *         description: Name updated successfully
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   */
  router.patch('/name',
    authenticate,
    blockDemoRoles,
    [validateFullName],
    checkValidation,
    asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = req.user.organizationId;
      const { fullName } = req.body;

      // Verify user belongs to organization
      const userCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return errorResponse(res, 'User not found', 404);
      }

      // Update full name
      const result = await pool.query(
        `UPDATE users
         SET full_name = $1
         WHERE id = $2
         RETURNING id, full_name, email`,
        [fullName.trim(), userId]
      );

      logger.info(`User ${userId} updated their name`);

      return success(res, result.rows[0], 'Name updated successfully');
    })
  );

  /**
   * @swagger
   * /api/v1/users/me/language-preference:
   *   patch:
   *     summary: Update user's language preference
   *     description: Update the authenticated user's preferred language for email communications
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - languagePreference
   *             properties:
   *               languagePreference:
   *                 type: string
   *                 enum: [en, fr, uk, it]
   *     responses:
   *       200:
   *         description: Language preference updated successfully
   *       400:
   *         description: Invalid language code
   *       401:
   *         description: Unauthorized
   */
  router.patch('/language-preference',
    authenticate,
    asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = req.user.organizationId;
      const { languagePreference } = req.body;

      // Supported languages
      const supportedLanguages = ['en', 'fr', 'uk', 'it'];

      // Validate language code
      if (!languagePreference) {
        return errorResponse(res, 'Language preference is required', 400);
      }

      if (!supportedLanguages.includes(languagePreference)) {
        return errorResponse(res, `Invalid language code. Supported languages: ${supportedLanguages.join(', ')}`, 400);
      }

      // Verify user belongs to organization
      const userCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return errorResponse(res, 'User not found', 404);
      }

      // Update language preference
      const result = await pool.query(
        `UPDATE users
         SET language_preference = $1
         WHERE id = $2
         RETURNING id, full_name, email, language_preference`,
        [languagePreference, userId]
      );

      logger.info(`User ${userId} updated their language preference to ${languagePreference}`);

      return success(res, result.rows[0], 'Language preference updated successfully');
    })
  );

  /**
   * @swagger
   * /api/v1/users/me/whatsapp-phone:
   *   patch:
   *     summary: Update user's WhatsApp phone number
   *     description: Update the authenticated user's WhatsApp phone number for receiving notifications
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               whatsappPhoneNumber:
   *                 type: string
   *                 description: Phone number in E.164 format (e.g., +1234567890). Set to null or empty string to remove.
   *                 example: "+15551234567"
   *     responses:
   *       200:
   *         description: WhatsApp phone number updated successfully
   *       400:
   *         description: Invalid phone number format
   *       401:
   *         description: Unauthorized
   */
  router.patch('/whatsapp-phone',
    authenticate,
    blockDemoRoles,
    asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const { whatsappPhoneNumber } = req.body;

      // Get organization ID from headers or JWT token
      const { getOrganizationId } = require('../middleware/auth');
      let organizationId;
      try {
        organizationId = await getOrganizationId(req, pool);
      } catch (error) {
        logger.warn(`Could not determine organization ID for user ${userId}:`, error.message);
        organizationId = null;
      }

      // Verify user belongs to organization (if organization ID is available)
      if (organizationId) {
        const userCheck = await pool.query(
          `SELECT u.id FROM users u
           JOIN user_organizations uo ON u.id = uo.user_id
           WHERE u.id = $1 AND uo.organization_id = $2`,
          [userId, organizationId]
        );

        if (userCheck.rows.length === 0) {
          return errorResponse(res, 'User not found in this organization', 404);
        }
      }

      // Validate phone number format (E.164 format: +[country code][number])
      // Allow null or empty string to remove the phone number
      let phoneNumber = null;
      if (whatsappPhoneNumber && whatsappPhoneNumber.trim() !== '') {
        const trimmedPhone = whatsappPhoneNumber.trim();

        // Basic E.164 validation: starts with +, followed by 7-15 digits
        const e164Regex = /^\+[1-9]\d{6,14}$/;

        if (!e164Regex.test(trimmedPhone)) {
          return errorResponse(res,
            'Invalid phone number format. Please use E.164 format (e.g., +1234567890)',
            400
          );
        }

        phoneNumber = trimmedPhone;
      }

      // Update WhatsApp phone number
      const result = await pool.query(
        `UPDATE users
         SET whatsapp_phone_number = $1
         WHERE id = $2
         RETURNING id, full_name, email, whatsapp_phone_number`,
        [phoneNumber, userId]
      );

      logger.info(`User ${userId} updated their WhatsApp phone number`);

      const message = phoneNumber
        ? 'WhatsApp phone number updated successfully'
        : 'WhatsApp phone number removed successfully';

      return success(res, result.rows[0], message);
    })
  );

  /**
   * @swagger
   * /api/v1/users/me/guardian-profile:
   *   patch:
   *     summary: Update guardian contact info for authenticated user
   *     description: Create or update the guardian record associated with the authenticated user's linked participants
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - firstName
   *               - lastName
   *             properties:
   *               firstName:
   *                 type: string
   *               lastName:
   *                 type: string
   *               relationship:
   *                 type: string
   *                 description: Guardian relationship to participant (e.g., parent, guardian)
   *               homePhone:
   *                 type: string
   *               workPhone:
   *                 type: string
   *               mobilePhone:
   *                 type: string
   *               primaryContact:
   *                 type: boolean
   *               emergencyContact:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Guardian profile updated successfully
   *       400:
   *         description: Validation error or missing participant links
   *       401:
   *         description: Unauthorized
   */
  router.patch('/guardian-profile', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    const {
      firstName,
      lastName,
      relationship,
      homePhone,
      workPhone,
      mobilePhone,
      primaryContact,
      emergencyContact,
    } = req.body;

    const trimmedFirstName = sanitizeTextInput(firstName);
    const trimmedLastName = sanitizeTextInput(lastName);
    const relationshipValue = sanitizeTextInput(relationship);
    const trimmedRelationship = relationshipValue ? relationshipValue.slice(0, 120) : null;

    if (!trimmedFirstName || !trimmedLastName) {
      return errorResponse(res, 'First and last name are required to update guardian info', 400);
    }

    if (trimmedFirstName.length > 120 || trimmedLastName.length > 120) {
      return errorResponse(res, 'Names must be 120 characters or fewer', 400);
    }

    const homeValidation = validateGuardianPhone(homePhone);
    const workValidation = validateGuardianPhone(workPhone);
    const mobileValidation = validateGuardianPhone(mobilePhone);

    if (!homeValidation.isValid || !workValidation.isValid || !mobileValidation.isValid) {
      return errorResponse(res, 'Please provide phone numbers using digits, spaces, plus, dash, parentheses, or periods only', 400);
    }

    const participantIds = await getLinkedParticipantIds(pool, userId, organizationId);

    if (participantIds.length === 0) {
      return errorResponse(res, 'No linked participants found for guardian profile', 400);
    }

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return errorResponse(res, 'User not found', 404);
    }

    const userEmail = userResult.rows[0].email;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const guardianLookup = await client.query(
        `SELECT DISTINCT g.id
         FROM parents_guardians g
         JOIN participant_guardians pg ON pg.guardian_id = g.id
         JOIN participants p ON pg.participant_id = p.id
         WHERE pg.participant_id = ANY($1::int[])
           AND (LOWER(g.courriel) = LOWER($2) OR g.user_uuid = $3::uuid)`,
        [participantIds, userEmail, userId]
      );

      let guardianIds = guardianLookup.rows.map((row) => row.id);

      if (guardianIds.length === 0) {
        const insertGuardian = await client.query(
          `INSERT INTO parents_guardians
           (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire, is_primary, is_emergency_contact, user_uuid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            trimmedFirstName,
            trimmedLastName,
            userEmail,
            homeValidation.sanitized,
            workValidation.sanitized,
            mobileValidation.sanitized,
            Boolean(primaryContact),
            Boolean(emergencyContact),
            userId,
          ]
        );

        guardianIds = [insertGuardian.rows[0].id];
      } else {
        await client.query(
          `UPDATE parents_guardians
           SET nom = $1,
               prenom = $2,
               courriel = $3,
               telephone_residence = $4,
               telephone_travail = $5,
               telephone_cellulaire = $6,
               is_primary = $7,
               is_emergency_contact = $8,
               user_uuid = $9
           WHERE id = ANY($10::int[])`,
          [
            trimmedFirstName,
            trimmedLastName,
            userEmail,
            homeValidation.sanitized,
            workValidation.sanitized,
            mobileValidation.sanitized,
            Boolean(primaryContact),
            Boolean(emergencyContact),
            userId,
            guardianIds,
          ]
        );
      }

      // Batch insert all guardian-participant relationships
      const values = [];
      const params = [trimmedRelationship];
      let paramIndex = 2;
      
      for (const guardianId of guardianIds) {
        for (const participantId of participantIds) {
          values.push(`($${paramIndex}, $${paramIndex + 1}, $1)`);
          params.push(guardianId, participantId);
          paramIndex += 2;
        }
      }
      
      if (values.length > 0) {
        await client.query(
          `INSERT INTO participant_guardians (guardian_id, participant_id, lien)
           VALUES ${values.join(', ')}
           ON CONFLICT (guardian_id, participant_id)
           DO UPDATE SET lien = EXCLUDED.lien`,
          params
        );
      }

      await client.query('COMMIT');

      const updatedProfile = await buildGuardianProfile(pool, userId, organizationId);

      return success(res, updatedProfile, 'Guardian profile updated successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating guardian profile:', error);
      return errorResponse(res, 'Failed to update guardian profile', 500);
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/users/me/email:
   *   patch:
   *     summary: Update user's email address
   *     description: Update the authenticated user's email. This will invalidate the current JWT token and require re-login.
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *     responses:
   *       200:
   *         description: Email updated successfully. User must log in again.
   *       400:
   *         description: Validation error or email already exists
   *       401:
   *         description: Unauthorized
   */
  router.patch('/email',
    authenticate,
    blockDemoRoles,
    emailChangeLimiter,
    [normalizeEmailInput, validateEmail],
    checkValidation,
    asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = req.user.organizationId;
      const { email } = req.body;

      // Verify user belongs to organization
      const userCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return errorResponse(res, 'User not found', 404);
      }

      // Check if email already exists for another user in this organization
      const emailCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE LOWER(u.email) = LOWER($1) 
         AND uo.organization_id = $2 
         AND u.id != $3`,
        [email, organizationId, userId]
      );

      if (emailCheck.rows.length > 0) {
        return errorResponse(res, 'Email address already in use by another user in this organization', 400);
      }

      // Update email
      await pool.query(
        `UPDATE users
         SET email = $1
         WHERE id = $2`,
        [email.toLowerCase(), userId]
      );

      logger.info(`User ${userId} updated their email to ${email}`);

      // Note: JWT token will be invalidated on client side after this response
      return success(res, null, 'Email updated successfully. Please log in again with your new email address.');
    })
  );

  /**
   * @swagger
   * /api/v1/users/me/password:
   *   patch:
   *     summary: Change user's password
   *     description: Change the authenticated user's password. Requires current password verification.
   *     tags: [User Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - currentPassword
   *               - newPassword
   *             properties:
   *               currentPassword:
   *                 type: string
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *     responses:
   *       200:
   *         description: Password changed successfully
   *       400:
   *         description: Validation error or incorrect current password
   *       401:
   *         description: Unauthorized
   */
  router.patch('/password',
    authenticate,
    blockDemoRoles,
    passwordChangeLimiter,
    [validateCurrentPassword, validateNewPasswordForChange],
    checkValidation,
    asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = req.user.organizationId;
      const { currentPassword, newPassword } = req.body;

      // Validate required fields
      if (!currentPassword || !newPassword) {
        return errorResponse(res, 'Current password and new password are required', 400);
      }

      // Verify user belongs to organization and get current password hash
      const userResult = await pool.query(
        `SELECT u.id, u.password FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      if (userResult.rows.length === 0) {
        return errorResponse(res, 'User not found', 404);
      }

      const user = userResult.rows[0];

      // Verify current password
      const passwordMatch = await bcrypt.compare(currentPassword, user.password);
      if (!passwordMatch) {
        logger.warn(`Failed password change attempt for user ${userId} - incorrect current password`);
        return errorResponse(res, 'Current password is incorrect', 400);
      }

      // Hash new password
      const saltRounds = 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await pool.query(
        `UPDATE users
         SET password = $1
         WHERE id = $2`,
        [newPasswordHash, userId]
      );

      logger.info(`User ${userId} changed their password`);

      return success(res, null, 'Password changed successfully');
    })
  );

  return router;
};
