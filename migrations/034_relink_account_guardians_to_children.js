'use strict';

/**
 * Family-link co-parents appear among their children's guardians, again.
 *
 * Migration 011 linked each family account's contact record to the children
 * the account can see, but accepting a family link went on granting access
 * alone, so every co-parent linked since was missing from the child's guardians
 * and listed under "unknown child" in "Écrire aux familles". Acceptance now
 * links the record itself (services/familyLinks.js); this repairs the links
 * made in between by running 011's statement once more. That statement only
 * inserts missing rows, under the same rules, so running it again is safe.
 */

const fs = require('fs');
const path = require('path');

const description = 'Link family accounts\' contact records to the children they can see (rerun of 011)';

async function up(client) {
  const sql = fs.readFileSync(path.join(__dirname, '011_link_account_guardians_to_children.sql'), 'utf8');
  await client.query(sql);
}

module.exports = { description, up };
