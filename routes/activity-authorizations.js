const express = require('express');
const { body } = require('express-validator');
const { authenticate, blockDemoRoles, requirePermission, requireAnyPermission, getOrganizationId } = require('../middleware/auth');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { success, error, asyncHandler } = require('../middleware/response');
const { readInvitation } = require('../services/activityInvitations');
const HTTP_BAD_REQUEST = 400;
const flow = require('../services/activityAuthorizations');

/** Activity-specific preparation, persistent results and targeted retries. */
module.exports = (pool) => {
  const router = express.Router();
  router.post('/preview', authenticate, requireAnyPermission('activities.create', 'activities.edit'), asyncHandler(async (req, res) => {
    const invitation = readInvitation(req.body, { isCreate: true });
    if (invitation.problem) {return error(res, 'invalid_request', HTTP_BAD_REQUEST);}
    return success(res, await flow.preview(pool, await getOrganizationId(req, pool), {
      invites_everyone: invitation.invitesEveryone, invited_participant_ids: invitation.participantIds,
    }));
  }));
  router.get('/:id', authenticate, requirePermission('activities.edit'), validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
    try {
      return success(res, await flow.summary(pool, await getOrganizationId(req, pool), Number(req.params.id)));
    } catch (err) {
      if (err instanceof flow.AuthorizationFlowError) {return error(res, err.message, err.status);}
      throw err;
    }
  }));
  router.post('/:id', authenticate, blockDemoRoles, requirePermission('activities.edit', 'communications.send'),
    validateIdParam('id'), body('deadline_date').optional({ nullable: true, values: 'falsy' }).isISO8601({ strict: true }), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = Number(req.params.id);
      try {
        await flow.prepare(pool, organizationId, activityId, req.body.deadline_date);
        return success(res, await flow.dispatch(pool, organizationId, activityId));
      } catch (err) {
        if (err instanceof flow.AuthorizationFlowError) {return error(res, err.message, err.status);}
        throw err;
      }
    }));
  return router;
};
