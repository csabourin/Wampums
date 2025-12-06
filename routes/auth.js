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
const {
  validateEmail,
  validatePassword,
  validateStrongPassword,
  validateNewPassword,
  validateToken,
  validateFullName,
  checkValidation
} = require('../middleware/validation');

// Import utilities
const { getCurrentOrganizationId, verifyJWT } = require('../utils/api-helpers');
const { sendEmail, sendAdminVerificationEmail } = require('../utils/index');

const emailTranslations = {
  en: require('../lang/en.json'),
  fr: require('../lang/fr.json')
};

function getEmailTranslations(req) {
  const preferredLanguage = (req.headers['accept-language'] || '').split(',')[0]?.slice(0, 2);
  return emailTranslations[preferredLanguage] || emailTranslations.en;
}

// Get JWT key from environment
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'too_many_login_attempts',
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
        const normalizedEmail = email.toLowerCase();
        const trimmedPassword = password.trim();

        const userResult = await pool.query(
          `SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
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

        const token = jwt.sign(
          {
            user_id: user.id,
            user_role: user.role,
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
          user_role: user.role,
          user_full_name: user.full_name,
          user_id: user.id
        };

        if (guardianResult.rows.length > 0) {
          response.guardian_participants = guardianResult.rows;
        }

        res.json(response);
      } catch (error) {
        logger.error('Login error:', error);
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
        const normalizedEmail = email.toLowerCase();
        const trimmedPassword = password.trim();
        const sanitizedUserType = (user_type || 'parent').toLowerCase();
        const role = sanitizedUserType === 'animation' ? 'animation' : 'parent';

        await client.query('BEGIN');

        // Hash password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // Insert user
        const result = await client.query(
          `INSERT INTO users (email, password, full_name, is_verified)
           VALUES ($1, $2, $3, FALSE)
           RETURNING id, email, full_name, is_verified`,
          [normalizedEmail, hashedPassword, full_name]
        );

        const userId = result.rows[0].id;

        // Link user to organization with the requested role (parent by default)
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role)
           VALUES ($1, $2, $3)`,
          [userId, organizationId, role]
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
        const normalizedEmail = email.toLowerCase();
        const trimmedPassword = password.trim();
        const sanitizedUserType = (user_type || 'parent').toLowerCase();
        const role = sanitizedUserType === 'animation' ? 'animation' : 'parent';

        await client.query('BEGIN');

        // Hash password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // Insert user
        const result = await client.query(
          `INSERT INTO users (email, password, full_name, is_verified)
           VALUES ($1, $2, $3, FALSE)
           RETURNING id, email, full_name, is_verified`,
          [normalizedEmail, hashedPassword, full_name]
        );

        const userId = result.rows[0].id;

        // Link user to organization with the requested role (parent by default)
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role)
           VALUES ($1, $2, $3)`,
          [userId, organizationId, role]
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
        const normalizedEmail = email.toLowerCase();

        // Check if user exists
        const user = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [normalizedEmail]
        );

        // Always return success to prevent email enumeration
        if (user.rows.length === 0) {
          return res.json({
            success: true,
            message: 'reset_link_sent_if_exists'
          });
        }

        // Generate a short random reset token (32 hex chars = 64 chars max)
        const resetToken = crypto.randomBytes(16).toString('hex');

        // Store reset token in users table
        await pool.query(
          `UPDATE users 
           SET reset_token = $1, reset_token_expiry = NOW() + INTERVAL '1 hour'
           WHERE id = $2`,
          [resetToken, user.rows[0].id]
        );

        // Get the domain for the reset link
        const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || 'wampums.app';
        const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
        const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

        // Send password reset email
        const subject = 'Wampums - Password Reset Request';
        const message = `You have requested to reset your password.\n\nClick the following link to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request this reset, please ignore this email.`;
        const html = `
          <h2>Password Reset Request</h2>
          <p>You have requested to reset your password.</p>
          <p><a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
          <p><em>This link will expire in 1 hour.</em></p>
          <p>If you did not request this reset, please ignore this email.</p>
        `;

        const emailSent = await sendEmail(email, subject, message, html);
        
        if (!emailSent) {
          logger.error('Failed to send password reset email to:', email);
        }

        res.json({
          success: true,
          message: 'reset_link_sent_if_exists',
          // In development, return token for testing
          ...(process.env.NODE_ENV !== 'production' && { resetToken })
        });
      } catch (error) {
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

        // Check if token exists in database and is not expired
        const tokenResult = await pool.query(
          `SELECT id FROM users
           WHERE reset_token = $1 AND reset_token_expiry > NOW()`,
          [token]
        );

        if (tokenResult.rows.length === 0) {
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

        res.json({
          success: true,
          message: 'password_reset_successful'
        });
      } catch (error) {
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
