/**
 * Equipment loans — who has which equipment at home right now.
 *
 * After a camp, tents and tarps leave with families to dry; a stove is lent for
 * a weekend. A loan names the holder (a youth of the unit, whose family takes
 * the equipment home, or an adult member), how many units, why, and when they
 * are due back. Returns are recorded as a count, so returning part of a loan,
 * or correcting a return, is the same idempotent write.
 *
 * Mounted at /api/v1/equipment-loans.
 *
 * @module routes/equipmentLoans
 */
const express = require('express');
const { createHash } = require('node:crypto');
const { check, query } = require('express-validator');

const {
  authenticate,
  getOrganizationId,
  requirePermission,
  blockDemoRoles,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation, validateIdParam, validateIdQuery } = require('../middleware/validation');
const { findAccessibleEquipmentIds, listAccessibleEquipmentIds } = require('../services/equipmentAccess');
const { listUnitLeaders } = require('../services/unitLeaders');

const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** Why equipment left storage. */
const LOAN_REASONS = ['drying', 'cleaning', 'repair', 'storage', 'other'];
/** Loans one handout may record: a camp's equipment split between its families. */
const MAX_LOANS_PER_REQUEST = 100;
/** Units of one item a single loan may name. */
const MAX_LOAN_QUANTITY = 10000;
/** Length of the free-text notes, as the columns allow. */
const MAX_NOTE_LENGTH = 500;
/** Activities offered for a handout: those that ended up to this many days ago… */
const HANDOUT_PAST_DAYS = 30;
/** …or start within this many days. */
const HANDOUT_UPCOMING_DAYS = 7;
const MAX_HANDOUT_ACTIVITIES = 20;
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;
/** Characters of YYYY-MM-DD at the start of an ISO 8601 date. */
const ISO_DATE_LENGTH = 10;

/** Reading loans: staff of the unit, since loans name its youths. */
const VIEW_POLICY = { permissions: ['inventory.view'], organizationScope: true };
/** Lending and taking back: the right to reserve equipment. */
const LEND_POLICY = { permissions: ['inventory.reserve'], organizationScope: true };
/** Preparing a handout also lists the unit's youths and leaders to choose from. */
const HANDOUT_POLICY = { permissions: ['inventory.reserve', 'participants.view'], organizationScope: true };

/**
 * A loan as the SPA reads it, with the names it shows.
 *
 * The holder's name comes from the participant or the account; both are NULL
 * once the holder was erased, and the SPA then says "former member".
 */
const LOAN_SELECT = `
  SELECT el.id, el.equipment_id, el.activity_id, el.holder_participant_id, el.holder_user_id,
         el.quantity, el.returned_quantity, (el.quantity - el.returned_quantity) AS outstanding_quantity,
         el.reason, el.loaned_on::text AS loaned_on, el.due_date::text AS due_date, el.returned_at,
         el.returned_at::date::text AS returned_on,
         el.notes, el.return_note, el.created_at, el.updated_at,
         (el.returned_at IS NULL AND el.due_date IS NOT NULL AND el.due_date < CURRENT_DATE) AS overdue,
         ei.name AS equipment_name, ei.category AS equipment_category,
         a.name AS activity_name,
         CASE
           WHEN p.id IS NOT NULL THEN 'participant'
           WHEN u.id IS NOT NULL THEN 'user'
           ELSE NULL
         END AS holder_type,
         COALESCE(NULLIF(TRIM(CONCAT(p.first_name, ' ', p.last_name)), ''), u.full_name) AS holder_name
    FROM equipment_loans el
    JOIN equipment_items ei ON ei.id = el.equipment_id
    LEFT JOIN activities a ON a.id = el.activity_id
    LEFT JOIN participants p ON p.id = el.holder_participant_id
    LEFT JOIN users u ON u.id = el.holder_user_id`;

/**
 * A unit's loans ($1): open, returned or all ($2), optionally for one
 * activity ($3) or item ($4). Overdue first, then the open ones by holder,
 * then the latest returns.
 */
const LIST_LOANS_SQL = `${LOAN_SELECT}
  WHERE el.organization_id = $1
    AND ($2 = 'all' OR ($2 = 'open') = (el.returned_at IS NULL))
    AND ($3::int IS NULL OR el.activity_id = $3)
    AND ($4::int IS NULL OR el.equipment_id = $4)
  ORDER BY COALESCE(el.returned_at IS NULL AND el.due_date < CURRENT_DATE, false) DESC,
           el.returned_at DESC NULLS FIRST,
           holder_name NULLS LAST, ei.name, el.id`;

/** Loans by id ($1), in id order. */
const LOANS_BY_IDS_SQL = `${LOAN_SELECT} WHERE el.id = ANY($1::int[]) ORDER BY el.id`;

/**
 * Today's date in the database's calendar, as YYYY-MM-DD.
 * @param {Object} db - Pool or client
 * @returns {Promise<string>}
 */
async function databaseToday(db) {
  const result = await db.query('SELECT CURRENT_DATE::text AS today');
  return result.rows[0].today;
}

/**
 * The most units of each item that would be committed on any one day, from
 * today to the loan's due date (with no end, for a loan with no due date), if
 * the loan were recorded.
 *
 * Commitments are the reservations still holding stock, the loans already
 * out, across every unit, until they are due back (with no end once overdue,
 * or with no due date: nobody knows when those come back), and the loan being
 * checked. A loan made for an activity is that activity's reservation leaving
 * the shelf, so on each day an activity commits the larger of what it reserved
 * and what its loans keep out, never both. A loan being changed is checked in
 * place of itself.
 *
 * Peaks, not sums: three tents back tomorrow and three reserved next weekend
 * never need more than three at once. The busiest day is always a day some
 * commitment starts (today, for those already under way), so only those days
 * are counted.
 *
 * @param {Object} db - Pool or client
 * @param {Map<number, number>} wanted - Units the loan keeps out, by item
 * @param {{until: (string|null), activityId: (number|null), exceptLoanId: (number|null)}} loan
 * @returns {Promise<Map<number, number>>} Peak committed units by item, the loan included
 */
async function peakWithLoan(db, wanted, { until, activityId, exceptLoanId }) {
  const ids = [...wanted.keys()];
  const result = await db.query(
    `WITH new_loan AS (
       SELECT (entry->>'equipment_id')::int AS equipment_id, (entry->>'quantity')::int AS quantity
         FROM jsonb_array_elements($5::jsonb) AS entry
     ),
     commitments AS (
       SELECT r.equipment_id, 'reservation' AS kind,
              COALESCE('activity:' || r.activity_id, 'reservation:' || r.id) AS commitment_group,
              r.reserved_quantity AS quantity,
              GREATEST(COALESCE(r.date_from, r.meeting_date), CURRENT_DATE) AS starts,
              COALESCE(r.date_to, r.meeting_date) AS ends
         FROM equipment_reservations r
        WHERE r.equipment_id = ANY($1::int[])
          AND r.status IN ('reserved', 'confirmed')
          AND COALESCE(r.date_to, r.meeting_date) >= CURRENT_DATE
          AND ($2::date IS NULL OR COALESCE(r.date_from, r.meeting_date) <= $2::date)
       UNION ALL
       SELECT l.equipment_id, 'loan',
              COALESCE('activity:' || l.activity_id, 'loan:' || l.id),
              l.quantity - l.returned_quantity,
              CURRENT_DATE,
              CASE WHEN l.due_date IS NULL OR l.due_date < CURRENT_DATE THEN 'infinity'::date ELSE l.due_date END
         FROM equipment_loans l
        WHERE l.equipment_id = ANY($1::int[])
          AND l.returned_at IS NULL
          AND ($4::int IS NULL OR l.id <> $4::int)
       UNION ALL
       SELECT n.equipment_id, 'loan',
              COALESCE('activity:' || $3::int, 'new loan'),
              n.quantity,
              CURRENT_DATE,
              COALESCE($2::date, 'infinity'::date)
         FROM new_loan n
     ),
     days AS (
       SELECT DISTINCT equipment_id, starts AS day FROM commitments
     ),
     by_group AS (
       SELECT d.equipment_id, d.day,
              GREATEST(
                COALESCE(SUM(c.quantity) FILTER (WHERE c.kind = 'reservation'), 0),
                COALESCE(SUM(c.quantity) FILTER (WHERE c.kind = 'loan'), 0)
              ) AS committed
         FROM days d
         JOIN commitments c
           ON c.equipment_id = d.equipment_id AND c.starts <= d.day AND c.ends >= d.day
        GROUP BY d.equipment_id, d.day, c.commitment_group
     )
     SELECT equipment_id, MAX(total)::int AS peak
       FROM (SELECT equipment_id, day, SUM(committed) AS total FROM by_group GROUP BY equipment_id, day) AS per_day
      GROUP BY equipment_id`,
    [
      ids,
      until,
      activityId,
      exceptLoanId,
      JSON.stringify(ids.map((id) => ({ equipment_id: id, quantity: wanted.get(id) }))),
    ],
  );
  return new Map(result.rows.map((row) => [Number(row.equipment_id), Number(row.peak)]));
}

/**
 * Lock the items about to be lent and check the unit has enough of each on
 * every day until the loan is due back.
 *
 * Locking the item rows, in id order, makes two devices lending the same tents
 * at once wait for each other, so together they never lend more than exist.
 *
 * @param {Object} client - Client inside an open transaction
 * @param {Map<number, number>} wanted - Units the loan keeps out, by item
 * @param {{until: (string|null), activityId: (number|null), exceptLoanId?: (number|null)}} loan -
 *   The loan's due date and activity, and its id when an existing loan is checked in its own place
 * @returns {Promise<Array<{equipment_id: number, available: number, requested: number}>>}
 *   The items there are not enough of; empty when the loan fits
 */
async function findShortages(client, wanted, { until, activityId, exceptLoanId = null }) {
  const ids = [...wanted.keys()].sort((a, b) => a - b);
  const items = await client.query(
    `SELECT id, quantity_total FROM equipment_items
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [ids],
  );
  const peaks = await peakWithLoan(client, wanted, { until, activityId, exceptLoanId });
  return items.rows
    .map((item) => {
      const id = Number(item.id);
      const total = Number(item.quantity_total);
      const requested = wanted.get(id);
      const peak = peaks.get(id) || 0;
      return { equipment_id: id, available: Math.max(0, total - (peak - requested)), requested, fits: peak <= total };
    })
    .filter((item) => !item.fits)
    .map(({ fits: _fits, ...shortage }) => shortage);
}

/**
 * Whether every named youth is on this year's roster of the unit and every
 * named adult an active member of it.
 *
 * @param {Object} db - Pool or client
 * @param {number} organizationId - Unit
 * @param {number[]} participantIds - Youths named as holders
 * @param {string[]} userIds - Adults named as holders
 * @returns {Promise<boolean>}
 */
async function holdersBelongToUnit(db, organizationId, participantIds, userIds) {
  const youths = [...new Set(participantIds)];
  const adults = [...new Set(userIds)];
  const [youthResult, adultResult] = await Promise.all([
    youths.length
      ? db.query(
        `SELECT COUNT(DISTINCT participant_id)::int AS found FROM participant_organizations
          WHERE organization_id = $1 AND participant_id = ANY($2::int[])`,
        [organizationId, youths],
      )
      : { rows: [{ found: 0 }] },
    adults.length
      ? db.query(
        `SELECT COUNT(DISTINCT user_id)::int AS found FROM user_organizations
          WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
        [organizationId, adults],
      )
      : { rows: [{ found: 0 }] },
  ]);
  return youthResult.rows[0].found === youths.length && adultResult.rows[0].found === adults.length;
}

module.exports = (pool) => {
  const router = express.Router();

  /**
   * The unit's loans: open ones by default, or returned ones, or all.
   * Overdue loans come first, then by holder.
   */
  router.get(
    '/',
    authenticate,
    requirePermission(VIEW_POLICY),
    [
      query('status').optional().isIn(['open', 'returned', 'all']),
      validateIdQuery('activity_id'),
      validateIdQuery('equipment_id'),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const status = req.query.status || 'open';
      const activityId = req.query.activity_id ? Number(req.query.activity_id) : null;
      const equipmentId = req.query.equipment_id ? Number(req.query.equipment_id) : null;

      const result = await pool.query(
        LIST_LOANS_SQL,
        [organizationId, status, activityId, equipmentId],
      );
      return success(res, { loans: result.rows });
    }),
  );

  /**
   * Everything the handout screen needs at once: the activities around today,
   * the equipment to hand out (what the chosen activity reserved, or all the
   * unit may use), and the youths and leaders who may take it home.
   */
  router.get(
    '/handout',
    authenticate,
    requirePermission(HANDOUT_POLICY),
    [validateIdQuery('activity_id')],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = req.query.activity_id ? Number(req.query.activity_id) : null;

      const activitiesResult = await pool.query(
        `SELECT a.id, a.name,
                a.activity_start_date::text AS start_date, a.activity_end_date::text AS end_date,
                EXISTS (
                  SELECT 1 FROM equipment_reservations er
                   WHERE er.activity_id = a.id AND er.organization_id = a.organization_id
                     AND er.status IN ('reserved', 'confirmed', 'expired')
                ) AS has_reservations
           FROM activities a
          WHERE a.organization_id = $1
            AND a.is_active IS DISTINCT FROM false
            AND a.activity_end_date >= CURRENT_DATE - $2::int
            AND a.activity_start_date <= CURRENT_DATE + $3::int
          ORDER BY a.activity_end_date DESC, a.id DESC
          LIMIT $4`,
        [organizationId, HANDOUT_PAST_DAYS, HANDOUT_UPCOMING_DAYS, MAX_HANDOUT_ACTIVITIES],
      );

      let activity = null;
      if (activityId) {
        const activityResult = await pool.query(
          `SELECT id, name, activity_start_date::text AS start_date, activity_end_date::text AS end_date
             FROM activities
            WHERE id = $1 AND organization_id = $2 AND is_active IS DISTINCT FROM false`,
          [activityId, organizationId],
        );
        if (activityResult.rows.length === 0) {
          return error(res, 'activity_not_found', HTTP_NOT_FOUND);
        }
        activity = activityResult.rows[0];
      }

      // Reservations whose date has passed are swept to `expired`; the camp's
      // equipment is still to be handed out the day after, so they count here.
      const itemsResult = activity
        ? await pool.query(
          `SELECT ei.id AS equipment_id, ei.name, ei.category, ei.quantity_total,
                  SUM(er.reserved_quantity)::int AS reserved_quantity,
                  equipment_loaned_quantity(ei.id, CURRENT_DATE) AS out_quantity,
                  COALESCE((
                    SELECT SUM(el.quantity - el.returned_quantity)
                      FROM equipment_loans el
                     WHERE el.equipment_id = ei.id AND el.activity_id = $2
                       AND el.organization_id = $1 AND el.returned_at IS NULL
                  ), 0)::int AS lent_for_activity
             FROM equipment_reservations er
             JOIN equipment_items ei ON ei.id = er.equipment_id
            WHERE er.organization_id = $1 AND er.activity_id = $2
              AND er.status IN ('reserved', 'confirmed', 'expired')
              AND ei.is_active IS DISTINCT FROM false
            GROUP BY ei.id
            ORDER BY ei.category NULLS LAST, ei.name`,
          [organizationId, activity.id],
        )
        : { rows: [] };

      let items = itemsResult.rows;
      if (!activity) {
        const accessible = await listAccessibleEquipmentIds(pool, organizationId);
        const allResult = await pool.query(
          `SELECT ei.id AS equipment_id, ei.name, ei.category, ei.quantity_total,
                  NULL::int AS reserved_quantity,
                  equipment_loaned_quantity(ei.id, CURRENT_DATE) AS out_quantity,
                  0 AS lent_for_activity
             FROM equipment_items ei
            WHERE ei.id = ANY($1::int[])
            ORDER BY ei.category NULLS LAST, ei.name`,
          [accessible],
        );
        items = allResult.rows;
      }

      const [participantsResult, leaders] = await Promise.all([
        pool.query(
          `SELECT DISTINCT p.id, p.first_name, p.last_name
             FROM participant_organizations po
             JOIN participants p ON p.id = po.participant_id
            WHERE po.organization_id = $1
            ORDER BY p.first_name, p.last_name, p.id`,
          [organizationId],
        ),
        listUnitLeaders(pool, organizationId),
      ]);

      return success(res, {
        activities: activitiesResult.rows,
        activity,
        items,
        holders: {
          participants: participantsResult.rows,
          adults: leaders.map((leader) => ({ id: leader.id, full_name: leader.full_name })),
        },
        reasons: LOAN_REASONS,
      });
    }),
  );

  /**
   * Record a handout: one or more loans, all or none.
   *
   * Replayable from the offline outbox: an Idempotency-Key claims a receipt
   * that commits with the loans, so a retried request answers what the first
   * one recorded instead of lending twice.
   */
  router.post(
    '/',
    authenticate,
    blockDemoRoles,
    requirePermission(LEND_POLICY),
    [
      check('activity_id').optional({ values: 'null' }).isInt({ min: 1, max: 2147483647 }),
      check('reason').optional().isIn(LOAN_REASONS),
      check('due_date').optional({ values: 'falsy' }).isISO8601({ strict: true }),
      check('notes').optional({ values: 'null' }).isString().trim().isLength({ max: MAX_NOTE_LENGTH }),
      check('loans').isArray({ min: 1, max: MAX_LOANS_PER_REQUEST }),
      check('loans.*.equipment_id').isInt({ min: 1, max: 2147483647 }),
      check('loans.*.quantity').isInt({ min: 1, max: MAX_LOAN_QUANTITY }),
      check('loans.*.participant_id').optional({ values: 'null' }).isInt({ min: 1, max: 2147483647 }),
      check('loans.*.user_id').optional({ values: 'null' }).isUUID(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const idempotencyKey = req.get('Idempotency-Key');
      if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        return error(res, 'invalid_request', HTTP_BAD_REQUEST);
      }

      const activityId = req.body.activity_id ? Number(req.body.activity_id) : null;
      const reason = req.body.reason || 'drying';
      const dueDate = req.body.due_date ? String(req.body.due_date).slice(0, ISO_DATE_LENGTH) : null;
      const notes = req.body.notes ? String(req.body.notes).trim() || null : null;
      const loans = req.body.loans.map((loan) => ({
        equipmentId: Number(loan.equipment_id),
        quantity: Number(loan.quantity),
        participantId: loan.participant_id ? Number(loan.participant_id) : null,
        userId: loan.user_id ? String(loan.user_id) : null,
      }));

      if (loans.some((loan) => (loan.participantId === null) === (loan.userId === null))) {
        return error(res, 'equipment_loan_holder_required', HTTP_BAD_REQUEST);
      }

      const requestHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (idempotencyKey) {
          const claim = await client.query(
            `INSERT INTO equipment_loan_receipts (organization_id, user_id, mutation_key, request_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (organization_id, user_id, mutation_key) DO NOTHING
             RETURNING mutation_key`,
            [organizationId, req.user.id, idempotencyKey, requestHash],
          );
          if (claim.rows.length === 0) {
            const existing = await client.query(
              `SELECT request_hash, response_data FROM equipment_loan_receipts
                WHERE organization_id = $1 AND user_id = $2 AND mutation_key = $3`,
              [organizationId, req.user.id, idempotencyKey],
            );
            if (existing.rows[0].request_hash !== requestHash) {
              await client.query('ROLLBACK');
              return error(res, 'idempotency_key_reused', HTTP_CONFLICT);
            }
            // The receipt keeps only loan ids: the answer is read from the
            // loans as they are now, so an erased holder stays erased.
            const loanIds = existing.rows[0].response_data?.loan_ids || [];
            const replayed = await client.query(LOANS_BY_IDS_SQL, [loanIds]);
            await client.query('ROLLBACK');
            return success(res, { loans: replayed.rows, count: replayed.rows.length }, 'Equipment loans recorded', HTTP_CREATED);
          }
        }

        const today = await databaseToday(client);
        if (dueDate && dueDate < today) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_due_date_past', HTTP_BAD_REQUEST);
        }

        if (activityId) {
          const activityResult = await client.query(
            'SELECT 1 FROM activities WHERE id = $1 AND organization_id = $2',
            [activityId, organizationId],
          );
          if (activityResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return error(res, 'activity_not_found', HTTP_NOT_FOUND);
          }
        }

        const wanted = new Map();
        loans.forEach((loan) => {
          wanted.set(loan.equipmentId, (wanted.get(loan.equipmentId) || 0) + loan.quantity);
        });
        const accessible = await findAccessibleEquipmentIds(client, organizationId, [...wanted.keys()]);
        if (accessible.size !== wanted.size) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_not_found', HTTP_NOT_FOUND);
        }

        const holdersOk = await holdersBelongToUnit(
          client,
          organizationId,
          loans.filter((loan) => loan.participantId).map((loan) => loan.participantId),
          loans.filter((loan) => loan.userId).map((loan) => loan.userId),
        );
        if (!holdersOk) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_holder_not_in_unit', HTTP_BAD_REQUEST);
        }

        const shortages = await findShortages(client, wanted, { until: dueDate, activityId });
        if (shortages.length > 0) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_exceeds_stock', HTTP_CONFLICT, shortages);
        }

        const inserted = await client.query(
          `INSERT INTO equipment_loans
             (organization_id, equipment_id, activity_id, holder_participant_id, holder_user_id,
              quantity, reason, due_date, notes, created_by)
           SELECT $1, item.equipment_id, $2, item.participant_id, item.user_id,
                  item.quantity, $3, $4, $5, $6
             FROM jsonb_to_recordset($7::jsonb)
               AS item(equipment_id int, participant_id int, user_id uuid, quantity int)
           RETURNING id`,
          [
            organizationId,
            activityId,
            reason,
            dueDate,
            notes,
            req.user.id,
            JSON.stringify(loans.map((loan) => ({
              equipment_id: loan.equipmentId,
              participant_id: loan.participantId,
              user_id: loan.userId,
              quantity: loan.quantity,
            }))),
          ],
        );
        const loanIds = inserted.rows.map((row) => row.id);
        const created = await client.query(LOANS_BY_IDS_SQL, [loanIds]);
        const responseData = { loans: created.rows, count: created.rows.length };

        if (idempotencyKey) {
          await client.query(
            `UPDATE equipment_loan_receipts SET response_data = $4::jsonb
              WHERE organization_id = $1 AND user_id = $2 AND mutation_key = $3`,
            [organizationId, req.user.id, idempotencyKey, JSON.stringify({ loan_ids: loanIds })],
          );
        }
        await client.query('COMMIT');
        return success(res, responseData, 'Equipment loans recorded', HTTP_CREATED);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  /**
   * Record what came back (`returned_quantity`, a count, not an increment),
   * a note on its state, or a new due date. Bringing a loan back out (a lower
   * count) checks the stock again, since the units may have been lent since.
   */
  router.patch(
    '/:id',
    authenticate,
    blockDemoRoles,
    requirePermission(LEND_POLICY),
    [
      validateIdParam('id'),
      check('returned_quantity').optional().isInt({ min: 0, max: MAX_LOAN_QUANTITY }),
      check('return_note').optional({ values: 'null' }).isString().trim().isLength({ max: MAX_NOTE_LENGTH }),
      check('due_date').optional({ values: 'null' }).isISO8601({ strict: true }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const loanId = Number(req.params.id);
      const has = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
      if (!has('returned_quantity') && !has('return_note') && !has('due_date')) {
        return error(res, 'invalid_request', HTTP_BAD_REQUEST);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query(
          `SELECT id, equipment_id, activity_id, quantity, returned_quantity,
                  loaned_on::text AS loaned_on, due_date::text AS due_date
             FROM equipment_loans
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE`,
          [loanId, organizationId],
        );
        if (current.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_not_found', HTTP_NOT_FOUND);
        }
        const loan = current.rows[0];
        const returnedQuantity = has('returned_quantity')
          ? Number(req.body.returned_quantity)
          : Number(loan.returned_quantity);
        if (returnedQuantity > Number(loan.quantity)) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_return_exceeds_quantity', HTTP_BAD_REQUEST);
        }
        const dueDate = has('due_date') && req.body.due_date ? String(req.body.due_date).slice(0, ISO_DATE_LENGTH) : null;
        if (dueDate && dueDate < loan.loaned_on) {
          await client.query('ROLLBACK');
          return error(res, 'equipment_loan_due_date_past', HTTP_BAD_REQUEST);
        }

        // Taking units back out, or keeping them out longer (a later due date,
        // or none), can collide with reservations; check the stock again.
        const goingBackOut = returnedQuantity < Number(loan.returned_quantity);
        const stillOut = returnedQuantity < Number(loan.quantity);
        const keptLonger = has('due_date') && stillOut && loan.due_date !== null
          && (dueDate === null || dueDate > loan.due_date);
        if (goingBackOut || keptLonger) {
          // The loan is checked in its own place: what it keeps out, until
          // its new due date, against everything else.
          const keptOut = Number(loan.quantity) - returnedQuantity;
          const shortages = await findShortages(client, new Map([[Number(loan.equipment_id), keptOut]]), {
            until: has('due_date') ? dueDate : loan.due_date,
            activityId: loan.activity_id,
            exceptLoanId: Number(loan.id),
          });
          if (shortages.length > 0) {
            await client.query('ROLLBACK');
            return error(res, 'equipment_loan_exceeds_stock', HTTP_CONFLICT, shortages);
          }
        }

        await client.query(
          `UPDATE equipment_loans
              SET returned_quantity = $3,
                  returned_at = CASE WHEN $3 = quantity THEN COALESCE(returned_at, NOW()) ELSE NULL END,
                  returned_by = CASE WHEN $3 <> returned_quantity THEN $4::uuid ELSE returned_by END,
                  return_note = CASE WHEN $5 THEN $6 ELSE return_note END,
                  due_date = CASE WHEN $7 THEN $8::date ELSE due_date END,
                  updated_at = NOW()
            WHERE id = $1 AND organization_id = $2`,
          [
            loanId,
            organizationId,
            returnedQuantity,
            req.user.id,
            has('return_note'),
            has('return_note') && req.body.return_note ? String(req.body.return_note).trim() || null : null,
            has('due_date'),
            dueDate,
          ],
        );
        const updated = await client.query(LOANS_BY_IDS_SQL, [[loanId]]);
        await client.query('COMMIT');
        return success(res, { loan: updated.rows[0] }, 'Equipment loan updated');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  /** Remove a loan recorded by mistake (wrong person, wrong item). */
  router.delete(
    '/:id',
    authenticate,
    blockDemoRoles,
    requirePermission(LEND_POLICY),
    [validateIdParam('id')],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const result = await pool.query(
        'DELETE FROM equipment_loans WHERE id = $1 AND organization_id = $2 RETURNING id',
        [Number(req.params.id), organizationId],
      );
      if (result.rows.length === 0) {
        return error(res, 'equipment_loan_not_found', HTTP_NOT_FOUND);
      }
      return success(res, null, 'Equipment loan deleted');
    }),
  );

  return router;
};
