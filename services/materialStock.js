/** Add optional stock to an article without partial creates or a second manual article. */
const { CatalogError, createCatalogItem, updateCatalogItem } = require('./equipmentCatalog');
const { readEquipmentOwner, OwnershipError } = require('./equipmentOwnership');
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/**
 * Save the article and its newly enabled stock in one transaction. Existing
 * inventory links use the ordinary catalogue path and never create stock again.
 * @param {Object} pool - pg pool
 * @param {number} organizationId - Authenticated unit
 * @param {string} actorId - Actor
 * @param {Object} fields - Validated article and stock.quantity_total
 * @param {number|null} itemId - Existing article, or null
 * @returns {Promise<Object>} Saved article
 */
async function saveArticleWithStock(pool, organizationId, actorId, fields, itemId = null) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let article;
    if (itemId) {
      article = (await db.query(`SELECT id, name, category, unit_of_measure, equipment_item_id, archived_at
        FROM equipment_catalog_items WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [itemId, organizationId])).rows[0];
      if (!article) { throw new CatalogError('equipment_catalog_item_not_found', HTTP_NOT_FOUND); }
      if ((fields.stock && article.equipment_item_id) || article.archived_at) { throw new CatalogError('material_stock_already_linked', HTTP_CONFLICT); }
    } else {
      article = await createCatalogItem(db, organizationId, actorId, fields);
    }
    const name = fields.name?.trim() || article.name;
    const category = fields.category || article.category;
    const unit = fields.unit_of_measure || article.unit_of_measure;
    const owner = fields.stock ? await readEquipmentOwner(db, organizationId, fields.stock) : null;
    const equipment = fields.stock
      ? (await db.query(`INSERT INTO equipment_items
        (organization_id, name, category, quantity_total, quantity_available, attributes, location_type, location_details, owner_type, owner_local_group_id)
        VALUES ($1, $2, $3, $4, $4, $5, 'local_scout_hall', '', $6, $7) RETURNING id`,
      [organizationId, name, category, fields.stock.quantity_total, { unit_of_measure: unit, share_with_local_group: false }, owner.owner_type, owner.owner_local_group_id])).rows[0]
      : (await db.query(`UPDATE equipment_items SET name = $3, category = $4,
          attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('unit_of_measure', $5::text), updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, article.equipment_item_id, name, category, unit])).rows[0];
    if (!equipment) { throw new CatalogError('equipment_catalog_equipment_unavailable', HTTP_NOT_FOUND); }
    const saved = await updateCatalogItem(db, organizationId, article.id, { ...fields, equipment_item_id: equipment.id });
    await db.query('COMMIT');
    return saved;
  } catch (err) {
    await db.query('ROLLBACK');
    if (err instanceof OwnershipError) { throw new CatalogError(err.message, err.status, 'stock.owner_type'); }
    if (err.code === '23505') { throw new CatalogError('material_stock_name_exists', HTTP_CONFLICT, 'name'); }
    throw err;
  } finally { db.release(); }
}
module.exports = { saveArticleWithStock };
