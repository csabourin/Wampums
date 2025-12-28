/**
 * Authentication Routes
 *
 * Handles user authentication, registration, password reset, and session management
 * All endpoints in this module are prefixed with /api/auth or /public
 *
 * @module routes/auth
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { validationResult } = require('express-validator');

// Import middleware
const { authenticate } = require('../middleware/auth');
const { ROLE_PRIORITY } = require('../config/role-constants');
  const {
    validateEmail,
    validatePassword,
    validateStrongPassword,
    validateNewPassword,
    validateToken,
    validateFullName,
    checkValidation,
    normalizeEmailInput,
    normalizeEmailValue
  } = require('../middleware/validation');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { sendEmail, sendAdminVerificationEmail, getTranslationsByCode, getUserEmailLanguage } = require('../utils/index');
const {
  generate2FACode,
  store2FACode,
  verify2FACode,
  createTrustedDevice,
  verifyTrustedDevice,
  send2FAEmail
} = require('../utils/twoFactor');

const emailTranslations = {
  en: require('../lang/en.json'),
  fr: require('../lang/fr.json'),
  uk: require('../lang/uk.json'),
  it: require('../lang/it.json'),
  id: require('../lang/id.json')
};

function getEmailTranslations(req) {
  const preferredLanguage = (req.headers['accept-language'] || '').split(',')[0]?.slice(0, 2);
  return emailTranslations[preferredLanguage] || emailTranslations.en;
}

/**
 * Normalize requested user type to a supported role
 * @param {string} userType Raw user_type value from the request
 * @returns {string} Canonical role value
 */
function mapRequestedRole(userType) {
  const sanitizedUserType = (userType || 'parent').toLowerCase();
  const animationAliases = ['animation', 'animator', 'animateur'];
  return animationAliases.includes(sanitizedUserType) ? 'animation' : 'parent';
}

// Get JWT key from environment
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 6, // 6 attempts per window (even number so login + 2FA both succeed if user is near limit)
  message: { success: false, message: 'too_many_login_attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

const isProduction = process.env.NODE_ENV === 'production';
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 5 : 100, // 5 attempts per hour in production, 100 in development
  message: { success: false, message: 'too_many_reset_requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with authentication routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /public/login:
   *   post:
   *     summary: User login
   *     description: Authenticate user and return JWT token
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 token:
   *                   type: string
   *                 user_role:
   *                   type: string
   *                 user_full_name:
   *                   type: string
   *                 user_id:
   *                   type: integer
   *       401:
   *         description: Invalid credentials
   *       403:
   *         description: Account not verified
   *       429:
   *         description: Too many attempts
   */
  router.post('/public/login',
    authLimiter,
    validateEmail,
    validatePassword,
    checkValidation,
    async (req, res) => {
      try {
        const organizationId = await getCurrentOrganizationId(req, pool, logger);
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmailValue(email);
        const trimmedPassword = password.trim();

        const userResult = await pool.query(
          `SELECT u.id, u.email, u.password, u.is_verified, u.full_name
           FROM users u
           JOIN user_organizations uo ON u.id = uo.user_id
           WHERE u.email = $1 AND uo.organization_id = $2`,
          [normalizedEmail, organizationId]
        );

        const user = userResult.rows[0];

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'invalid_email_or_password'
          });
        }

        // PHP bcrypt uses $2y$ prefix which Node.js bcrypt doesn't support
        // Convert $2y$ to $2a$ for compatibility with legacy PHP hashes
        let storedHash = user.password;
        if (storedHash && storedHash.startsWith('$2y$')) {
          storedHash = '$2a$' + storedHash.substring(4);
        }
        
        const passwordValid = await bcrypt.compare(trimmedPassword, storedHash);

        if (!passwordValid) {
          return res.status(401).json({
            success: false,
            message: 'invalid_email_or_password'
          });
        }

        if (!user.is_verified) {
          return res.status(403).json({
            success: false,
            message: 'account_not_verified_login'
          });
        }

        // Check if device is trusted (2FA)
        const deviceToken = req.headers['x-device-token'];
        const isTrustedDevice = await verifyTrustedDevice(pool, user.id, organizationId, deviceToken);

        // If device is not trusted, send 2FA code
        if (!isTrustedDevice) {
          const code = generate2FACode();
          const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
          const userAgent = req.headers['user-agent'] || '';

          // Store the code in database
          await store2FACode(pool, user.id, organizationId, code, ipAddress, userAgent);

          // Send email with code
          await send2FAEmail(normalizedEmail, code, user.full_name, organizationId, pool);

          // Return response indicating 2FA is required
          return res.status(200).json({
            success: true,
            requires_2fa: true,
            message: '2fa_code_sent',
            user_id: user.id,
            email: normalizedEmail
          });
        }

        // Device is trusted, proceed with normal login
        // Fetch user's roles and permissions for this organization
        const rolesResult = await pool.query(
          `SELECT DISTINCT r.id as role_id, r.role_name
           FROM user_organizations uo
           CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
           JOIN roles r ON r.id = role_id_text::integer
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [user.id, organizationId]
        );

        const permissionsResult = await pool.query(
          `SELECT DISTINCT p.permission_key
           FROM user_organizations uo
           CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
           JOIN role_permissions rp ON rp.role_id = role_id_text::integer
           JOIN permissions p ON p.id = rp.permission_id
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [user.id, organizationId]
        );

        const roleIds = rolesResult.rows.map(r => r.role_id);
        const roleNames = rolesResult.rows.map(r => r.role_name);
        const permissions = permissionsResult.rows.map(p => p.permission_key);

        // Determine primary role for backward compatibility
        // Priority: district > unitadmin > leader > finance > equipment > administration > parent
        // Use centralized role priority from config
        const rolePriority = ROLE_PRIORITY;
        const primaryRole = rolePriority.find(role => roleNames.includes(role)) || roleNames[0] || 'parent';

        const token = jwt.sign(
          {
            user_id: user.id,
            user_role: primaryRole, // Legacy: primary role for backward compatibility
            roleIds: roleIds,
            roleNames: roleNames,
            permissions: permissions,
            organizationId: organizationId
          },
          jwtKey,
          { expiresIn: '7d' }
        );

        // Check for guardian participants
        const guardianResult = await pool.query(
          `SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name
           FROM parents_guardians pg
           JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
           JOIN participants p ON pgu.participant_id = p.id
           LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
           WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
          [user.id, normalizedEmail]
        );

        const response = {
          success: true,
          message: 'login_successful',
          token: token,
          user_role: primaryRole, // Primary role for backward compatibility
          user_roles: roleNames, // All user roles
          user_permissions: permissions, // All user permissions
          user_full_name: user.full_name,
          user_id: user.id,
          organization_id: organizationId
        };

      if (guardianResult.rows.length > 0) {
        response.guardian_participants = guardianResult.rows;
      }

      res.json(response);
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Login error:', error);
      res.status(500).json({
        success: false,
          message: 'internal_server_error'
        });
      }
    });

  /**
   * @swagger
   * /public/verify-2fa:
   *   post:
   *     summary: Verify 2FA code (public endpoint)
   *     description: Verify the 2FA code sent via email and complete login
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - code
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               code:
   *                 type: string
   *                 description: 6-digit verification code
   *     responses:
   *       200:
   *         description: 2FA verified successfully, returns JWT token
   *       401:
   *         description: Invalid or expired code
   */
  router.post('/public/verify-2fa',
    authLimiter,
    validateEmail,
    checkValidation,
    async (req, res) => {
      try {
        const organizationId = await getCurrentOrganizationId(req, pool, logger);
        const { email, code } = req.body;
        const normalizedEmail = normalizeEmailValue(email);

        if (!code || code.length !== 6) {
          return res.status(400).json({
            success: false,
            message: 'invalid_2fa_code'
          });
        }

        // Fetch user
        const userResult = await pool.query(
          `SELECT u.id, u.email, u.full_name
           FROM users u
           JOIN user_organizations uo ON u.id = uo.user_id
           WHERE u.email = $1 AND uo.organization_id = $2`,
          [normalizedEmail, organizationId]
        );

        const user = userResult.rows[0];

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'invalid_email'
          });
        }

        // Verify the 2FA code
        const isValid = await verify2FACode(pool, user.id, organizationId, code);

        if (!isValid) {
          return res.status(401).json({
            success: false,
            message: 'invalid_or_expired_2fa_code'
          });
        }

        // Create trusted device token
        const userAgent = req.headers['user-agent'] || '';
        const newDeviceToken = await createTrustedDevice(pool, user.id, organizationId, userAgent);

        // Fetch user's roles and permissions for this organization
        const rolesResult = await pool.query(
          `SELECT DISTINCT r.id as role_id, r.role_name
           FROM user_organizations uo
           CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
           JOIN roles r ON r.id = role_id_text::integer
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [user.id, organizationId]
        );

        const permissionsResult = await pool.query(
          `SELECT DISTINCT p.permission_key
           FROM user_organizations uo
           CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
           JOIN role_permissions rp ON rp.role_id = role_id_text::integer
           JOIN permissions p ON p.id = rp.permission_id
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [user.id, organizationId]
        );

        const roleIds = rolesResult.rows.map(r => r.role_id);
        const roleNames = rolesResult.rows.map(r => r.role_name);
        const permissions = permissionsResult.rows.map(p => p.permission_key);

        // Determine primary role for backward compatibility
        // Use centralized role priority from config
        const rolePriority = ROLE_PRIORITY;
        const primaryRole = rolePriority.find(role => roleNames.includes(role)) || roleNames[0] || 'parent';

        const token = jwt.sign(
          {
            user_id: user.id,
            user_role: primaryRole,
            roleIds: roleIds,
            roleNames: roleNames,
            permissions: permissions,
            organizationId: organizationId
          },
          jwtKey,
          { expiresIn: '7d' }
        );

        // Check for guardian participants
        const guardianResult = await pool.query(
          `SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name
           FROM parents_guardians pg
           JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
           JOIN participants p ON pgu.participant_id = p.id
           LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
           WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
          [user.id, normalizedEmail]
        );

        const response = {
          success: true,
          message: 'login_successful',
          token: token,
          device_token: newDeviceToken,  // Return device token for client to store
          user_role: primaryRole,
          user_roles: roleNames,
          user_permissions: permissions,
          user_full_name: user.full_name,
          user_id: user.id,
          organization_id: organizationId
        };

        if (guardianResult.rows.length > 0) {
          response.guardian_participants = guardianResult.rows;
        }

        res.json(response);
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('2FA verification error:', error);
        res.status(500).json({
          success: false,
          message: 'internal_server_error'
        });
      }
    });

  /**
   * @swagger
   * /public/register:
   *   post:
   *     summary: Register new user (public endpoint)
   *     description: Register a new user account (requires admin approval)
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *               - full_name
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *               full_name:
   *                 type: string
   *               user_type:
   *                 type: string
   *                 enum: [parent, animation]
   *                 description: Requested role for the new account (defaults to parent)
   *     responses:
   *       201:
   *         description: User registered successfully
   *       400:
   *         description: Validation error or duplicate email
   */
  router.post('/public/register',
    validateEmail,
    validateStrongPassword,
    validateFullName,
    checkValidation,
      async (req, res) => {
        const client = await pool.connect();
        try {
          const organizationId = await getCurrentOrganizationId(req, pool, logger);
          const { email, password, full_name, user_type } = req.body;
          const normalizedEmail = normalizeEmailValue(email);
          const trimmedPassword = password.trim();
          const role = mapRequestedRole(user_type);

          await client.query('BEGIN');

        // Hash password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // Insert user
        // Parent role users are auto-verified, animation role requires admin approval
        const result = await client.query(
          `INSERT INTO users (email, password, full_name, is_verified)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, full_name, is_verified`,
          [normalizedEmail, hashedPassword, full_name, role === 'parent']
        );

        const userId = result.rows[0].id;

        // Get role ID from roles table
        const roleResult = await client.query(
          `SELECT id FROM roles WHERE role_name = $1`,
          [role]
        );

        if (roleResult.rows.length === 0) {
          throw new Error(`Role '${role}' not found in roles table`);
        }

        const roleId = roleResult.rows[0].id;

        // Link user to organization with the requested role (parent by default)
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role_ids)
           VALUES ($1, $2, $3)`,
          [userId, organizationId, JSON.stringify([roleId])]
        );

        await client.query('COMMIT');

        if (role === 'animation') {
          await sendAdminVerificationEmail(
            pool,
            organizationId,
            full_name,
            normalizedEmail,
            getEmailTranslations(req)
          );
        }

        res.status(201).json({
          success: true,
          data: result.rows[0],
          message: 'registration_successful_await_verification'
        });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        await client.query('ROLLBACK');
        logger.error('Error registering user:', error);

        // Handle duplicate email error (PostgreSQL error code 23505)
        if (error.code === '23505' && error.constraint === 'users_email_key') {
          return res.status(400).json({
            success: false,
            message: 'account_already_exists'
          });
        }

        res.status(500).json({ success: false, message: 'registration_error' });
      } finally {
        client.release();
      }
    });

  /**
   * @swagger
   * /api/auth/register:
   *   post:
   *     summary: Register new user
   *     description: Register a new user account (requires admin approval)
   *     tags: [Authentication]
   *     responses:
   *       201:
   *         description: User registered successfully
   *       400:
   *         description: Validation error
   */
  router.post('/api/auth/register',
    validateEmail,
    validateStrongPassword,
    validateFullName,
    checkValidation,
    async (req, res) => {
        const client = await pool.connect();
        try {
          const organizationId = await getCurrentOrganizationId(req, pool, logger);
          const { email, password, full_name, user_type } = req.body;
          const normalizedEmail = normalizeEmailValue(email);
          const trimmedPassword = password.trim();
          const role = mapRequestedRole(user_type);

        await client.query('BEGIN');

        // Hash password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // Insert user
        // Parent role users are auto-verified, animation role requires admin approval
        const result = await client.query(
          `INSERT INTO users (email, password, full_name, is_verified)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, full_name, is_verified`,
          [normalizedEmail, hashedPassword, full_name, role === 'parent']
        );

        const userId = result.rows[0].id;

        // Get role ID from roles table
        const roleResult = await client.query(
          `SELECT id FROM roles WHERE role_name = $1`,
          [role]
        );

        if (roleResult.rows.length === 0) {
          throw new Error(`Role '${role}' not found in roles table`);
        }

        const roleId = roleResult.rows[0].id;

        // Link user to organization with the requested role (parent by default)
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role_ids)
           VALUES ($1, $2, $3)`,
          [userId, organizationId, JSON.stringify([roleId])]
        );

        await client.query('COMMIT');

        if (role === 'animation') {
          await sendAdminVerificationEmail(
            pool,
            organizationId,
            full_name,
            normalizedEmail,
            getEmailTranslations(req)
          );
        }

        res.status(201).json({
          success: true,
          data: result.rows[0],
          message: 'registration_successful_await_verification'
        });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        await client.query('ROLLBACK');
        logger.error('Error registering user:', error);

        // Handle duplicate email error (PostgreSQL error code 23505)
        if (error.code === '23505' && error.constraint === 'users_email_key') {
          return res.status(400).json({
            success: false,
            message: 'account_already_exists'
          });
        }

        res.status(500).json({ success: false, message: 'registration_error' });
      } finally {
        client.release();
      }
    });

  /**
   * @swagger
   * /api/auth/request-reset:
   *   post:
   *     summary: Request password reset
   *     description: Send password reset token to user's email
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: Reset email sent
   *       429:
   *         description: Too many requests
   */
  router.post('/api/auth/request-reset',
    passwordResetLimiter,
    validateEmail,
      checkValidation,
      async (req, res) => {
        try {
          const { email } = req.body;
          const normalizedEmail = normalizeEmailValue(email);

        logger.info('Password reset request received', {
          email: normalizedEmail,
        });

        // Check if user exists
        const user = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [normalizedEmail]
        );

        // Always return success to prevent email enumeration
        if (user.rows.length === 0) {
          logger.info('Password reset requested for non-existent account', {
            email: normalizedEmail,
          });
          return res.json({
            success: true,
            message: 'reset_link_sent_if_exists'
          });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);

        // Generate a strong reset token and hash it before storage
        const rawResetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawResetToken).digest('hex');

        // Persist reset token securely
        logger.info('Persisting password reset token', {
          userId: user.rows[0].id,
          email: normalizedEmail,
          expiryMinutes: 60,
        });

        // Store reset token in users table
        const tokenUpdate = await pool.query(
          `UPDATE users
           SET reset_token = $1, reset_token_expiry = NOW() + INTERVAL '1 hour'
           WHERE id = $2`,
          [hashedToken, user.rows[0].id]
        );

        if (tokenUpdate.rowCount === 0) {
          logger.error(`Failed to persist reset token for user ID ${user.rows[0].id}`);
          return res.status(500).json({ success: false, message: 'reset_token_not_saved' });
        }

        if (!isProduction) {
          logger.info('Password reset token generated (development)', {
            userId: user.rows[0].id,
            email: normalizedEmail,
          });
        }

        // Get the domain for the reset link
        const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || 'wampums.app';
        const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
        const resetLink = `${baseUrl}/reset-password?token=${rawResetToken}`;

        // Send password reset email with localization
        const preferredLanguage = await getUserEmailLanguage(pool, normalizedEmail, organizationId);
        const translations = getTranslationsByCode(preferredLanguage);
        const fallbackTranslations = getTranslationsByCode('en');

        const subject = translations.password_reset_email_subject || fallbackTranslations.password_reset_email_subject || 'Wampums - Password Reset Request';
        const heading = translations.password_reset_email_heading || fallbackTranslations.password_reset_email_heading || 'Password Reset Request';
        const greeting = translations.password_reset_email_greeting || fallbackTranslations.password_reset_email_greeting || 'Hello,';
        const intro = translations.password_reset_email_intro || fallbackTranslations.password_reset_email_intro || 'You have requested to reset your password.';
        const buttonLabel = translations.password_reset_email_button || fallbackTranslations.password_reset_email_button || 'Reset Password';
        const copyHint = translations.password_reset_email_copy_hint || fallbackTranslations.password_reset_email_copy_hint || 'Or copy this link:';
        const expiry = translations.password_reset_email_expiry || fallbackTranslations.password_reset_email_expiry || 'This link will expire in 1 hour.';
        const ignore = translations.password_reset_email_ignore || fallbackTranslations.password_reset_email_ignore || "If you did not request this reset, please ignore this email.";

        const message = [
          greeting,
          "",
          intro,
          "",
          resetLink,
          "",
          expiry,
          "",
          ignore
        ].join('\n');

        const html = `
          <h2>${heading}</h2>
          <p>${intro}</p>
          <p><a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${buttonLabel}</a></p>
          <p>${copyHint} <a href="${resetLink}">${resetLink}</a></p>
          <p><em>${expiry}</em></p>
          <p>${ignore}</p>
        `;

        const emailSent = await sendEmail(normalizedEmail, subject, message, html);

        if (!emailSent) {
          logger.error('Failed to send password reset email', { email: normalizedEmail });
        } else {
          logger.info('Password reset email dispatched', { email: normalizedEmail });
        }

        res.json({
          success: true,
          message: 'reset_link_sent_if_exists',
          // In development, return token for testing
          ...(process.env.NODE_ENV !== 'production' && { resetToken: rawResetToken })
        });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        logger.error('Error requesting password reset:', error);
        res.status(500).json({ success: false, message: error.message });
      }
    });

  /**
   * @swagger
   * /api/auth/reset-password:
   *   post:
   *     summary: Reset password
   *     description: Reset user password with valid token
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: Password reset successful
   *       400:
   *         description: Invalid or expired token
   */
  router.post('/api/auth/reset-password',
    passwordResetLimiter,
    validateToken,
    validateNewPassword,
    checkValidation,
    async (req, res) => {
      try {
        const { token, new_password } = req.body;
        const trimmedPassword = new_password.trim();

        logger.info('Password reset submission received');

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // Check if token exists in database and is not expired
        const tokenResult = await pool.query(
          `SELECT id FROM users
           WHERE reset_token = $1 AND reset_token_expiry > NOW()`,
          [hashedToken]
        );

        if (tokenResult.rows.length === 0) {
          logger.warn('Invalid or expired password reset token');
          return res.status(400).json({ success: false, message: 'invalid_or_expired_token' });
        }

        const userId = tokenResult.rows[0].id;

        // Hash new password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // Update password and clear reset token
        await pool.query(
          'UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2',
          [hashedPassword, userId]
        );

        logger.info('Password reset completed', { userId });

        res.json({
          success: true,
          message: 'password_reset_successful'
        });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        logger.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: error.message });
      }
    });

  /**
   * @swagger
   * /api/auth/verify-session:
   *   post:
   *     summary: Verify JWT session
   *     description: Verify that a JWT token is valid and return user info
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Session valid
   *       401:
   *         description: Invalid session
   */
  router.post('/api/auth/verify-session', authenticate, async (req, res) => {
    try {
      // If authenticate middleware passed, session is valid
      res.json({
        success: true,
        user: {
          id: req.user.id,
          role: req.user.role,
          organizationId: req.user.organizationId
        },
        message: 'Session valid'
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error verifying session:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/auth/logout:
   *   post:
   *     summary: Logout user
   *     description: Clear user session (client-side token should be removed)
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: Logout successful
   */
  router.post('/api/auth/logout', (req, res) => {
    // JWT is stateless, so logout is handled client-side
    // This endpoint exists for consistency and potential future server-side session handling
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });

  return router;
};
