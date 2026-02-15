/**
 * Program Progress Routes
 *
 * Records progression in program tables first, then mirrors badge presentation
 * into badge_progress via source_type/source_id.
 */

const express = require('express');
const router = express.Router();

const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const { asyncHandler, success, error: errorResponse } = require('../middleware/response');
const { recordProgression, PROGRAM_TABLE_CONFIG } = require('../services/programProgress');

module.exports = (pool, logger) => {
  /**
   * POST /api/v1/program-progress/award
   *
   * Body:
   * - program_type (required): one of PROGRAM_TABLE_CONFIG keys
   * - participant_id (required)
   * - program_data (required): table-specific payload
   * - badge_data (optional): mirrored insert into badge_progress
   */
  router.post('/award', authenticate, blockDemoRoles, requirePermission('badges.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const programType = req.body.program_type;
    const participantId = parseInt(req.body.participant_id, 10);
    const programData = req.body.program_data || {};
    const badgeData = req.body.badge_data || null;

    if (!programType || !PROGRAM_TABLE_CONFIG[programType]) {
      return errorResponse(res, 'program_type is required and must be supported', 400);
    }

    if (!Number.isInteger(participantId) || participantId <= 0) {
      return errorResponse(res, 'participant_id must be a valid integer', 400);
    }

    if (!programData || typeof programData !== 'object' || Array.isArray(programData)) {
      return errorResponse(res, 'program_data must be an object', 400);
    }

    try {
      const result = await recordProgression({
        pool,
        organizationId,
        programType,
        participantId,
        programData,
        badgeData,
        user: req.user
      });

      return success(res, result, 'Program progression recorded', 201);
    } catch (err) {
      if (err.message === 'Participant not found in organization') {
        return errorResponse(res, err.message, 404);
      }
      if (err.message === 'Unsupported program_type' || err.message === 'No valid program data provided' || err.message === 'Badge template not found') {
        return errorResponse(res, err.message, 400);
      }

      logger.error('Failed to record program progression', {
        organizationId,
        participantId,
        programType,
        error: err.message
      });

      return errorResponse(res, 'Failed to record program progression', 500);
    }
  }));

  return router;
};
