/**
 * Transfer Routes
 *
 * Moving a participant to a sister unit. The endpoints deliberately mirror the
 * year transition's shape — list, preview, execute — because a transfer has the
 * same property: it is easy to trigger, hard to reverse, and the person running
 * it should see what it will do before it does it.
 *
 * Authorisation is `participants.transfer`, which already existed and is held by
 * district, unit admin and leader. The destination is bounded to the origin's
 * local group, so the permission cannot reach an unrelated tenant.
 *
 * @module routes/transfers
 */

const express = require('express');
const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const {
  listSiblingOrganizations,
  areSiblings,
  previewTransfer,
  transferParticipant
} = require('../services/transfer');

/** Why a transfer was refused, and the status that says so. */
const BLOCKED_STATUS = {
  same_organization: 400,
  not_a_sibling_unit: 403,
  not_enrolled: 404,
  target_has_no_active_year: 409
};

module.exports = (pool, logger) => {
  const router = express.Router();

  /**
   * Parse and validate the destination from a request body.
   *
   * @param {Object} body - Request body
   * @returns {number|null} Destination organization ID, or null when unusable
   */
  function readTargetOrganizationId(body) {
    const value = parseInt(body?.target_organization_id, 10);
    return Number.isInteger(value) ? value : null;
  }

  /**
   * Units this organization may transfer to.
   */
  router.get('/destinations',
    authenticate,
    requirePermission('participants.transfer'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const siblings = await listSiblingOrganizations(pool, organizationId);
      return success(res, siblings);
    })
  );

  /**
   * What a transfer would do. Reads only.
   */
  router.post('/preview',
    authenticate,
    requirePermission('participants.transfer'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = parseInt(req.body?.participant_id, 10);
      const targetOrganizationId = readTargetOrganizationId(req.body);

      if (!Number.isInteger(participantId) || targetOrganizationId === null) {
        return error(res, 'participant_id and target_organization_id are required', 400);
      }

      const preview = await previewTransfer(pool, {
        participantId,
        organizationId,
        targetOrganizationId
      });

      if (preview.blocked) {
        return error(res, preview.blocked, BLOCKED_STATUS[preview.blocked] || 400);
      }

      return success(res, preview);
    })
  );

  /**
   * Carry out the transfer.
   */
  router.post('/',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.transfer'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = parseInt(req.body?.participant_id, 10);
      const targetOrganizationId = readTargetOrganizationId(req.body);
      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

      if (!Number.isInteger(participantId) || targetOrganizationId === null) {
        return error(res, 'participant_id and target_organization_id are required', 400);
      }
      if (organizationId === targetOrganizationId) {
        return error(res, 'same_organization', 400);
      }
      if (!(await areSiblings(pool, organizationId, targetOrganizationId))) {
        return error(res, 'not_a_sibling_unit', 403);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transferParticipant(client, {
          participantId,
          organizationId,
          targetOrganizationId,
          userId: req.user.id,
          note
        });

        if (result.blocked) {
          await client.query('ROLLBACK');
          return error(res, result.blocked, BLOCKED_STATUS[result.blocked] || 400);
        }

        await client.query('COMMIT');
        logger?.info('Participant transferred', {
          participantId,
          from: organizationId,
          to: targetOrganizationId,
          by: req.user.id
        });
        return success(res, result, 'Participant transferred');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  return router;
};
