/**
 * A participant fee's status follows its payments: paid once they cover its
 * total, partial while some are recorded, unpaid otherwise. Nobody sets it by
 * hand; every change of amount or payment recalculates it.
 *
 * @module services/feeStatus
 */

/**
 * Recalculate one fee's status from its total and its payments.
 * @param {Object} db - Pool or client (the one that changed the fee or its payments)
 * @param {number} feeId - Participant fee
 * @param {number} organizationId - Its unit
 * @returns {Promise<Object|undefined>} The fee row, with its new status
 */
async function recalculateFeeStatus(db, feeId, organizationId) {
  const result = await db.query(
    `UPDATE participant_fees pf
        SET status = CASE
              WHEN paid.total >= pf.total_amount THEN 'paid'
              WHEN paid.total > 0 THEN 'partial'
              ELSE 'unpaid'
            END
       FROM (SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE participant_fee_id = $1) AS paid
      WHERE pf.id = $1 AND pf.organization_id = $2
      RETURNING pf.*`,
    [feeId, organizationId]
  );
  return result.rows[0];
}

module.exports = { recalculateFeeStatus };
