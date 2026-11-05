/**
 * Camp lists (#1319): the youth taking part in a planned camp and its team.
 *
 * Mounted at /api/v1/camp-rosters. Reading takes `meetings.view` and
 * `participants.view` with a unit-wide data scope, since the lists name
 * youth; naming the team, and reading a member's birth date, takes
 * `meetings.manage`, as planning the camp does. Volunteers' names go only to
 * holders of `volunteers.manage` (devdocs/VOLUNTEERS.md). Team members'
 * certifications go to holders of either `meetings.manage` or
 * `volunteers.manage`; the gaps they cause are shown to every reader.
 *
 * @module routes/camp-rosters
 */
const express = require('express');
const { param } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const {
  CampRosterError, readCampRoster, listTeamCandidates, saveTeamMember, removeTeamMember, saveCampActivities,
} = require('../services/campRoster');

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CampRosterError) {
      const fields = err.field ? [{ path: err.field, location: 'body', msg: err.message }] : undefined;
      return error(res, err.message, err.status, fields);
    }
    throw err;
  }
});

const READ = { permissions: ['meetings.view', 'participants.view'], organizationScope: true };
const MANAGE = { permissions: ['meetings.manage'], organizationScope: true };
const userIdParam = param('userId').isUUID().withMessage('camp_roster_member_not_found');

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  router.get('/:meetingId',
    requirePermission(READ),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const [canManage, canSeeVolunteers] = await Promise.all([
        userHasPermission(req, pool, organizationId, 'meetings.manage'),
        userHasPermission(req, pool, organizationId, 'volunteers.manage'),
      ]);
      const canSeeCertifications = canManage || canSeeVolunteers;
      return success(res, await readCampRoster(pool, organizationId, Number(req.params.meetingId),
        { canManage, canSeeVolunteers, canSeeCertifications }));
    }));

  // What the camp plans that changes its lists: today, whether it plans swimming.
  router.patch('/:meetingId',
    blockDemoRoles,
    requirePermission(MANAGE),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveCampActivities(pool, organizationId, Number(req.params.meetingId), req.body),
        'camp_roster_activities_saved');
    }));

  router.get('/:meetingId/team-candidates',
    requirePermission(MANAGE),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listTeamCandidates(pool, organizationId));
    }));

  router.put('/:meetingId/team/:userId',
    blockDemoRoles,
    requirePermission(MANAGE),
    validateIdParam('meetingId'),
    userIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const team = await saveTeamMember(pool, organizationId, req.user.id,
        Number(req.params.meetingId), req.params.userId, req.body);
      return success(res, { team }, 'camp_roster_team_saved');
    }));

  router.delete('/:meetingId/team/:userId',
    blockDemoRoles,
    requirePermission(MANAGE),
    validateIdParam('meetingId'),
    userIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const team = await removeTeamMember(pool, organizationId, Number(req.params.meetingId), req.params.userId);
      return success(res, { team }, 'camp_roster_team_removed');
    }));

  return router;
};
