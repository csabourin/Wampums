/**
 * Volunteer space (#1360): a member's own shifts and tasks, and the camps they take part in.
 *
 * Mounted at /api/v1/volunteer-space. Reading takes `volunteer_space.view`; which camps open is
 * decided by taking part (a shift place or a seat on the team), in services/volunteerSpace.js.
 * Read only: places are taken on /volunteer-shifts, tasks changed on /tasks.
 *
 * @module routes/volunteer-space
 */
const express = require('express');
const { authenticate, requirePermission, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { VolunteerSpaceError, readOverview, readCamp, readCampContacts } = require('../services/volunteerSpace');

/** Answer known refusals with their translation key; anything else goes to the global handler. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof VolunteerSpaceError) {
      return error(res, err.message, err.status);
    }
    throw err;
  }
});

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  router.get('/', requirePermission('volunteer_space.view'), handle(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await readOverview(pool, organizationId, req.user.id));
  }));

  router.get('/camps/:activityId', requirePermission('volunteer_space.view'), validateIdParam('activityId'), checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await readCamp(pool, organizationId, req.user.id, Number(req.params.activityId)));
    }));

  router.get('/camps/:activityId/contacts', requirePermission('volunteer_space.view'), validateIdParam('activityId'), checkValidation,
    handle(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await readCampContacts(pool, organizationId, req.user.id, Number(req.params.activityId)));
    }));

  return router;
};
