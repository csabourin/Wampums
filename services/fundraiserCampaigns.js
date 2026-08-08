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

/**
 * SQL expression resolving the money raised by one fundraiser entry.
 * Written as a fragment so list, detail and report queries stay consistent.
 *
 * @param {string} [entryAlias='c'] - Alias of the fundraiser_entries table
 * @param {string} [campaignAlias='f'] - Alias of the fundraisers table
 * @returns {string} SQL expression yielding a numeric amount
 */
function entryAmountSql(entryAlias = 'c', campaignAlias = 'f') {
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
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_KEYS,
  DEFAULT_CAMPAIGN_TYPE,
  campaignTypeCapabilities,
  entryAmountSql,
  isValidCampaignType,
  resolveEntryAmount,
  toNullableNumber,
};
