/**
 * Scout Year Routes
 *
 * Year lifecycle for a unit: consult the year history, preview what a transition
 * would do, run it, and manage membership status.
 *
 * The guiding rule is that nothing is deleted. Closing a year leaves every
 * enrollment, point and account in place; they simply stop belonging to the
 * active year.
 *
 * @module routes/scoutYears
 */

const express = require('express');
const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const {
  computeYearBounds,
  ensureActiveScoutYear,
  listScoutYears,
  openNextScoutYear,
  listMembershipsWithoutEnrolledChild
} = require('../services/scoutYear');

/** Age at which a participant leaves the section, unless configured otherwise. */
const DEFAULT_MAX_AGE = 12;
/** Reference day used to evaluate that age: December 31st of the starting year. */
const DEFAULT_AGE_REFERENCE = '12-31';

module.exports = (pool, logger) => {
  const router = express.Router();

  /**
   * Read the organization's year transition rules.
   *
   * @param {number} organizationId - Organization ID
   * @returns {Promise<{maxAge: number, ageReference: string}>} Transition rules
   */
  async function getTransitionSettings(organizationId) {
    const result = await pool.query(
      `SELECT setting_value FROM organization_settings
        WHERE organization_id = $1 AND setting_key = 'year_transition'
        LIMIT 1`,
      [organizationId]
    );

    const setting = result.rows[0]?.setting_value || {};
    const maxAge = parseInt(setting.max_age, 10);

    return {
      maxAge: Number.isNaN(maxAge) ? DEFAULT_MAX_AGE : maxAge,
      ageReference: typeof setting.age_reference_date === 'string'
        ? setting.age_reference_date
        : DEFAULT_AGE_REFERENCE
    };
  }

  /**
   * @swagger
   * /api/v1/scout-years:
   *   get:
   *     summary: List the organization's scout years
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Scout years, most recent first
   */
  router.get('/', authenticate, requirePermission('scout_year.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    await ensureActiveScoutYear(pool, organizationId);
    const years = await listScoutYears(pool, organizationId);
    return success(res, years);
  }));

  /**
   * @swagger
   * /api/v1/scout-years/active:
   *   get:
   *     summary: Get the active scout year
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Active scout year
   */
  router.get('/active', authenticate, requirePermission('scout_year.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const scoutYear = await ensureActiveScoutYear(pool, organizationId);
    return success(res, scoutYear);
  }));

  /**
   * @swagger
   * /api/v1/scout-years/transition/preview:
   *   get:
   *     summary: Preview the next year transition
   *     description: >
   *       Proposes a disposition for every enrolled participant and lists the
   *       parent accounts that would end up without an enrolled child. Changes
   *       nothing.
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Proposed transition
   */
  router.get('/transition/preview', authenticate, requirePermission('scout_year.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const currentYear = await ensureActiveScoutYear(pool, organizationId);
    const { maxAge, ageReference } = await getTransitionSettings(organizationId);

    // Boundaries the next year would get, and the date its age rule refers to.
    const nextBounds = await computeYearBounds(
      pool,
      organizationId,
      new Date(new Date(currentYear.end_date).getTime() + 86400000)
    );
    const referenceDate = `${nextBounds.label.split('-')[0]}-${ageReference}`;

    const participantsResult = await pool.query(
      `SELECT p.id,
              p.first_name,
              p.last_name,
              p.date_naissance,
              g.name AS group_name,
              CASE
                WHEN p.date_naissance IS NULL THEN NULL
                ELSE date_part('year', age($3::date, p.date_naissance))::int
              END AS age_at_reference,
              COALESCE((
                SELECT SUM(value) FROM points
                 WHERE participant_id = p.id AND scout_year_id = $2
              ), 0) AS points_this_year
         FROM participant_enrollments pe
         JOIN participants p ON p.id = pe.participant_id
         LEFT JOIN participant_groups pg ON pg.participant_id = p.id AND pg.organization_id = $1
         LEFT JOIN groups g ON g.id = pg.group_id
        WHERE pe.organization_id = $1
          AND pe.scout_year_id = $2
          AND pe.status = 'active'
        ORDER BY p.first_name, p.last_name`,
      [organizationId, currentYear.id, referenceDate]
    );

    // A participant with no birth date is never graduated automatically: the
    // leader has to decide.
    const participants = participantsResult.rows.map(row => ({
      ...row,
      points_this_year: parseInt(row.points_this_year, 10),
      disposition: row.age_at_reference !== null && row.age_at_reference >= maxAge
        ? 'graduating'
        : 'returning',
      needs_review: row.age_at_reference === null
    }));

    const proposedGraduatingIds = participants
      .filter(p => p.disposition === 'graduating')
      .map(p => p.id);

    // The wizard re-asks for a preview once the leader has overridden some
    // dispositions, so the list of affected parents stays in sync with the
    // choices actually made.
    const overrideIds = typeof req.query.graduating_ids === 'string'
      ? req.query.graduating_ids
        .split(',')
        .map(value => parseInt(value.trim(), 10))
        .filter(value => !Number.isNaN(value))
      : null;
    const graduatingIds = overrideIds === null ? proposedGraduatingIds : overrideIds;

    // Which parents would be left without an enrolled child, assuming those
    // dispositions are applied.
    const membershipCandidates = await listMembershipsWithoutEnrolledChild(
      pool,
      organizationId,
      currentYear.id
    );
    const membershipsAfterTransition = graduatingIds.length === 0
      ? membershipCandidates
      : await pool.query(
        `WITH linked_participants AS (
           SELECT up.user_id, up.participant_id FROM user_participants up
           UNION
           SELECT gu.user_id, pg.participant_id
             FROM guardian_users gu
             JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
         ),
         staying AS (
           SELECT pe.participant_id
             FROM participant_enrollments pe
            WHERE pe.organization_id = $1
              AND pe.scout_year_id = $2
              AND pe.status = 'active'
              AND NOT (pe.participant_id = ANY($3::int[]))
         )
         SELECT uo.id AS membership_id, uo.user_id, u.email, u.full_name,
                ARRAY_AGG(DISTINCT r.role_name::text) FILTER (WHERE r.role_name IS NOT NULL) AS role_names
           FROM user_organizations uo
           JOIN users u ON u.id = uo.user_id
           LEFT JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text ON TRUE
           LEFT JOIN roles r ON r.id = role_id_text::integer
          WHERE uo.organization_id = $1
            AND uo.status = 'active'
          GROUP BY uo.id, uo.user_id, u.email, u.full_name
         HAVING ARRAY_AGG(DISTINCT r.role_name::text) FILTER (WHERE r.role_name IS NOT NULL)
                  <@ ARRAY['parent','guardian','demoparent']::text[]
            AND NOT EXISTS (
              SELECT 1 FROM linked_participants lp
               JOIN staying s ON s.participant_id = lp.participant_id
              WHERE lp.user_id = uo.user_id
            )
          ORDER BY u.full_name NULLS LAST, u.email`,
        [organizationId, currentYear.id, graduatingIds]
      ).then(result => result.rows);

    return success(res, {
      current_year: currentYear,
      next_year: nextBounds,
      age_rule: { max_age: maxAge, reference_date: referenceDate },
      participants,
      memberships_to_deactivate: membershipsAfterTransition,
      counts: {
        returning: participants.length - graduatingIds.length,
        graduating: graduatingIds.length,
        needs_review: participants.filter(p => p.needs_review).length,
        memberships_to_deactivate: membershipsAfterTransition.length
      }
    });
  }));

  /**
   * @swagger
   * /api/v1/scout-years/transition:
   *   post:
   *     summary: Close the active year and open the next one
   *     description: >
   *       Applies the dispositions confirmed by the leader. Participants who
   *       leave keep their enrollment record, flagged as graduated; returning
   *       participants get a fresh enrollment in the new year. Deactivated
   *       parent accounts keep every link and can be reactivated.
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       201:
   *         description: Transition executed
   *       400:
   *         description: Invalid payload
   */
  router.post('/transition', authenticate, blockDemoRoles, requirePermission('scout_year.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const {
      graduating_participant_ids: graduatingInput = [],
      deactivate_membership_ids: deactivateInput = [],
      exceptions = []
    } = req.body || {};

    if (!Array.isArray(graduatingInput) || !Array.isArray(deactivateInput)) {
      return error(res, 'graduating_participant_ids and deactivate_membership_ids must be arrays', 400);
    }

    const graduatingIds = graduatingInput.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
    const membershipIds = deactivateInput.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
    // Notes recorded for participants the leader kept despite the age rule.
    const exceptionNotes = new Map(
      (Array.isArray(exceptions) ? exceptions : [])
        .filter(item => item && item.participant_id)
        .map(item => [parseInt(item.participant_id, 10), String(item.note || '').slice(0, 500)])
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { previousYear, newYear, restampedPoints } = await openNextScoutYear(client, {
        organizationId,
        userId: req.user.id
      });

      if (!previousYear) {
        await client.query('ROLLBACK');
        return error(res, 'No active scout year to close', 409);
      }

      // Close the enrollments of participants who are leaving. The rows stay.
      const graduated = await client.query(
        `UPDATE participant_enrollments
            SET status = 'graduated',
                ended_on = $4::date,
                exit_reason = COALESCE(exit_reason, 'age_limit')
          WHERE organization_id = $1
            AND scout_year_id = $2
            AND status = 'active'
            AND participant_id = ANY($3::int[])
          RETURNING participant_id`,
        [organizationId, previousYear.id, graduatingIds, previousYear.end_date]
      );

      // Carry everyone else over, preserving their original inscription date.
      const carriedOver = await client.query(
        `INSERT INTO participant_enrollments
                (participant_id, organization_id, scout_year_id, inscription_date, status, exception_note)
         SELECT pe.participant_id, pe.organization_id, $3, pe.inscription_date, 'active',
                CASE WHEN pe.participant_id = ANY($5::int[]) THEN $6::jsonb ->> pe.participant_id::text END
           FROM participant_enrollments pe
          WHERE pe.organization_id = $1
            AND pe.scout_year_id = $2
            AND pe.status = 'active'
            AND NOT (pe.participant_id = ANY($4::int[]))
         ON CONFLICT (participant_id, organization_id, scout_year_id) DO NOTHING
         RETURNING participant_id`,
        [
          organizationId,
          previousYear.id,
          newYear.id,
          graduatingIds,
          [...exceptionNotes.keys()],
          JSON.stringify(Object.fromEntries(exceptionNotes))
        ]
      );

      // Deactivate the confirmed memberships. Never touch a membership that
      // holds a non-parent role, whatever the client sent.
      let deactivated = { rows: [] };
      if (membershipIds.length > 0) {
        deactivated = await client.query(
          `UPDATE user_organizations uo
              SET status = 'inactive',
                  deactivated_at = now(),
                  deactivated_reason = 'no_enrolled_child',
                  last_active_scout_year_id = $3
            WHERE uo.id = ANY($2::int[])
              AND uo.organization_id = $1
              AND uo.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                  FROM jsonb_array_elements_text(uo.role_ids) AS role_id_text
                  JOIN roles r ON r.id = role_id_text::integer
                 WHERE r.role_name <> ALL (ARRAY['parent','guardian','demoparent'])
              )
            RETURNING uo.id, uo.user_id`,
          [organizationId, membershipIds, previousYear.id]
        );
      }

      const summary = {
        graduated: graduated.rows.length,
        carried_over: carriedOver.rows.length,
        memberships_deactivated: deactivated.rows.length,
        memberships_skipped: membershipIds.length - deactivated.rows.length,
        points_restamped: restampedPoints
      };

      const transition = await client.query(
        `INSERT INTO scout_year_transitions
                (organization_id, from_scout_year_id, to_scout_year_id, executed_by, summary, changeset)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         RETURNING id, executed_at`,
        [
          organizationId,
          previousYear.id,
          newYear.id,
          req.user.id,
          JSON.stringify(summary),
          JSON.stringify({
            graduated_participant_ids: graduated.rows.map(r => r.participant_id),
            carried_over_participant_ids: carriedOver.rows.map(r => r.participant_id),
            deactivated_membership_ids: deactivated.rows.map(r => r.id),
            exceptions: Object.fromEntries(exceptionNotes)
          })
        ]
      );

      await client.query('COMMIT');

      logger.info('Scout year transition executed', {
        organizationId,
        from: previousYear.label,
        to: newYear.label,
        ...summary
      });

      return success(res, {
        transition_id: transition.rows[0].id,
        executed_at: transition.rows[0].executed_at,
        previous_year: previousYear,
        new_year: newYear,
        summary
      }, 'Scout year transition completed', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/scout-years/memberships/without-child:
   *   get:
   *     summary: List active memberships with no enrolled child
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Candidate memberships
   */
  router.get('/memberships/without-child', authenticate, requirePermission('scout_year.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const scoutYear = await ensureActiveScoutYear(pool, organizationId);
    const memberships = await listMembershipsWithoutEnrolledChild(pool, organizationId, scoutYear.id);
    return success(res, memberships);
  }));

  /**
   * @swagger
   * /api/v1/scout-years/memberships/{membershipId}/status:
   *   patch:
   *     summary: Activate or deactivate a membership
   *     description: >
   *       Deactivating keeps the account, its guardian links and its history; the
   *       user simply loses access to the unit and stops receiving its
   *       communications. Reactivating restores access.
   *     tags: [Scout Years]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Membership updated
   *       400:
   *         description: Invalid status
   *       404:
   *         description: Membership not found
   */
  router.patch('/memberships/:membershipId/status', authenticate, blockDemoRoles, requirePermission('scout_year.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const membershipId = parseInt(req.params.membershipId, 10);
    const { status, reason } = req.body || {};

    if (Number.isNaN(membershipId)) {
      return error(res, 'Invalid membership identifier', 400);
    }

    const allowedStatuses = ['active', 'inactive', 'alumni'];
    if (!allowedStatuses.includes(status)) {
      return error(res, `status must be one of: ${allowedStatuses.join(', ')}`, 400);
    }

    const isDeactivation = status !== 'active';
    const scoutYear = await ensureActiveScoutYear(pool, organizationId);

    const result = await pool.query(
      `UPDATE user_organizations
          SET status = $3,
              deactivated_at = CASE WHEN $4 THEN now() ELSE NULL END,
              deactivated_reason = CASE WHEN $4 THEN $5 ELSE NULL END,
              last_active_scout_year_id = CASE WHEN $4 THEN $6 ELSE last_active_scout_year_id END
        WHERE id = $1 AND organization_id = $2
        RETURNING id, user_id, status, deactivated_at, deactivated_reason`,
      [membershipId, organizationId, status, isDeactivation, reason || null, scoutYear.id]
    );

    if (result.rows.length === 0) {
      return error(res, 'Membership not found', 404);
    }

    logger.info('Membership status changed', { organizationId, membershipId, status });

    return success(res, result.rows[0], 'Membership status updated');
  }));

  return router;
};
