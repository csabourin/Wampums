'use strict';

/**
 * Remember how the demo unit looks before visitors may change it.
 *
 * Migration 041 opens points, attendance and honors to demo visitors. This
 * runs in the same deploy, before the server starts, so the baseline is the
 * state no visitor has touched. A baseline already taken is kept: running it
 * again never records a visitor's changes as the state to return to. Retake it
 * on purpose with `node scripts/demo/reset-demo-sandbox.js --capture`.
 */

const { listDemoUnits, captureBaseline } = require('../services/demoSandbox');

const description = 'Capture the demo unit\'s points, attendance and honors for the night reset';

async function up(client) {
  for (const organizationId of await listDemoUnits(client)) {
    // eslint-disable-next-line no-await-in-loop -- one demo unit in practice, and one transaction
    await captureBaseline(client, organizationId, { replace: false });
  }
}

module.exports = { description, up };
