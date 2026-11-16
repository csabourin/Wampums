'use strict';

/**
 * Letter to parents drawn from the camp (#1321).
 *
 * The camp plan asks for a letter to the families giving the arrival (date, time, place), the return,
 * and how to reach the team in an emergency. Wampums already knows all of it: the camp's activity holds
 * the meeting points and times, its site and on-site lead the emergency number (#1317). The draft is
 * built from them in French and in English, then edited by the team; nothing is entered twice. A fact
 * that is missing is written "to be confirmed", never left as a gap.
 *
 * Sending freezes a numbered version and emails the families of the youth invited to the camp's
 * activity (whose authorization was not declined or withdrawn), each address in its language. The
 * letter's links (what is left to do, carpooling, the personal list) open the family's own pages: they
 * name no child, and each family sees only its own children once signed in. Every address has a
 * receipt claimed before the provider is called; only a failed address is retried.
 *
 * @module services/campParentLetter
 */
const { sendEmail, getUserEmailLanguage } = require('../utils/index');
const { sanitizeRichTextHtml, richTextToPlainText } = require('../utils/richText');
const { escapeHtml } = require('../utils/api-helpers');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { resolveOrganizationEmailSender } = require('./emailSender');
const { audience } = require('./activityAuthorizations');
const { CampPlanError } = require('./campPlan');
const logger = require('../config/logger');

const TRANSLATIONS = { en: require('../lang/en.json'), fr: require('../lang/fr.json') };
const LANGUAGES = Object.freeze(['fr', 'en']);
const LOCALES = Object.freeze({ fr: 'fr-CA', en: 'en-CA' });
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TIMEOUT = 408;
const HTTP_SERVER_ERROR = 500;
const SMTP_STATUS_LIMIT = 600;
/** Lengths the letter may reach, past which it is refused rather than cut. */
const LIMITS = Object.freeze({ subject: 200, body: 20000, sends_per_hour: 10 });
const ISO_DATE_LENGTH = 10;
/** Any day: clock() only needs a Date to carry the hour and the minute. */
const REFERENCE_YEAR = 2000;
const JANUARY = 0;
const HH_MM = /^(\d{1,2}):(\d{2})/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/** A fact the letter needs and the screen that completes it. */
const FACTS = Object.freeze(['activity', 'going_place', 'going_time', 'return_place', 'return_time', 'emergency_phone']);

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CampPlanError(key, status, field);
};

/**
 * @param {string} language - 'fr' or 'en'
 * @param {string} key - Translation key
 * @param {Object} [values] - {placeholder} values, already escaped when the text is HTML
 * @returns {string}
 */
function text(language, key, values = {}) {
  const template = TRANSLATIONS[language][key] || TRANSLATIONS.fr[key] || key;
  return Object.entries(values).reduce((out, [name, value]) => out.split(`{${name}}`).join(value), template);
}

/** @returns {string} A day in words: "samedi 14 novembre 2026" */
function day(value, language) {
  if (!value || !ISO_DATE.test(String(value))) {
    return '';
  }
  const [year, month, date] = String(value).slice(0, ISO_DATE_LENGTH).split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALES[language], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, date));
}

/** @returns {string} A clock time in the language's own way: "18 h 45", "6:45 p.m." */
function clock(value, language) {
  const match = HH_MM.exec(String(value || ''));
  if (!match) {
    return '';
  }
  return new Intl.DateTimeFormat(LOCALES[language], { hour: 'numeric', minute: '2-digit' })
    .format(new Date(REFERENCE_YEAR, JANUARY, 1, Number(match[1]), Number(match[2])));
}

const filled = (value) => typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined;

/**
 * Everything the letter is drawn from, read where it lives.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, activity, emergency, personal_list }
 */
async function letterFacts(db, organizationId, meetingId) {
  const row = (await db.query(
    `SELECT m.id, m.theme, m.meeting_date::text AS date_from, m.activity_id, m.is_cancelled,
            COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
            a.name AS activity_name, a.is_active AS activity_active,
            a.activity_start_date::text AS going_date, a.meeting_location_going AS going_place,
            to_char(a.meeting_time_going, 'HH24:MI') AS going_time,
            to_char(a.departure_time_going, 'HH24:MI') AS going_departure,
            a.activity_end_date::text AS return_date, a.meeting_location_return AS return_place,
            to_char(a.meeting_time_return, 'HH24:MI') AS return_time,
            d.contact_phone, u.full_name AS on_site_lead_name, s.name AS site_name, s.phone AS site_phone,
            COALESCE(l.published, FALSE) AS personal_list
       FROM year_plan_meetings m
       LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
       LEFT JOIN camp_details d ON d.organization_id = m.organization_id AND d.meeting_id = m.id
       LEFT JOIN users u ON u.id = d.on_site_lead_id
       LEFT JOIN camp_sites s ON s.organization_id = m.organization_id AND s.id = d.camp_site_id
       LEFT JOIN personal_equipment_lists l ON l.organization_id = m.organization_id AND l.meeting_id = m.id
      WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`,
    [organizationId, meetingId]
  )).rows[0];
  if (!row) {
    refuse('camp_letter_camp_not_found', HTTP_NOT_FOUND);
  }
  const hasActivity = Boolean(row.activity_id) && row.activity_active !== false;
  // The on-site lead's number first, then the site's: the number to call is never typed twice.
  const leadPhone = filled(row.contact_phone) ? row.contact_phone.trim() : null;
  const emergencyPhone = leadPhone || (filled(row.site_phone) ? row.site_phone.trim() : null);
  return {
    camp: { id: row.id, name: row.theme || row.activity_name || '', date_from: row.date_from, date_to: row.date_to,
      activity_id: hasActivity ? row.activity_id : null, is_cancelled: Boolean(row.is_cancelled) },
    activity: hasActivity ? {
      going_date: row.going_date, going_place: filled(row.going_place) ? row.going_place.trim() : null,
      going_time: row.going_time || null, going_departure: row.going_departure || null,
      return_date: row.return_date, return_place: filled(row.return_place) ? row.return_place.trim() : null,
      return_time: row.return_time || null,
    } : null,
    emergency: {
      phone: emergencyPhone,
      name: leadPhone ? row.on_site_lead_name || null : (emergencyPhone ? row.site_name || null : null),
    },
    personal_list: Boolean(row.personal_list),
  };
}

/**
 * What the letter cannot say yet, in the order the screen lists it.
 *
 * @param {Object} facts - From letterFacts
 * @returns {string[]} FACTS entries
 */
function missingFacts(facts) {
  const { activity, emergency } = facts;
  const missing = {
    activity: !activity,
    going_place: !activity?.going_place,
    going_time: !activity?.going_time,
    return_place: !activity?.return_place,
    return_time: !activity?.return_time,
    emergency_phone: !emergency.phone,
  };
  return FACTS.filter((fact) => missing[fact]);
}

/**
 * The letter Wampums proposes, in one language: plain facts, then the family's own pages.
 *
 * @param {Object} facts - From letterFacts
 * @param {string} language - 'fr' or 'en'
 * @param {string} baseUrl - The unit's address, for the links
 * @returns {{subject: string, body_html: string}}
 */
function draftLetter(facts, language, baseUrl) {
  const t = (key, values) => text(language, key, values);
  const safe = (value) => escapeHtml(String(value));
  const tbc = safe(t('camp_letter_to_confirm'));
  const shown = (value) => (filled(value) ? safe(value) : tbc);
  const { camp, activity, emergency } = facts;
  const dates = camp.date_from === camp.date_to
    ? safe(day(camp.date_from, language))
    : safe(t('camp_letter_dates_range', { from: day(camp.date_from, language), to: day(camp.date_to, language) }));
  const going = activity
    ? t('camp_letter_going', {
      date: safe(day(activity.going_date, language)), time: activity.going_time ? safe(clock(activity.going_time, language)) : tbc,
      place: shown(activity.going_place), departure: activity.going_departure ? safe(clock(activity.going_departure, language)) : tbc,
    })
    : tbc;
  const back = activity
    ? t('camp_letter_return', {
      date: safe(day(activity.return_date, language)), time: activity.return_time ? safe(clock(activity.return_time, language)) : tbc,
      place: shown(activity.return_place),
    })
    : tbc;
  const reach = emergency.phone
    ? (emergency.name ? t('camp_letter_emergency_named', { name: safe(emergency.name), phone: safe(emergency.phone) }) : safe(emergency.phone))
    : tbc;
  const link = (path, key) => `<li><a href="${safe(`${baseUrl}${path}`)}">${safe(t(key))}</a></li>`;
  const links = [
    link('/parent-dashboard', 'camp_letter_link_todo'),
    camp.activity_id ? link(`/carpool/${Number(camp.activity_id)}`, 'camp_letter_link_carpool') : '',
    facts.personal_list ? link(`/personal-equipment/${Number(camp.id)}`, 'camp_letter_link_packing') : '',
  ].join('');
  const body = [
    `<p>${safe(t('camp_letter_greeting'))}</p>`,
    `<p>${t('camp_letter_intro', { camp: safe(camp.name), dates })}</p>`,
    `<p><strong>${safe(t('camp_letter_going_label'))}</strong> ${going}</p>`,
    `<p><strong>${safe(t('camp_letter_return_label'))}</strong> ${back}</p>`,
    `<p><strong>${safe(t('camp_letter_emergency_label'))}</strong> ${reach}</p>`,
    `<p><strong>${safe(t('camp_letter_before_label'))}</strong></p>`,
    `<ul>${links}</ul>`,
    `<p>${safe(t('camp_letter_medication'))}</p>`,
    `<p>${safe(t('camp_letter_closing'))}</p>`,
  ].join('');
  return { subject: t('camp_letter_subject', { camp: camp.name }), body_html: sanitizeRichTextHtml(body) };
}

/**
 * Check one language's letter and rebuild its formatted text.
 *
 * @param {Object} input - The request body
 * @param {string} language - 'fr' or 'en'
 * @returns {{subject: string, html: string, text: string}}
 */
function readVersion(input, language) {
  const subject = typeof input?.[`subject_${language}`] === 'string' ? input[`subject_${language}`].trim() : '';
  const html = sanitizeRichTextHtml(typeof input?.[`body_${language}_html`] === 'string' ? input[`body_${language}_html`] : '');
  const plain = richTextToPlainText(html).trim();
  if (!subject || subject.length > LIMITS.subject) {
    refuse('camp_letter_subject_invalid', HTTP_BAD_REQUEST, `subject_${language}`);
  }
  if (!plain || html.length > LIMITS.body) {
    refuse('camp_letter_body_invalid', HTTP_BAD_REQUEST, `body_${language}_html`);
  }
  return { subject, html, text: plain };
}

/** @returns {Object} Both languages, checked, ready to store */
function readLetterInput(input) {
  const fr = readVersion(input, 'fr');
  const en = readVersion(input, 'en');
  return { fr, en };
}

/**
 * The families the letter goes to: the youth invited to the camp's activity, without those whose
 * authorization was declined or withdrawn. One address is one recipient, whatever its children.
 *
 * @returns {Promise<{children: Object[], emails: string[]}>}
 */
async function recipients(db, organizationId, activityId) {
  const activity = (await db.query(
    `SELECT a.id, a.invites_everyone, COALESCE((SELECT array_agg(ai.participant_id) FROM activity_invitees ai
       WHERE ai.activity_id = a.id AND ai.organization_id = a.organization_id), '{}') AS invited_participant_ids
       FROM activities a WHERE a.id = $1 AND a.organization_id = $2 AND a.is_active = TRUE`,
    [activityId, organizationId]
  )).rows[0];
  if (!activity) {
    return { children: [], emails: [] };
  }
  const withdrawn = new Set((await db.query(
    `SELECT DISTINCT participant_id FROM permission_slips
      WHERE organization_id = $1 AND activity_id = $2 AND status IN ('declined', 'revoked')`,
    [organizationId, activityId]
  )).rows.map((slip) => Number(slip.participant_id)));
  const children = (await audience(db, organizationId, activity)).filter((child) => !withdrawn.has(Number(child.id)));
  return { children, emails: [...new Set(children.flatMap((child) => child.emails))] };
}

const LANGUAGE_CODE_LENGTH = 2;

/**
 * The language a family reads: theirs when it is French or English; for an optional language
 * (Ukrainian…), the unit's fallback language, as the app itself falls back (CLAUDE.md §1).
 *
 * @returns {Promise<string>} 'fr' or 'en'
 */
async function familyLanguage(db, email, organizationId) {
  const preferred = String(await getUserEmailLanguage(db, email, organizationId) || '')
    .slice(0, LANGUAGE_CODE_LENGTH).toLowerCase();
  if (LANGUAGES.includes(preferred)) {
    return preferred;
  }
  const fallback = (await db.query(
    `SELECT setting_value->>'fallback' AS fallback FROM organization_settings
      WHERE organization_id = $1 AND setting_key = 'interface_languages'`,
    [organizationId]
  )).rows[0]?.fallback;
  return LANGUAGES.includes(fallback) ? fallback : 'fr';
}

/**
 * How every sent version stands, newest first: who sent it, when, how many addresses it reached,
 * failed or is uncertain about, and how many of the camp's current addresses it never tried
 * (a family added since, or a send interrupted before its last address).
 *
 * @param {string[]} currentEmails - The camp's addresses now
 */
async function sentVersions(db, organizationId, meetingId, currentEmails = []) {
  const rows = (await db.query(
    `SELECT l.id, l.version_number, l.sent_at, u.full_name AS sent_by_name,
            COUNT(d.id) FILTER (WHERE d.status = 'sent')::int AS sent,
            COUNT(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
            COUNT(d.id) FILTER (WHERE d.status IN ('sending', 'unknown'))::int AS unknown,
            (SELECT COUNT(*) FROM unnest($3::text[]) AS current(email)
              WHERE NOT EXISTS (SELECT 1 FROM camp_parent_letter_deliveries tried
                                 WHERE tried.letter_id = l.id AND tried.email = current.email))::int AS unreached
       FROM camp_parent_letters l
       LEFT JOIN users u ON u.id = l.sent_by
       LEFT JOIN camp_parent_letter_deliveries d ON d.letter_id = l.id AND d.organization_id = l.organization_id
      WHERE l.organization_id = $1 AND l.meeting_id = $2 AND l.status = 'sent'
      GROUP BY l.id, u.full_name
      ORDER BY l.version_number DESC`,
    [organizationId, meetingId, currentEmails]
  )).rows;
  // Counts only: the screen is kept on the device for offline use, the families' addresses are not.
  return rows.map(({ id: _id, ...row }) => row);
}

/**
 * The camp's letter: the facts it is drawn from, what is missing, the saved draft or the proposed one,
 * who it would reach, and every version sent.
 *
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} meetingId
 * @param {{names: boolean}} rights - Whether youth may be named (participants.view)
 * @returns {Promise<Object>}
 */
async function readCampLetter(pool, organizationId, meetingId, { names = false } = {}) {
  const facts = await letterFacts(pool, organizationId, meetingId);
  const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
  const proposed = Object.fromEntries(LANGUAGES.map((language) => [language, draftLetter(facts, language, baseUrl)]));
  const reach = facts.camp.activity_id
    ? await recipients(pool, organizationId, facts.camp.activity_id)
    : { children: [], emails: [] };
  const [draftRow, sent] = await Promise.all([
    pool.query(
      `SELECT subject_fr, body_fr_html, subject_en, body_en_html, updated_at FROM camp_parent_letters
        WHERE organization_id = $1 AND meeting_id = $2 AND status = 'draft'`,
      [organizationId, meetingId]
    ).then((result) => result.rows[0] || null),
    sentVersions(pool, organizationId, meetingId, reach.emails),
  ]);
  const draft = draftRow
    ? { saved: true, updated_at: draftRow.updated_at,
      fr: { subject: draftRow.subject_fr, body_html: draftRow.body_fr_html },
      en: { subject: draftRow.subject_en, body_html: draftRow.body_en_html } }
    : { saved: false, updated_at: null, ...proposed };
  const withoutAddress = reach.children.filter((child) => !child.emails.length);
  return {
    camp: facts.camp,
    facts: { activity: facts.activity, emergency: facts.emergency, personal_list: facts.personal_list },
    missing: missingFacts(facts),
    draft,
    proposed,
    audience: {
      families: reach.emails.length,
      children: reach.children.length,
      without_address: names
        ? withoutAddress.map(({ id, first_name, last_name }) => ({ id, first_name, last_name }))
        : withoutAddress.length,
    },
    sent,
  };
}

/**
 * Keep the team's edits as the camp's draft.
 *
 * @returns {Promise<Object>} The letter as readCampLetter answers it
 */
async function saveCampLetterDraft(pool, organizationId, actorId, meetingId, input, rights) {
  const letter = readLetterInput(input);
  await letterFacts(pool, organizationId, meetingId);
  await pool.query(
    `INSERT INTO camp_parent_letters (organization_id, meeting_id, status, subject_fr, body_fr_html, body_fr,
       subject_en, body_en_html, body_en, updated_by)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (meeting_id) WHERE status = 'draft' DO UPDATE SET
       subject_fr = EXCLUDED.subject_fr, body_fr_html = EXCLUDED.body_fr_html, body_fr = EXCLUDED.body_fr,
       subject_en = EXCLUDED.subject_en, body_en_html = EXCLUDED.body_en_html, body_en = EXCLUDED.body_en,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [organizationId, meetingId, letter.fr.subject, letter.fr.html, letter.fr.text,
      letter.en.subject, letter.en.html, letter.en.text, actorId]
  );
  return readCampLetter(pool, organizationId, meetingId, rights);
}

/**
 * Claim one address, then call the provider. Only an explicit refusal is retryable; a lost answer
 * stays uncertain and is never sent again (the rule of the authorization emails).
 *
 * @returns {Promise<string>} 'sent', 'failed', 'unknown' or 'skipped' (already claimed)
 */
async function deliver(pool, organizationId, letter, email, sender) {
  const language = await familyLanguage(pool, email, organizationId);
  const claim = await pool.query(
    `INSERT INTO camp_parent_letter_deliveries (organization_id, letter_id, email, language, status)
     VALUES ($1, $2, $3, $4, 'sending')
     ON CONFLICT (letter_id, email) DO UPDATE SET status = 'sending', language = EXCLUDED.language, updated_at = NOW()
       WHERE camp_parent_letter_deliveries.status = 'failed' AND camp_parent_letter_deliveries.organization_id = $1
     RETURNING id`,
    [organizationId, letter.id, email, language]
  );
  if (!claim.rows.length) {
    return 'skipped';
  }
  let status = 'unknown';
  try {
    const sentOk = await sendEmail(email, letter[`subject_${language}`], letter[`body_${language}`],
      `<div>${letter[`body_${language}_html`]}</div>`, sender, { throwOnError: true });
    status = sentOk ? 'sent' : 'failed';
  } catch (err) {
    const httpStatus = Number(err.response?.status || err.statusCode);
    const smtpStatus = Number(err.responseCode);
    if ((httpStatus >= HTTP_BAD_REQUEST && httpStatus < HTTP_SERVER_ERROR && httpStatus !== HTTP_TIMEOUT)
      || (smtpStatus >= HTTP_BAD_REQUEST && smtpStatus < SMTP_STATUS_LIMIT)) {
      status = 'failed';
    }
    logger.warn('Camp letter email outcome is uncertain', { letterId: letter.id });
  }
  try {
    await pool.query(
      'UPDATE camp_parent_letter_deliveries SET status = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
      [status, claim.rows[0].id, organizationId]
    );
  } catch (_err) {
    logger.warn('Camp letter receipt could not be saved', { letterId: letter.id });
    return 'unknown';
  }
  return status;
}

/** Send one version to the addresses not yet reached (never claimed, or refused by the provider). */
async function dispatch(pool, organizationId, letter, emails) {
  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  for (const email of emails) {
    // eslint-disable-next-line no-await-in-loop -- one claim and one receipt per address, in order
    await deliver(pool, organizationId, letter, email, sender);
  }
}

/**
 * Freeze the letter as a new version and send it to the camp's families. The camp row is locked so two
 * leaders sending at once make two numbered versions, never one number twice.
 *
 * @returns {Promise<Object>} The letter as readCampLetter answers it
 */
async function sendCampLetter(pool, organizationId, actorId, meetingId, input, rights) {
  const content = readLetterInput(input);
  const facts = await letterFacts(pool, organizationId, meetingId);
  if (facts.camp.is_cancelled) {
    refuse('camp_letter_camp_cancelled', HTTP_CONFLICT);
  }
  if (!facts.camp.activity_id) {
    refuse('camp_letter_no_activity', HTTP_CONFLICT);
  }
  const { emails } = await recipients(pool, organizationId, facts.camp.activity_id);
  if (!emails.length) {
    refuse('camp_letter_no_recipients', HTTP_CONFLICT);
  }
  const client = await pool.connect();
  let letter;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM year_plan_meetings WHERE organization_id = $1 AND id = $2 FOR UPDATE', [organizationId, meetingId]);
    const next = (await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM camp_parent_letters
        WHERE organization_id = $1 AND meeting_id = $2 AND status = 'sent'`,
      [organizationId, meetingId]
    )).rows[0].next;
    letter = (await client.query(
      `INSERT INTO camp_parent_letters (organization_id, meeting_id, status, version_number, subject_fr, body_fr_html, body_fr,
         subject_en, body_en_html, body_en, updated_by, sent_by, sent_at)
       VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW())
       RETURNING *`,
      [organizationId, meetingId, next, content.fr.subject, content.fr.html, content.fr.text,
        content.en.subject, content.en.html, content.en.text, actorId]
    )).rows[0];
    // What was sent is the starting point of the next version.
    await client.query(
      `INSERT INTO camp_parent_letters (organization_id, meeting_id, status, subject_fr, body_fr_html, body_fr,
         subject_en, body_en_html, body_en, updated_by)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (meeting_id) WHERE status = 'draft' DO UPDATE SET
         subject_fr = EXCLUDED.subject_fr, body_fr_html = EXCLUDED.body_fr_html, body_fr = EXCLUDED.body_fr,
         subject_en = EXCLUDED.subject_en, body_en_html = EXCLUDED.body_en_html, body_en = EXCLUDED.body_en,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [organizationId, meetingId, content.fr.subject, content.fr.html, content.fr.text,
        content.en.subject, content.en.html, content.en.text, actorId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await dispatch(pool, organizationId, letter, emails);
  return readCampLetter(pool, organizationId, meetingId, rights);
}

/**
 * Send a version again to the addresses the provider refused, and to the camp's families added since.
 * An uncertain address is never sent twice.
 *
 * @returns {Promise<Object>} The letter as readCampLetter answers it
 */
async function retryCampLetter(pool, organizationId, meetingId, versionNumber, rights) {
  const facts = await letterFacts(pool, organizationId, meetingId);
  const letter = (await pool.query(
    `SELECT * FROM camp_parent_letters
      WHERE organization_id = $1 AND meeting_id = $2 AND status = 'sent' AND version_number = $3`,
    [organizationId, meetingId, versionNumber]
  )).rows[0];
  if (!letter) {
    refuse('camp_letter_version_not_found', HTTP_NOT_FOUND);
  }
  // A camp cancelled since: no family receives its instructions, whatever version they would get.
  if (facts.camp.is_cancelled) {
    refuse('camp_letter_camp_cancelled', HTTP_CONFLICT);
  }
  if (!facts.camp.activity_id) {
    refuse('camp_letter_no_activity', HTTP_CONFLICT);
  }
  const { emails } = await recipients(pool, organizationId, facts.camp.activity_id);
  await dispatch(pool, organizationId, letter, emails);
  return readCampLetter(pool, organizationId, meetingId, rights);
}

/**
 * The latest sent version, for the camp permit's "letter to parents" line.
 *
 * @returns {Promise<{version_number: number, sent_at: string}|null>}
 */
async function latestSentLetter(db, organizationId, meetingId) {
  return (await db.query(
    `SELECT version_number, sent_at FROM camp_parent_letters
      WHERE organization_id = $1 AND meeting_id = $2 AND status = 'sent'
      ORDER BY version_number DESC LIMIT 1`,
    [organizationId, meetingId]
  )).rows[0] || null;
}

module.exports = {
  FACTS, LIMITS, letterFacts, missingFacts, draftLetter, readLetterInput, recipients,
  readCampLetter, saveCampLetterDraft, sendCampLetter, retryCampLetter, latestSentLetter,
};
