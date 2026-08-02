'use strict';

const { installDefaultFormFormats } = require('../services/defaultFormFormats');

/**
 * Backfill the standard form catalog without overwriting customized formats.
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
    await installDefaultFormFormats(client, Number(organizationId));
  }
}

module.exports = {
  description: 'Install the five standard organization form formats',
  up,
};
