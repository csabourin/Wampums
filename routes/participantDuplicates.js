'use strict';

/**
 * Administrator review of children who may be recorded twice.
 *
 * Pairs arrive here from family linking and from parents registering children
 * (services/duplicateCandidates). This is where someone who knows the family
 * says whether the two records are one child. Deciding "same person" does not
 * merge them; it marks the pair for a deliberate merge.
 *
 * @module routes/participantDuplicates
 */

const express = require('express');
const { body, param, query } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');
const {
  DUPLICATE_DECISION,
  listDuplicateCandidates,
  resolveDuplicateCandidate,
} = require('../services/duplicateCandidates');

/** Longest an administrator's note on a decision may be. */
const MAX_NOTE_LENGTH = 1000;

module.exports = (pool) => {
  const router = express.Router();

  /**
   * Pairs awaiting a decision in this unit, or every pair with `?all=true`.
   */
  router.get('/',
    authenticate,
    requirePermission('participants.edit'),
    query('all').optional().isBoolean(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const candidates = await listDuplicateCandidates(pool, organizationId, {
        includeResolved: req.query.all === 'true',
      });
      return success(res, candidates);
    })
  );

  /**
   * Decide whether a pair is one child (`same_person`) or two (`different`).
   */
  router.post('/:id/resolve',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.edit'),
    param('id').isInt({ min: 1 }),
    body('decision').isIn(Object.values(DUPLICATE_DECISION)),
    body('note').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NOTE_LENGTH }),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resolved = await resolveDuplicateCandidate(pool, {
        organizationId,
        candidateId: parseInt(req.params.id, 10),
        decision: req.body.decision,
        note: req.body.note || null,
        resolvedBy: req.user.id,
      });

      if (!resolved) {
        return error(res, 'No pending duplicate with this id in this organization', 404);
      }
      return success(res, resolved, 'Decision recorded');
    })
  );

  return router;
};
