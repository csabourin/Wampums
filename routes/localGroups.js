/**
 * Local Groups Routes
 *
 * Provides CRUD-style endpoints for local group catalog and organization memberships.
 * Endpoints are prefixed with /api/v1/local-groups.
 *
 * @module routes/localGroups
 */

const express = require('express');
const router = express.Router();
const { authenticate, blockDemoRoles, getOrganizationId, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

/**
 * Validate and normalize a local group identifier.
 *
 * @param {*} value - Incoming value to validate.
 * @returns {number|null} Parsed identifier or null when invalid.
 */
function parseLocalGroupId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

module.exports = (pool) => {
  /**
   * GET /api/v1/local-groups
   * List all available local groups.
   */
  router.get('/', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, slug
       FROM local_groups
       ORDER BY name`
    );

    return success(res, rows, 'Local groups retrieved successfully');
  }));

  /**
   * GET /api/v1/local-groups/memberships
   * Retrieve current organization's local group memberships.
   */
  router.get('/memberships', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { rows } = await pool.query(
      `SELECT lg.id, lg.name, lg.slug
       FROM local_groups lg
       INNER JOIN organization_local_groups olg
         ON olg.local_group_id = lg.id
       WHERE olg.organization_id = $1
       ORDER BY lg.name`,
      [organizationId]
    );

    return success(res, rows, 'Organization local group memberships retrieved successfully');
  }));

  /**
   * POST /api/v1/local-groups/memberships
   * Add organization membership to a local group.
   */
  router.post('/memberships', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const parsedId = parseLocalGroupId(req.body?.local_group_id);

    if (!parsedId) {
      return error(res, 'A valid local_group_id is required', 400);
    }

    const groupResult = await pool.query(
      'SELECT id, name, slug FROM local_groups WHERE id = $1',
      [parsedId]
    );

    if (groupResult.rows.length === 0) {
      return error(res, 'Local group not found', 404);
    }

    await pool.query(
      `INSERT INTO organization_local_groups (organization_id, local_group_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [organizationId, parsedId]
    );

    const membershipsResult = await pool.query(
      `SELECT lg.id, lg.name, lg.slug
       FROM local_groups lg
       INNER JOIN organization_local_groups olg
         ON olg.local_group_id = lg.id
       WHERE olg.organization_id = $1
       ORDER BY lg.name`,
      [organizationId]
    );

    return success(res, {
      added: groupResult.rows[0],
      memberships: membershipsResult.rows
    }, 'Local group membership added successfully', 201);
  }));

  /**
   * DELETE /api/v1/local-groups/memberships/:localGroupId
   * Remove organization membership from a local group.
   */
  router.delete('/memberships/:localGroupId', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const parsedId = parseLocalGroupId(req.params.localGroupId);

    if (!parsedId) {
      return error(res, 'A valid localGroupId is required', 400);
    }

    const deletionResult = await pool.query(
      `DELETE FROM organization_local_groups
       WHERE organization_id = $1 AND local_group_id = $2
       RETURNING local_group_id`,
      [organizationId, parsedId]
    );

    if (deletionResult.rows.length === 0) {
      return error(res, 'Membership not found for organization', 404);
    }

    return success(res, null, 'Local group membership removed successfully', 200);
  }));

  return router;
};
