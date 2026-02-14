const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { toBool } = require('../utils');
const { success, error, asyncHandler } = require('../middleware/response');
const logger = require('../config/logger');

module.exports = (pool) => {
  const ICAL_PROD_ID = '-//Wampums//Activities Calendar//EN';

  /**
   * Escape iCalendar text values according to RFC 5545.
   * @param {string} value
   * @returns {string}
   */
  const escapeICalText = (value = '') => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

  /**
   * Fold an iCalendar content line to the RFC 5545 75-octet limit.
   * Continuation lines begin with a single whitespace character.
   *
   * @param {string} value
   * @returns {string[]}
   */
  const foldICalLine = (value = '') => {
    const line = String(value ?? '');
    const maxOctets = 75;

    if (Buffer.byteLength(line, 'utf8') <= maxOctets) {
      return [line];
    }

    const characters = Array.from(line);
    const folded = [];
    let current = '';
    let currentBytes = 0;

    characters.forEach((char) => {
      const charBytes = Buffer.byteLength(char, 'utf8');
      const currentLimit = folded.length === 0 ? maxOctets : maxOctets - 1;

      if (currentBytes + charBytes > currentLimit) {
        folded.push(folded.length === 0 ? current : ` ${current}`);
        current = char;
        currentBytes = charBytes;
        return;
      }

      current += char;
      currentBytes += charBytes;
    });

    folded.push(folded.length === 0 ? current : ` ${current}`);

    return folded;
  };

  /**
   * Format local date and time values to a floating iCalendar date-time value.
   *
   * We intentionally do not append a timezone suffix (e.g., "Z") because
   * activities currently do not store timezone context. Floating values preserve
   * the originally entered local wall time for calendar clients.
   *
   * @param {string} dateValue
   * @param {string} timeValue
   * @returns {string|null}
   */
  const formatICalLocalDateTime = (dateValue, timeValue) => {
    if (!dateValue || !timeValue) {
      return null;
    }

    const dateMatch = String(dateValue).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(timeValue).trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);

    if (!dateMatch || !timeMatch) {
      return null;
    }

    const [, year, month, day] = dateMatch;
    const [, hours, minutes, seconds = '00'] = timeMatch;

    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  };

  /**
   * Format a Date object into UTC iCalendar date-time format.
   * @param {Date} value
   * @returns {string}
   */
  const formatICalUtcDateTime = (value) => {
    const year = String(value.getUTCFullYear());
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');
    const seconds = String(value.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  };

  /**
   * Build a safe iCalendar filename for Content-Disposition.
   * @param {string} organizationName
   * @returns {string}
   */
  const buildICalFilename = (organizationName = '') => {
    const normalizedOrganization = String(organizationName)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    const datePart = new Date().toISOString().slice(0, 10);

    if (!normalizedOrganization) {
      return `activities-calendar-${datePart}.ics`;
    }

    return `${normalizedOrganization}-activities-${datePart}.ics`;
  };

  /**
   * Get all activities for the organization
   * Accessible by: animation, admin, parent
   */
  router.get('/', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        a.*,
        u.full_name as created_by_name,
        COUNT(DISTINCT co.id) as carpool_offer_count,
        COUNT(DISTINCT ca.participant_id) as assigned_participant_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'pending') as pending_slip_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'signed') as signed_slip_count
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN carpool_offers co ON a.id = co.activity_id AND co.is_active = TRUE
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       LEFT JOIN permission_slips ps ON a.id = ps.activity_id AND ps.status IN ('pending', 'signed')
       WHERE a.organization_id = $1 AND a.is_active = TRUE
       GROUP BY a.id, u.full_name
       ORDER BY COALESCE(a.activity_start_date, a.activity_date) ASC, a.activity_start_time ASC, a.departure_time_going ASC`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Download active activities as iCalendar file.
   * Accessible by: animation, admin, parent
   */
  router.get('/calendar.ics', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const organizationResult = await pool.query(
      'SELECT name FROM organizations WHERE id = $1',
      [organizationId]
    );

    const result = await pool.query(
      `SELECT
        id,
        name,
        description,
        activity_date::text as activity_date,
        activity_start_date::text as activity_start_date,
        activity_start_time::text as activity_start_time,
        activity_end_date::text as activity_end_date,
        activity_end_time::text as activity_end_time,
        meeting_location_going,
        meeting_time_going::text as meeting_time_going,
        departure_time_going::text as departure_time_going,
        departure_time_return::text as departure_time_return,
        created_at,
        updated_at
       FROM activities
       WHERE organization_id = $1 AND is_active = TRUE
       ORDER BY COALESCE(activity_start_date, activity_date) ASC, activity_start_time ASC, departure_time_going ASC`,
      [organizationId]
    );

    const nowStamp = formatICalUtcDateTime(new Date());
    const events = result.rows
      .map((activity) => {
        const normalizedStartDate = activity.activity_start_date || activity.activity_date;
        const normalizedStartTime = activity.activity_start_time || activity.meeting_time_going;
        const normalizedEndDate = activity.activity_end_date || normalizedStartDate;
        const normalizedEndTime = activity.activity_end_time
          || activity.departure_time_return
          || activity.departure_time_going
          || normalizedStartTime;

        const dtStart = formatICalLocalDateTime(normalizedStartDate, normalizedStartTime);
        const dtEnd = formatICalLocalDateTime(normalizedEndDate, normalizedEndTime);

        if (!dtStart || !dtEnd) {
          return null;
        }

        const sourceStamp = activity.updated_at || activity.created_at;
        const dtStamp = sourceStamp
          ? formatICalUtcDateTime(new Date(sourceStamp))
          : nowStamp;

        return [
          'BEGIN:VEVENT',
          `UID:activity-${activity.id}-${organizationId}@wampums.local`,
          `DTSTAMP:${dtStamp}`,
          `SUMMARY:${escapeICalText(activity.name || 'Activity')}`,
          `DESCRIPTION:${escapeICalText(activity.description || '')}`,
          `LOCATION:${escapeICalText(activity.meeting_location_going || '')}`,
          `DTSTART:${dtStart}`,
          `DTEND:${dtEnd}`,
          'END:VEVENT'
        ];
      })
      .filter(Boolean)
      .flat();

    const icalPayload = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:${ICAL_PROD_ID}`,
      'CALSCALE:GREGORIAN',
      ...events,
      'END:VCALENDAR',
      ''
    ]
      .flatMap(foldICalLine)
      .join('\r\n');

    const organizationName = organizationResult.rows[0]?.name || '';
    const calendarFilename = buildICalFilename(organizationName);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${calendarFilename}"; filename*=UTF-8''${encodeURIComponent(calendarFilename)}`);
    return res.status(200).send(icalPayload);
  }));

  /**
   * Get a specific activity by ID
   * Accessible by: animation, admin, parent
   */
  router.get('/:id', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        a.*,
        u.full_name as created_by_name,
        u.email as created_by_email
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1 AND a.organization_id = $2 AND a.is_active = TRUE`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    return success(res, result.rows[0]);
  }));

  /**
   * Create a new activity
   * Accessible by: animation, admin only
   */
  router.post('/', authenticate, blockDemoRoles, requirePermission('activities.create'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    // Debug logging to diagnose form submission issues
    logger.info('[Activity Creation] Request received', {
      organizationId,
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body),
      bodyPreview: {
        name: req.body.name,
        activity_name: req.body.activity_name,
        activity_start_date: req.body.activity_start_date,
        meeting_time_going: req.body.meeting_time_going,
        departure_time_going: req.body.departure_time_going
      }
    });

    // Accept both 'activity_name' (new) and 'name' (legacy) field names
    const activityName = req.body.activity_name || req.body.name;

    const {
      description,
      activity_date,
      activity_start_date,
      activity_start_time,
      activity_end_date,
      activity_end_time,
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return,
      meeting_time_return,
      departure_time_return
    } = req.body;

    const normalizedActivityDate = activity_date || activity_start_date;
    const normalizedStartDate = activity_start_date || activity_date;
    // activity_start_time can fall back to meeting_time_going if not provided
    const normalizedStartTime = activity_start_time || meeting_time_going;
    const normalizedEndDate = activity_end_date || normalizedStartDate;
    // activity_end_time can fall back to departure times if not provided
    const normalizedEndTime = activity_end_time || departure_time_return || departure_time_going;

    // Validation with specific error messages
    const missingFields = [];
    if (!activityName) missingFields.push('name');
    if (!normalizedStartDate) missingFields.push('activity_start_date (or activity_date as fallback)');
    if (!normalizedEndDate) missingFields.push('activity_end_date');
    if (!meeting_location_going) missingFields.push('meeting_location_going');
    // Core carpool fields are always required
    if (!meeting_time_going) missingFields.push('meeting_time_going');
    if (!departure_time_going) missingFields.push('departure_time_going');
    // Normalized times depend on the above required fields as fallbacks
    if (!normalizedStartTime) {
      // This should never happen if meeting_time_going validation passes above
      missingFields.push('activity_start_time (meeting_time_going can be used as fallback)');
    }
    if (!normalizedEndTime) {
      // This should never happen if departure_time_going validation passes above
      missingFields.push('activity_end_time (departure times can be used as fallback)');
    }

    if (missingFields.length > 0) {
      return error(res, `Missing required fields: ${missingFields.join(', ')}`, 400);
    }

    // Validate that departure time is after meeting time
    if (meeting_time_going >= departure_time_going) {
      return error(res, 'Departure time must be after meeting time', 400);
    }

    // If return trip is specified, validate those times too
    if (meeting_time_return && departure_time_return && meeting_time_return >= departure_time_return) {
      return error(res, 'Return departure time must be after return meeting time', 400);
    }

    // Insert activity
    const query = `
      INSERT INTO activities (
        name, description, activity_date, activity_start_date, activity_start_time,
        activity_end_date, activity_end_time, meeting_location_going, meeting_time_going,
        departure_time_going, meeting_location_return, meeting_time_return,
        departure_time_return, created_by, organization_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15
      ) RETURNING *
    `;

    const values = [
      activityName,
      description || '',
      normalizedActivityDate,
      normalizedStartDate,
      normalizedStartTime,
      normalizedEndDate,
      normalizedEndTime,
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return || '',
      meeting_time_return || null,
      departure_time_return || null,
      userId,
      organizationId
    ];

    const result = await pool.query(query, values);

    return success(res, result.rows[0], 'Activity created successfully', 201);
  }));

  /**
   * Update an activity
   * Accessible by: animation, admin only
   */
  router.put('/:id', authenticate, blockDemoRoles, requirePermission('activities.edit'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const {
      name,
      description,
      activity_date,
      activity_start_date,
      activity_start_time,
      activity_end_date,
      activity_end_time,
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return,
      meeting_time_return,
      departure_time_return,
      is_active
    } = req.body;

    const result = await pool.query(
      `UPDATE activities
       SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         activity_date = COALESCE($3, activity_date),
         activity_start_date = COALESCE($4, activity_start_date),
         activity_start_time = COALESCE($5, activity_start_time),
         activity_end_date = COALESCE($6, activity_end_date),
         activity_end_time = COALESCE($7, activity_end_time),
         meeting_location_going = COALESCE($8, meeting_location_going),
         meeting_time_going = COALESCE($9, meeting_time_going),
         departure_time_going = COALESCE($10, departure_time_going),
         meeting_location_return = COALESCE($11, meeting_location_return),
         meeting_time_return = COALESCE($12, meeting_time_return),
         departure_time_return = COALESCE($13, departure_time_return),
         is_active = COALESCE($14, is_active),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 AND organization_id = $16
       RETURNING *`,
      [
        name,
        description,
        activity_date,
        activity_start_date,
        activity_start_time,
        activity_end_date,
        activity_end_time,
        meeting_location_going,
        meeting_time_going,
        departure_time_going,
        meeting_location_return,
        meeting_time_return,
        departure_time_return,
        toBool(is_active),
        id,
        organizationId
      ]
    );

    if (result.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    return success(res, result.rows[0], 'Activity updated successfully');
  }));

  /**
   * Delete an activity (soft delete)
   * Accessible by: animation, admin only
   */
  router.delete('/:id', authenticate, blockDemoRoles, requirePermission('activities.delete'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    // First verify activity exists and belongs to organization
    const activityCheck = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (activityCheck.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Cancel all active carpool offers for this activity
    await pool.query(
      'UPDATE carpool_offers SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE activity_id = $1 AND is_active = TRUE',
      [id]
    );

    // Soft delete activity
    const result = await pool.query(
      `UPDATE activities
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );

    return success(res, result.rows[0], 'Activity deleted successfully');
  }));

  return router;
};
