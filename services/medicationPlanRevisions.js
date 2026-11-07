'use strict';

/**
 * Correcting a medication plan in place (#1379).
 *
 * A family corrects its child's plan instead of creating a second one. The correction keeps the
 * plan's id and its child, never touches a dose already given, and is recorded field by field in
 * `medication_requirement_revisions`. A change to what is given, made by an adult other than the
 * one who signed the administration authorization, sets that authorization to `plan_changed`.
 */

/** Fields of a plan, in the order a correction lists them. */
const PLAN_FIELDS = Object.freeze([
  'medication_name',
  'default_dose_amount',
  'default_dose_unit',
  'dosage_instructions',
  'frequency_preset_type',
  'frequency_times',
  'frequency_slots',
  'frequency_interval_hours',
  'frequency_interval_start',
  'route',
  'start_date',
  'end_date',
  'general_notes',
]);

/**
 * Fields that change what is given. A correction of one of them by an adult other than the signer
 * calls for a new signature; notes and treatment dates do not.
 */
const SUBSTANTIVE_FIELDS = new Set([
  'medication_name',
  'default_dose_amount',
  'default_dose_unit',
  'dosage_instructions',
  'frequency_preset_type',
  'frequency_times',
  'frequency_slots',
  'frequency_interval_hours',
  'frequency_interval_start',
  'route',
]);

/** Length of a clock time written HH:MM. */
const CLOCK_TIME_LENGTH = 5;

/** Status of an administration authorization that must be signed again after a correction. */
const PLAN_CHANGED_STATUS = 'plan_changed';

/**
 * Read one stored or submitted value the same way on both sides, so an unchanged field never
 * shows as a change: numbers as numbers, times as HH:MM, empty as null, lists as JSON text.
 *
 * @param {string} field - Plan field
 * @param {*} value - Value as stored, or as it will be stored
 * @returns {*} Comparable value
 */
function comparable(field, value) {
  if (value === undefined || value === null || value === '') {return null;}
  if (field === 'default_dose_amount' || field === 'frequency_interval_hours') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (field === 'frequency_interval_start') {return String(value).slice(0, CLOCK_TIME_LENGTH);}
  if (field === 'frequency_times' || field === 'frequency_slots') {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const empty = Array.isArray(parsed) ? parsed.length === 0 : Object.keys(parsed || {}).length === 0;
    return empty ? null : JSON.stringify(parsed);
  }
  return value;
}

/**
 * The value a revision records for a field: plain, readable, no JSON text.
 *
 * @param {string} field - Plan field
 * @param {*} value - Comparable value
 * @returns {*} Recorded value
 */
function recorded(field, value) {
  if (value !== null && (field === 'frequency_times' || field === 'frequency_slots')) {
    return JSON.parse(value);
  }
  return value;
}

/**
 * What a correction changes, field by field.
 *
 * @param {Object} current - The plan as stored (dates as YYYY-MM-DD, interval start as text)
 * @param {Object} next - The plan as it will be stored
 * @returns {Object} `{ field: { from, to } }`, empty when nothing changes
 */
function planChanges(current, next) {
  const changes = {};
  PLAN_FIELDS.forEach((field) => {
    const before = comparable(field, current[field]);
    const after = comparable(field, next[field]);
    if (before !== after) {
      changes[field] = { from: recorded(field, before), to: recorded(field, after) };
    }
  });
  return changes;
}

/**
 * @param {Object} changes - Result of planChanges()
 * @returns {boolean} True when the correction changes what is given
 */
function changesWhatIsGiven(changes) {
  return Object.keys(changes).some((field) => SUBSTANTIVE_FIELDS.has(field));
}

/**
 * Doses scheduled for later and not yet given follow the corrected dose, unless the team set
 * that dose apart from the plan. Doses given, missed or cancelled are history and never change.
 *
 * @param {Object} client - Transaction client
 * @param {Object} plan - `{ organizationId, requirementId, before, after }`
 * @returns {Promise<number>} Doses updated
 */
async function followCorrectedDose(client, { organizationId, requirementId, before, after }) {
  const result = await client.query(
    `UPDATE medication_distributions
        SET dose_amount = $5, dose_unit = $6, updated_at = NOW()
      WHERE organization_id = $1
        AND medication_requirement_id = $2
        AND status = 'scheduled'
        AND scheduled_for > NOW()
        AND dose_amount IS NOT DISTINCT FROM $3::numeric
        AND dose_unit IS NOT DISTINCT FROM $4`,
    [organizationId, requirementId, before.default_dose_amount ?? null, before.default_dose_unit ?? null,
      after.default_dose_amount ?? null, after.default_dose_unit ?? null]
  );
  return result.rowCount;
}

/**
 * Ask for a new signature when an adult other than the signer changed what is given: the signed
 * administration authorizations covering this plan become `plan_changed`, and are then listed
 * with those to sign again. The signer correcting their own plan is not asked to sign twice.
 *
 * @param {Object} client - Transaction client
 * @param {Object} plan - `{ organizationId, participantId, requirementId, userId }`
 * @returns {Promise<boolean>} True when a signature is now needed
 */
async function requireNewSignatureFromOthers(client, { organizationId, participantId, requirementId, userId }) {
  const result = await client.query(
    `UPDATE medication_admin_authorizations maa
        SET status = $5, updated_at = NOW()
      WHERE maa.organization_id = $1
        AND maa.participant_id = $2
        AND maa.status = 'signed'
        AND maa.created_by IS DISTINCT FROM $4::uuid
        AND EXISTS (
          SELECT 1 FROM medication_admin_authorization_requirements maar
           WHERE maar.authorization_id = maa.id AND maar.medication_requirement_id = $3
        )`,
    [organizationId, participantId, requirementId, userId, PLAN_CHANGED_STATUS]
  );
  return result.rowCount > 0;
}

/**
 * Record a correction.
 *
 * @param {Object} client - Transaction client
 * @param {Object} revision - `{ organizationId, requirementId, changes, userId, requiresNewSignature }`
 * @returns {Promise<Object>} The revision as the plan lists it
 */
async function recordRevision(client, { organizationId, requirementId, changes, userId, requiresNewSignature }) {
  const result = await client.query(
    `INSERT INTO medication_requirement_revisions
       (organization_id, medication_requirement_id, changes, changed_by, requires_new_signature)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING changes, changed_by, changed_at, requires_new_signature`,
    [organizationId, requirementId, JSON.stringify(changes), userId, requiresNewSignature]
  );
  return result.rows[0];
}

module.exports = {
  PLAN_FIELDS,
  PLAN_CHANGED_STATUS,
  planChanges,
  changesWhatIsGiven,
  followCorrectedDose,
  requireNewSignatureFromOthers,
  recordRevision,
};
