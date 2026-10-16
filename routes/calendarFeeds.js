/**
 * Calendar subscriptions.
 *
 *   GET    /api/v1/calendar-feeds/:token.ics  the feed a calendar app polls (no session)
 *   GET    /api/v1/calendar-feed              whether the signed-in person has a link
 *   POST   /api/v1/calendar-feed              make a link (revokes the previous one)
 *   DELETE /api/v1/calendar-feed              disable the link
 *
 * The link is shown once, when it is made: only its digest is stored
 * (services/calendarFeeds.js). Each fetch re-checks the holder's membership
 * and activities.view, so the feed closes when either goes away.
 */

const express = require('express');
const {
  authenticate,
  authenticateCalendarFeed,
  blockDemoRoles,
  getOrganizationId,
  requirePermission,
} = require('../middleware/auth');
const { success, asyncHandler } = require('../middleware/response');
const { buildActivitiesCalendar } = require('../utils/activityCalendar');
const calendarFeeds = require('../services/calendarFeeds');

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * How long a calendar app or proxy may reuse a fetched feed. Short enough that
 * a revoked link stops serving within minutes.
 */
const FEED_CACHE_SECONDS = 900;

module.exports = (pool, logger) => {
  const router = express.Router();

  router.get(
    '/calendar-feeds/:token',
    authenticateCalendarFeed,
    requirePermission('activities.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { body } = await buildActivitiesCalendar(pool, organizationId, { subscription: true });
      // Seeing that the link is used helps its holder recognise a forgotten one;
      // failing to note it must not cost them their calendar.
      calendarFeeds.recordFeedUse(pool, req.calendarFeed.id).catch((err) => {
        logger.warn('Could not record calendar feed use', { feedId: req.calendarFeed.id, error: err.message });
      });
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', `private, max-age=${FEED_CACHE_SECONDS}`);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.status(HTTP_OK).send(body);
    })
  );

  router.get(
    '/calendar-feed',
    authenticate,
    requirePermission(),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const status = await calendarFeeds.getFeedStatus(pool, { organizationId, userId: req.user.id });
      return success(res, status);
    })
  );

  router.post(
    '/calendar-feed',
    authenticate,
    blockDemoRoles,
    requirePermission('activities.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const feed = await calendarFeeds.createFeed(pool, { organizationId, userId: req.user.id });
      return success(res, feed, 'calendar_feed_created', HTTP_CREATED);
    })
  );

  router.delete(
    '/calendar-feed',
    authenticate,
    blockDemoRoles,
    requirePermission(),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const revoked = await calendarFeeds.revokeFeed(pool, { organizationId, userId: req.user.id });
      return success(res, { revoked }, 'calendar_feed_revoked');
    })
  );

  return router;
};
