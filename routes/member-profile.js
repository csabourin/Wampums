/** Self-only contacts and health forms. No route accepts a target member id. */
const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { MemberProfileError, readOwnProfile, readOwnHealth, saveOwnForm } = require('../services/memberProfile');

module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate, requirePermission());
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = (handler) => asyncHandler(async (req, res) => {
    try { return await handler(req, res); } catch (err) {
      if (!(err instanceof MemberProfileError)) { throw err; }
      return error(res, err.message, err.status, err.field ? [{ path: err.field, location: 'body', msg: err.message }] : undefined);
    }
  });
  router.get('/me', handle(async (req, res) => success(res,
    await readOwnProfile(pool, await getOrganizationId(req, pool), req.user.id))));
  router.put('/me', blockDemoRoles, handle(async (req, res) => success(res,
    await saveOwnForm(pool, await getOrganizationId(req, pool), req.user.id, req.body), 'member_profile_saved')));
  router.get('/me/health', handle(async (req, res) => success(res,
    await readOwnHealth(pool, await getOrganizationId(req, pool), req.user.id))));
  router.put('/me/health', blockDemoRoles, handle(async (req, res) => success(res,
    await saveOwnForm(pool, await getOrganizationId(req, pool), req.user.id, req.body, true), 'member_health_saved')));
  return router;
};
