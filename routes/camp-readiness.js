/** Read-only team overview; section rights do not follow from the overview right. */
const express = require('express');
const { authenticate, requirePermission, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { success, error, asyncHandler } = require('../middleware/response');
const { campReadiness, campReadinessForActivity, upcomingCamps } = require('../services/campReadiness');
const HTTP_NOT_FOUND = 404;
/** The dashboard names camps under way or starting within two weeks, at most three. */
const UPCOMING_DAYS = 14;
const UPCOMING_LIMIT = 3;
module.exports = (pool) => {
  const router = express.Router();
  router.get('/upcoming', authenticate, requirePermission({ permissions: ['meetings.view'], organizationScope: true }),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await upcomingCamps(pool, organizationId, UPCOMING_DAYS, UPCOMING_LIMIT));
    }));
  /** Section rights come from the shared engine; none follows from the overview right. */
  async function sectionRights(req, organizationId) {
    const keys = ['inventory.view', 'camp_lots.view', 'tasks.view', 'tasks.manage', 'activities.view', 'participants.view', 'groups.view', 'volunteers.view'];
    const grants = await Promise.all(keys.map((key) => userHasPermission(req, pool, organizationId, key)));
    const can = (key) => grants[keys.indexOf(key)];
    return {
      inventory: can('inventory.view'), lots: can('camp_lots.view'),
      tasks: can('tasks.view') && can('tasks.manage'),
      permissions: can('activities.view') && can('participants.view') && can('groups.view'),
      volunteers: can('volunteers.view'),
    };
  }
  router.get('/activities/:id', authenticate, requirePermission({ permissions: ['meetings.view'], organizationScope: true }),
    validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const result = await campReadinessForActivity(pool, organizationId, Number(req.params.id), await sectionRights(req, organizationId));
      return result ? success(res, result) : error(res, 'camp_readiness_not_found', HTTP_NOT_FOUND);
    }));
  router.get('/:id', authenticate, requirePermission({ permissions: ['meetings.view'], organizationScope: true }),
    validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const result = await campReadiness(pool, organizationId, Number(req.params.id), await sectionRights(req, organizationId));
      return result ? success(res, result) : error(res, 'camp_readiness_not_found', HTTP_NOT_FOUND);
    }));
  return router;
};
