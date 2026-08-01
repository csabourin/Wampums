/**
 * Scout Year Service
 *
 * The scout year is the dimension that makes a year transition non-destructive:
 * participants, points and memberships are scoped to a year rather than wiped.
 *
 * Year boundaries derive from the organization's existing `fiscal_year` setting
 * (defaults to September 1st).
 *
 * Key invariant: **the active year always contains today.** `openNextScoutYear`
 * clamps boundaries when a transition is run ahead of the nominal start date, so
 * points awarded between an early transition and September 1st land in the newly
 * opened year rather than the one that was just closed. The `points` insert
 * trigger relies on this.
 *
 * @module services/scoutYear
 */

const DEFAULT_FISCAL_START_MONTH = 9;
const DEFAULT_FISCAL_START_DAY = 1;
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const MIN_DAY = 1;
/** Highest day-of-month accepted as a fiscal year start, so every month is valid. */
const MAX_DAY = 28;

/**
 * Format a Date as an ISO calendar date (YYYY-MM-DD) in UTC.
 *
 * @param {Date} date - Date to format
 * @returns {string} ISO calendar date
 */
function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse a value into a UTC-midnight Date.
 *
 * @param {string|Date} value - ISO date string or Date
 * @returns {Date} UTC-midnight date
 */
function toUtcDate(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Today as a UTC-midnight Date.
 *
 * @returns {Date} Today
 */
function today() {
  return toUtcDate(new Date());
}

/**
 * Add a number of days to a date.
 *
 * @param {Date} date - Base date
 * @param {number} days - Days to add (may be negative)
 * @returns {Date} Shifted date
 */
function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Read the organization's fiscal year start, falling back to September 1st.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<{startMonth: number, startDay: number}>} Fiscal year start
 */
async function getFiscalYearStart(pool, organizationId) {
  const result = await pool.query(
    `SELECT setting_value
       FROM organization_settings
      WHERE organization_id = $1 AND setting_key = 'fiscal_year'
      LIMIT 1`,
    [organizationId]
  );

  const setting = result.rows[0]?.setting_value || {};
  const rawMonth = parseInt(setting.start_month, 10);
  const rawDay = parseInt(setting.start_day, 10);

  const startMonth = Number.isNaN(rawMonth) || rawMonth < MIN_MONTH || rawMonth > MAX_MONTH
    ? DEFAULT_FISCAL_START_MONTH
    : rawMonth;
  const startDay = Number.isNaN(rawDay) || rawDay < MIN_DAY || rawDay > MAX_DAY
    ? DEFAULT_FISCAL_START_DAY
    : rawDay;

  return { startMonth, startDay };
}

/**
 * Compute the nominal boundaries of the scout year containing a given date.
 *
 * Mirrors the `scout_year_for_date()` SQL function used by the migration.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @param {string|Date} [onDate] - Date to locate (defaults to today)
 * @returns {Promise<{label: string, startDate: string, endDate: string}>} Year boundaries
 */
async function computeYearBounds(pool, organizationId, onDate = today()) {
  const { startMonth, startDay } = await getFiscalYearStart(pool, organizationId);
  const reference = toUtcDate(onDate);

  let startYear = reference.getUTCFullYear();
  let start = new Date(Date.UTC(startYear, startMonth - 1, startDay));

  if (reference < start) {
    startYear -= 1;
    start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  }

  const end = addDays(new Date(Date.UTC(startYear + 1, startMonth - 1, startDay)), -1);

  return {
    label: `${startYear}-${startYear + 1}`,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end)
  };
}

/**
 * Get the organization's active scout year.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Object|null>} Active scout year row, or null
 */
async function getActiveScoutYear(pool, organizationId) {
  const result = await pool.query(
    `SELECT id, organization_id, label, start_date, end_date, status
       FROM scout_years
      WHERE organization_id = $1 AND status = 'active'
      LIMIT 1`,
    [organizationId]
  );
  return result.rows[0] || null;
}

/**
 * Get the active scout year, creating it if the organization has none.
 *
 * Used as a safety net so an organization that never ran a transition still has
 * a year to attach data to.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Object>} Active scout year row
 */
async function ensureActiveScoutYear(pool, organizationId) {
  const existing = await getActiveScoutYear(pool, organizationId);
  if (existing) {
    return existing;
  }

  const bounds = await computeYearBounds(pool, organizationId);
  const result = await pool.query(
    `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (organization_id, label) DO UPDATE SET status = 'active'
     RETURNING id, organization_id, label, start_date, end_date, status`,
    [organizationId, bounds.label, bounds.startDate, bounds.endDate]
  );
  return result.rows[0];
}

/**
 * List an organization's scout years, most recent first.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<Object>>} Scout years with participant counts
 */
async function listScoutYears(pool, organizationId) {
  const result = await pool.query(
    `SELECT sy.id, sy.label, sy.start_date, sy.end_date, sy.status,
            sy.closed_at, sy.closed_by,
            COUNT(pe.participant_id) FILTER (WHERE pe.status = 'active') AS active_participants,
            COUNT(pe.participant_id) AS total_enrollments
       FROM scout_years sy
       LEFT JOIN participant_enrollments pe
         ON pe.scout_year_id = sy.id AND pe.organization_id = sy.organization_id
      WHERE sy.organization_id = $1
      GROUP BY sy.id
      ORDER BY sy.start_date DESC`,
    [organizationId]
  );
  return result.rows;
}

/**
 * Resolve which scout year a request is about.
 *
 * Falls back to the active year when no year is requested. A requested year that
 * does not belong to the organization is rejected rather than silently ignored.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @param {number|string|null} requestedYearId - Explicitly requested year, if any
 * @returns {Promise<Object>} Scout year row
 * @throws {Error} When the requested year does not belong to the organization
 */
async function resolveScoutYear(pool, organizationId, requestedYearId = null) {
  if (requestedYearId === null || requestedYearId === undefined || requestedYearId === '') {
    return ensureActiveScoutYear(pool, organizationId);
  }

  const parsed = parseInt(requestedYearId, 10);
  if (Number.isNaN(parsed)) {
    const invalid = new Error('Invalid scout year identifier');
    invalid.code = 'INVALID_SCOUT_YEAR';
    throw invalid;
  }

  const result = await pool.query(
    `SELECT id, organization_id, label, start_date, end_date, status
       FROM scout_years
      WHERE id = $1 AND organization_id = $2`,
    [parsed, organizationId]
  );

  if (result.rows.length === 0) {
    const notFound = new Error('Scout year not found for this organization');
    notFound.code = 'SCOUT_YEAR_NOT_FOUND';
    throw notFound;
  }

  return result.rows[0];
}

/**
 * Close the active year and open the next one.
 *
 * Boundary handling keeps the "active year contains today" invariant:
 * - transition run **early** (before the nominal start): the new year starts
 *   today and the closed year ends yesterday;
 * - transition run **late** (after the nominal start): the new year keeps its
 *   nominal start, and points already awarded since that date are re-stamped
 *   from the closed year onto the new one.
 *
 * Does not move participants — that is the caller's job, inside the same
 * transaction.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {Object} options - Options
 * @param {number} options.organizationId - Organization ID
 * @param {string} options.userId - UUID of the user performing the transition
 * @returns {Promise<{previousYear: Object|null, newYear: Object, restampedPoints: number}>} Result
 */
async function openNextScoutYear(client, { organizationId, userId }) {
  const previousYear = await getActiveScoutYear(client, organizationId);
  const now = today();

  const nominalReference = previousYear
    ? addDays(toUtcDate(previousYear.end_date), 1)
    : now;
  const nominal = await computeYearBounds(client, organizationId, nominalReference);

  const nominalStart = toUtcDate(nominal.startDate);
  const effectiveStart = nominalStart > now ? now : nominalStart;

  if (previousYear && toUtcDate(previousYear.end_date) >= effectiveStart) {
    await client.query(
      `UPDATE scout_years SET end_date = $1, updated_at = now() WHERE id = $2`,
      [toIsoDate(addDays(effectiveStart, -1)), previousYear.id]
    );
  }

  if (previousYear) {
    await client.query(
      `UPDATE scout_years
          SET status = 'closed', closed_at = now(), closed_by = $1, updated_at = now()
        WHERE id = $2`,
      [userId, previousYear.id]
    );
  }

  const created = await client.query(
    `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (organization_id, label)
     DO UPDATE SET status = 'active', start_date = EXCLUDED.start_date,
                   end_date = EXCLUDED.end_date, updated_at = now()
     RETURNING id, organization_id, label, start_date, end_date, status`,
    [organizationId, nominal.label, toIsoDate(effectiveStart), nominal.endDate]
  );
  const newYear = created.rows[0];

  // Late transition: points awarded since the nominal start belong to the new year.
  let restampedPoints = 0;
  if (previousYear && effectiveStart < now) {
    const restamped = await client.query(
      `UPDATE points
          SET scout_year_id = $1
        WHERE organization_id = $2
          AND scout_year_id = $3
          AND created_at::date >= $4`,
      [newYear.id, organizationId, previousYear.id, toIsoDate(effectiveStart)]
    );
    restampedPoints = restamped.rowCount;
  }

  return { previousYear, newYear, restampedPoints };
}

/**
 * List memberships whose linked participants are no longer enrolled.
 *
 * A user is considered linked to a participant either directly
 * (`user_participants`) or through a guardian record (`guardian_users` ->
 * `participant_guardians`). Memberships holding any role other than a parent
 * role are never listed: a leader who is also a parent must keep their access.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @param {number} scoutYearId - Scout year the enrollment check runs against
 * @param {Array<string>} [parentRoleNames] - Role names considered "parent only"
 * @returns {Promise<Array<Object>>} Candidate memberships
 */
async function listMembershipsWithoutEnrolledChild(
  pool,
  organizationId,
  scoutYearId,
  parentRoleNames = ['parent', 'guardian', 'demoparent']
) {
  const result = await pool.query(
    `WITH membership_roles AS (
       SELECT uo.id AS membership_id,
              uo.user_id,
              uo.status,
              ARRAY_AGG(DISTINCT r.role_name::text) FILTER (WHERE r.role_name IS NOT NULL) AS role_names
         FROM user_organizations uo
         LEFT JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text ON TRUE
         LEFT JOIN roles r ON r.id = role_id_text::integer
        WHERE uo.organization_id = $1
        GROUP BY uo.id, uo.user_id, uo.status
     ),
     linked_participants AS (
       SELECT up.user_id, up.participant_id
         FROM user_participants up
       UNION
       SELECT gu.user_id, pg.participant_id
         FROM guardian_users gu
         JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
     )
     SELECT mr.membership_id,
            mr.user_id,
            mr.status,
            mr.role_names,
            u.email,
            u.full_name,
            COALESCE(
              ARRAY_AGG(DISTINCT p.first_name || ' ' || p.last_name)
                FILTER (WHERE p.id IS NOT NULL),
              ARRAY[]::text[]
            ) AS past_children
       FROM membership_roles mr
       JOIN users u ON u.id = mr.user_id
       LEFT JOIN linked_participants lp ON lp.user_id = mr.user_id
       LEFT JOIN participants p ON p.id = lp.participant_id
      WHERE mr.status = 'active'
        AND mr.role_names IS NOT NULL
        AND mr.role_names <@ $3::text[]
        AND NOT EXISTS (
          SELECT 1
            FROM linked_participants lp2
            JOIN participant_enrollments pe
              ON pe.participant_id = lp2.participant_id
             AND pe.organization_id = $1
             AND pe.scout_year_id = $2
             AND pe.status = 'active'
           WHERE lp2.user_id = mr.user_id
        )
      GROUP BY mr.membership_id, mr.user_id, mr.status, mr.role_names, u.email, u.full_name
      ORDER BY u.full_name NULLS LAST, u.email`,
    [organizationId, scoutYearId, parentRoleNames]
  );

  return result.rows;
}

/**
 * Flag the required forms of returning participants as needing a review.
 *
 * The content is deliberately kept: a health form or an emergency contact
 * rarely changes, and retyping it every September is how you get half-filled
 * forms. What the parent is asked for is a re-read, which they can settle by
 * confirming without changing anything.
 *
 * Only forms declared required (`organization_form_formats.is_required`) are
 * flagged — nobody needs to review last year's one-off outing form.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} organizationId - Organization ID
 * @param {Array<number>} participantIds - Participants carried over to the new year
 * @returns {Promise<Array<number>>} Ids of the submissions that were flagged
 */
async function flagRequiredFormsForReview(client, organizationId, participantIds) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return [];
  }

  const result = await client.query(
    `UPDATE form_submissions fs
        SET review_state = 'needs_review',
            flagged_for_review_at = now()
      WHERE fs.organization_id = $1
        AND fs.participant_id = ANY($2::int[])
        AND fs.review_state <> 'needs_review'
        AND EXISTS (
          SELECT 1
            FROM organization_form_formats off
           WHERE off.organization_id = fs.organization_id
             AND off.form_type = fs.form_type
             AND off.is_required = TRUE
        )
      RETURNING fs.id`,
    [organizationId, participantIds]
  );

  return result.rows.map(row => row.id);
}

/**
 * Expire the standing medication authorizations of returning participants.
 *
 * Unlike a health form, an authorization to give medication carries a parent
 * signature and a legal responsibility, so re-reading it is not enough: the
 * parent has to sign again for the new year.
 *
 * Nothing is deleted. Both tables are append-only, so the expired row stays on
 * file as the record of what was authorized last year, and the next signature
 * is inserted alongside it.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} organizationId - Organization ID
 * @param {Array<number>} participantIds - Participants carried over to the new year
 * @returns {Promise<{treatment: Array<number>, administration: Array<number>}>} Expired authorization ids
 */
async function expireMedicationAuthorizations(client, organizationId, participantIds) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return { treatment: [], administration: [] };
  }

  const expire = async (table) => {
    const result = await client.query(
      `UPDATE ${table}
          SET status = 'expired',
              expired_at = now(),
              updated_at = now()
        WHERE organization_id = $1
          AND participant_id = ANY($2::int[])
          AND status = 'signed'
        RETURNING id`,
      [organizationId, participantIds]
    );
    return result.rows.map(row => row.id);
  };

  // Table names are literals chosen here, never user input.
  const treatment = await expire('medication_treatment_authorizations');
  const administration = await expire('medication_admin_authorizations');

  return { treatment, administration };
}

module.exports = {
  DEFAULT_FISCAL_START_MONTH,
  DEFAULT_FISCAL_START_DAY,
  getFiscalYearStart,
  computeYearBounds,
  getActiveScoutYear,
  ensureActiveScoutYear,
  listScoutYears,
  resolveScoutYear,
  openNextScoutYear,
  listMembershipsWithoutEnrolledChild,
  flagRequiredFormsForReview,
  expireMedicationAuthorizations
};
