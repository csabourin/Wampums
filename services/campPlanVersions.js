'use strict';
/**
 * Frozen versions of a camp plan (#1418, camp plan slice 3).
 *
 * Submitting the plan reads everything the camp permit's document holds, from
 * where it lives (the checklist of services/campPermit.js, the written sections
 * of services/campPlan.js, the schedule, the site, the camp lists, the
 * material), keeps it as a snapshot, and generates the PDF from that snapshot
 * (services/campPlanPdf.js). The version never changes afterwards: editing the
 * camp, its site or the unit's templates leaves it as submitted.
 *
 * - The snapshot holds no volunteer's name: volunteers are counted by type of shift,
 *   since their names are only for managers of volunteers. Team qualifications are in
 *   it, so reading versions takes the rights the camp lists ask for them
 *   (meetings.manage or volunteers.manage, checked by the route).
 * - The snapshot holds no health information. The allergies section exists only
 *   in a second PDF (`pdf_health`), served to holders of `camp_allergies.view`.
 * - Each PDF's SHA-256 digest is stored and shown, so a copy attached to the permit request
 *   can be checked against its version.
 * - A new submission supersedes the version still waiting (`submitted`).
 * - What changed since the latest version is found by comparing the current
 *   plan's snapshot with it, part by part.
 *
 * @module services/campPlanVersions
 */
const crypto = require('crypto');
const transaction = require('../utils/transaction');
const { CampPlanError, readCampPlan } = require('./campPlan');
const { readCampPermit } = require('./campPermit');
const { readCampSite } = require('./campSites');
const { readCampRoster } = require('./campRoster');
const { buildCampMaterialList } = require('./campMaterialList');
const { withLeaders } = require('./scheduleLeaders');
const { renderPlanPdf, PDF_LANGUAGES } = require('./campPlanPdf');

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** The parts of a snapshot compared to say what changed since a version. */
const SNAPSHOT_PARTS = ['camp', 'header', 'checklist', 'sections', 'rain_games', 'schedule', 'site', 'team', 'volunteers', 'youth', 'material'];
/** Every right a submitted plan is read with: it is the whole plan, for the people who approve it. */
const FULL_PERMIT_RIGHTS = Object.freeze({ participants: true, carpools: true, reviews: true });
/** Site facts the document prints, in its order. */
const SITE_FIELDS = ['name', 'owner_name', 'address', 'province', 'phone', 'site_type', 'accommodation', 'accommodation_note',
  'heating', 'heating_note', 'has_own_insurance', 'insurance_note', 'hospital_name', 'hospital_address', 'hospital_phone',
  'hospital_travel_minutes', 'hospital_distance_km', 'poison_centre_phone', 'other_emergency_numbers', 'directions_url',
  'hospital_directions_url'];

/**
 * How many volunteers hold places of each type of shift: the document counts them,
 * never names them (their names are for managers of volunteers only).
 *
 * @param {{types: string[]}[]} people
 * @returns {{type: string, count: number}[]} In type order
 */
function volunteerCounts(people) {
  const counts = new Map();
  people.forEach((person) => (person.types || []).forEach((type) => counts.set(type, (counts.get(type) || 0) + 1)));
  return [...counts.keys()].sort().map((type) => ({ type, count: counts.get(type) }));
}

/** @returns {string} SHA-256 of a buffer, in hexadecimal */
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * The language the unit's documents are written in: its default email language,
 * when it is one the document is translated into, else French.
 */
async function unitLanguage(db, organizationId) {
  const raw = (await db.query(
    `SELECT setting_value FROM organization_settings
      WHERE organization_id = $1 AND setting_key = 'default_email_language'`,
    [organizationId]
  )).rows[0]?.setting_value;
  const language = typeof raw === 'string' ? raw : raw?.language;
  return PDF_LANGUAGES.includes(language) ? language : 'fr';
}

/** The camp's schedule, day by day, with each line's members in charge and notes. */
async function scheduleFor(db, organizationId, camp, days) {
  const [dayRows, lineRows] = [
    (await db.query(
      `SELECT day_offset, title, notes FROM year_plan_meeting_days
        WHERE organization_id = $1 AND meeting_id = $2 ORDER BY day_offset`,
      [organizationId, camp.id]
    )).rows,
    (await db.query(
      `SELECT id, day_offset, to_char(start_time, 'HH24:MI') AS start_time, name, duration_minutes, responsable, description
         FROM year_plan_meeting_activities
        WHERE organization_id = $1 AND meeting_id = $2
        ORDER BY day_offset, start_time NULLS LAST, sort_order, id`,
      [organizationId, camp.id]
    )).rows,
  ];
  const lines = await withLeaders(db, organizationId, lineRows);
  const first = Date.parse(`${camp.date_from}T00:00:00Z`);
  const DAY_MS = 86400000;
  return Array.from({ length: days }, (_, offset) => {
    const heading = dayRows.find((row) => Number(row.day_offset) === offset);
    return {
      day_offset: offset,
      date: new Date(first + (offset * DAY_MS)).toISOString().slice(0, 'YYYY-MM-DD'.length),
      title: heading?.title || null,
      notes: heading?.notes || null,
      lines: lines.filter((line) => Number(line.day_offset) === offset).map((line) => ({
        start_time: line.start_time,
        name: line.name,
        duration_minutes: line.duration_minutes,
        leaders: line.leaders.map((leader) => ({ name: leader.name, left: !leader.active_member })),
        responsable: line.responsable || null,
        description: line.description || null,
      })),
    };
  });
}

/**
 * Everything the plan's document holds, as it reads now.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId - The planned camp
 * @param {{withHealth?: boolean}} [options] - Also read the allergies, for the second PDF
 * @returns {Promise<{snapshot: Object, health: Object|null}>}
 */
async function buildPlanSnapshot(db, organizationId, meetingId, { withHealth = false } = {}) {
  // One read at a time: inside a submission, `db` is a single transaction client.
  const permit = await readCampPermit(db, organizationId, meetingId, FULL_PERMIT_RIGHTS);
  const plan = await readCampPlan(db, organizationId, meetingId);
  const site = await readCampSite(db, organizationId, meetingId);
  const roster = await readCampRoster(db, organizationId, meetingId,
    { canManage: false, canSeeVolunteers: true, canSeeCertifications: true, canSeeAllergies: withHealth });
  const material = await buildCampMaterialList(db, organizationId, meetingId);
  const schedule = await scheduleFor(db, organizationId, permit.camp, permit.header.days);

  const snapshot = {
    camp: { theme: permit.camp.theme, date_from: permit.camp.date_from, date_to: permit.camp.date_to },
    header: permit.header,
    checklist: permit.lines,
    sections: plan.sections.map((section) => ({ key: section.key, source: section.source, text: section.body_text || null })),
    rain_games: plan.rain_games.map((game) => ({
      name: game.name, description: game.description || null, material: game.material || null,
      duration_min: game.estimated_duration_min ?? null, duration_max: game.estimated_duration_max ?? null,
    })),
    schedule,
    site: site.site ? {
      ...Object.fromEntries(SITE_FIELDS.map((field) => [field, site.site[field] ?? null])),
      season: site.details?.season || null,
      camp_accommodation: site.details?.accommodation || null,
      on_site_lead_name: site.details?.on_site_lead_name || null,
      contact_phone: site.details?.contact_phone || null,
    } : null,
    team: roster.team.map((member) => ({
      name: member.name, team_role: member.team_role, active_member: member.active_member,
      certifications: member.certifications?.verified || [],
    })),
    volunteers: volunteerCounts(roster.volunteers.people || []),
    // The id is kept so a family's erasure finds the versions naming their child; it is never printed.
    youth: roster.youth.map((person) => ({
      participant_id: person.id, first_name: person.first_name, last_name: person.last_name, age_at_camp: person.age_at_camp,
    })),
    material: {
      items: (material?.items || []).map((item) => ({
        name: item.name, quantity: item.quantity, unit_of_measure: item.unit_of_measure, category: item.category,
      })),
      free_text: (material?.free_text || []).map((entry) => ({ activity: entry.name, material: entry.material })),
    },
  };
  return { snapshot, health: withHealth ? roster.allergies : null };
}

/**
 * A value as JSON with its object keys sorted, so two equal snapshots compare equal
 * however they were stored (JSONB does not keep key order).
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** How many characters of a fingerprint people compare, in groups of four. */
const CODE_LENGTH = 8;
const CODE_GROUP = 4;

/**
 * The short code people compare by eye: the start of a fingerprint, in capitals, in groups of four.
 * The SPA's `verificationCode` (spa/modules/camp-plan/CampPermit.js) writes it the same way.
 */
function verificationCode(digest) {
  const start = String(digest || '').slice(0, CODE_LENGTH).toUpperCase();
  return start.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g'))?.join(' ') || '';
}

/** @returns {string[]} The parts of `current` that differ from `previous` */
function changedParts(previous, current) {
  return SNAPSHOT_PARTS.filter((part) => canonicalJson(previous?.[part]) !== canonicalJson(current?.[part]));
}

/** The planned camp, locked; refused when the unit has none, or when it is cancelled. */
async function lockCamp(db, organizationId, meetingId) {
  const camp = (await db.query(
    `SELECT id, is_cancelled FROM year_plan_meetings
      WHERE organization_id = $1 AND id = $2 AND meeting_kind = 'camp' FOR UPDATE`,
    [organizationId, meetingId]
  )).rows[0];
  if (!camp) {
    throw new CampPlanError('camp_permit_camp_not_found', HTTP_NOT_FOUND);
  }
  if (camp.is_cancelled) {
    throw new CampPlanError('camp_plan_camp_cancelled', HTTP_CONFLICT);
  }
}

/**
 * Hold the youth a snapshot names until the version is stored, so an erasure cannot slip between
 * reading them and storing the version. An erasure locks its child FOR UPDATE: one under way makes
 * this wait, and one that removed a child since the snapshot was read refuses the submission (409),
 * to be tried again, rather than storing the erased child.
 */
async function lockNamedYouth(db, snapshot) {
  const ids = snapshot.youth.map((person) => person.participant_id);
  if (!ids.length) {
    return;
  }
  const held = (await db.query(
    'SELECT id FROM participants WHERE id = ANY($1::int[]) ORDER BY id FOR SHARE',
    [ids]
  )).rowCount;
  if (held !== ids.length) {
    throw new CampPlanError('camp_plan_roster_changed', HTTP_CONFLICT);
  }
}

/** Where the reader's right to allergies sits among each query's parameters. */
const HEALTH_PARAM = { submitted: 4, listed: 3 };

/**
 * A version as people see it: no snapshot, no document bytes. `pdf_sha256` is the
 * fingerprint of the copy this reader downloads.
 *
 * @param {number} healthParam - Number of the query parameter saying the reader may read allergies
 * @returns {string} SQL select list
 */
const versionColumns = (healthParam) => `v.version_number, v.status, v.language, v.snapshot_sha256,
  CASE WHEN $${healthParam}::boolean AND v.pdf_health IS NOT NULL THEN v.pdf_health_sha256 ELSE v.pdf_sha256 END AS pdf_sha256,
  v.pdf_health IS NOT NULL AS has_health, v.submitted_at, v.redacted_at, u.full_name AS submitted_by_name`;

/**
 * Submit the plan: freeze its content and generate its document.
 *
 * @param {Object} pool
 * @param {number} organizationId
 * @param {string} actorId - The member submitting
 * @param {number} meetingId - The planned camp
 * @param {boolean} [withHealth] - The submitter may read allergies: describe the copy they download
 * @returns {Promise<Object>} The new version, as listPlanVersions describes it
 */
function submitPlanVersion(pool, organizationId, actorId, meetingId, withHealth = false) {
  return transaction(pool, async (db) => {
    await lockCamp(db, organizationId, meetingId);
    const { snapshot, health } = await buildPlanSnapshot(db, organizationId, meetingId, { withHealth: true });
    await lockNamedYouth(db, snapshot);
    const language = await unitLanguage(db, organizationId);
    const number = Number((await db.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM camp_plan_versions
        WHERE organization_id = $1 AND meeting_id = $2`,
      [organizationId, meetingId]
    )).rows[0].next);
    const submittedAt = new Date();
    // The verification code printed on the document and shown in Wampums: the same for both copies.
    const snapshotSha256 = sha256(canonicalJson({ meeting_id: meetingId, version: number, snapshot }));
    const meta = { version: number, submittedAt, language, code: verificationCode(snapshotSha256) };
    const pdf = await renderPlanPdf(snapshot, null, meta);
    const hasHealth = Boolean(health && (health.youth.length || health.adults.length));
    const pdfHealth = hasHealth ? await renderPlanPdf(snapshot, health, meta) : null;
    // Only a fingerprint of the allergies is kept beside the snapshot, to tell when they change.
    const healthSha256 = sha256(canonicalJson(health));
    await db.query(
      `UPDATE camp_plan_versions SET status = 'superseded'
        WHERE organization_id = $1 AND meeting_id = $2 AND status = 'submitted'`,
      [organizationId, meetingId]
    );
    await db.query(
      `INSERT INTO camp_plan_versions (organization_id, meeting_id, version_number, language, snapshot, snapshot_sha256,
         pdf, pdf_sha256, pdf_health, pdf_health_sha256, health_sha256, submitted_by, submitted_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [organizationId, meetingId, number, language, JSON.stringify(snapshot), snapshotSha256, pdf, sha256(pdf),
        pdfHealth, pdfHealth ? sha256(pdfHealth) : null, healthSha256, actorId, submittedAt]
    );
    return (await db.query(
      `SELECT ${versionColumns(HEALTH_PARAM.submitted)} FROM camp_plan_versions v LEFT JOIN users u ON u.id = v.submitted_by
        WHERE v.organization_id = $1 AND v.meeting_id = $2 AND v.version_number = $3`,
      [organizationId, meetingId, number, withHealth]
    )).rows[0];
  });
}

/**
 * A camp's versions, newest first, and what changed in the plan since the latest.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {boolean} [withHealth] - The reader may read allergies: each fingerprint is that of their copy
 * @returns {Promise<{versions: Object[], changed_since_latest: string[]|null}>}
 *   `changed_since_latest` is null when nothing was submitted yet
 */
async function listPlanVersions(db, organizationId, meetingId, withHealth = false) {
  const versions = (await db.query(
    `SELECT ${versionColumns(HEALTH_PARAM.listed)} FROM camp_plan_versions v LEFT JOIN users u ON u.id = v.submitted_by
      WHERE v.organization_id = $1 AND v.meeting_id = $2 ORDER BY v.version_number DESC`,
    [organizationId, meetingId, withHealth]
  )).rows;
  if (!versions.length) {
    // Still refuses another unit's camp, or a meeting that is not one.
    await readCampPermit(db, organizationId, meetingId, { participants: false, carpools: false, reviews: false });
    return { versions: [], changed_since_latest: null };
  }
  const latest = (await db.query(
    `SELECT snapshot, health_sha256 FROM camp_plan_versions
      WHERE organization_id = $1 AND meeting_id = $2 AND version_number = $3`,
    [organizationId, meetingId, versions[0].version_number]
  )).rows[0];
  const { snapshot, health } = await buildPlanSnapshot(db, organizationId, meetingId, { withHealth });
  const changed = changedParts(latest.snapshot, snapshot);
  // Whether the allergies changed is itself health information: only their readers are told.
  if (withHealth && sha256(canonicalJson(health)) !== latest.health_sha256) {
    changed.push('allergies');
  }
  return { versions, changed_since_latest: changed };
}

/**
 * Remove an erased child from every frozen version that names them (services/erasure.js), inside
 * the erasure's transaction. The snapshot loses the child, the PDF is regenerated from it, the copy
 * naming allergies is deleted (it cannot be rebuilt without the erased health information), and the
 * version is marked redacted. Its verification code changes: older copies no longer match.
 *
 * @param {Object} client - The erasure's transaction client
 * @param {number} participantId - The child being erased
 * @returns {Promise<number>} How many versions were redacted
 */
async function redactParticipantFromVersions(client, participantId) {
  const versions = (await client.query(
    `SELECT id, meeting_id, version_number, language, submitted_at, snapshot FROM camp_plan_versions
      WHERE snapshot->'youth' @> jsonb_build_array(jsonb_build_object('participant_id', $1::int))
      FOR UPDATE`,
    [participantId]
  )).rows;
  // One version at a time: they share the erasure's single client.
  /* eslint-disable no-await-in-loop */
  for (const version of versions) {
    const youth = version.snapshot.youth.filter((person) => person.participant_id !== participantId);
    const snapshot = {
      ...version.snapshot,
      youth,
      header: { ...version.snapshot.header, youth_count: youth.length },
    };
    const snapshotSha256 = sha256(canonicalJson({ meeting_id: version.meeting_id, version: version.version_number, snapshot }));
    const pdf = await renderPlanPdf(snapshot, null, {
      version: version.version_number, submittedAt: new Date(version.submitted_at), language: version.language,
      code: verificationCode(snapshotSha256),
    });
    await client.query(
      `UPDATE camp_plan_versions
          SET snapshot = $2::jsonb, snapshot_sha256 = $3, pdf = $4, pdf_sha256 = $5,
              pdf_health = NULL, pdf_health_sha256 = NULL, health_sha256 = $6, redacted_at = NOW()
        WHERE id = $1`,
      [version.id, JSON.stringify(snapshot), snapshotSha256, pdf, sha256(pdf), sha256(canonicalJson(null))]
    );
  }
  /* eslint-enable no-await-in-loop */
  return versions.length;
}

/**
 * One version's document: with the allergies for whoever may read them, else without.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {number} versionNumber
 * @param {boolean} withHealth - The reader holds camp_allergies.view
 * @returns {Promise<{pdf: Buffer, sha256: string, filename: string}>}
 */
async function readPlanVersionPdf(db, organizationId, meetingId, versionNumber, withHealth) {
  const row = (await db.query(
    `SELECT v.version_number, v.pdf, v.pdf_sha256, v.pdf_health, v.pdf_health_sha256
       FROM camp_plan_versions v
       JOIN year_plan_meetings m ON m.id = v.meeting_id AND m.organization_id = v.organization_id
      WHERE v.organization_id = $1 AND v.meeting_id = $2 AND v.version_number = $3`,
    [organizationId, meetingId, versionNumber]
  )).rows[0];
  if (!row) {
    throw new CampPlanError('camp_plan_version_not_found', HTTP_NOT_FOUND);
  }
  const health = withHealth && row.pdf_health;
  return {
    pdf: health ? row.pdf_health : row.pdf,
    sha256: health ? row.pdf_health_sha256 : row.pdf_sha256,
    filename: `camp-plan-${meetingId}-v${row.version_number}${health ? '-health' : ''}.pdf`,
  };
}

module.exports = {
  SNAPSHOT_PARTS, buildPlanSnapshot, changedParts, verificationCode, redactParticipantFromVersions, submitPlanVersion, listPlanVersions, readPlanVersionPdf, unitLanguage,
};
