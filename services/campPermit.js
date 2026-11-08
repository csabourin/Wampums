'use strict';
/**
 * The camp permit's checklist (#1416, first slice of the camp plan document #1320).
 *
 * The permit asks for a list of things a camp must have settled. Almost all of
 * them already live in Wampums (the site, the written sections, the camp lists,
 * the material); this service reads each one where it lives and says, line by
 * line, whether it is complete, still to complete, or not verified. Nothing is
 * copied: the checklist is always read fresh.
 *
 * - A line is never complete by default. A source that is empty, missing, or
 *   that the person may not read is "to complete" or "not verified", never
 *   "complete"; nothing here says the camp is compliant.
 * - A line whose source takes a right the person lacks reads "not verified"
 *   with the reason `no_access`, and no detail. Rights come from the route,
 *   which asks the shared authorization engine.
 * - No youth's name and no health information is returned: states and counts only.
 *
 * @module services/campPermit
 */
const RULES = require('../config/camp_permit.json');
const { CampPlanError, campPlanGaps } = require('./campPlan');
const { readCampSite, emergencyGaps } = require('./campSites');
const { readCampRoster } = require('./campRoster');
const { buildCampMaterialList } = require('./campMaterialList');

const HTTP_NOT_FOUND = 404;
const COMPLETE = 'complete';
const TO_COMPLETE = 'to_complete';
const UNVERIFIED = 'unverified';
/** Milliseconds in a day, to count a camp's days from its calendar dates. */
const DAY_MS = 86400000;
/** Emergency fields the permit's emergency section asks for; the address and directions have their own lines. */
const EMERGENCY_FIELDS = ['phone', 'hospital_name', 'hospital_phone', 'hospital_travel_minutes', 'poison_centre_phone'];
/** Team gaps that leave the team list to complete; the others are only to check. */
const TEAM_TO_COMPLETE = ['no_lead', 'no_first_aider', 'member_left_unit', 'aide_age_unknown', 'certification_to_verify'];

/** Every reason a line may give; each has a `camp_permit_reason_<reason>` text in both languages. */
const REASONS = Object.freeze([
  'missing_scout_group', 'missing_district', 'missing_coeducation', 'no_site', 'site_archived', 'missing_address',
  'missing_owner', ...EMERGENCY_FIELDS.map((field) => `missing_${field}`), 'missing_on_site_lead', 'on_site_lead_inactive', 'insurance_unanswered',
  'missing_directions', 'missing_season', 'missing_accommodation', 'sections_to_write', 'sections_to_review', 'no_rain_game',
  'no_schedule', 'days_without_activity', 'days_without_title', 'no_group_material', 'no_first_aid_kit', 'material_free_text', 'no_personal_list',
  'personal_list_unpublished', 'no_scout_year', 'no_youth', 'consent_pending', ...TEAM_TO_COMPLETE,
  'swimming_supervision', 'youth_health_form_missing', 'adult_allergies_not_declared', 'after_camp', 'review_open',
  'not_in_wampums', 'approvals_coming', 'approval_submit', 'approval_pending', 'approval_changes', 'approval_redacted', 'no_activity', 'no_access', 'cite_transport',
]);

/** Every line key, in the order the permit lists them. */
const LINE_KEYS = RULES.GROUPS.flatMap((group) => group.lines);

/** @returns {Object} One line of the checklist */
const line = (key, state, reasons = [], extra = {}) => ({ key, state, reasons, ...extra });

/** @returns {Object} A line the person may not verify */
const noAccess = (key) => line(key, UNVERIFIED, ['no_access']);

/** @returns {number} How many calendar days a camp lasts, both ends included */
function campDays(dateFrom, dateTo) {
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo || dateFrom}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return 1;
  }
  return Math.round((to - from) / DAY_MS) + 1;
}

/** @returns {boolean} Whether a text field holds something */
const filled = (value) => typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined;

/** The unit's identity, as the permit's header asks for it. */
function identityLine(unit) {
  const reasons = [];
  if (!unit.scout_groups.length) {
    reasons.push('missing_scout_group');
  }
  if (!filled(unit.district)) {
    reasons.push('missing_district');
  }
  if (!RULES.COEDUCATION.includes(unit.coeducation)) {
    reasons.push('missing_coeducation');
  }
  return line('identification', reasons.length ? TO_COMPLETE : COMPLETE, reasons);
}

/** The site's lines: where, what kind of camp, emergencies, insurance, directions. */
function siteLines({ details, site }, leadActive) {
  if (!site) {
    return ['site', 'emergency', 'insurance', 'directions'].map((key) => line(key, TO_COMPLETE, ['no_site']))
      .concat(campTypeLine(details, null));
  }
  const siteReasons = [];
  if (site.archived) {
    siteReasons.push('site_archived');
  }
  if (!filled(site.address)) {
    siteReasons.push('missing_address');
  }
  if (!filled(site.owner_name)) {
    siteReasons.push('missing_owner');
  }
  const gaps = emergencyGaps(site);
  const emergencyReasons = EMERGENCY_FIELDS.filter((field) => gaps.includes(field)).map((field) => `missing_${field}`);
  if (!details?.on_site_lead_id) {
    emergencyReasons.push('missing_on_site_lead');
  } else if (!leadActive) {
    // Chosen while a member, since gone: no one is actually in charge on site.
    emergencyReasons.push('on_site_lead_inactive');
  }
  const insuranceAnswered = site.has_own_insurance === true || site.has_own_insurance === false;
  return [
    line('site', siteReasons.length ? TO_COMPLETE : COMPLETE, siteReasons),
    campTypeLine(details, site),
    line('emergency', emergencyReasons.length ? TO_COMPLETE : COMPLETE, emergencyReasons),
    line('insurance', insuranceAnswered ? COMPLETE : TO_COMPLETE, insuranceAnswered ? [] : ['insurance_unanswered']),
    line('directions', filled(site.directions_url) ? COMPLETE : TO_COMPLETE, filled(site.directions_url) ? [] : ['missing_directions']),
  ];
}

/** The season and accommodation: the camp's own, else its site's accommodation. */
function campTypeLine(details, site) {
  const reasons = [];
  if (!filled(details?.season)) {
    reasons.push('missing_season');
  }
  if (!filled(details?.accommodation) && !filled(site?.accommodation)) {
    reasons.push('missing_accommodation');
  }
  return line('camp_type', reasons.length ? TO_COMPLETE : COMPLETE, reasons);
}

/** The written sections and bad-weather games (#1318). */
function planLines(plan) {
  const toWrite = plan.to_write.filter((key) => key !== 'rain_games').length;
  const toReview = plan.to_review.length;
  const reasons = [];
  if (toWrite) {
    reasons.push('sections_to_write');
  }
  if (toReview) {
    reasons.push('sections_to_review');
  }
  return [
    line('written_sections', reasons.length ? TO_COMPLETE : COMPLETE, reasons, { counts: { to_write: toWrite, to_review: toReview } }),
    line('rain_games', plan.rain_games ? COMPLETE : TO_COMPLETE, plan.rain_games ? [] : ['no_rain_game'],
      { counts: { games: plan.rain_games } }),
  ];
}

/**
 * The camp's schedule: every day of the camp has something planned, and a title
 * the plan uses as its narrative heading (#1417).
 */
function scheduleLine(camp, scheduledDays, titledDays = []) {
  const days = campDays(camp.date_from, camp.date_to);
  const inCamp = (day) => day >= 0 && day < days;
  const planned = new Set(scheduledDays.filter(inCamp)).size;
  const untitled = days - new Set(titledDays.filter(inCamp)).size;
  if (!planned) {
    return line('schedule', TO_COMPLETE, ['no_schedule'], { counts: { days, empty_days: days, untitled_days: untitled } });
  }
  const empty = days - planned;
  const reasons = [];
  if (empty) {
    reasons.push('days_without_activity');
  }
  if (untitled) {
    reasons.push('days_without_title');
  }
  return line('schedule', reasons.length ? TO_COMPLETE : COMPLETE, reasons,
    { counts: { days, empty_days: empty, untitled_days: untitled } });
}

/** The group's material and its first aid kit. Free-text needs cannot be checked. */
function materialLine(material) {
  const items = material?.items || [];
  const freeText = material?.free_text || [];
  if (!items.length && !freeText.length) {
    return line('group_material', TO_COMPLETE, ['no_group_material']);
  }
  const reasons = [];
  if (!items.some((item) => item.category === 'first_aid')) {
    reasons.push('no_first_aid_kit');
  }
  if (freeText.length) {
    reasons.push('material_free_text');
  }
  let state = COMPLETE;
  if (reasons.includes('no_first_aid_kit')) {
    state = TO_COMPLETE;
  } else if (reasons.length) {
    state = UNVERIFIED;
  }
  return line('group_material', state, reasons, { counts: { items: items.length, free_text: freeText.length } });
}

/** The youth's personal list (#1249): written, then published to families. */
function personalLine(personal) {
  if (!personal) {
    return line('personal_material', TO_COMPLETE, ['no_personal_list']);
  }
  return personal.published
    ? line('personal_material', COMPLETE)
    : line('personal_material', TO_COMPLETE, ['personal_list_unpublished']);
}

/** The camp lists (#1319): youth, team, health forms and allergies. States only, no names. */
function rosterLines(roster) {
  const gaps = new Set(roster.gaps);
  const youth = roster.youth.length;
  const youthReasons = [];
  // Wampums is the source of the camp's lists: with no gap, they are complete.
  let youthState = COMPLETE;
  if (gaps.has('no_scout_year') || gaps.has('no_youth')) {
    youthReasons.push(gaps.has('no_scout_year') ? 'no_scout_year' : 'no_youth');
    youthState = TO_COMPLETE;
  } else if (roster.consent?.pending) {
    youthReasons.push('consent_pending');
    youthState = TO_COMPLETE;
  }

  const teamReasons = TEAM_TO_COMPLETE.filter((gap) => gaps.has(gap));
  let teamState = teamReasons.length ? TO_COMPLETE : COMPLETE;
  // Swimming supervision cannot be checked from the lists: it is to check, never complete.
  if (gaps.has('swimming_supervision')) {
    teamReasons.push('swimming_supervision');
    if (teamState === COMPLETE) {
      teamState = UNVERIFIED;
    }
  }

  // Without youth, there is nothing to vouch for: an empty list is not a complete one.
  const healthMissing = gaps.has('youth_health_form_missing');
  const health = youth
    ? line('health_forms', healthMissing ? TO_COMPLETE : COMPLETE, healthMissing ? ['youth_health_form_missing'] : [])
    : line('health_forms', UNVERIFIED, ['no_youth']);
  const allergyReasons = ['youth_health_form_missing', 'adult_allergies_not_declared'].filter((gap) => gaps.has(gap));
  const allergies = youth
    ? line('allergies', allergyReasons.length ? TO_COMPLETE : COMPLETE, allergyReasons)
    : line('allergies', UNVERIFIED, ['no_youth']);

  return [
    line('youth_list', youthState, youthReasons, {
      counts: { youth, pending: roster.consent?.pending || 0 },
    }),
    line('team_list', teamState, teamReasons, {
      blocking: roster.blocking_gaps.length > 0,
      counts: { team: roster.team.filter((member) => member.active_member).length },
    }),
    health,
    allergies,
  ];
}

/** The camp's review: due once the camp is over, done once closed. */
function evaluationLine(evaluation) {
  if (!evaluation.over) {
    return line('evaluation', UNVERIFIED, ['after_camp']);
  }
  return evaluation.closed ? line('evaluation', COMPLETE) : line('evaluation', TO_COMPLETE, ['review_open']);
}

/** The current submission's approval state. Frozen snapshots describe their own submission. */
function approvalLine(approval, frozen) {
  if (frozen) {
    return line('approvals', TO_COMPLETE, ['approval_pending']);
  }
  if (approval?.redacted) {
    return line('approvals', TO_COMPLETE, ['approval_redacted']);
  }
  switch (approval?.status) {
    case 'approved': return line('approvals', COMPLETE);
    case 'changes_requested': return line('approvals', TO_COMPLETE, ['approval_changes']);
    case 'submitted': return line('approvals', TO_COMPLETE, ['approval_pending']);
    default: return line('approvals', TO_COMPLETE, ['approval_submit']);
  }
}

/**
 * Every line of the checklist, in the permit's order, from what was read.
 * Pure: the sources are read by readCampPermit.
 *
 * @param {Object} sources - { unit, camp, site, plan, schedule_days, material, personal, roster, carpool_offers, evaluation }
 * @param {Object} rights - { participants, carpools, reviews }
 * @returns {Object[]} Lines, each { key, state, reasons, counts?, blocking? }
 */
function permitLines(sources, rights) {
  const lines = [
    identityLine(sources.unit),
    line('dates', COMPLETE, [], { counts: { days: campDays(sources.camp.date_from, sources.camp.date_to) } }),
    ...siteLines(sources.site, sources.on_site_lead_active),
    ...planLines(sources.plan),
    scheduleLine(sources.camp, sources.schedule_days, sources.titled_days),
    line('menu', UNVERIFIED, ['not_in_wampums']),
    materialLine(sources.material),
    personalLine(sources.personal),
    line('parent_letter', UNVERIFIED, ['not_in_wampums']),
    approvalLine(sources.approval, rights.frozen),
  ];
  if (!sources.camp.activity_id) {
    lines.push(line('transport', UNVERIFIED, ['no_activity']));
  } else if (!rights.carpools) {
    lines.push(noAccess('transport'));
  } else {
    lines.push(line('transport', UNVERIFIED, ['cite_transport'], { counts: { offers: sources.carpool_offers } }));
  }
  if (rights.participants) {
    lines.push(...rosterLines(sources.roster));
  } else {
    lines.push(...['youth_list', 'team_list', 'health_forms', 'allergies'].map(noAccess));
  }
  lines.push(rights.reviews ? evaluationLine(sources.evaluation) : noAccess('evaluation'));
  return LINE_KEYS.map((key) => lines.find((entry) => entry.key === key));
}

/** The planned camp, refused when the unit has none. */
async function campFor(db, organizationId, meetingId) {
  const camp = (await db.query(
    `SELECT m.id, m.theme, m.meeting_date::text AS date_from,
            COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
            m.activity_id, m.is_cancelled, m.year_plan_id,
            COALESCE(a.activity_end_date, m.meeting_date) < CURRENT_DATE AS over
       FROM year_plan_meetings m
       LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
      WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`,
    [organizationId, meetingId]
  )).rows[0];
  if (!camp) {
    throw new CampPlanError('camp_permit_camp_not_found', HTTP_NOT_FOUND);
  }
  return camp;
}

/** The unit's name, branch, scout group(s), district and coeducation. */
async function unitFor(db, organizationId) {
  const row = (await db.query(
    `SELECT o.name, o.program_section,
            (SELECT s.setting_value FROM organization_settings s
              WHERE s.organization_id = o.id AND s.setting_key = 'organization_info') AS info,
            COALESCE((SELECT json_agg(lg.name ORDER BY lg.name)
                        FROM organization_local_groups olg JOIN local_groups lg ON lg.id = olg.local_group_id
                       WHERE olg.organization_id = o.id), '[]'::json) AS scout_groups
       FROM organizations o WHERE o.id = $1`,
    [organizationId]
  )).rows[0] || {};
  const info = row.info && typeof row.info === 'object' ? row.info : {};
  return {
    name: info.name || row.name || null,
    unit: filled(info.unit) ? info.unit : null,
    district: filled(info.district) ? info.district : null,
    coeducation: RULES.COEDUCATION.includes(info.coeducation) ? info.coeducation : null,
    program_section: row.program_section || 'general',
    scout_groups: Array.isArray(row.scout_groups) ? row.scout_groups : [],
  };
}

/** What only counts or a state are read from: schedule days, personal list, carpool offers, review. */
async function smallReads(db, organizationId, camp) {
  const row = (await db.query(
    `SELECT COALESCE((SELECT json_agg(DISTINCT a.day_offset) FROM year_plan_meeting_activities a
                       WHERE a.organization_id = $1 AND a.meeting_id = $2), '[]'::json) AS schedule_days,
            COALESCE((SELECT json_agg(d.day_offset) FROM year_plan_meeting_days d
                       WHERE d.organization_id = $1 AND d.meeting_id = $2
                         AND length(btrim(COALESCE(d.title, ''))) > 0), '[]'::json) AS titled_days,
            (SELECT json_build_object('published', l.published) FROM personal_equipment_lists l
              WHERE l.organization_id = $1 AND l.meeting_id = $2) AS personal,
            (SELECT COUNT(*) FROM carpool_offers c
              WHERE c.organization_id = $1 AND c.activity_id = $3 AND COALESCE(c.is_active, TRUE)
                AND c.cancelled_at IS NULL)::int AS carpool_offers,
            COALESCE((SELECT uo.status = 'active' FROM camp_details d
                        JOIN user_organizations uo ON uo.organization_id = d.organization_id AND uo.user_id = d.on_site_lead_id
                       WHERE d.organization_id = $1 AND d.meeting_id = $2), FALSE) AS on_site_lead_active,
            COALESCE((SELECT r.status = 'closed' FROM camp_reviews r
                       WHERE r.organization_id = $1 AND r.meeting_id = $2), FALSE) AS review_closed,
            (SELECT json_build_object('status', v.status, 'redacted', v.redacted_at IS NOT NULL)
               FROM camp_plan_versions v WHERE v.organization_id = $1 AND v.meeting_id = $2
              ORDER BY v.version_number DESC LIMIT 1) AS approval`,
    [organizationId, camp.id, camp.activity_id]
  )).rows[0] || {};
  return {
    schedule_days: (row.schedule_days || []).map(Number),
    titled_days: (row.titled_days || []).map(Number),
    personal: row.personal || null,
    approval: row.approval || null,
    carpool_offers: Number(row.carpool_offers) || 0,
    on_site_lead_active: Boolean(row.on_site_lead_active),
    evaluation: { over: Boolean(camp.over), closed: Boolean(row.review_closed) },
  };
}

/** Rights the camp lists' gaps need none of: only states and counts leave this service. */
const ROSTER_RIGHTS = Object.freeze({ canManage: false, canSeeVolunteers: false, canSeeCertifications: false, canSeeAllergies: false });

/**
 * One camp's permit checklist and header.
 *
 * @param {Object} db - pg pool
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @param {{participants: boolean, carpools: boolean, reviews: boolean}} rights - From the authorization engine
 * @returns {Promise<Object>} { camp, header, groups, lines }
 */
async function readCampPermit(db, organizationId, meetingId, rights) {
  const camp = await campFor(db, organizationId, meetingId);
  const [unit, site, plan, material, small, roster] = await Promise.all([
    unitFor(db, organizationId),
    readCampSite(db, organizationId, meetingId),
    campPlanGaps(db, organizationId, meetingId),
    buildCampMaterialList(db, organizationId, meetingId),
    smallReads(db, organizationId, camp),
    rights.participants ? readCampRoster(db, organizationId, meetingId, ROSTER_RIGHTS) : Promise.resolve(null),
  ]);
  const lines = permitLines({ unit, camp, site, plan, material, roster, ...small }, rights);
  return {
    camp: { id: camp.id, theme: camp.theme, date_from: camp.date_from, date_to: camp.date_to,
      activity_id: camp.activity_id, is_cancelled: camp.is_cancelled, year_plan_id: camp.year_plan_id },
    header: {
      ...unit,
      days: campDays(camp.date_from, camp.date_to),
      youth_count: roster ? roster.youth.length : null,
    },
    groups: RULES.GROUPS,
    lines,
  };
}

module.exports = { RULES, LINE_KEYS, REASONS, campDays, permitLines, readCampPermit };
