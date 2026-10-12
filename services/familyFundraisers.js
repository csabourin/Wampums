/**
 * Fundraising campaigns as a family sees them.
 *
 * The campaign screens (`fundraisers.view`, `finance.view`) show every child in
 * the unit, so a parent cannot be given them. This answers the one question a
 * family has -- "where do my children stand in the campaigns under way?" --
 * from the children linked to the account, whatever permissions it holds.
 *
 * A campaign is listed while it is not archived and either has not ended or
 * the family still has money to hand in for it: a sale that closed last week
 * with calendars unpaid is exactly what a parent comes here to check.
 *
 * @module services/familyFundraisers
 */

const {
  campaignModelColumnsSql,
  entryAmountSql,
  entryHoursSql,
  entryQuantitySql,
  hasCampaignModelColumns,
  toNullableNumber,
} = require('./fundraiserCampaigns');

/** Amounts are compared in cents so a float remainder never shows as owed. */
const CENTS_PER_UNIT = 100;

/**
 * Round a money value to cents.
 *
 * @param {number} value - Amount
 * @returns {number} Amount rounded to two decimals
 */
function roundMoney(value) {
  return Math.round(value * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

/**
 * Coerce a database value to a number, treating NULL as zero.
 *
 * @param {*} value - Raw column value (pg returns numeric as a string)
 * @returns {number} Finite number
 */
function toNumber(value) {
  return toNullableNumber(value) ?? 0;
}

/**
 * Shape one child's standing in a campaign.
 *
 * @param {Object} row - Aggregated fundraiser_entries row
 * @returns {Object} Child entry as sent to the client
 */
function formatChildEntry(row) {
  const amountDue = roundMoney(toNumber(row.amount_due));
  const amountPaid = roundMoney(toNumber(row.amount_paid));

  return {
    participant_id: row.participant_id,
    first_name: row.first_name,
    last_name: row.last_name,
    quantity: toNullableNumber(row.quantity),
    hours: toNullableNumber(row.hours),
    amount_due: amountDue,
    amount_paid: amountPaid,
    balance: Math.max(roundMoney(amountDue - amountPaid), 0),
    paid: row.paid === true,
  };
}

/**
 * The campaigns a family should see, with each of its children's standing.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} context - Who is asking
 * @param {number} context.organizationId - Unit taken from the session
 * @param {string} context.userId - Account UUID
 * @returns {Promise<{campaigns: Array<Object>, children_count: number}>}
 *   Campaigns, most recent first, and how many children the account has in the unit
 */
async function listFamilyFundraisers(pool, { organizationId, userId }) {
  const extended = await hasCampaignModelColumns(pool);

  // Only fragments built from constants are interpolated; every value is bound.
  const campaignsSql = `
    SELECT f.id, f.name, f.objective,
           to_char(f.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(f.end_date, 'YYYY-MM-DD') AS end_date,
           ${campaignModelColumnsSql('f', extended)},
           (f.end_date IS NOT NULL AND f.end_date < CURRENT_DATE) AS ended,
           COALESCE((
             SELECT SUM(c.amount_paid)
               FROM fundraiser_entries c
              WHERE c.fundraiser = f.id
           ), 0) AS total_collected
      FROM fundraisers f
     WHERE f.organization = $1
       AND (f.archived IS NULL OR f.archived = false)
     ORDER BY f.start_date DESC NULLS LAST, f.created_at DESC`;

  // user_participants has no unit of its own and a child can be enrolled in
  // several, so the enrollment in *this* unit is checked as well.
  const entriesSql = `
    SELECT c.fundraiser, c.participant_id, p.first_name, p.last_name,
           SUM(${entryQuantitySql('c', extended)}) AS quantity,
           SUM(${entryHoursSql('c', extended)}) AS hours,
           COALESCE(SUM(${entryAmountSql('c', 'f', extended)}), 0) AS amount_due,
           COALESCE(SUM(c.amount_paid), 0) AS amount_paid,
           BOOL_AND(c.paid) AS paid
      FROM fundraiser_entries c
      JOIN fundraisers f ON f.id = c.fundraiser
      JOIN participants p ON p.id = c.participant_id
      JOIN user_participants up ON up.participant_id = c.participant_id AND up.user_id = $2
      JOIN participant_organizations po ON po.participant_id = c.participant_id AND po.organization_id = $1
     WHERE f.organization = $1
       AND (f.archived IS NULL OR f.archived = false)
     GROUP BY c.fundraiser, c.participant_id, p.first_name, p.last_name
     ORDER BY p.first_name, p.last_name`;

  const childrenSql = `
    SELECT COUNT(DISTINCT up.participant_id)::int AS children_count
      FROM user_participants up
      JOIN participant_organizations po ON po.participant_id = up.participant_id AND po.organization_id = $1
     WHERE up.user_id = $2`;

  const [campaignsResult, entriesResult, childrenResult] = await Promise.all([
    pool.query(campaignsSql, [organizationId]),
    pool.query(entriesSql, [organizationId, userId]),
    pool.query(childrenSql, [organizationId, userId]),
  ]);

  const childrenByCampaign = new Map();
  entriesResult.rows.forEach((row) => {
    const key = String(row.fundraiser);
    if (!childrenByCampaign.has(key)) {
      childrenByCampaign.set(key, []);
    }
    childrenByCampaign.get(key).push(formatChildEntry(row));
  });

  const campaigns = campaignsResult.rows
    .map((row) => {
      const children = childrenByCampaign.get(String(row.id)) || [];
      const objective = toNullableNumber(row.objective);

      return {
        ended: row.ended === true,
        campaign: {
          id: Number(row.id),
          name: row.name,
          start_date: row.start_date,
          end_date: row.end_date,
          campaign_type: row.campaign_type,
          unit_price: toNullableNumber(row.unit_price),
          unit_label: row.unit_label || null,
          // The unit's progress is one total, shown only against an objective
          // the unit set: no other family's figures.
          unit_progress: objective !== null && objective > 0
            ? { objective, collected: roundMoney(toNumber(row.total_collected)) }
            : null,
          children,
        },
      };
    })
    .filter(({ ended, campaign }) => !ended || campaign.children.some((child) => child.balance > 0))
    .map(({ campaign }) => campaign);

  return {
    campaigns,
    children_count: childrenResult.rows[0]?.children_count || 0,
  };
}

module.exports = {
  listFamilyFundraisers,
};
