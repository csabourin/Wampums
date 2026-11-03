'use strict';
/**
 * Camp sites (#1317): the places a unit camps at, and what one camp records
 * about where it is held (site, season, accommodation, who leads on site, the
 * number families call).
 *
 * A site holds no personal data: its phones are the site's, the hospital's and
 * public lines. Sites are archived rather than deleted, so a camp keeps the site
 * it was held at; an archived site cannot be chosen for another camp.
 *
 * @module services/campSites
 */
const transaction = require('../utils/transaction');
const RULES = require('../config/camp_sites.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const UNIQUE_VIOLATION = '23505';
const PHONE_PATTERN = /^[0-9+().\-\s#x*]*$/i;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISTANCE_PRECISION = 10;

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class CampSiteError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CampSiteError(key, status, field);
};

/** Text fields of a site, with their longest value. */
const TEXT_FIELDS = {
  owner_name: RULES.TEXT_MAX,
  address: RULES.LONG_TEXT_MAX,
  site_type: RULES.TEXT_MAX,
  description: RULES.LONG_TEXT_MAX,
  accommodation_note: RULES.TEXT_MAX,
  heating_note: RULES.TEXT_MAX,
  insurance_note: RULES.LONG_TEXT_MAX,
  hospital_name: RULES.TEXT_MAX,
  hospital_address: RULES.LONG_TEXT_MAX,
  other_emergency_numbers: RULES.LONG_TEXT_MAX,
};
const PHONE_FIELDS = ['phone', 'hospital_phone', 'poison_centre_phone'];
const URL_FIELDS = ['directions_url', 'hospital_directions_url'];
const CHOICE_FIELDS = { accommodation: RULES.ACCOMMODATIONS, heating: RULES.HEATING, province: RULES.PROVINCES };

/** The columns a site is written with, in the order the INSERT and UPDATE below list them. */
const SITE_COLUMNS = [
  'name',
  'owner_name',
  'address',
  'site_type',
  'description',
  'accommodation_note',
  'heating_note',
  'insurance_note',
  'hospital_name',
  'hospital_address',
  'other_emergency_numbers',
  'phone',
  'hospital_phone',
  'poison_centre_phone',
  'directions_url',
  'hospital_directions_url',
  'accommodation',
  'heating',
  'province',
  'has_own_insurance',
  'hospital_travel_minutes',
  'hospital_distance_km',
];

/**
 * @param {*} value - Text sent, or null/undefined/'' for none
 * @returns {string|null|undefined} Trimmed text, null for none, undefined when not text
 */
function optionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.includes('\0')) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Check a whole site as sent, before any transaction opens.
 *
 * @param {Object} input - Request body
 * @returns {Object} The site's columns, ready to write
 */
function readSite(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    refuse('camp_site_invalid');
  }
  const site = {};
  const name = optionalText(input.name);
  if (!name || name.length > RULES.NAME_MAX) {
    refuse('camp_site_name_required', HTTP_BAD_REQUEST, 'name');
  }
  site.name = name;
  Object.entries(TEXT_FIELDS).forEach(([field, max]) => {
    const value = optionalText(input[field]);
    if (value === undefined || (value && value.length > max)) {
      refuse('camp_site_invalid_text', HTTP_BAD_REQUEST, field);
    }
    site[field] = value;
  });
  PHONE_FIELDS.forEach((field) => {
    const value = optionalText(input[field]);
    if (value === undefined || (value && (value.length > RULES.PHONE_MAX || !PHONE_PATTERN.test(value)))) {
      refuse('camp_site_invalid_phone', HTTP_BAD_REQUEST, field);
    }
    site[field] = value;
  });
  URL_FIELDS.forEach((field) => {
    const value = optionalText(input[field]);
    if (value === undefined || (value && (value.length > RULES.URL_MAX || !URL_PATTERN.test(value)))) {
      refuse('camp_site_invalid_url', HTTP_BAD_REQUEST, field);
    }
    site[field] = value;
  });
  Object.entries(CHOICE_FIELDS).forEach(([field, allowed]) => {
    const value = input[field] ?? null;
    if (value !== null && !allowed.includes(value)) {
      refuse('camp_site_invalid_choice', HTTP_BAD_REQUEST, field);
    }
    site[field] = value;
  });
  if (input.has_own_insurance !== undefined && input.has_own_insurance !== null && typeof input.has_own_insurance !== 'boolean') {
    refuse('camp_site_invalid_choice', HTTP_BAD_REQUEST, 'has_own_insurance');
  }
  site.has_own_insurance = input.has_own_insurance ?? null;
  const minutes = input.hospital_travel_minutes ?? null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > RULES.TRAVEL_MINUTES_MAX)) {
    refuse('camp_site_invalid_number', HTTP_BAD_REQUEST, 'hospital_travel_minutes');
  }
  site.hospital_travel_minutes = minutes;
  const distance = input.hospital_distance_km ?? null;
  if (distance !== null && (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || distance > RULES.DISTANCE_KM_MAX)) {
    refuse('camp_site_invalid_number', HTTP_BAD_REQUEST, 'hospital_distance_km');
  }
  site.hospital_distance_km = distance === null ? null : Math.round(distance * DISTANCE_PRECISION) / DISTANCE_PRECISION;
  return site;
}

/** @returns {Object} A site row as the API answers it */
function present(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    hospital_distance_km: row.hospital_distance_km === null || row.hospital_distance_km === undefined
      ? null : Number(row.hospital_distance_km),
    archived: Boolean(row.archived_at),
    gaps: emergencyGaps(row),
  };
}

/**
 * What a site still lacks for the camp permit's emergency section.
 *
 * @param {Object|null} site
 * @returns {string[]} Missing field names, in the order the permit lists them
 */
function emergencyGaps(site) {
  if (!site) {
    return ['site'];
  }
  return ['phone', 'address', 'hospital_name', 'hospital_phone', 'hospital_travel_minutes', 'poison_centre_phone', 'directions_url']
    .filter((field) => site[field] === null || site[field] === undefined || site[field] === '');
}

/**
 * @param {Object} db
 * @param {number} organizationId
 * @param {{includeArchived?: boolean}} [options]
 * @returns {Promise<Object[]>} The unit's sites, active first, by name
 */
async function listSites(db, organizationId, { includeArchived = false } = {}) {
  const result = await db.query(
    `SELECT * FROM camp_sites
      WHERE organization_id = $1 AND ($2::boolean OR archived_at IS NULL)
      ORDER BY (archived_at IS NOT NULL), LOWER(name), id`,
    [organizationId, includeArchived]
  );
  return result.rows.map(present);
}

/** Map a duplicate active name to its refusal. */
async function guardName(work) {
  try {
    return await work();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'camp_sites_active_name') {
      refuse('camp_site_name_conflict', HTTP_CONFLICT, 'name');
    }
    throw err;
  }
}

/**
 * Add a site to the unit.
 *
 * @returns {Promise<Object>} The saved site
 */
function createSite(pool, organizationId, actorId, input) {
  const site = readSite(input);
  return guardName(async () => {
    const result = await pool.query(
      `INSERT INTO camp_sites (organization_id, created_by,
         name, owner_name, address, site_type, description, accommodation_note,
         heating_note, insurance_note, hospital_name, hospital_address, other_emergency_numbers, phone,
         hospital_phone, poison_centre_phone, directions_url, hospital_directions_url, accommodation, heating,
         province, has_own_insurance, hospital_travel_minutes, hospital_distance_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       RETURNING *`,
      [organizationId, actorId, ...SITE_COLUMNS.map((column) => site[column])]
    );
    return present(result.rows[0]);
  });
}

/**
 * Replace a site's information. The editor names the version it loaded; a
 * change made since by someone else is refused rather than overwritten.
 *
 * @returns {Promise<Object>} The saved site
 */
function updateSite(pool, organizationId, siteId, input) {
  const site = readSite(input);
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) {
    refuse('camp_site_invalid', HTTP_BAD_REQUEST, 'expected_version');
  }
  return guardName(async () => {
    const result = await pool.query(
      `UPDATE camp_sites
          SET name = $4, owner_name = $5, address = $6, site_type = $7,
              description = $8, accommodation_note = $9, heating_note = $10, insurance_note = $11,
              hospital_name = $12, hospital_address = $13, other_emergency_numbers = $14, phone = $15,
              hospital_phone = $16, poison_centre_phone = $17, directions_url = $18, hospital_directions_url = $19,
              accommodation = $20, heating = $21, province = $22, has_own_insurance = $23,
              hospital_travel_minutes = $24, hospital_distance_km = $25,
              version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 AND version = $3
        RETURNING *`,
      [organizationId, siteId, input.expected_version, ...SITE_COLUMNS.map((column) => site[column])]
    );
    if (result.rows.length) {
      return present(result.rows[0]);
    }
    const exists = await pool.query('SELECT 1 FROM camp_sites WHERE organization_id = $1 AND id = $2', [organizationId, siteId]);
    return refuse(exists.rows.length ? 'camp_site_version_conflict' : 'camp_site_not_found',
      exists.rows.length ? HTTP_CONFLICT : HTTP_NOT_FOUND);
  });
}

/**
 * Archive or restore a site. Restoring fails when another active site took its name.
 *
 * @returns {Promise<Object>} The site
 */
function setSiteArchived(pool, organizationId, siteId, archived) {
  return guardName(async () => {
    const result = await pool.query(
      `UPDATE camp_sites
          SET archived_at = CASE WHEN $3::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END,
              version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2
        RETURNING *`,
      [organizationId, siteId, archived]
    );
    if (!result.rows.length) {
      refuse('camp_site_not_found', HTTP_NOT_FOUND);
    }
    return present(result.rows[0]);
  });
}

/** A planned camp of the unit, with its dates. */
const CAMP_SQL = `SELECT m.id, m.theme, m.meeting_date::text AS date_from,
       COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
       m.activity_id, m.is_cancelled, m.year_plan_id
  FROM year_plan_meetings m
  LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
 WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`;
const CAMP_LOCKED_SQL = `${CAMP_SQL} FOR UPDATE OF m`;

/**
 * The planned camp, or null when the unit has no such camp.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {boolean} [lock] - Lock the camp to serialize writes
 */
async function campFor(db, organizationId, meetingId, lock = false) {
  const result = await db.query(lock ? CAMP_LOCKED_SQL : CAMP_SQL, [organizationId, meetingId]);
  return result.rows[0] || null;
}

/**
 * Where one camp is held and how to reach help from there.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {{withMembers?: boolean}} [options] - Also list who may lead on site (managers only)
 * @returns {Promise<Object>} { camp, details, site, gaps, members? }
 */
async function readCampSite(db, organizationId, meetingId, { withMembers = false } = {}) {
  const camp = await campFor(db, organizationId, meetingId);
  if (!camp) {
    refuse('camp_site_camp_not_found', HTTP_NOT_FOUND);
  }
  const details = (await db.query(
    `SELECT d.camp_site_id, d.season, d.accommodation, d.on_site_lead_id, d.contact_phone, d.version,
            u.full_name AS on_site_lead_name
       FROM camp_details d
       LEFT JOIN users u ON u.id = d.on_site_lead_id
      WHERE d.organization_id = $1 AND d.meeting_id = $2`,
    [organizationId, meetingId]
  )).rows[0] || null;
  const site = details?.camp_site_id
    ? present((await db.query('SELECT * FROM camp_sites WHERE organization_id = $1 AND id = $2',
      [organizationId, details.camp_site_id])).rows[0])
    : null;
  const answer = { camp, details, site, gaps: emergencyGaps(site) };
  if (withMembers) {
    answer.members = (await db.query(
      `SELECT u.id, u.full_name FROM user_organizations uo JOIN users u ON u.id = uo.user_id
        WHERE uo.organization_id = $1 AND uo.status = 'active' ORDER BY u.full_name, u.id`,
      [organizationId]
    )).rows;
  }
  return answer;
}

/**
 * Check what a camp records about its site, before any transaction opens.
 *
 * @param {Object} input
 * @returns {Object} Columns ready to write
 */
function readCampDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    refuse('camp_site_invalid');
  }
  const siteId = input.camp_site_id ?? null;
  if (siteId !== null && (!Number.isInteger(siteId) || siteId < 1)) {
    refuse('camp_site_invalid', HTTP_BAD_REQUEST, 'camp_site_id');
  }
  const season = input.season ?? null;
  if (season !== null && !RULES.SEASONS.includes(season)) {
    refuse('camp_site_invalid_choice', HTTP_BAD_REQUEST, 'season');
  }
  const accommodation = input.accommodation ?? null;
  if (accommodation !== null && !RULES.ACCOMMODATIONS.includes(accommodation)) {
    refuse('camp_site_invalid_choice', HTTP_BAD_REQUEST, 'accommodation');
  }
  const lead = input.on_site_lead_id ?? null;
  if (lead !== null && (typeof lead !== 'string' || !UUID_PATTERN.test(lead))) {
    refuse('camp_site_lead_inactive', HTTP_BAD_REQUEST, 'on_site_lead_id');
  }
  const phone = optionalText(input.contact_phone);
  if (phone === undefined || (phone && (phone.length > RULES.PHONE_MAX || !PHONE_PATTERN.test(phone)))) {
    refuse('camp_site_invalid_phone', HTTP_BAD_REQUEST, 'contact_phone');
  }
  if (!Number.isInteger(input.expected_version) || input.expected_version < 0) {
    refuse('camp_site_invalid', HTTP_BAD_REQUEST, 'expected_version');
  }
  return {
    camp_site_id: siteId, season, accommodation, on_site_lead_id: lead, contact_phone: phone,
    expected_version: input.expected_version,
  };
}

/**
 * Record where a camp is held. The camp is locked, the site must be the unit's
 * and still offered (or already the camp's), and the lead an active member.
 *
 * @returns {Promise<Object>} The camp's site, as readCampSite answers it
 */
function saveCampSite(pool, organizationId, actorId, meetingId, input) {
  const details = readCampDetails(input);
  return transaction(pool, async (db) => {
    const camp = await campFor(db, organizationId, meetingId, true);
    if (!camp) {
      refuse('camp_site_camp_not_found', HTTP_NOT_FOUND);
    }
    if (camp.is_cancelled) {
      refuse('camp_site_camp_cancelled', HTTP_CONFLICT);
    }
    const current = (await db.query(
      'SELECT camp_site_id, version FROM camp_details WHERE organization_id = $1 AND meeting_id = $2',
      [organizationId, meetingId]
    )).rows[0];
    if ((current?.version || 0) !== details.expected_version) {
      refuse('camp_site_version_conflict', HTTP_CONFLICT);
    }
    if (details.camp_site_id !== null) {
      const site = (await db.query(
        'SELECT id, archived_at FROM camp_sites WHERE organization_id = $1 AND id = $2 FOR SHARE',
        [organizationId, details.camp_site_id]
      )).rows[0];
      if (!site || (site.archived_at && current?.camp_site_id !== site.id)) {
        refuse('camp_site_unavailable', HTTP_BAD_REQUEST, 'camp_site_id');
      }
    }
    if (details.on_site_lead_id !== null) {
      const member = await db.query(
        `SELECT 1 FROM user_organizations
          WHERE organization_id = $1 AND user_id = $2 AND status = 'active' FOR SHARE`,
        [organizationId, details.on_site_lead_id]
      );
      if (!member.rows.length) {
        refuse('camp_site_lead_inactive', HTTP_BAD_REQUEST, 'on_site_lead_id');
      }
    }
    await db.query(
      `INSERT INTO camp_details
         (organization_id, meeting_id, camp_site_id, season, accommodation, on_site_lead_id, contact_phone, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, meeting_id) DO UPDATE SET
         camp_site_id = EXCLUDED.camp_site_id, season = EXCLUDED.season, accommodation = EXCLUDED.accommodation,
         on_site_lead_id = EXCLUDED.on_site_lead_id, contact_phone = EXCLUDED.contact_phone,
         updated_by = EXCLUDED.updated_by, version = camp_details.version + 1, updated_at = NOW()`,
      [organizationId, meetingId, details.camp_site_id, details.season, details.accommodation,
        details.on_site_lead_id, details.contact_phone, actorId]
    );
    return readCampSite(db, organizationId, meetingId, { withMembers: true });
  });
}

module.exports = {
  CampSiteError,
  RULES,
  readSite,
  emergencyGaps,
  listSites,
  createSite,
  updateSite,
  setSiteArchived,
  readCampSite,
  saveCampSite,
};
