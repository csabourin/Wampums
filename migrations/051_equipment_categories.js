'use strict';

const { EQUIPMENT_CATEGORIES, categoryFromText } = require('../services/equipmentCategories');

/**
 * Equipment categories become a fixed list (services/equipmentCategories.js),
 * so each one is shown in the reader's language and can be filtered on.
 *
 * Free-text categories are read into a key ("games" → games, "Cuisine" →
 * kitchen). Text that names none becomes `other`, and what was typed is kept
 * in attributes.legacy_category so nothing a unit wrote is lost. Items with no
 * category become `other` too. Running it again changes nothing: keys map to
 * themselves.
 *
 * @param {Object} client - Connected PostgreSQL client, inside the runner's transaction
 */
async function up(client) {
  const items = await client.query(
    `SELECT id, category FROM equipment_items
      WHERE category IS NULL OR NOT (category = ANY($1::text[]))`,
    [EQUIPMENT_CATEGORIES],
  );

  for (const item of items.rows) {
    const key = categoryFromText(item.category) || 'other';
    const typed = item.category && item.category.trim() && !categoryFromText(item.category)
      ? item.category.trim()
      : null;
    // eslint-disable-next-line no-await-in-loop -- one transaction client, used in order
    await client.query(
      `UPDATE equipment_items
          SET category = $2,
              attributes = CASE WHEN $3::text IS NULL THEN attributes
                                ELSE COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('legacy_category', $3::text) END
        WHERE id = $1`,
      [item.id, key, typed],
    );
  }

  await client.query("ALTER TABLE equipment_items ALTER COLUMN category SET DEFAULT 'other'");
  await client.query('ALTER TABLE equipment_items ALTER COLUMN category SET NOT NULL');
  await client.query('ALTER TABLE equipment_items DROP CONSTRAINT IF EXISTS equipment_items_category_check');
  await client.query(
    `ALTER TABLE equipment_items ADD CONSTRAINT equipment_items_category_check
       CHECK (category IN (${EQUIPMENT_CATEGORIES.map((key) => `'${key}'`).join(', ')}))`,
  );
}

module.exports = {
  description: 'Equipment categories become a fixed, translated list',
  up,
};
