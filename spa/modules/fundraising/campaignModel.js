/**
 * Client-side mirror of the fundraising campaign model.
 *
 * Keep the capability table in sync with `services/fundraiserCampaigns.js`:
 * the server resolves the authoritative amounts, this module only decides
 * which inputs a campaign screen should show and how to label them.
 *
 * @module modules/fundraising/campaignModel
 */

/**
 * Campaign types and the measures each one records.
 * @type {Readonly<Object<string, {usesQuantity: boolean, usesHours: boolean, usesUnitPrice: boolean, usesDirectAmount: boolean}>>}
 */
export const CAMPAIGN_TYPES = Object.freeze({
	fixed_price_sale: { usesQuantity: true, usesHours: false, usesUnitPrice: true, usesDirectAmount: false },
	variable_price_sale: { usesQuantity: true, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
	container_deposit: { usesQuantity: true, usesHours: false, usesUnitPrice: true, usesDirectAmount: false },
	hours_worked: { usesQuantity: false, usesHours: true, usesUnitPrice: true, usesDirectAmount: false },
	direct_amount: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
	donation: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
	sponsored_activity: { usesQuantity: false, usesHours: false, usesUnitPrice: false, usesDirectAmount: true },
	other: { usesQuantity: true, usesHours: true, usesUnitPrice: true, usesDirectAmount: true },
});

/** @type {string[]} Ordered campaign type keys, for select controls. */
export const CAMPAIGN_TYPE_KEYS = Object.freeze(Object.keys(CAMPAIGN_TYPES));

/** Campaign type used by campaigns created before the model was generalised. */
export const DEFAULT_CAMPAIGN_TYPE = "fixed_price_sale";

/**
 * Describe the measures a campaign type records.
 *
 * @param {string} campaignType - Campaign type key
 * @returns {{usesQuantity: boolean, usesHours: boolean, usesUnitPrice: boolean, usesDirectAmount: boolean}}
 */
export function campaignTypeCapabilities(campaignType) {
	return CAMPAIGN_TYPES[campaignType] || CAMPAIGN_TYPES[DEFAULT_CAMPAIGN_TYPE];
}

/**
 * Translation key describing a campaign type.
 *
 * @param {string} campaignType - Campaign type key
 * @returns {string} Translation key
 */
export function campaignTypeLabelKey(campaignType) {
	return `campaign_type_${CAMPAIGN_TYPES[campaignType] ? campaignType : DEFAULT_CAMPAIGN_TYPE}`;
}

/**
 * Parse a value to a finite number, or null when the field carries no value.
 * An empty input clears the measure instead of storing 0.
 *
 * @param {*} value - Raw input value
 * @returns {number|null} Parsed number or null
 */
export function toNullableNumber(value) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve the money raised by one entry, mirroring the server-side resolution
 * order: direct amount, then hours or quantity times unit price, then the
 * legacy unit-count column.
 *
 * @param {Object} entry - Fundraiser entry
 * @param {Object} campaign - Parent campaign
 * @returns {number} Money raised by this entry
 */
export function resolveEntryAmount(entry = {}, campaign = {}) {
	const direct = toNullableNumber(entry.amount_raised);
	if (direct !== null) {
		return direct;
	}

	const unitPrice = toNullableNumber(campaign.unit_price);
	if (unitPrice !== null) {
		const measure = campaign.campaign_type === "hours_worked"
			? toNullableNumber(entry.hours)
			: toNullableNumber(entry.quantity);
		if (measure !== null) {
			return measure * unitPrice;
		}
	}

	return toNullableNumber(entry.calendar_amount ?? entry.amount) ?? 0;
}
