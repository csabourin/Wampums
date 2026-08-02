'use strict';

const { defaultFormCatalog, INSTALLED_DISPLAY_TYPE } = require('../services/defaultFormFormats');

/** Make previously seeded template/null display types consumable by /forms/types. */
async function up(client, { organizationIds } = {}) {
  const formTypes = defaultFormCatalog.forms.map((form) => form.form_type);
  const targetIds = Array.isArray(organizationIds) && organizationIds.length > 0
    ? organizationIds.map(Number)
    : null;

  await client.query(
    `UPDATE organization_form_formats
     SET display_type = $1, updated_at = NOW()
     WHERE form_type = ANY($2::text[])
       AND (display_type IS NULL OR display_type = 'template')
       AND ($3::int[] IS NULL OR organization_id = ANY($3::int[]))`,
    [INSTALLED_DISPLAY_TYPE, formTypes, targetIds],
  );
}

module.exports = {
  description: 'Expose installed standard formats through the public form-types API',
  up,
};
