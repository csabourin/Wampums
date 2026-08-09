#!/usr/bin/env node
/**
 * Diagnose the allergy report
 *
 * Answers one question against a live database: for the organisation's active
 * scout year, which enrolled participants have a fiche santé that says
 * something about an allergy, and would each of them have appeared on the
 * allergy report before the fix — and if not, why.
 *
 * Prints participant initials and the *shape* of the answers, never the allergy
 * text itself, so the output can be pasted into a bug report.
 *
 * Usage:
 *   node scripts/diagnose-allergies-report.js <organization_id> [scout_year_id]
 *
 * Requires DATABASE_URL, like the server.
 */

const { Pool } = require('pg');
const { declaresAllergy, allergyText, isAffirmative } = require('../utils/health-form');
require('dotenv').config();

const SEPARATOR = '='.repeat(72);

/**
 * Initials of a participant, so the report can be shared without naming a child.
 *
 * @param {Object} row - Participant row
 * @returns {string} Initials, e.g. `A.T.`
 */
function initials(row) {
  const letter = (name) => (name ? `${String(name).trim().charAt(0).toUpperCase()}.` : '?.');
  return `${letter(row.first_name)}${letter(row.last_name)}`;
}

/**
 * Describe a stored answer without printing its content.
 *
 * @param {*} value - Raw submission value
 * @returns {string} Shape description
 */
function describe(value) {
  if (value === undefined) {
    return 'absent';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value.length <= 5 ? `"${value}"` : `text (${value.length} chars)`;
  }
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Run the diagnosis.
 *
 * @returns {Promise<void>} Resolves when the report has been printed
 */
async function main() {
  const organizationId = parseInt(process.argv[2], 10);
  const requestedYearId = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  if (Number.isNaN(organizationId)) {
    console.error('Usage: node scripts/diagnose-allergies-report.js <organization_id> [scout_year_id]');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    const yearResult = await pool.query(
      requestedYearId
        ? `SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, status
             FROM scout_years WHERE organization_id = $1 AND id = $2`
        : `SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, status
             FROM scout_years WHERE organization_id = $1 AND status = 'active' LIMIT 1`,
      requestedYearId ? [organizationId, requestedYearId] : [organizationId]
    );

    if (yearResult.rows.length === 0) {
      console.error(`No scout year found for organization ${organizationId}`);
      process.exitCode = 1;
      return;
    }

    const year = yearResult.rows[0];
    console.log(SEPARATOR);
    console.log(`Organization ${organizationId} — scout year ${year.label} (${year.status})`);
    console.log(`  ${year.start_date} → ${year.end_date}`);
    console.log(SEPARATOR);

    // Every enrolled participant with their health form, joined with no year
    // window at all: the window itself is one of the things being diagnosed.
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              sub.id AS submission_id,
              sub.scout_year_id,
              sub.created_at::text AS created_at,
              sub.updated_at::text AS updated_at,
              sub_year.label AS submission_year_label,
              sub_year.start_date::text AS submission_year_start,
              sub.submission_data AS health_data
         FROM participants p
         JOIN participant_enrollments po ON po.participant_id = p.id
          AND po.scout_year_id = $2 AND po.status = 'active'
         LEFT JOIN form_submissions sub ON sub.participant_id = p.id
          AND sub.organization_id = $1 AND sub.form_type = 'fiche_sante'
         LEFT JOIN scout_years sub_year ON sub_year.id = sub.scout_year_id
        WHERE po.organization_id = $1
        ORDER BY p.last_name, p.first_name`,
      [organizationId, year.id]
    );

    const declaring = result.rows.filter((row) => declaresAllergy(row.health_data));

    console.log(`Enrolled participants: ${result.rows.length}`);
    console.log(`Health forms declaring an allergy: ${declaring.length}`);
    console.log('');

    const missedBefore = [];

    declaring.forEach((row) => {
      const healthData = row.health_data || {};
      const reasons = [];

      // Reason 1: the old WHERE clause matched `has_allergies` against 'yes'.
      if (healthData.has_allergies !== 'yes') {
        reasons.push(`has_allergies is ${describe(healthData.has_allergies)}, not the string "yes"`);
      }

      // Reason 2: the "as of year" window could not see the submission.
      if (row.scout_year_id !== null && row.submission_year_start > year.start_date) {
        reasons.push(`form is stamped with ${row.submission_year_label}, which starts after this year`);
      }
      if (row.scout_year_id === null && row.created_at > `${year.end_date} 23:59:59`) {
        reasons.push(`form was created ${row.created_at}, after this year's end date`);
      }

      // Reason 3: allergy recorded under a field the report did not read.
      if (!healthData.allergie && allergyText(healthData)) {
        reasons.push('allergy text is stored under a field other than `allergie`');
      }

      if (reasons.length > 0) {
        missedBefore.push({ row, reasons });
      }
    });

    if (missedBefore.length === 0) {
      console.log('No participant was hidden from the allergy report by a data-shape issue.');
      console.log('If someone is still missing, check that they have an *active* enrollment');
      console.log(`for scout year ${year.label} — the report only lists that roster.`);
    } else {
      console.log(`${missedBefore.length} participant(s) the old report could not show:`);
      console.log('');
      missedBefore.forEach(({ row, reasons }) => {
        console.log(`  ${initials(row)} (participant ${row.id}, submission ${row.submission_id ?? 'none'})`);
        reasons.forEach((reason) => console.log(`      - ${reason}`));
        console.log(`      epipen: ${describe((row.health_data || {}).epipen)}`
          + ` | allergy text present: ${allergyText(row.health_data) ? 'yes' : 'no'}`
          + ` | epipen affirmative: ${isAffirmative((row.health_data || {}).epipen)}`);
        console.log('');
      });
    }

    const withoutForm = result.rows.filter((row) => !row.submission_id);
    if (withoutForm.length > 0) {
      console.log(SEPARATOR);
      console.log(`${withoutForm.length} enrolled participant(s) have no fiche santé at all:`);
      console.log(`  ${withoutForm.map(initials).join(', ')}`);
      console.log('An allergy cannot be reported for them because nothing was ever recorded.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Diagnosis failed:', error.message);
  process.exitCode = 1;
});
