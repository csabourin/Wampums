/** Read-only team overview; section rights do not follow from the overview right. */
const express = require('express');
const { authenticate, requirePermission, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { success, error, asyncHandler } = require('../middleware/response');
const { campReadiness } = require('../services/campReadiness');
const HTTP_NOT_FOUND = 404;
module.exports = (pool) => {
  const router = express.Router();
  router.get('/:id', authenticate, requirePermission({ permissions: ['meetings.view'], organizationScope: true }),
    validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const keys = ['inventory.view', 'camp_lots.view', 'tasks.view', 'tasks.manage', 'activities.view', 'participants.view', 'groups.view'];
      const grants = await Promise.all(keys.map((key) => userHasPermission(req, pool, organizationId, key)));
      const can = (key) => grants[keys.indexOf(key)];
      const result = await campReadiness(pool, organizationId, Number(req.params.id), {
        inventory: can('inventory.view'), lots: can('camp_lots.view'),
        tasks: can('tasks.view') && can('tasks.manage'),
        permissions: can('activities.view') && can('participants.view') && can('groups.view'),
      });
      return result ? success(res, result) : error(res, 'camp_readiness_not_found', HTTP_NOT_FOUND);
    }));
  return router;
};
