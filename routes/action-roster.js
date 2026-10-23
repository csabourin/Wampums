'use strict';
const express = require('express');
const { authenticate, requireAnyPermission, getOrganizationId } = require('../middleware/auth');
const { validateDate, checkValidation } = require('../middleware/validation');
const { success, asyncHandler } = require('../middleware/response');
const { getActionRoster } = require('../services/actionRoster');

module.exports = (pool) => {
  const router = express.Router();
  router.get('/', authenticate,
    requireAnyPermission('attendance.view', 'points.view', 'honors.view'),
    validateDate('date'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await getActionRoster(pool, organizationId, req.query.date));
    }));
  return router;
};
