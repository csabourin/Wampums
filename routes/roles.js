/**
 * Role and Permission Management Routes
 *
 * Handles role and permission management for the organization
 * Available to district and unitadmin users
 *
 * @module routes/roles
 */

const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, forbidden, asyncHandler } = require('../middleware/response');
const { findRolesInUnit, pairedViewKey, checkPermissionChange, permissionLockReason, recordRoleChange, recordRoleDefinitionChange } = require('../services/roleAssignment');
const { query, body, param } = require('express-validator');
const { checkValidation } = require('../middleware/validation');

/** Entries returned by the role history when no limit is given. */
const ROLE_AUDIT_DEFAULT_LIMIT = 15;
/** Most entries the role history returns at once. */
const ROLE_AUDIT_MAX_LIMIT = 50;

/** Longest roles.role_name the column accepts. */
const ROLE_NAME_MAX_LENGTH = 50;
const HTTP = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, CREATED: 201, INTERNAL: 500 };
const ROLE_DISPLAY_MAX_LENGTH = 100;
const ROLE_DESCRIPTION_MAX_LENGTH = 2000;
const validateRoleId = () => [param('roleId').isInt({ min: 1 }).toInt(), checkValidation];
const validateDefinition = () => [
  body('display_name').optional().isString().trim().isLength({ min: 1, max: ROLE_DISPLAY_MAX_LENGTH }),
  body('description').optional({ nullable: true }).isString().isLength({ max: ROLE_DESCRIPTION_MAX_LENGTH }),
  body('data_scope').optional().isIn(['organization', 'linked']),
];

/** Translate a policy refusal to the shared response contract. */
function policyResponse(res, refusal) {
  return refusal.status === HTTP.FORBIDDEN
    ? forbidden(res, refusal.message, refusal.required, refusal.missing)
    : error(res, refusal.message, refusal.status);
}

/** Consistent role history snapshot, independent of catalog ordering. */
function definitionSnapshot(role, keys) {
  return { display_name: role.display_name, description: role.description, data_scope: role.data_scope, permissions: [...keys].sort() };
}

/**
 * @param {string|number} value - Route parameter or body field
 * @returns {number|null} The ID, or null when it is not a positive integer
 */
function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Internal key for a unit's custom role. The unit prefix keeps keys unique
 * across units without revealing another unit's role names, and keeps custom
 * keys apart from the built-in ones.
 *
 * @param {number} organizationId - The unit
 * @param {string} requested - Name the caller asked for
 * @returns {string|null} Key, or null when nothing usable remains
 */
function customRoleKey(organizationId, requested) {
  const prefix = `u${organizationId}_`;
  const slug = String(requested || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, ROLE_NAME_MAX_LENGTH - prefix.length);
  return slug ? `${prefix}${slug}` : null;
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with role management routes
 */
module.exports = (pool, logger) => {
  const router = express.Router();

  /** Serialize all mutations of a role, including the legacy single-cell API. */
  async function changeRole(req, res, action) {
    const organizationId = await getOrganizationId(req, pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const role = (await client.query(
        `SELECT * FROM roles WHERE id = $1
          AND (organization_id = $2 OR (organization_id IS NULL AND is_system_role)) FOR UPDATE`,
        [req.params.roleId, organizationId]
      )).rows[0];
      if (!role) { await client.query('ROLLBACK'); return error(res, 'Role not found', HTTP.NOT_FOUND); }
      if (role.is_system_role) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Cannot modify system roles', [], []);
      }
      const catalog = (await client.query('SELECT * FROM permissions ORDER BY category, permission_key')).rows;
      const current = (await client.query('SELECT permission_id FROM role_permissions WHERE role_id = $1', [role.id])).rows.map((r) => Number(r.permission_id));
      const currentKeys = catalog.filter((p) => current.includes(Number(p.id))).map((p) => p.permission_key);
      const before = definitionSnapshot(role, currentKeys);
      const result = await action({ client, organizationId, role, catalog, current, currentKeys });
      if (result.refusal) { await client.query('ROLLBACK'); return policyResponse(res, result.refusal); }
      await recordRoleDefinitionChange(client, { organizationId, changedBy: req.user.id, roleId: role.id, before, after: result.after });
      if (result.deleted) { await client.query('DELETE FROM roles WHERE id = $1 AND organization_id = $2', [role.id, organizationId]); }
      await client.query('COMMIT');
      return success(res, result.data ?? null, 'Role updated');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error changing role definition:', err);
      return error(res, 'Failed to change role', err.code === '23505' ? HTTP.CONFLICT : HTTP.INTERNAL);
    } finally { client.release(); }
  }

  /** Replace a desired set after applying the shared authority and scope policy. */
  async function replacePermissions(req, state, requested, requireComplete = true) {
    const { client, role, catalog, currentKeys } = state;
    const requestedKeys = catalog.filter((p) => requested.includes(Number(p.id))).map((p) => p.permission_key);
    const refusal = checkPermissionChange({ role, catalog, currentKeys, requestedKeys, heldPermissions: req.userPermissions || [], requireComplete });
    if (refusal) { return { refusal }; }
    await client.query('DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_id = ANY($2::int[]))', [role.id, requested]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, permission_id FROM unnest($2::int[]) AS ids(permission_id) ON CONFLICT DO NOTHING`,
      [role.id, requested]
    );
    return { after: definitionSnapshot(role, requestedKeys) };
  }

  router.get('/api/v1/roles/matrix', authenticate, requirePermission('roles.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    // One statement gives the UI a coherent catalog and role-permission snapshot.
    const result = await pool.query(
      `SELECT
        COALESCE((SELECT jsonb_agg(p ORDER BY p.category, p.permission_key) FROM permissions p), '[]'::jsonb) AS permissions,
        COALESCE((SELECT jsonb_agg(item ORDER BY item.id) FROM (
          SELECT r.id, r.role_name, r.display_name, r.description, r.data_scope, r.is_system_role,
                 COALESCE((SELECT jsonb_agg(rp.permission_id ORDER BY rp.permission_id)
                             FROM role_permissions rp WHERE rp.role_id = r.id), '[]'::jsonb) AS permission_ids
            FROM roles r WHERE r.organization_id = $1 OR (r.organization_id IS NULL AND r.is_system_role)
        ) item), '[]'::jsonb) AS roles`, [organizationId]
    );
    const { permissions = [], roles = [] } = result.rows[0] || {};
    const held = req.userPermissions || [];
    return success(res, { organization_id: organizationId, permissions, roles: roles.map((role) => ({
      ...role,
      can_delete: !checkPermissionChange({ role, catalog: permissions, currentKeys: permissions.filter((p) => role.permission_ids.includes(p.id)).map((p) => p.permission_key), requestedKeys: [], heldPermissions: held }),
      can_copy: !checkPermissionChange({ role: { ...role, is_system_role: false }, catalog: permissions, currentKeys: [],
        requestedKeys: permissions.filter((p) => role.permission_ids.includes(p.id)).map((p) => p.permission_key), heldPermissions: held }),
      cells: permissions.map((p) => {
        const baseReason = permissionLockReason(role, p, held, permissions);
        const manage = p.permission_key.endsWith('.view')
          ? permissions.find((candidate) => candidate.permission_key === p.permission_key.replace(/\.view$/, '.manage')) : null;
        const dependencyReason = manage && role.permission_ids.includes(manage.id) ? 'view_required' : null;
        const reason = baseReason || dependencyReason;
        return { permission_id: p.id, can_modify: !reason, reason, base_reason: baseReason,
          required_view: pairedViewKey(p.permission_key, permissions) };
      }),
    })) });
  }));

  router.put('/api/v1/roles/:roleId/permissions', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateRoleId(), body('permission_ids').isArray(), body('permission_ids.*').isInt({ min: 1 }),
    body('expected_permission_ids').optional().isArray(), body('expected_permission_ids.*').optional().isInt({ min: 1 }), checkValidation,
    asyncHandler((req, res) => changeRole(req, res, (state) => {
      const requested = [...new Set(req.body.permission_ids.map(Number))];
      if (requested.some((id) => !state.catalog.some((p) => Number(p.id) === id))) {
        return { refusal: { status: HTTP.BAD_REQUEST, message: 'Unknown permission' } };
      }
      if (req.body.expected_permission_ids) {
        const expected = [...new Set(req.body.expected_permission_ids.map(Number))];
        if (expected.length !== state.current.length || expected.some((id) => !state.current.includes(id))) {
          return { refusal: { status: HTTP.CONFLICT, message: 'role_matrix_stale' } };
        }
      }
      return replacePermissions(req, state, requested);
    })));

  router.patch('/api/v1/roles/:roleId', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateRoleId(), ...validateDefinition(),
    body().custom((value) => value && ['display_name', 'description', 'data_scope'].some((key) => Object.hasOwn(value, key))), checkValidation,
    asyncHandler((req, res) => changeRole(req, res, async ({ client, organizationId, role, catalog, currentKeys }) => {
      const updated = { ...role, ...Object.fromEntries(['display_name', 'description', 'data_scope']
        .filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]])) };
      const refusal = checkPermissionChange({ role: updated, catalog, currentKeys, requestedKeys: currentKeys,
        heldPermissions: req.userPermissions || [], previousScope: role.data_scope });
      if (refusal) { return { refusal }; }
      const result = await client.query(
        `UPDATE roles SET display_name = $1, description = $2, data_scope = $3, updated_at = NOW()
         WHERE id = $4 AND organization_id = $5 RETURNING *`,
        [updated.display_name, updated.description, updated.data_scope, role.id, organizationId]
      );
      return { data: result.rows[0], after: definitionSnapshot(updated, currentKeys) };
    })));

  /**
   * GET /api/v1/roles
   * Get all available roles
   * Available to: district, unitadmin
   */
  router.get('/api/v1/roles',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        // Every role is listed. `assignable` says whether the caller holds all
        // of its permissions, which is what granting or removing it requires
        // (services/roleAssignment.js); forms show the others as read-only.
        const organizationId = await getOrganizationId(req, pool);
        // A unit sees the shared built-in roles and its own custom roles
        // (services/roleAssignment.js findRolesInUnit).
        const result = await pool.query(
          `SELECT r.id, r.role_name, r.display_name, r.description, r.is_system_role, r.created_at,
                  NOT EXISTS (
                    SELECT 1
                    FROM role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                    WHERE rp.role_id = r.id
                      AND NOT (p.permission_key = ANY($1::text[]))
                      -- same exception as services/roleAssignment.js
                      AND NOT (p.self_scoped AND r.data_scope = 'linked')
                  ) AS assignable
           FROM roles r
           WHERE r.organization_id = $2 OR (r.organization_id IS NULL AND r.is_system_role)
           ORDER BY
             CASE r.role_name
               WHEN 'district' THEN 0
               WHEN 'unitadmin' THEN 1
               WHEN 'leader' THEN 2
               WHEN 'parent' THEN 3
               WHEN 'finance' THEN 4
               WHEN 'equipment' THEN 5
               WHEN 'administration' THEN 6
               WHEN 'demoadmin' THEN 7
               WHEN 'demoparent' THEN 8
               ELSE 9
             END`,
          [req.userPermissions || [], organizationId]
        );

        return success(res, result.rows, 'Roles retrieved successfully');
      } catch (err) {
        logger.error('Error fetching roles:', err);
        return error(res, 'Failed to fetch roles', HTTP.INTERNAL);
      }
    })
  );

  /**
   * GET /api/v1/roles/:roleId/permissions
   * Get permissions for a specific role
   * Available to: district, unitadmin
   */
  router.get('/api/v1/roles/:roleId/permissions',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const roleId = parsePositiveId(req.params.roleId);
        if (!roleId || (await findRolesInUnit(pool, [roleId], organizationId)).length === 0) {
          return error(res, 'Role not found', HTTP.NOT_FOUND);
        }

        const query = `
          SELECT p.id, p.permission_key, p.permission_name, p.category, p.description
          FROM permissions p
          JOIN role_permissions rp ON p.id = rp.permission_id
          WHERE rp.role_id = $1
          ORDER BY p.category, p.permission_key
        `;

        const result = await pool.query(query, [roleId]);

        return success(res, result.rows, 'Role permissions retrieved successfully');
      } catch (err) {
        logger.error('Error fetching role permissions:', err);
        return error(res, 'Failed to fetch role permissions', HTTP.INTERNAL);
      }
    })
  );

  /**
   * GET /api/v1/permissions
   * Get all available permissions grouped by category
   * Available to: district, unitadmin
   */
  router.get('/api/v1/permissions',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        const query = `
          SELECT id, permission_key, permission_name, category, description
          FROM permissions
          ORDER BY category, permission_key
        `;

        const result = await pool.query(query);

        // Group by category
        const grouped = result.rows.reduce((acc, perm) => {
          if (!acc[perm.category]) {
            acc[perm.category] = [];
          }
          acc[perm.category].push(perm);
          return acc;
        }, {});

        return success(res, grouped, 'Permissions retrieved successfully');
      } catch (err) {
        logger.error('Error fetching permissions:', err);
        return error(res, 'Failed to fetch permissions', HTTP.INTERNAL);
      }
    })
  );

  /**
   * POST /api/v1/roles/:roleId/permissions
   * Add permission to a role (custom roles only)
   * Available to: holders of roles.manage
   */
  router.post('/api/v1/roles/:roleId/permissions', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateRoleId(), body('permissionId').isInt({ min: 1 }).toInt(), checkValidation,
    asyncHandler((req, res) => changeRole(req, res, (state) => {
      const permission = state.catalog.find((p) => Number(p.id) === req.body.permissionId);
      if (!permission) { return { refusal: { status: HTTP.NOT_FOUND, message: 'Permission not found' } }; }
      const view = pairedViewKey(permission.permission_key, state.catalog);
      const ids = [Number(permission.id)];
      if (view) { ids.push(Number(state.catalog.find((p) => p.permission_key === view).id)); }
      return replacePermissions(req, state, [...new Set([...state.current, ...ids])], false);
    })));

  /**
   * DELETE /api/v1/roles/:roleId/permissions/:permissionId
   * Remove permission from a role (custom roles only)
   * Available to: holders of roles.manage
   */
  router.delete('/api/v1/roles/:roleId/permissions/:permissionId', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateRoleId(), param('permissionId').isInt({ min: 1 }).toInt(), checkValidation,
    asyncHandler((req, res) => changeRole(req, res, (state) => {
      if (!state.catalog.some((p) => Number(p.id) === req.params.permissionId)) {
        return { refusal: { status: HTTP.NOT_FOUND, message: 'Permission not found' } };
      }
      return replacePermissions(req, state, state.current.filter((id) => id !== req.params.permissionId), false);
    })));

  /**
   * POST /api/v1/roles
   * Create a new custom role
   * Available to: holders of roles.manage
   */
  router.post('/api/v1/roles', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateDefinition(), body('display_name').exists(),
    body('role_name').optional().isString().trim().isLength({ min: 1, max: ROLE_NAME_MAX_LENGTH }),
    body('base_role_id').optional().isInt({ min: 1 }).toInt(), body('reassign_members').optional().isBoolean({ strict: true }).toBoolean(), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let base = null;
        let keys = [];
        let catalog = [];
        if (req.body.base_role_id) {
          base = (await client.query(
            `SELECT * FROM roles WHERE id = $1
             AND (organization_id = $2 OR (organization_id IS NULL AND is_system_role)) FOR UPDATE`,
            [req.body.base_role_id, organizationId]
          )).rows[0];
          if (!base) { await client.query('ROLLBACK'); return error(res, 'Role not found', HTTP.NOT_FOUND); }
          catalog = (await client.query('SELECT * FROM permissions ORDER BY category, permission_key')).rows;
          keys = (await client.query(
            'SELECT p.permission_key FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1',
            [base.id]
          )).rows.map((p) => p.permission_key);
        } else if (req.body.reassign_members) {
          await client.query('ROLLBACK'); return error(res, 'A base role is required to reassign members', HTTP.BAD_REQUEST);
        }
        const role = { display_name: req.body.display_name, description: req.body.description ?? base?.description ?? null,
          data_scope: base?.data_scope || req.body.data_scope || 'organization', is_system_role: false };
        const refusal = checkPermissionChange({ role, catalog, currentKeys: [], requestedKeys: keys, heldPermissions: req.userPermissions || [] });
        if (refusal) { await client.query('ROLLBACK'); return policyResponse(res, refusal); }
        const roleKey = customRoleKey(organizationId, req.body.role_name || role.display_name);
        if (!roleKey) { await client.query('ROLLBACK'); return error(res, 'role_name must contain letters or digits', HTTP.BAD_REQUEST); }
        const created = (await client.query(
          `INSERT INTO roles (role_name, display_name, description, is_system_role, organization_id, data_scope)
           VALUES ($1, $2, $3, false, $4, $5) RETURNING *`,
          [roleKey, role.display_name, role.description, organizationId, role.data_scope]
        )).rows[0];
        let reassigned = 0;
        if (base) {
          await client.query(`INSERT INTO role_permissions (role_id, permission_id)
            SELECT $1, permission_id FROM role_permissions WHERE role_id = $2 ON CONFLICT DO NOTHING`, [created.id, base.id]);
          // Per-form rights are part of the role too, and belong to this unit.
          await client.query(`INSERT INTO form_permissions (form_format_id, role_id, can_view, can_submit, can_edit, can_approve)
            SELECT fp.form_format_id, $1, fp.can_view, fp.can_submit, fp.can_edit, fp.can_approve
            FROM form_permissions fp JOIN organization_form_formats f ON f.id = fp.form_format_id
            WHERE fp.role_id = $2 AND f.organization_id = $3 ON CONFLICT DO NOTHING`, [created.id, base.id, organizationId]);
          if (req.body.reassign_members) {
            const members = (await client.query(
              `SELECT user_id, role_ids FROM user_organizations
               WHERE organization_id = $1 AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(role_ids, '[]'::jsonb)) held(role_id)
                 WHERE held.role_id = $2::text
               ) ORDER BY user_id FOR UPDATE`,
              [organizationId, String(base.id)]
            )).rows;
            for (const member of members) {
              const updated = [...new Set(member.role_ids.map((id) => Number(id) === Number(base.id) ? created.id : Number(id)))];
              // eslint-disable-next-line no-await-in-loop -- one transaction client; keep updates and history together
              await client.query('UPDATE user_organizations SET role_ids = $1::jsonb WHERE user_id = $2 AND organization_id = $3',
                [JSON.stringify(updated), member.user_id, organizationId]);
              // eslint-disable-next-line no-await-in-loop -- snapshot before deleting the role
              await recordRoleChange(client, { organizationId, userId: member.user_id, changedBy: req.user.id,
                previousRoleIds: member.role_ids, newRoleIds: updated, note: 'Unit role customization' });
              reassigned += 1;
            }
          }
        }
        await recordRoleDefinitionChange(client, { organizationId, changedBy: req.user.id, roleId: created.id,
          before: null, after: definitionSnapshot(created, keys) });
        await client.query('COMMIT');
        return success(res, { ...created, reassigned_members: reassigned }, 'Role created successfully', HTTP.CREATED);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Error creating role:', err);
        return error(res, 'Failed to create role', err.code === '23505' ? HTTP.CONFLICT : HTTP.INTERNAL);
      } finally { client.release(); }
    }));

  /**
   * DELETE /api/v1/roles/:roleId
   * Delete a custom role
   * Available to: holders of roles.manage
   */
  router.delete('/api/v1/roles/:roleId', authenticate, blockDemoRoles, requirePermission('roles.manage'),
    ...validateRoleId(), asyncHandler((req, res) => changeRole(req, res, async ({ client, role, organizationId, catalog, currentKeys }) => {
      const refusal = checkPermissionChange({ role, catalog, currentKeys, requestedKeys: [], heldPermissions: req.userPermissions || [] });
      if (refusal) { return { refusal }; }
      const members = (await client.query(
        `SELECT user_id, role_ids FROM user_organizations
         WHERE organization_id = $1 AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(role_ids, '[]'::jsonb)) held(role_id)
                 WHERE held.role_id = $2::text
               ) ORDER BY user_id FOR UPDATE`,
        [organizationId, String(role.id)]
      )).rows;
      for (const member of members) {
        const updated = member.role_ids.map(Number).filter((id) => id !== Number(role.id));
        // eslint-disable-next-line no-await-in-loop -- one transaction client; keep updates and history together
        await client.query('UPDATE user_organizations SET role_ids = $1::jsonb WHERE user_id = $2 AND organization_id = $3',
          [JSON.stringify(updated), member.user_id, organizationId]);
        // eslint-disable-next-line no-await-in-loop -- snapshot before deleting the role
        await recordRoleChange(client, { organizationId, userId: member.user_id, changedBy: req.user.id,
          previousRoleIds: member.role_ids, newRoleIds: updated, note: 'Custom role deleted' });
      }
      return { after: null, deleted: true };
    })));

  /**
   * @swagger
   * /api/v1/audit/roles:
   *   get:
   *     summary: History of a member's role changes in the unit
   *     description: >
   *       Newest first. Each entry gives who made the change, when, the roles
   *       before and after (as they were then) and the optional note.
   *     tags: [Roles]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: user_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 50
   *           default: 15
   *     responses:
   *       200:
   *         description: Role changes, newest first
   *       400:
   *         description: Invalid user_id or limit
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/api/v1/audit/roles',
    authenticate,
    requirePermission('users.view'),
    query('user_id').isUUID(),
    query('limit').optional().isInt({ min: 1, max: ROLE_AUDIT_MAX_LIMIT }).toInt(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const limit = req.query.limit || ROLE_AUDIT_DEFAULT_LIMIT;

      const result = await pool.query(
        `SELECT a.id, a.created_at, a.previous_roles, a.new_roles, a.note,
                a.changed_by, actor.full_name AS actor_name
           FROM role_assignment_audit a
           LEFT JOIN users actor ON actor.id = a.changed_by
          WHERE a.organization_id = $1 AND a.user_id = $2
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $3`,
        [organizationId, req.query.user_id, limit]
      );

      return success(res, result.rows, 'Role history retrieved');
    })
  );

  return router;
};
