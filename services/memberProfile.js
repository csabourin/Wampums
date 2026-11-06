'use strict';
/** Personal contacts and health information, written only by their account holder (#1359). */
const RULES = require('../config/member_profile.json');
const { adult_age: ADULT_AGE, oldest_age: OLDEST_AGE } = require('../config/camp_team.json');
const { isCalendarDate } = require('../utils/calendar-date');

const ISO_YEAR_LENGTH = 'YYYY'.length;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const CONTACT_FIELDS = ['phone', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship'];
const HEALTH_FIELDS = ['health_conditions', 'medications', 'support_needs'];

/** A field-specific refusal safe to return to the caller. */
class MemberProfileError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** Validate a complete contacts or health form. Unknown fields never select an account. */
function readInput(input, health = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MemberProfileError('member_profile_invalid');
  }
  const data = {};
  for (const field of health ? HEALTH_FIELDS : CONTACT_FIELDS) {
    const value = input[field];
    const max = health ? RULES.health_text_max_length : field.includes('phone') ? RULES.phone_max_length : RULES.name_max_length;
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > max
      || (field.includes('phone') && !/^[0-9+().\-\s]*$/.test(value)))) {
      throw new MemberProfileError('member_profile_field_invalid', HTTP_BAD_REQUEST, field);
    }
    data[field] = typeof value === 'string' ? value.trim() || null : null;
  }
  if (!health) {
    if (typeof input.share_camp_contacts !== 'boolean') {
      throw new MemberProfileError('member_profile_field_invalid', HTTP_BAD_REQUEST, 'share_camp_contacts');
    }
    data.share_camp_contacts = input.share_camp_contacts;
    if (input.date_of_birth !== undefined) {
      const value = input.date_of_birth;
      const today = new Date().toISOString().slice(0, 'YYYY-MM-DD'.length);
      if (value !== null && value !== '' && (!isCalendarDate(value) || value > today
        || Number(today.slice(0, ISO_YEAR_LENGTH)) - Number(value.slice(0, ISO_YEAR_LENGTH)) > OLDEST_AGE)) {
        throw new MemberProfileError('camp_roster_birth_date_invalid', HTTP_BAD_REQUEST, 'date_of_birth');
      }
      data.date_of_birth = value || null;
    }
  }
  return data;
}

/** Serialize account-wide writes with age checks, including across units. */
async function lockProfile(db, userId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`member-profile:${userId}`]);
}

/** Reads and writes require current active membership; records themselves have no unit owner. */
async function assertMember(db, organizationId, userId) {
  const result = await db.query("SELECT 1 FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [organizationId, userId]);
  if (!result.rows.length) { throw new MemberProfileError('member_profile_member_not_found', HTTP_NOT_FOUND); }
}

/** The holder's contacts and optional birth date, never another account's. */
async function readOwnProfile(db, organizationId, userId) {
  await assertMember(db, organizationId, userId);
  return (await db.query(
    `SELECT p.phone, p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relationship,
            COALESCE(p.share_camp_contacts, FALSE) AS share_camp_contacts, u.date_of_birth::text AS date_of_birth
       FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]
  )).rows[0];
}

/** The holder's voluntary health form, or null if not yet filled in. Allergies have their own section. */
async function readOwnHealth(db, organizationId, userId) {
  await assertMember(db, organizationId, userId);
  return (await db.query('SELECT health_conditions, medications, support_needs, updated_at FROM member_health_forms WHERE user_id = $1', [userId])).rows[0] || null;
}

/** Save a complete form in a transaction. The authenticated caller supplies userId, never the body. */
async function saveOwnForm(pool, organizationId, userId, input, health = false) {
  const data = readInput(input, health);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockProfile(db, userId);
    await assertMember(db, organizationId, userId);
    if (health) {
      await db.query(`INSERT INTO member_health_forms (user_id, health_conditions, medications, support_needs)
        VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET health_conditions = EXCLUDED.health_conditions,
        medications = EXCLUDED.medications, support_needs = EXCLUDED.support_needs, updated_at = NOW()`,
      [userId, ...HEALTH_FIELDS.map((field) => data[field])]);
    } else {
      await db.query(`INSERT INTO member_profiles (user_id, phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, share_camp_contacts)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone,
        emergency_contact_name = EXCLUDED.emergency_contact_name, emergency_contact_phone = EXCLUDED.emergency_contact_phone,
        emergency_contact_relationship = EXCLUDED.emergency_contact_relationship, share_camp_contacts = EXCLUDED.share_camp_contacts, updated_at = NOW()`,
      [userId, ...CONTACT_FIELDS.map((field) => data[field]), data.share_camp_contacts]);
      if (data.date_of_birth !== undefined) {
        await db.query('UPDATE users SET date_of_birth = $2 WHERE id = $1', [userId, data.date_of_birth]);
      }
    }
    const saved = health ? await readOwnHealth(db, organizationId, userId) : await readOwnProfile(db, organizationId, userId);
    await db.query('COMMIT');
    return saved;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally { db.release(); }
}

/** Refuse a known under-age account at signup or assignment; unknown ages stay explicitly unverified. */
async function assertVolunteerAge(db, userId, dateOfBirth) {
  await lockProfile(db, userId);
  const row = (await db.query(`SELECT CASE WHEN $2::date IS NULL THEN u.date_of_birth ELSE $2::date END IS NOT NULL
      AND age(CURRENT_DATE, COALESCE($2::date, u.date_of_birth)) < make_interval(years => $3::int) AS too_young
    FROM users u WHERE u.id = $1`, [userId, dateOfBirth || null, RULES.minimum_volunteer_age])).rows[0];
  if (row?.too_young) { throw new MemberProfileError('member_profile_volunteer_too_young'); }
}

/**
 * Fresh peer contacts for one camp; called only after readCamp established the caller's participation.
 * Only consenting, known adults who are currently active in this unit are returned. Emergency contacts
 * and health information are never included. Minors and unknown ages disclose nothing to peers.
 */
async function campContacts(db, organizationId, userId, activityId) {
  return (await db.query(`SELECT u.id AS user_id, u.full_name AS name, u.nickname, p.phone
    FROM member_profiles p JOIN users u ON u.id = p.user_id
    JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $1 AND uo.status = 'active'
    WHERE p.share_camp_contacts AND p.phone IS NOT NULL AND u.id <> $2
      AND age(CURRENT_DATE, u.date_of_birth) >= make_interval(years => $4::int)
      AND EXISTS (SELECT 1 FROM users caller WHERE caller.id = $2
        AND age(CURRENT_DATE, caller.date_of_birth) >= make_interval(years => $4::int))
      AND (EXISTS (SELECT 1 FROM volunteer_signups v JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
        WHERE v.organization_id = $1 AND v.user_id = u.id AND s.activity_id = $3)
      OR EXISTS (SELECT 1 FROM camp_team_members t JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id
        WHERE t.organization_id = $1 AND t.user_id = u.id AND m.activity_id = $3 AND NOT m.is_cancelled))
    ORDER BY u.full_name, u.id`, [organizationId, userId, activityId, ADULT_AGE])).rows;
}

/** Read health and emergency contacts only for active members of this camp's team, after health authorization. */
async function campHealthForms(db, organizationId, meetingId) {
  return (await db.query(`SELECT u.id AS user_id, u.full_name AS name, u.nickname,
      h.health_conditions, h.medications, h.support_needs, h.updated_at,
      p.phone, p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relationship
    FROM camp_team_members t JOIN users u ON u.id = t.user_id
    JOIN user_organizations uo ON uo.user_id = t.user_id AND uo.organization_id = t.organization_id AND uo.status = 'active'
    LEFT JOIN member_health_forms h ON h.user_id = u.id LEFT JOIN member_profiles p ON p.user_id = u.id
    WHERE t.organization_id = $1 AND t.meeting_id = $2 ORDER BY u.full_name, u.id`, [organizationId, meetingId])).rows;
}

module.exports = { MemberProfileError, readInput, readOwnProfile, readOwnHealth, saveOwnForm, assertVolunteerAge, campContacts, campHealthForms };
