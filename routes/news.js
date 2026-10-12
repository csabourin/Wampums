/**
 * News Routes
 *
 * The unit's news, as the "Messages and news" screen lists it. Any member of
 * the unit may read the active items; archiving, restoring and reading the
 * archive take `communications.send`. The signed-out feed stays in
 * routes/public.js and leaves archived items out.
 * All endpoints in this module are prefixed with /api/v1/news
 *
 * @module routes/news
 */

const express = require('express');
const { check } = require('express-validator');
const { authenticate, blockDemoRoles, getOrganizationId, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation, validateIdParam } = require('../middleware/validation');

const HTTP_NOT_FOUND = 404;
const LIST_LIMIT = 50;

/**
 * @param {Object} pool - Database connection pool
 * @returns {Router} Express router with news routes
 */
module.exports = (pool) => {
  const router = express.Router();

  /**
   * GET /api/v1/news
   * The unit's active news, newest first.
   */
  router.get('/', authenticate, requirePermission(), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const result = await pool.query(
      `SELECT id, title, content, link, created_at, expires, archived_at
         FROM news
        WHERE organization_id = $1 AND archived_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [organizationId, LIST_LIMIT],
    );
    return success(res, result.rows);
  }));

  /**
   * GET /api/v1/news/archived
   * The unit's archived news, newest first.
   */
  router.get('/archived', authenticate, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const result = await pool.query(
      `SELECT id, title, content, link, created_at, expires, archived_at
         FROM news
        WHERE organization_id = $1 AND archived_at IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [organizationId, LIST_LIMIT],
    );
    return success(res, result.rows);
  }));

  /**
   * PATCH /api/v1/news/:newsId/archive
   * Archive a news item (`archived: true`) or restore it (`archived: false`).
   */
  router.patch(
    '/:newsId/archive',
    authenticate, blockDemoRoles, requirePermission('communications.send'),
    validateIdParam('newsId'),
    [check('archived').isBoolean().withMessage('archived must be a boolean')],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const archived = req.body.archived === true || req.body.archived === 'true';
      const result = await pool.query(
        `UPDATE news
            SET archived_at = CASE WHEN $1::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END
          WHERE id = $2 AND organization_id = $3
        RETURNING id, archived_at`,
        [archived, Number(req.params.newsId), organizationId],
      );
      if (result.rows.length === 0) {
        return error(res, 'news_not_found', HTTP_NOT_FOUND);
      }
      return success(res, result.rows[0], archived ? 'news_archived' : 'news_restored');
    }),
  );

  return router;
};
