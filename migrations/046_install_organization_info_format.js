'use strict';

const { installDefaultFormFormats } = require('../services/defaultFormFormats');

/**
 * Give every unit the organization_info format, which the unit creation screen
 * reads from the active unit. Until now it existed only in units that had it
 * from the old template, so a new installation could not create a unit.
 * Only this format is installed: a unit that removed a standard form keeps it
 * removed, and a unit that already has organization_info keeps its own copy.
 *
 * @param {Object} client - Connected PostgreSQL client
 * @param {Object} [context] - Migration execution context
 * @param {number[]} [context.organizationIds] - Optional target organization IDs
 */
async function up(client, { organizationIds } = {}) {
  let targetIds = organizationIds;
  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    const organizations = await client.query('SELECT id FROM organizations ORDER BY id');
    targetIds = organizations.rows.map((row) => row.id);
  }

  for (const organizationId of targetIds) {
    // eslint-disable-next-line no-await-in-loop -- one transaction client, used in order
    await installDefaultFormFormats(client, Number(organizationId), { formTypes: ['organization_info'] });
  }
}

module.exports = {
  description: 'Install the organization_info format in every unit',
  up,
};
