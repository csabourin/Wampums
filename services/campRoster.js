'use strict';
const { assertVolunteerAge, MemberProfileError, campHealthForms } = require('./memberProfile');

/**
 * Camp lists (#1319, first slice): the youth taking part in a planned camp and
 * its team, as the camp permit asks for them.
 *
 * - **Youth** are the roster of the scout year covering the camp's first day,
 *   still enrolled then and registered by its last day. When the camp's activity has issued permission
 *   requests, only those whose request is signed take part (the action roster
 *   rule, devdocs/ACTION_ROSTERS.md); a declined or revoked request is a
 *   withdrawal. A youth enrolled in several units appears only for the units
 *   that enroll them, since every read is filtered by the camp's unit.
 * - **Team** members are named by a manager among the unit's active members
 *   whose roles reach beyond their own children (`camp_team_members`). A camp
 *   aide's age on the camp's first day comes from the account's optional birth
 *   date; without it, it reads "not verified", never "adult".
 * - **Volunteers** holding a place on one of the camp's shifts are listed on
 *   their own, by name only for whoever manages volunteers (the rule of #1251).
 *
 * - **Certifications** (second slice): an adult declares their own, a manager
 *   of volunteers verifies them (services/memberCertifications.js). Only a
 *   verified one valid through the camp's last day counts; a team without a
 *   verified first aider is a blocking gap. They are shown only to whoever
 *   manages the camp or volunteers.
 * - **Allergies** (third slice): the youth's come from their health forms, the
 *   team's from what each adult declared for themselves
 *   (services/memberAllergies.js). They are returned only to holders of
 *   `camp_allergies.view`; a youth without a health form, or a team member who
 *   declared nothing, is listed to check, never read as "no allergy".
 * - **Swimming**: a camp may say it plans swimming; its supervision is then
 *   listed to check. It is never a blocking gap: no lifeguard certification is
 *   recorded.
 *
 * Nothing here says a camp is compliant: what cannot be checked is listed in
 * `gaps`, and an empty list is one of them. `blocking_gaps` names those of
 * them the camp cannot leave without.
 *
 * @module services/campRoster
 */
const transaction = require('../utils/transaction');
const { isCalendarDate } = require('../utils/calendar-date');
const RULES = require('../config/camp_team.json');
const { FIRST_AID, certificationsForCamp } = require('./memberCertifications');
const { declarationsFor } = require('./memberAllergies');
const { isAffirmative, allergyText, medicationText, declaresAllergy } = require('../utils/health-form');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const TEAM_ROLES = RULES.team_roles;
/** Gaps the camp cannot leave without; the others are to check. */
const BLOCKING_GAPS = ['no_first_aider'];
/** Length of a YYYY-MM-DD calendar date in an ISO timestamp. */
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/** @returns {string} A day as YYYY-MM-DD, in UTC */
const isoDay = (date) => date.toISOString().slice(0, ISO_DATE_LENGTH);

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class CampRosterError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CampRosterError(key, status, field);
};

const CAMP_SQL = `SELECT m.id, m.theme, m.meeting_date::text AS date_from,
       COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
       m.activity_id, m.is_cancelled, m.swimming_planned
  FROM year_plan_meetings m
  LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id AND a.is_active = TRUE
 WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`;

/**
 * The planned camp of the unit, locked for a write; refused when the unit has
 * none, or, for a write, when it is cancelled.
 */
async function campFor(db, organizationId, meetingId, { lock = false } = {}) {
  const camp = (await db.query(lock ? `${CAMP_SQL} FOR UPDATE OF m` : CAMP_SQL, [organizationId, meetingId])).rows[0];
  if (!camp) {
    refuse('camp_roster_camp_not_found', HTTP_NOT_FOUND);
  }
  if (lock && camp.is_cancelled) {
    refuse('camp_roster_camp_cancelled', HTTP_CONFLICT);
  }
  return camp;
}

/** Members of the unit whose roles reach beyond their own children: those a camp's team is chosen from. */
const ON_TEAM_SQL = `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
                      JOIN roles r ON r.id = role_id_text::integer
                     WHERE r.data_scope IS DISTINCT FROM 'linked')`;

/**
 * The youth of the camp, and how their permission requests stand.
 *
 * @returns {Promise<{scout_year: Object|null, consent: Object, youth: Object[]}>}
 */
async function campYouth(db, organizationId, camp) {
  const scoutYear = (await db.query(
    `SELECT id, label FROM scout_years
      WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date
      ORDER BY start_date DESC, id DESC LIMIT 1`,
    [organizationId, camp.date_from]
  )).rows[0] || null;
  const counts = camp.activity_id ? (await db.query(
    `SELECT COUNT(DISTINCT participant_id) FILTER (WHERE status = 'signed')::int AS signed,
            COUNT(DISTINCT participant_id) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(DISTINCT participant_id) FILTER (WHERE status IN ('declined', 'revoked'))::int AS withdrawn,
            COUNT(*) FILTER (WHERE status IN ('pending', 'signed', 'declined', 'revoked', 'expired'))::int AS issued
       FROM permission_slips WHERE organization_id = $1 AND activity_id = $2`,
    [organizationId, camp.activity_id]
  )).rows[0] : null;
  const requested = Boolean(counts && counts.issued > 0);
  const consent = {
    requested,
    signed: requested ? counts.signed : 0,
    pending: requested ? counts.pending : 0,
    withdrawn: requested ? counts.withdrawn : 0,
  };
  if (!scoutYear) {
    return { scout_year: null, consent, youth: [] };
  }
  const youth = (await db.query(
    `SELECT p.id, p.first_name, p.last_name, p.nickname,
            CASE WHEN p.date_naissance IS NULL THEN NULL
                 ELSE date_part('year', age($3::date, p.date_naissance))::int END AS age_at_camp
       FROM participant_enrollments pe
       JOIN participants p ON p.id = pe.participant_id
      WHERE pe.organization_id = $1 AND pe.scout_year_id = $2
        AND (pe.status = 'active' OR pe.ended_on >= $3::date)
        -- Registered after the camp ended, they were not there: a later walk-in never changes a past camp.
        AND (pe.inscription_date IS NULL OR pe.inscription_date <= $6::date)
        AND (NOT $5::boolean OR EXISTS (
          SELECT 1 FROM permission_slips ps
           WHERE ps.organization_id = $1 AND ps.activity_id = $4 AND ps.participant_id = p.id AND ps.status = 'signed'))
      ORDER BY p.last_name, p.first_name, p.id`,
    [organizationId, scoutYear.id, camp.date_from, camp.activity_id, requested, camp.date_to]
  )).rows;
  return { scout_year: scoutYear, consent, youth };
}

/**
 * The camp's named team, with each member's age on the camp's first day.
 * The birth date itself is returned only to those who may change it.
 */
async function campTeam(db, organizationId, camp, { canManage }) {
  const rows = (await db.query(
    `SELECT t.user_id, t.team_role, u.full_name AS name, u.nickname,
            u.date_of_birth::text AS date_of_birth,
            CASE WHEN u.date_of_birth IS NULL THEN 'unknown'
                 WHEN age($3::date, u.date_of_birth) < make_interval(years => $4::int) THEN 'minor'
                 ELSE 'adult' END AS age_status,
            COALESCE(uo.status = 'active', FALSE) AS active_member
       FROM camp_team_members t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN user_organizations uo ON uo.organization_id = t.organization_id AND uo.user_id = t.user_id
      WHERE t.organization_id = $1 AND t.meeting_id = $2
      ORDER BY array_position($5::text[], t.team_role::text), u.full_name, t.user_id`,
    [organizationId, camp.id, camp.date_from, RULES.adult_age, TEAM_ROLES]
  )).rows;
  return rows.map((row) => {
    const member = { ...row };
    if (!canManage) {
      delete member.date_of_birth;
    }
    return member;
  });
}

/** Volunteers with a place on one of the camp's shifts: names for managers, a count for everyone else. */
async function campVolunteers(db, organizationId, camp, { canSeeVolunteers }) {
  if (!camp.activity_id) {
    return { count: 0, people: canSeeVolunteers ? [] : null };
  }
  const rows = (await db.query(
    `SELECT v.user_id, u.full_name AS name, u.nickname,
            array_agg(DISTINCT s.volunteer_type ORDER BY s.volunteer_type) AS types,
            bool_or(v.status = 'pending') AS pending
       FROM volunteer_signups v
       JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
       JOIN users u ON u.id = v.user_id
      WHERE v.organization_id = $1 AND s.activity_id = $2
      GROUP BY v.user_id, u.full_name, u.nickname
      ORDER BY u.full_name, v.user_id`,
    [organizationId, camp.activity_id]
  )).rows;
  return { count: rows.length, people: canSeeVolunteers ? rows : null };
}

/**
 * Each team member's certifications for the camp. Every member's are read, since the gaps need
 * them; they are attached to the members only for those who may see them.
 */
async function withCertifications(db, organizationId, camp, team, { canSeeCertifications }) {
  // A member who left the unit is still listed, but their person-wide record is no longer this unit's to read.
  const present = team.filter((member) => member.active_member).map((member) => member.user_id);
  const certifications = await certificationsForCamp(db, present, camp.date_from, camp.date_to);
  const members = team.map((member) => (canSeeCertifications && member.active_member
    ? { ...member, certifications: certifications.get(member.user_id) }
    : member));
  return { members, certifications };
}

/**
 * Each listed youth's health form in the unit: whether there is one, and, for whoever may read
 * allergies, what it says about them. The latest submission is the one in force.
 */
async function youthHealthForms(db, organizationId, youth, { canSeeAllergies }) {
  if (!youth.length) {
    return new Map();
  }
  const rows = (await db.query(
    `SELECT DISTINCT ON (fs.participant_id) fs.participant_id,
            CASE WHEN $3::boolean THEN fs.submission_data END AS health_data
       FROM form_submissions fs
      WHERE fs.organization_id = $1 AND fs.participant_id = ANY($2::int[]) AND fs.form_type = 'fiche_sante'
      ORDER BY fs.participant_id, fs.updated_at DESC NULLS LAST, fs.id DESC`,
    [organizationId, youth.map((person) => person.id), Boolean(canSeeAllergies)]
  )).rows;
  return new Map(rows.map((row) => [row.participant_id, row.health_data || {}]));
}

/**
 * The camp's allergies, for holders of `camp_allergies.view`: youth whose health form declares one,
 * and active team members who declared theirs. What cannot be known is counted, never left out.
 */
function campAllergies(youth, team, healthForms, declarations) {
  const present = team.filter((member) => member.active_member);
  const youthAllergies = youth.filter((person) => healthForms.has(person.id) && declaresAllergy(healthForms.get(person.id)))
    .map((person) => {
      const health = healthForms.get(person.id);
      const epipen = isAffirmative(health.epipen);
      return {
        participant_id: person.id, first_name: person.first_name, last_name: person.last_name, nickname: person.nickname,
        allergies: allergyText(health),
        epipen,
        emergency_medication: epipen ? medicationText(health) : null,
        reaction: health.allergie_reaction || health.reaction_allergie || null,
        action: health.allergie_action || health.mesures_allergie || null,
      };
    });
  const adults = present.filter((member) => declarations.has(member.user_id)).map((member) => ({
    user_id: member.user_id, name: member.name, nickname: member.nickname, ...declarations.get(member.user_id),
  }));
  return {
    youth: youthAllergies,
    youth_without_health_form: youth.filter((person) => !healthForms.has(person.id)).length,
    adults,
    adults_without_declaration: present.length - adults.length,
  };
}

/** What the lists cannot vouch for: each entry is a key the screen explains. */
function rosterGaps({ scout_year: scoutYear, youth }, team, certifications, camp, healthForms, declarations) {
  const gaps = [];
  if (!scoutYear) {
    gaps.push('no_scout_year');
  } else if (!youth.length) {
    gaps.push('no_youth');
  }
  if (!team.some((member) => member.team_role === 'lead' && member.active_member)) {
    gaps.push('no_lead');
  }
  if (team.some((member) => member.team_role === 'camp_aide' && member.age_status === 'unknown')) {
    gaps.push('aide_age_unknown');
  }
  if (team.some((member) => !member.active_member)) {
    gaps.push('member_left_unit');
  }
  const present = team.filter((member) => member.active_member);
  const held = (member) => certifications.get(member.user_id) || { verified: [], to_verify: [] };
  if (!present.some((member) => held(member).verified.some((key) => FIRST_AID.includes(key)))) {
    gaps.push('no_first_aider');
  }
  if (present.some((member) => held(member).to_verify.length)) {
    gaps.push('certification_to_verify');
  }
  if (youth.some((person) => !healthForms.has(person.id))) {
    gaps.push('youth_health_form_missing');
  }
  if (present.some((member) => !declarations.has(member.user_id))) {
    gaps.push('adult_allergies_not_declared');
  }
  if (camp.swimming_planned) {
    gaps.push('swimming_supervision');
  }
  return gaps;
}

/**
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId - The planned camp
 * @param {{canManage: boolean, canSeeVolunteers: boolean, canSeeCertifications: boolean, canSeeAllergies: boolean}} rights - From the authorization engine
 * @returns {Promise<Object>} { camp, scout_year, consent, youth, team, volunteers, allergies, gaps, blocking_gaps };
 *   `allergies` is null without `camp_allergies.view`
 */
async function readCampRoster(db, organizationId, meetingId, rights) {
  const camp = await campFor(db, organizationId, meetingId);
  const [youth, team, volunteers] = await Promise.all([
    campYouth(db, organizationId, camp),
    campTeam(db, organizationId, camp, rights),
    campVolunteers(db, organizationId, camp, rights),
  ]);
  const present = team.filter((member) => member.active_member).map((member) => member.user_id);
  const [{ members, certifications }, healthForms, declarations] = await Promise.all([
    withCertifications(db, organizationId, camp, team, rights),
    youthHealthForms(db, organizationId, youth.youth, rights),
    declarationsFor(db, present),
  ]);
  const gaps = rosterGaps(youth, team, certifications, camp, healthForms, declarations);
  const allergies = rights.canSeeAllergies ? campAllergies(youth.youth, team, healthForms, declarations) : null;
  return {
    camp: {
      id: camp.id, theme: camp.theme, date_from: camp.date_from, date_to: camp.date_to,
      activity_id: camp.activity_id, is_cancelled: camp.is_cancelled, swimming_planned: camp.swimming_planned,
    },
    ...youth,
    team: members,
    volunteers,
    allergies,
    adult_health_forms: rights.canSeeAllergies ? await campHealthForms(db, organizationId, meetingId) : null,
    gaps,
    blocking_gaps: gaps.filter((gap) => BLOCKING_GAPS.includes(gap)),
  };
}

/**
 * Say whether the camp plans swimming.
 *
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {Object} input - Request body: { swimming_planned: boolean }
 * @returns {Promise<{swimming_planned: boolean}>}
 */
function saveCampActivities(pool, organizationId, meetingId, input) {
  if (typeof input?.swimming_planned !== 'boolean') {
    refuse('camp_roster_invalid', HTTP_BAD_REQUEST, 'swimming_planned');
  }
  return transaction(pool, async (client) => {
    const camp = await campFor(client, organizationId, meetingId, { lock: true });
    await client.query(
      'UPDATE year_plan_meetings SET swimming_planned = $3 WHERE organization_id = $1 AND id = $2',
      [organizationId, camp.id, input.swimming_planned]
    );
    return { swimming_planned: input.swimming_planned };
  });
}

/**
 * The unit's members a camp's team may be chosen from.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @returns {Promise<Object[]>} { user_id, name, nickname }
 */
async function listTeamCandidates(db, organizationId) {
  return (await db.query(
    `SELECT u.id AS user_id, u.full_name AS name, u.nickname
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.organization_id = $1 AND uo.status = 'active' AND ${ON_TEAM_SQL}
      ORDER BY u.full_name, u.id`,
    [organizationId]
  )).rows;
}

/**
 * Read a team assignment from a request body, before any transaction opens.
 * `date_of_birth` left out keeps the account's; null or '' clears it. A date in the
 * future, or more than `oldest_age` years ago, is refused.
 *
 * @returns {{teamRole: string, dateOfBirth: string|null|undefined}}
 */
function readTeamInput(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    refuse('camp_roster_invalid');
  }
  if (!TEAM_ROLES.includes(input.team_role)) {
    refuse('camp_roster_team_role_invalid', HTTP_BAD_REQUEST, 'team_role');
  }
  let dateOfBirth;
  if (input.date_of_birth === null || input.date_of_birth === '') {
    dateOfBirth = null;
  } else if (input.date_of_birth !== undefined) {
    const value = input.date_of_birth;
    const today = isoDay(now);
    const oldestDate = new Date(now);
    oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - RULES.oldest_age);
    const oldest = isoDay(oldestDate);
    if (!isCalendarDate(value) || value > today || value < oldest) {
      refuse('camp_roster_birth_date_invalid', HTTP_BAD_REQUEST, 'date_of_birth');
    }
    dateOfBirth = value;
  }
  return { teamRole: input.team_role, dateOfBirth };
}

/**
 * Name a member to the camp's team, or change their role there.
 *
 * @param {Object} pool
 * @param {number} organizationId
 * @param {string} actorId - UUID of the manager
 * @param {number} meetingId
 * @param {string} userId - UUID of the member
 * @param {Object} input - { team_role, date_of_birth? }
 * @returns {Promise<Object[]>} The camp's team as it now is
 */
function saveTeamMember(pool, organizationId, actorId, meetingId, userId, input) {
  const { teamRole, dateOfBirth } = readTeamInput(input, new Date());
  return transaction(pool, async (client) => {
    const camp = await campFor(client, organizationId, meetingId, { lock: true });
    const member = (await client.query(
      `SELECT uo.user_id FROM user_organizations uo
        WHERE uo.organization_id = $1 AND uo.user_id = $2 AND uo.status = 'active' AND ${ON_TEAM_SQL}`,
      [organizationId, userId]
    )).rows[0];
    if (!member) {
      refuse('camp_roster_member_not_found', HTTP_NOT_FOUND, 'user_id');
    }
    try { await assertVolunteerAge(client, userId, dateOfBirth); } catch (err) {
      if (err instanceof MemberProfileError) { refuse(err.message, err.status, 'user_id'); }
      throw err;
    }
    await client.query(
      `INSERT INTO camp_team_members (organization_id, meeting_id, user_id, team_role, assigned_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, meeting_id, user_id)
       DO UPDATE SET team_role = EXCLUDED.team_role, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()`,
      [organizationId, camp.id, userId, teamRole, actorId]
    );
    if (dateOfBirth !== undefined) {
      await client.query('UPDATE users SET date_of_birth = $2 WHERE id = $1', [userId, dateOfBirth]);
    }
    return campTeam(client, organizationId, camp, { canManage: true });
  });
}

/**
 * Take a member off the camp's team. Their account and other camps are untouched.
 *
 * @returns {Promise<Object[]>} The camp's team as it now is
 */
function removeTeamMember(pool, organizationId, meetingId, userId) {
  return transaction(pool, async (client) => {
    const camp = await campFor(client, organizationId, meetingId, { lock: true });
    const removed = await client.query(
      'DELETE FROM camp_team_members WHERE organization_id = $1 AND meeting_id = $2 AND user_id = $3',
      [organizationId, camp.id, userId]
    );
    if (!removed.rowCount) {
      refuse('camp_roster_member_not_found', HTTP_NOT_FOUND);
    }
    return campTeam(client, organizationId, camp, { canManage: true });
  });
}

module.exports = {
  CampRosterError, TEAM_ROLES, BLOCKING_GAPS, readCampRoster, listTeamCandidates, saveTeamMember, removeTeamMember,
  saveCampActivities,
};
