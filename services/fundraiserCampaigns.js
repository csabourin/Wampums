/**
 * Fundraising campaign model helpers.
 *
 * A campaign is described by a `campaign_type` that says which measures its
 * entries actually carry. The money raised by an entry is resolved from those
 * measures rather than being hard-wired to "unit count x fixed price":
 *
 *   1. `amount_raised` when the value was entered directly;
 *   2. otherwise `hours x unit_price` for hour based campaigns;
 *   3. otherwise `quantity x unit_price` for unit based campaigns;
 *   4. otherwise the legacy `amount` column, so campaigns recorded before the
 *      004 migration keep the totals they have always shown.
 *
 * @module services/fundraiserCampaigns
 */

/**
 * Supported campaign types and the measures each one records.
 * `usesUnitPrice` means a per-unit (or per-hour) price is meaningful.
 */
const CAMPAIGN_TYPES = Object.freeze({
  fixed_price_sale: { usesQuantity: true, usesHours: false, usesUnitPrice: true, usesDirectAmount: false },
  variable_price_sale: { usesQuantity: true, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
  container_deposit: { usesQuantity: true, usesHours: false, usesUnitPrice: true, usesDirectAmount: false },
  hours_worked: { usesQuantity: false, usesHours: true, usesUnitPrice: true, usesDirectAmount: false },
  direct_amount: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
  donation: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
  sponsored_activity: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
  other: { usesQuantity: true, usesHours: true, usesUnitPrice: true, usesDirectAmount: true },
});

const CAMPAIGN_TYPE_KEYS = Object.freeze(Object.keys(CAMPAIGN_TYPES));

/** Campaign type applied to campaigns created before the model was generalised. */
const DEFAULT_CAMPAIGN_TYPE = 'fixed_price_sale';

/** Columns migration 004 adds to `fundraisers`. */
const CAMPAIGN_MODEL_COLUMNS = Object.freeze(['campaign_type', 'unit_price', 'unit_label']);

/** Columns migration 004 adds to `fundraiser_entries`. */
const ENTRY_MEASURE_COLUMNS = Object.freeze(['quantity', 'hours', 'amount_raised']);

/**
 * Cached "has migration 004 been applied?" answer, keyed by pool.
 * @type {WeakMap<Object, Promise<boolean>>}
 */
const schemaSupportCache = new WeakMap();

/**
 * Whether the generalised campaign columns exist in this database.
 *
 * The API must serve campaigns whether or not migration 004 has run yet:
 * a deploy that reaches the app before the migration would otherwise make
 * every campaign query fail with "column f.campaign_type does not exist",
 * taking the whole screen down. The answer is looked up once per pool.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<boolean>} True when the campaign model columns are present
 */
function hasCampaignModelColumns(pool) {
  const cached = schemaSupportCache.get(pool);
  if (cached) {
    return cached;
  }

  const lookup = pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE table_name = 'fundraisers' AND column_name = ANY($1::text[])
       ) AS campaign_columns,
       COUNT(*) FILTER (
         WHERE table_name = 'fundraiser_entries' AND column_name = ANY($2::text[])
       ) AS entry_columns
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('fundraisers', 'fundraiser_entries')`,
    [[...CAMPAIGN_MODEL_COLUMNS], [...ENTRY_MEASURE_COLUMNS]]
  ).then((result) => {
    const row = result.rows[0] || {};
    return Number(row.campaign_columns) === CAMPAIGN_MODEL_COLUMNS.length
      && Number(row.entry_columns) === ENTRY_MEASURE_COLUMNS.length;
  }).catch(() => {
    // Never let schema detection itself break a request: fall back to the
    // legacy shape, which every database has, and retry on the next call.
    schemaSupportCache.delete(pool);
    return false;
  });

  schemaSupportCache.set(pool, lookup);
  return lookup;
}

/**
 * Forget the cached schema answer (used by tests and after a migration run).
 *
 * @param {Object} [pool] - Pool to forget; omit to forget nothing in particular
 * @returns {void}
 */
function resetCampaignModelSchemaCache(pool) {
  if (pool) {
    schemaSupportCache.delete(pool);
  }
}

/**
 * SQL expression resolving the money raised by one fundraiser entry.
 * Written as a fragment so list, detail and report queries stay consistent.
 *
 * @param {string} [entryAlias='c'] - Alias of the fundraiser_entries table
 * @param {string} [campaignAlias='f'] - Alias of the fundraisers table
 * @param {boolean} [extended=true] - Whether the campaign model columns exist
 * @returns {string} SQL expression yielding a numeric amount
 */
function entryAmountSql(entryAlias = 'c', campaignAlias = 'f', extended = true) {
  if (!extended) {
    // Pre-migration, the legacy amount column is the only measure there is.
    return `${entryAlias}.amount`;
  }
  return `COALESCE(
    ${entryAlias}.amount_raised,
    CASE
      WHEN ${campaignAlias}.campaign_type = 'hours_worked'
        THEN ${entryAlias}.hours * ${campaignAlias}.unit_price
      ELSE ${entryAlias}.quantity * ${campaignAlias}.unit_price
    END,
    ${entryAlias}.amount
  )`;
}

/**
 * Campaign shape columns, or the legacy defaults when they do not exist yet,
 * so the response shape is identical either way.
 *
 * @param {string} [campaignAlias='f'] - Alias of the fundraisers table
 * @param {boolean} [extended=true] - Whether the campaign model columns exist
 * @returns {string} Comma separated select list (no trailing comma)
 */
function campaignModelColumnsSql(campaignAlias = 'f', extended = true) {
  if (!extended) {
    return `'${DEFAULT_CAMPAIGN_TYPE}'::text AS campaign_type,
            NULL::numeric AS unit_price,
            NULL::text AS unit_label`;
  }
  return CAMPAIGN_MODEL_COLUMNS.map((column) => `${campaignAlias}.${column}`).join(',\n            ');
}

/**
 * Per-entry measure columns, or the legacy defaults.
 *
 * The legacy `amount` column held a unit count, so it maps onto `quantity` —
 * the same mapping migration 004 performs when it backfills.
 *
 * @param {string} [entryAlias='c'] - Alias of the fundraiser_entries table
 * @param {boolean} [extended=true] - Whether the entry measure columns exist
 * @returns {string} Comma separated select list (no trailing comma)
 */
function entryMeasureColumnsSql(entryAlias = 'c', extended = true) {
  if (!extended) {
    return `${entryAlias}.amount::numeric AS quantity,
            NULL::numeric AS hours,
            NULL::numeric AS amount_raised`;
  }
  return ENTRY_MEASURE_COLUMNS.map((column) => `${entryAlias}.${column}`).join(',\n            ');
}

/**
 * Expression for a participant's unit count, whichever schema is in place.
 *
 * @param {string} [entryAlias='c'] - Alias of the fundraiser_entries table
 * @param {boolean} [extended=true] - Whether the entry measure columns exist
 * @returns {string} SQL expression yielding a numeric unit count
 */
function entryQuantitySql(entryAlias = 'c', extended = true) {
  return extended ? `${entryAlias}.quantity` : `${entryAlias}.amount`;
}

/**
 * Expression for a participant's worked hours, whichever schema is in place.
 *
 * @param {string} [entryAlias='c'] - Alias of the fundraiser_entries table
 * @param {boolean} [extended=true] - Whether the entry measure columns exist
 * @returns {string} SQL expression yielding numeric hours
 */
function entryHoursSql(entryAlias = 'c', extended = true) {
  return extended ? `${entryAlias}.hours` : 'NULL::numeric';
}

/**
 * Describe the measures a campaign type records.
 *
 * @param {string} campaignType - Campaign type key
 * @returns {{usesQuantity: boolean, usesHours: boolean, usesUnitPrice: boolean, usesDirectAmount: boolean}}
 */
function campaignTypeCapabilities(campaignType) {
  return CAMPAIGN_TYPES[campaignType] || CAMPAIGN_TYPES[DEFAULT_CAMPAIGN_TYPE];
}

/**
 * @param {string} campaignType - Campaign type key
 * @returns {boolean} True when the type is one of the supported campaign types
 */
function isValidCampaignType(campaignType) {
  return Object.prototype.hasOwnProperty.call(CAMPAIGN_TYPES, campaignType);
}

/**
 * Coerce a value to a finite number, or null when it carries no value.
 * Empty strings, null and undefined are all treated as "not provided" so a
 * cleared form field clears the stored measure instead of writing 0.
 *
 * @param {*} value - Raw value from a request body
 * @returns {number|null} Parsed number or null
 */
function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve the money raised by an entry in JavaScript, mirroring entryAmountSql.
 *
 * @param {Object} entry - Fundraiser entry row
 * @param {Object} campaign - Parent fundraiser row
 * @returns {number} Money raised by this entry
 */
function resolveEntryAmount(entry = {}, campaign = {}) {
  const direct = toNullableNumber(entry.amount_raised);
  if (direct !== null) {
    return direct;
  }

  const unitPrice = toNullableNumber(campaign.unit_price);
  if (unitPrice !== null) {
    const measure = campaign.campaign_type === 'hours_worked'
      ? toNullableNumber(entry.hours)
      : toNullableNumber(entry.quantity);
    if (measure !== null) {
      return measure * unitPrice;
    }
  }

  return toNullableNumber(entry.amount) ?? 0;
}

module.exports = {
  CAMPAIGN_MODEL_COLUMNS,
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_KEYS,
  DEFAULT_CAMPAIGN_TYPE,
  ENTRY_MEASURE_COLUMNS,
  campaignModelColumnsSql,
  campaignTypeCapabilities,
  entryAmountSql,
  entryHoursSql,
  entryMeasureColumnsSql,
  entryQuantitySql,
  hasCampaignModelColumns,
  isValidCampaignType,
  resetCampaignModelSchemaCache,
  resolveEntryAmount,
  toNullableNumber,
};
