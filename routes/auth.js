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

// Get JWT key from environment
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: 'Too many password reset requests, please try again after an hour.',
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
            message: 'Invalid email or password'
          });
        }

        // Convert PHP $2y$ bcrypt hash to Node.js compatible $2a$ format
        const nodeCompatibleHash = user.password.replace(/^\$2y\$/, '$2a$');
        const passwordValid = await bcrypt.compare(password, nodeCompatibleHash);

        if (!passwordValid) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
          });
        }

        if (!user.is_verified) {
          return res.status(403).json({
            success: false,
            message: 'Your account is not yet verified. Please wait for admin verification.'
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
          message: 'Internal server error'
        });
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
  router.post('/register',
    validateEmail,
    validateStrongPassword,
    validateFullName,
    checkValidation,
    async (req, res) => {
      try {
        const { email, password, full_name } = req.body;

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const result = await pool.query(
          `INSERT INTO users (email, password, full_name, is_verified)
           VALUES ($1, $2, $3, FALSE)
           RETURNING id, email, full_name, is_verified`,
          [email, hashedPassword, full_name]
        );

        res.status(201).json({
          success: true,
          data: result.rows[0],
          message: 'User registered successfully. Please wait for admin approval.'
        });
      } catch (error) {
        logger.error('Error registering user:', error);
        res.status(500).json({ success: false, message: error.message });
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
  router.post('/request-reset',
    passwordResetLimiter,
    validateEmail,
    checkValidation,
    async (req, res) => {
      try {
        const { email } = req.body;

        // Check if user exists
        const user = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [email]
        );

        // Always return success to prevent email enumeration
        if (user.rows.length === 0) {
          return res.json({
            success: true,
            message: 'If a user with that email exists, a reset link has been sent'
          });
        }

        // Generate reset token (valid for 1 hour)
        const resetToken = jwt.sign(
          { user_id: user.rows[0].id, purpose: 'password_reset' },
          jwtKey,
          { expiresIn: '1h' }
        );

        // Store reset token in database
        await pool.query(
          `INSERT INTO password_reset_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '1 hour')
           ON CONFLICT (user_id)
           DO UPDATE SET token = $2, expires_at = NOW() + INTERVAL '1 hour', created_at = NOW()`,
          [user.rows[0].id, resetToken]
        );

        // TODO: Send email with reset link
        res.json({
          success: true,
          message: 'If a user with that email exists, a reset link has been sent',
          // In development, return token (remove in production)
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
  router.post('/reset-password',
    passwordResetLimiter,
    validateToken,
    validateNewPassword,
    checkValidation,
    async (req, res) => {
      try {
        const { token, new_password } = req.body;

        // Verify token
        let decoded;
        try {
          decoded = jwt.verify(token, jwtKey);
          if (decoded.purpose !== 'password_reset') {
            throw new Error('Invalid token purpose');
          }
        } catch (err) {
          return res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }

        // Check if token exists in database and is not expired
        const tokenResult = await pool.query(
          `SELECT user_id FROM password_reset_tokens
           WHERE user_id = $1 AND token = $2 AND expires_at > NOW()`,
          [decoded.user_id, token]
        );

        if (tokenResult.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update password
        await pool.query(
          'UPDATE users SET password = $1 WHERE id = $2',
          [hashedPassword, decoded.user_id]
        );

        // Delete used reset token
        await pool.query(
          'DELETE FROM password_reset_tokens WHERE user_id = $1',
          [decoded.user_id]
        );

        res.json({
          success: true,
          message: 'Password reset successful'
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
  router.post('/verify-session', authenticate, async (req, res) => {
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
  router.post('/logout', (req, res) => {
    // JWT is stateless, so logout is handled client-side
    // This endpoint exists for consistency and potential future server-side session handling
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });

  return router;
};
