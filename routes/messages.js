/**
 * Messages Routes
 *
 * The signed-in member's copies of the push messages sent to them, so a tapped
 * notification opens a page showing the message. A member reads only their
 * own copies, in the unit they are signed in to.
 * All endpoints in this module are prefixed with /api/v1/messages
 *
 * @module routes/messages
 */

const express = require('express');
const { check } = require('express-validator');
const { authenticate, getOrganizationId, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');

const HTTP_NOT_FOUND = 404;
const LIST_LIMIT = 50;

/**
 * @param {Object} pool - Database connection pool
 * @returns {Router} Express router with message routes
 */
module.exports = (pool) => {
  const router = express.Router();

  /**
   * GET /api/v1/messages
   * The member's most recent messages in this unit, newest first.
   */
  router.get('/', authenticate, requirePermission(), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const result = await pool.query(
      `SELECT id, title, body, created_at
         FROM user_messages
        WHERE organization_id = $1 AND user_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [organizationId, req.user.id, LIST_LIMIT]
    );
    return success(res, result.rows);
  }));

  /**
   * GET /api/v1/messages/:id
   * One of the member's messages, with who sent it.
   */
  router.get('/:id', authenticate, requirePermission(),
    check('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const result = await pool.query(
        `SELECT m.id, m.title, m.body, m.created_at,
                NULLIF(u.full_name, '') AS sender_name
           FROM user_messages m
           LEFT JOIN users u ON u.id = m.sent_by
          WHERE m.id = $1 AND m.organization_id = $2 AND m.user_id = $3`,
        [parseInt(req.params.id, 10), organizationId, req.user.id]
      );
      // Someone else's message reads as missing, not as forbidden: its id says
      // nothing about whether it exists.
      if (result.rows.length === 0) {
        return error(res, 'message_not_found', HTTP_NOT_FOUND);
      }
      return success(res, result.rows[0]);
    }));

  return router;
};
