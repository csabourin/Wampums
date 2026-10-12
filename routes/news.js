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
const { success, error, paginated, asyncHandler } = require('../middleware/response');
const { checkValidation, validateIdParam } = require('../middleware/validation');

const HTTP_NOT_FOUND = 404;
const PAGE_SIZE = 50;
const MAX_PAGE = 100000;

/**
 * @param {Object} pool - Database connection pool
 * @returns {Router} Express router with news routes
 */
module.exports = (pool) => {
  const router = express.Router();

  /**
   * One page of the unit's news, newest first.
   *
   * @param {boolean} archived - List the archived items instead of the active ones
   * @returns {Function} Express handler
   */
  const listNews = (archived) => asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const page = Number(req.query.page) || 1;
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT id, title, content, link, created_at, expires, archived_at
           FROM news
          WHERE organization_id = $1 AND (archived_at IS NOT NULL) = $2
          ORDER BY created_at DESC, id DESC
          LIMIT $3 OFFSET $4`,
        [organizationId, archived, PAGE_SIZE, (page - 1) * PAGE_SIZE],
      ),
      pool.query(
        'SELECT COUNT(*)::int AS total FROM news WHERE organization_id = $1 AND (archived_at IS NOT NULL) = $2',
        [organizationId, archived],
      ),
    ]);
    return paginated(res, rows.rows, page, PAGE_SIZE, count.rows[0]?.total || 0);
  });

  const pageValidation = [
    check('page').optional().isInt({ min: 1, max: MAX_PAGE }).withMessage('page must be a positive integer'),
    checkValidation,
  ];

  /**
   * GET /api/v1/news?page=
   * The unit's active news, newest first.
   */
  router.get('/', authenticate, requirePermission(), pageValidation, listNews(false));

  /**
   * GET /api/v1/news/archived?page=
   * The unit's archived news, newest first.
   */
  router.get('/archived', authenticate, requirePermission('communications.send'), pageValidation, listNews(true));

  /**
   * PATCH /api/v1/news/:newsId/archive
   * Archive a news item (`archived: true`) or restore it (`archived: false`).
   */
  router.patch(
    '/:newsId/archive',
    authenticate, blockDemoRoles, requirePermission('communications.send'),
    validateIdParam('newsId'),
    [check('archived').isIn(['true', 'false']).withMessage('archived must be a boolean')],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const archived = String(req.body.archived) === 'true';
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
