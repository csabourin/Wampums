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
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

// Import middleware
const { authenticate } = require('../middleware/auth');
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

// Rate limiter for password change - prevent brute force
const isProduction = process.env.NODE_ENV === 'production';
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 100, // 5 attempts per 15 minutes in production
  message: { success: false, message: 'Too many password change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for email change - moderate protection
const emailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 10 : 100, // 10 attempts per 15 minutes in production
  message: { success: false, message: 'Too many email change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
   *       401:
   *         description: Unauthorized
   */
  router.get('/v1/users/me', authenticate, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, uo.role
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.id = $1 AND uo.organization_id = $2`,
      [userId, organizationId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'User not found', 404);
    }

    return success(res, result.rows[0], 'User information retrieved successfully');
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
  router.patch('/v1/users/me/name',
    authenticate,
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
  router.patch('/v1/users/me/email',
    authenticate,
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
  router.patch('/v1/users/me/password',
    authenticate,
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
