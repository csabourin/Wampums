'use strict';

const defaultFormCatalog = require('../config/default-form-formats.json');

const APPROVER_ROLES = ['district', 'unitadmin', 'admin', 'administration'];
const STAFF_EDITOR_ROLES = ['leader', 'animation'];
const INSTALLED_DISPLAY_TYPE = 'public';

/**
 * Choose versions for a format that has no version history. Preserved tenant
 * formats must begin from their own current structure, never the catalog copy.
 *
 * @param {Object} form - Catalog form definition
 * @param {Object} installedStructure - Structure currently stored for the tenant
 * @param {boolean} preservedExisting - Whether the format predates installation
 * @returns {Array<Object>} Initial versions to insert
 */
function getInitialVersions(form, installedStructure, preservedExisting) {
  if (!preservedExisting && form.versions.length > 0) return form.versions;
  return [{
    version_number: 1,
    form_structure: installedStructure,
    display_name: form.display_name || form.form_type,
    change_description: preservedExisting
      ? 'Initial version captured from existing tenant format'
      : 'Initial standard form version',
    is_active: true,
  }];
}

/**
 * Return the safe baseline form permissions for a standard form.
 * Organization data scope and participant links still constrain accessible
 * records; these flags only control actions on the form type itself.
 *
 * @param {string} formType - Standard form type
 * @returns {Array<Object>} Permission rows keyed by role name
 */
function getDefaultPermissionPolicy(formType) {
  const isParticipantForm = formType !== 'incident_report';
  const permissions = [
    ...APPROVER_ROLES.map((roleName) => ({
      role_name: roleName,
      can_view: true,
      can_submit: true,
      can_edit: true,
      can_approve: true,
    })),
    ...STAFF_EDITOR_ROLES.map((roleName) => ({
      role_name: roleName,
      can_view: true,
      can_submit: true,
      can_edit: true,
      can_approve: false,
    })),
  ];

  if (isParticipantForm) {
    permissions.push({
      role_name: 'parent',
      can_view: true,
      can_submit: true,
      can_edit: true,
      can_approve: false,
    });
  }

  permissions.push(
    {
      role_name: 'demoadmin',
      can_view: true,
      can_submit: false,
      can_edit: false,
      can_approve: false,
    },
    {
      role_name: 'demoparent',
      can_view: isParticipantForm,
      can_submit: false,
      can_edit: false,
      can_approve: false,
    },
  );

  return permissions;
}

/**
 * Install the checked-in standard form catalog for one organization.
 * Existing formats and permission decisions are preserved; missing versions
 * and permission rows are repaired without replacing tenant customizations.
 *
 * @param {Object} client - Connected PostgreSQL client
 * @param {number} organizationId - Target organization
 * @returns {Promise<{created: number, preserved: number}>} Install summary
 */
async function installDefaultFormFormats(client, organizationId) {
  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) < 0) {
    throw new Error('A valid organization ID is required to install default forms');
  }

  let created = 0;
  let preserved = 0;

  for (const form of defaultFormCatalog.forms) {
    const existing = await client.query(
      `SELECT id, current_version_id, form_structure
       FROM organization_form_formats
       WHERE organization_id = $1 AND form_type = $2
       ORDER BY id
       LIMIT 1`,
      [organizationId, form.form_type],
    );

    let formFormatId;
    const preservedExisting = Boolean(existing.rows[0]);
    let currentVersionId = existing.rows[0]?.current_version_id || null;
    let installedStructure = existing.rows[0]?.form_structure || form.form_structure;

    if (existing.rows[0]) {
      formFormatId = existing.rows[0].id;
      preserved += 1;
    } else {
      const inserted = await client.query(
        `INSERT INTO organization_form_formats
           (organization_id, form_type, form_structure, display_type,
            display_name, description, instructions, category, status,
            is_required, display_order, tags, display_context)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9,
                 $10, $11, $12::text[], $13::text[])
         RETURNING id`,
        [
          organizationId,
          form.form_type,
          JSON.stringify(form.form_structure),
          INSTALLED_DISPLAY_TYPE,
          form.display_name,
          form.description,
          form.instructions,
          form.category,
          form.status,
          form.is_required,
          form.display_order,
          form.tags,
          form.display_context,
        ],
      );
      formFormatId = inserted.rows[0].id;
      installedStructure = form.form_structure;
      created += 1;
    }

    const storedVersions = await client.query(
      `SELECT id, version_number, is_active
       FROM form_format_versions
       WHERE form_format_id = $1
       ORDER BY version_number`,
      [formFormatId],
    );

    if (storedVersions.rows.length === 0) {
      const sourceVersions = getInitialVersions(
        form,
        installedStructure,
        preservedExisting,
      );

      for (const version of sourceVersions) {
        const insertedVersion = await client.query(
          `INSERT INTO form_format_versions
             (form_format_id, version_number, form_structure, display_name,
              change_description, created_by, is_active)
           VALUES ($1, $2, $3::jsonb, $4, $5, NULL, $6)
           RETURNING id`,
          [
            formFormatId,
            version.version_number,
            JSON.stringify(version.form_structure),
            version.display_name || form.display_name || form.form_type,
            version.change_description || 'Installed from standard form catalog',
            version.is_active,
          ],
        );
        if (version.is_active || !currentVersionId) {
          currentVersionId = insertedVersion.rows[0].id;
        }
      }
    } else if (!currentVersionId) {
      currentVersionId = storedVersions.rows.find((version) => version.is_active)?.id
        || storedVersions.rows.at(-1).id;
    }

    if (currentVersionId) {
      await client.query(
        `UPDATE organization_form_formats
         SET current_version_id = $1, updated_at = NOW()
         WHERE id = $2 AND current_version_id IS DISTINCT FROM $1`,
        [currentVersionId, formFormatId],
      );
    }

    for (const permission of getDefaultPermissionPolicy(form.form_type)) {
      await client.query(
        `INSERT INTO form_permissions
           (form_format_id, role_id, can_view, can_submit, can_edit, can_approve)
         SELECT $1, r.id, $3, $4, $5, $6
         FROM roles r
         WHERE r.role_name = $2
         ON CONFLICT (form_format_id, role_id) DO NOTHING`,
        [
          formFormatId,
          permission.role_name,
          permission.can_view,
          permission.can_submit,
          permission.can_edit,
          permission.can_approve,
        ],
      );
    }
  }

  return { created, preserved };
}

module.exports = {
  INSTALLED_DISPLAY_TYPE,
  defaultFormCatalog,
  getDefaultPermissionPolicy,
  getInitialVersions,
  installDefaultFormFormats,
};
