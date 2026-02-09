/**
 * Offline preparation routes
 * Provides bulk data fetching for multi-day offline operation (camp mode)
 */
const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

/**
 * Generate an array of date strings between start and end (inclusive)
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {string[]} Array of date strings
 */
function generateDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

module.exports = (pool, logger) => {
    /**
     * POST /api/v1/offline/prepare-activity
     * Bulk fetch all data needed for offline operation during a multi-day activity
     *
     * Request body:
     * - activity_id: (optional) ID of the activity
     * - start_date: Start date in YYYY-MM-DD format
     * - end_date: End date in YYYY-MM-DD format
     *
     * Returns all data needed for the date range:
     * - participants, groups
     * - attendance for each date
     * - honors
     * - medication requirements and distributions
     * - badge templates and progress
     */
    router.post('/prepare-activity',
        authenticate,
        requirePermission('activities.view'),
        asyncHandler(async (req, res) => {
            const organizationId = await getOrganizationId(req, pool);
            const { activity_id, start_date, end_date } = req.body;

            // Validate dates
            if (!start_date || !end_date) {
                return error(res, 'start_date and end_date are required', 400);
            }

            const startDateObj = new Date(start_date);
            const endDateObj = new Date(end_date);

            if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
                return error(res, 'Invalid date format. Use YYYY-MM-DD', 400);
            }

            if (endDateObj < startDateObj) {
                return error(res, 'end_date must be after start_date', 400);
            }

            // Limit to 14 days max for performance
            const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));
            if (daysDiff > 14) {
                return error(res, 'Date range cannot exceed 14 days', 400);
            }

            const dates = generateDateRange(start_date, end_date);
            logger.info(`[offline] Preparing data for ${dates.length} days (${start_date} to ${end_date})`);

            // Use a single client to avoid exhausting connection pool
            const client = await pool.connect();
            try {
                // Fetch all data sequentially on a single connection
                const participantsResult = await client.query(
                    `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                            pg.group_id, g.name as group_name
                     FROM participants p
                     JOIN participant_organizations po ON p.id = po.participant_id
                     LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
                     LEFT JOIN groups g ON pg.group_id = g.id
                     WHERE po.organization_id = $1
                     ORDER BY p.last_name, p.first_name`,
                    [organizationId]
                );

                const groupsResult = await client.query(
                    `SELECT id, name, section
                     FROM groups
                     WHERE organization_id = $1
                     ORDER BY name`,
                    [organizationId]
                );

                const attendanceResult = await client.query(
                    `SELECT a.id, a.participant_id, a.date::text as date, a.status,
                            p.first_name, p.last_name
                     FROM attendance a
                     JOIN participants p ON a.participant_id = p.id
                     WHERE a.organization_id = $1
                       AND a.date >= $2::date
                       AND a.date <= $3::date
                     ORDER BY a.date, p.first_name`,
                    [organizationId, start_date, end_date]
                );

                const honorsResult = await client.query(
                    `SELECT h.id, h.participant_id, h.date::text as date, h.reason,
                            h.created_at, h.created_by,
                            p.first_name, p.last_name
                     FROM honors h
                     JOIN participants p ON h.participant_id = p.id
                     WHERE h.organization_id = $1
                     ORDER BY h.date DESC, h.created_at DESC`,
                    [organizationId]
                );

                const medicationRequirementsResult = await client.query(
                    `SELECT mr.id, mr.medication_name, mr.dosage_instructions,
                            mr.frequency_text, mr.route,
                            mr.default_dose_amount, mr.default_dose_unit,
                            mr.general_notes,
                            mr.start_date::text as start_date, mr.end_date::text as end_date,
                            mr.frequency_preset_type, mr.frequency_times, mr.frequency_slots,
                            pm.participant_id, p.first_name, p.last_name
                     FROM medication_requirements mr
                     JOIN participant_medications pm ON pm.medication_requirement_id = mr.id
                     JOIN participants p ON pm.participant_id = p.id
                     WHERE mr.organization_id = $1
                       AND (mr.end_date IS NULL OR mr.end_date >= $2::date)
                       AND (mr.start_date IS NULL OR mr.start_date <= $3::date)
                     ORDER BY p.last_name, p.first_name, mr.medication_name`,
                    [organizationId, start_date, end_date]
                );

                const medicationDistributionsResult = await client.query(
                    `SELECT md.id, md.medication_requirement_id, md.scheduled_for,
                            md.administered_at, md.administered_by,
                            md.dose_notes, md.status,
                            mr.medication_name, mr.dosage_instructions,
                            md.participant_id, p.first_name, p.last_name
                     FROM medication_distributions md
                     JOIN medication_requirements mr ON md.medication_requirement_id = mr.id
                     JOIN participants p ON md.participant_id = p.id
                     WHERE md.organization_id = $1
                       AND md.scheduled_for >= $2::timestamp
                       AND md.scheduled_for <= ($3::date + interval '1 day')
                     ORDER BY md.scheduled_for, p.last_name`,
                    [organizationId, start_date, end_date]
                );

                const badgeTemplatesResult = await client.query(
                    `SELECT bt.id, bt.template_key, bt.name, bt.translation_key,
                            bt.section, bt.level_count, bt.levels, bt.image
                     FROM badge_templates bt
                     WHERE bt.organization_id = $1
                     ORDER BY bt.section, bt.name`,
                    [organizationId]
                );

                const badgeProgressResult = await client.query(
                    `SELECT bp.id, bp.participant_id, bp.badge_template_id,
                            bp.territoire_chasse, bp.objectif, bp.description,
                            bp.fierte, bp.raison,
                            bp.status, bp.date_obtention::text as date_obtention,
                            bp.etoiles, bp.section, bp.star_type,
                            bp.delivered_at, bp.delivered_by,
                            p.first_name, p.last_name,
                            bt.name as badge_name, bt.template_key
                     FROM badge_progress bp
                     JOIN participants p ON bp.participant_id = p.id
                     JOIN badge_templates bt ON bp.badge_template_id = bt.id
                     WHERE bp.organization_id = $1
                     ORDER BY bp.date_obtention DESC`,
                    [organizationId]
                );

                const activityResult = activity_id ? await client.query(
                    `SELECT id, name, description,
                            activity_start_date::text as activity_start_date,
                            activity_end_date::text as activity_end_date,
                            activity_start_time::text as activity_start_time,
                            activity_end_time::text as activity_end_time,
                            meeting_location_going
                     FROM activities
                     WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
                    [activity_id, organizationId]
                ) : { rows: [] };

                const carpoolOffersResult = activity_id ? await client.query(
                    `SELECT co.id, co.activity_id, co.user_id, co.vehicle_make,
                            co.vehicle_color, co.total_seats_available, co.trip_direction,
                            co.notes, co.is_active, co.created_at,
                            u.full_name as driver_name, u.email as driver_email
                     FROM carpool_offers co
                     JOIN users u ON co.user_id = u.id
                     WHERE co.activity_id = $1 AND co.is_active = TRUE
                     ORDER BY co.created_at`,
                    [activity_id]
                ) : { rows: [] };

                const carpoolAssignmentsResult = activity_id ? await client.query(
                    `SELECT ca.id, ca.carpool_offer_id, ca.participant_id,
                            ca.trip_direction, ca.created_at,
                            p.first_name, p.last_name
                     FROM carpool_assignments ca
                     JOIN carpool_offers co ON ca.carpool_offer_id = co.id
                     JOIN participants p ON ca.participant_id = p.id
                     WHERE co.activity_id = $1 AND co.is_active = TRUE
                     ORDER BY ca.created_at`,
                    [activity_id]
                ) : { rows: [] };

                // Organize attendance by date
                const attendanceByDate = {};
                for (const date of dates) {
                    attendanceByDate[date] = attendanceResult.rows.filter(a => a.date === date);
                }

                // Organize honors by date
                const honorsByDate = {};
                for (const date of dates) {
                    honorsByDate[date] = honorsResult.rows.filter(h => h.date === date);
                }

                const responseData = {
                    activity: activityResult.rows[0] || null,
                    dates,
                    participants: participantsResult.rows,
                    groups: groupsResult.rows,
                    attendance: attendanceByDate,
                    attendanceFlat: attendanceResult.rows,
                    honors: honorsResult.rows,
                    honorsByDate,
                    medications: {
                        requirements: medicationRequirementsResult.rows,
                        distributions: medicationDistributionsResult.rows
                    },
                    badges: {
                        templates: badgeTemplatesResult.rows,
                        progress: badgeProgressResult.rows
                    },
                    carpools: {
                        offers: carpoolOffersResult.rows,
                        assignments: carpoolAssignmentsResult.rows
                    },
                    preparedAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days
                };

                logger.info(`[offline] Prepared data: ${participantsResult.rows.length} participants, ` +
                    `${attendanceResult.rows.length} attendance records, ` +
                    `${honorsResult.rows.length} honors, ` +
                    `${medicationDistributionsResult.rows.length} medication distributions, ` +
                    `${carpoolOffersResult.rows.length} carpool offers, ` +
                    `${carpoolAssignmentsResult.rows.length} carpool assignments`);

                return success(res, responseData, 'Offline data prepared successfully');
            } catch (err) {
                logger.error('[offline] Error preparing offline data:', err.message, err.stack);
                return error(res, `Preparation failed: ${err.message}`, 500);
            } finally {
                client.release();
            }
        })
    );

    /**
     * GET /api/v1/offline/status
     * Get current offline preparation status for the organization
     */
    router.get('/status',
        authenticate,
        asyncHandler(async (req, res) => {
            const organizationId = await getOrganizationId(req, pool);

            // Get upcoming multi-day activities
            const today = new Date().toISOString().split('T')[0];
            const upcomingResult = await pool.query(
                `SELECT id, name,
                        activity_start_date::text as activity_start_date,
                        activity_end_date::text as activity_end_date
                 FROM activities
                 WHERE organization_id = $1
                   AND is_active = TRUE
                   AND activity_end_date >= $2::date
                   AND (activity_end_date::date - activity_start_date::date) >= 1
                 ORDER BY activity_start_date ASC
                 LIMIT 5`,
                [organizationId, today]
            );

            // Estimate storage requirements
            const statsResult = await pool.query(
                `SELECT
                    (SELECT COUNT(*) FROM participants p
                     JOIN participant_organizations po ON p.id = po.participant_id
                     WHERE po.organization_id = $1) as participant_count,
                    (SELECT COUNT(*) FROM groups WHERE organization_id = $1) as group_count,
                    (SELECT COUNT(*) FROM badge_settings WHERE organization_id = $1) as badge_count,
                    (SELECT COUNT(*) FROM medication_requirements WHERE organization_id = $1) as medication_count`,
                [organizationId]
            );

            const stats = statsResult.rows[0];
            // Rough estimate: ~1KB per participant, ~5KB per day of attendance
            const estimatedKBPerDay = Math.ceil(
                (parseInt(stats.participant_count) * 1) + // participants
                (parseInt(stats.group_count) * 0.5) + // groups
                (parseInt(stats.participant_count) * 0.5) + // attendance per day
                (parseInt(stats.badge_count) * 0.3) + // badges
                (parseInt(stats.medication_count) * 0.5) // medications
            );

            return success(res, {
                upcomingActivities: upcomingResult.rows,
                stats: {
                    participantCount: parseInt(stats.participant_count),
                    groupCount: parseInt(stats.group_count),
                    badgeCount: parseInt(stats.badge_count),
                    medicationCount: parseInt(stats.medication_count),
                    estimatedKBPerDay
                }
            });
        })
    );

    return router;
};
