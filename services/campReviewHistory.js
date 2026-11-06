'use strict';
/** Closed camp reviews across scout years, scoped only to the authenticated unit. */
const { CampReviewError } = require('./campReviews');
const sites = require('../config/camp_sites.json');
const rules = require('../config/camp_reviews.json');
const { HTTP_STATUS } = require('../utils/http-status');

/** Validate optional filters without coercing arrays, partial numbers or unknown choices. */
function readHistoryFilters(input = {}) {
  if (Object.keys(input).some((key) => /^(site_id|season|accommodation|page|limit)\[/.test(key))) {
    throw new CampReviewError('camp_review_history_invalid_filter', HTTP_STATUS.BAD_REQUEST);
  }
  const positive = (key, fallback, maximum) => {
    const value = input[key];
    if (value === undefined || value === '') { return fallback; }
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
      throw new CampReviewError('camp_review_history_invalid_filter', HTTP_STATUS.BAD_REQUEST, key);
    }
    return Number(value);
  };
  const choice = (key, allowed) => {
    if (input[key] === undefined || input[key] === '') { return null; }
    if (!allowed.includes(input[key])) {
      throw new CampReviewError('camp_review_history_invalid_filter', HTTP_STATUS.BAD_REQUEST, key);
    }
    return input[key];
  };
  return {
    siteId: positive('site_id', null, rules.HISTORY_ID_MAX),
    season: choice('season', sites.SEASONS), accommodation: choice('accommodation', sites.ACCOMMODATIONS),
    page: positive('page', 1, rules.HISTORY_PAGE_MAX),
    limit: positive('limit', rules.HISTORY_PAGE_SIZE, rules.HISTORY_PAGE_MAX_SIZE),
  };
}

/** Read a page and its total in one statement, including archived sites in the filter choices. */
async function readCampReviewHistory(db, organizationId, filters) {
  const { siteId, season, accommodation, page, limit } = filters;
  const { rows } = await db.query(`WITH history AS (
    SELECT m.id, m.theme, m.meeting_date::text AS date_from,
      COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to, m.is_cancelled,
      r.closed_at, d.camp_site_id AS site_id, s.name AS site_name,
      s.archived_at IS NOT NULL AS site_archived, d.season, d.accommodation,
      (SELECT COUNT(*)::int FROM camp_review_notes n WHERE n.organization_id = m.organization_id
        AND n.meeting_id = m.id AND n.merged_into_id IS NULL AND n.outcome = 'keep') AS keep_count,
      (SELECT COUNT(*)::int FROM camp_review_notes n WHERE n.organization_id = m.organization_id
        AND n.meeting_id = m.id AND n.merged_into_id IS NULL AND n.outcome = 'fix') AS fix_count
    FROM camp_reviews r
    JOIN year_plan_meetings m ON m.organization_id = r.organization_id AND m.id = r.meeting_id
    LEFT JOIN activities a ON a.organization_id = m.organization_id AND a.id = m.activity_id
    LEFT JOIN camp_details d ON d.organization_id = m.organization_id AND d.meeting_id = m.id
    LEFT JOIN camp_sites s ON s.organization_id = d.organization_id AND s.id = d.camp_site_id
    WHERE r.organization_id = $1 AND r.status = 'closed' AND m.meeting_kind = 'camp'
  ), filtered AS (
    SELECT * FROM history WHERE ($2::int IS NULL OR site_id = $2)
      AND ($3::text IS NULL OR season = $3) AND ($4::text IS NULL OR accommodation = $4)
  ) SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
    COALESCE((SELECT json_agg(p) FROM (SELECT * FROM filtered ORDER BY date_from DESC, id DESC LIMIT $5 OFFSET $6) p), '[]'::json) AS camps,
    COALESCE((SELECT json_agg(s ORDER BY s.name, s.id) FROM
      (SELECT DISTINCT site_id AS id, site_name AS name, site_archived AS archived FROM history WHERE site_id IS NOT NULL) s), '[]'::json) AS sites`,
  [organizationId, siteId, season, accommodation, limit, (page - 1) * limit]);
  return rows[0] || { total: 0, camps: [], sites: [] };
}

/** Earlier closed camps at the same site OR with the same complete season/accommodation profile. */
async function readCampReviewLessons(db, organizationId, meetingId, { page, limit }) {
  const target = (await db.query(`SELECT m.id, m.meeting_date::text AS date_from,
      d.camp_site_id AS site_id, d.season, d.accommodation
    FROM year_plan_meetings m LEFT JOIN camp_details d ON d.organization_id = m.organization_id AND d.meeting_id = m.id
    WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`, [organizationId, meetingId])).rows[0];
  if (!target) { throw new CampReviewError('camp_review_camp_not_found', HTTP_STATUS.NOT_FOUND); }
  const { rows } = await db.query(`WITH lessons AS (
    SELECT n.id, n.category, n.outcome, n.note_text AS text, n.action_text,
      m.id AS source_meeting_id, m.theme AS source_name, m.meeting_date::text AS source_date,
      d.camp_site_id AS site_id, s.name AS site_name, d.season, d.accommodation,
      ($3::int IS NOT NULL AND d.camp_site_id = $3) AS same_site,
      ($4::text IS NOT NULL AND $5::text IS NOT NULL AND d.season = $4 AND d.accommodation = $5) AS same_profile,
      (1 + (SELECT COUNT(*) FROM camp_review_votes v WHERE v.organization_id = n.organization_id AND v.note_id = n.id)
        + (SELECT COUNT(*) FROM camp_review_notes c WHERE c.organization_id = n.organization_id AND c.merged_into_id = n.id)
        + (SELECT COUNT(*) FROM camp_review_votes v JOIN camp_review_notes c ON c.organization_id = v.organization_id AND c.id = v.note_id
          WHERE c.organization_id = n.organization_id AND c.merged_into_id = n.id))::int AS weight
    FROM camp_review_notes n
    JOIN camp_reviews r ON r.organization_id = n.organization_id AND r.meeting_id = n.meeting_id AND r.status = 'closed'
    JOIN year_plan_meetings m ON m.organization_id = n.organization_id AND m.id = n.meeting_id
    JOIN camp_details d ON d.organization_id = m.organization_id AND d.meeting_id = m.id
    LEFT JOIN camp_sites s ON s.organization_id = d.organization_id AND s.id = d.camp_site_id
    WHERE n.organization_id = $1 AND m.id <> $2 AND m.meeting_kind = 'camp' AND NOT m.is_cancelled
      AND m.meeting_date < $6::date AND n.merged_into_id IS NULL AND n.outcome IN ('keep', 'fix')
      AND (($3::int IS NOT NULL AND d.camp_site_id = $3)
        OR ($4::text IS NOT NULL AND $5::text IS NOT NULL AND d.season = $4 AND d.accommodation = $5))
  ) SELECT (SELECT COUNT(*)::int FROM lessons) AS total,
    COALESCE((SELECT json_agg(p) FROM (SELECT * FROM lessons ORDER BY outcome, weight DESC, source_date DESC, id
      LIMIT $7 OFFSET $8) p), '[]'::json) AS notes`,
  [organizationId, meetingId, target.site_id, target.season, target.accommodation, target.date_from, limit, (page - 1) * limit]);
  return { ...rows[0], target };
}

module.exports = { readHistoryFilters, readCampReviewHistory, readCampReviewLessons };
