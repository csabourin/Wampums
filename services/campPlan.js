'use strict';
/**
 * Written sections of the camp plan (#1318).
 *
 * A camp writes its own sections (V.C.P.R.E.F., theme and story, motivation
 * system) and lists the games it keeps for bad weather, chosen from its unit's
 * activity library. The sections stable from year to year (rules of life, camp
 * rules, code of ethics, emergency procedures) are written once as the unit's
 * templates: a camp follows the template unless it writes its own text, and the
 * difference is visible. Writing nothing for a stable section returns the camp
 * to its template. An emptied section keeps its row with no text, so its
 * version only ever grows: clearing and rewriting cannot let a stale editor in.
 *
 * Every text is rich text rebuilt by utils/richText.js, stored with its plain
 * version for exports. A section left empty is reported as still to write,
 * never as complete.
 *
 * @module services/campPlan
 */
const transaction = require('../utils/transaction');
const { readRichTextField, RICH_TEXT_MAX_LENGTH } = require('../utils/richText');
const { getPointSystemRules } = require('../utils/api-helpers');
const RULES = require('../config/camp_plan.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** Largest PostgreSQL integer: an activity id beyond it cannot exist. */
const MAX_ID = 2147483647;

/** Sections a camp writes for itself, in the order the plan lists them. */
const CAMP_SECTIONS = [...RULES.VCPREF_SECTIONS, ...RULES.STORY_SECTIONS];
const { UNIT_SECTIONS } = RULES;
const ALL_SECTIONS = [...CAMP_SECTIONS, ...UNIT_SECTIONS];

/** A refusal whose message is a translation key the SPA knows, naming its field when it has one. */
class CampPlanError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const refuse = (key, status = HTTP_BAD_REQUEST, field = null) => {
  throw new CampPlanError(key, status, field);
};

/** @returns {boolean} Whether a section key is one the plan has */
const isSection = (key) => ALL_SECTIONS.includes(key);
/** @returns {boolean} Whether a section key is one a unit writes a template for */
const isUnitSection = (key) => UNIT_SECTIONS.includes(key);

/**
 * Check a section's text and the version its editor loaded, before any transaction opens.
 *
 * @param {Object} input - Request body: { body_html, expected_version }
 * @returns {{html: string|null, text: string|null, expectedVersion: number}}
 */
function readSectionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    refuse('camp_plan_invalid');
  }
  const value = input.body_html ?? '';
  if (typeof value !== 'string' || value.length > RICH_TEXT_MAX_LENGTH) {
    refuse('camp_plan_text_too_long', HTTP_BAD_REQUEST, 'body_html');
  }
  if (!Number.isInteger(input.expected_version) || input.expected_version < 0) {
    refuse('camp_plan_invalid', HTTP_BAD_REQUEST, 'expected_version');
  }
  const { html, text } = readRichTextField(value);
  return { html, text, expectedVersion: input.expected_version };
}

/** A planned camp of the unit. */
const CAMP_SQL = `SELECT m.id, m.theme, m.meeting_date::text AS date_from,
       COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to,
       m.activity_id, m.is_cancelled, m.year_plan_id
  FROM year_plan_meetings m
  LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
 WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`;
const CAMP_LOCKED_SQL = `${CAMP_SQL} FOR UPDATE OF m`;

/**
 * The planned camp, locked when it is about to be written; refused when the unit has none,
 * or, for a write, when it is cancelled.
 */
async function campFor(db, organizationId, meetingId, { lock = false } = {}) {
  const camp = (await db.query(lock ? CAMP_LOCKED_SQL : CAMP_SQL, [organizationId, meetingId])).rows[0];
  if (!camp) {
    refuse('camp_plan_camp_not_found', HTTP_NOT_FOUND);
  }
  if (lock && camp.is_cancelled) {
    refuse('camp_plan_camp_cancelled', HTTP_CONFLICT);
  }
  return camp;
}

/**
 * @param {Object} db
 * @param {number} organizationId
 * @returns {Promise<Object[]>} Every stable section, written or not, in plan order
 */
async function listTemplates(db, organizationId) {
  const rows = (await db.query(
    `SELECT t.section_key, t.body_html, t.body_text, t.version, t.updated_at, u.full_name AS updated_by_name
       FROM camp_plan_templates t LEFT JOIN users u ON u.id = t.updated_by
      WHERE t.organization_id = $1`,
    [organizationId]
  )).rows;
  return UNIT_SECTIONS.map((key) => {
    const row = rows.find((candidate) => candidate.section_key === key);
    return {
      key,
      body_html: row?.body_html ?? null,
      body_text: row?.body_text ?? null,
      version: row?.version ?? 0,
      updated_at: row?.updated_at ?? null,
      updated_by_name: row?.updated_by_name ?? null,
    };
  });
}

/**
 * Write one of the unit's templates. Camps that follow it read the new text;
 * a camp that wrote its own keeps it. Writing nothing removes the template.
 *
 * @returns {Promise<Object>} The template as it now is
 */
function saveTemplate(pool, organizationId, actorId, sectionKey, input) {
  if (!isUnitSection(sectionKey)) {
    refuse('camp_plan_section_not_found', HTTP_NOT_FOUND);
  }
  const { html, text, expectedVersion } = readSectionInput(input);
  return transaction(pool, async (db) => {
    // Each write names the version it replaces, so two editors (even two first writes) never both
    // succeed. Emptying keeps the row with no text: its version only grows.
    const written = expectedVersion === 0
      ? (await db.query(
        `INSERT INTO camp_plan_templates (organization_id, section_key, body_html, body_text, updated_by)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (organization_id, section_key) DO NOTHING`,
        [organizationId, sectionKey, html, text, actorId]
      )).rowCount > 0
      : (await db.query(
        `UPDATE camp_plan_templates
            SET body_html = $4, body_text = $5, updated_by = $6, version = version + 1, updated_at = NOW()
          WHERE organization_id = $1 AND section_key = $2 AND version = $3`,
        [organizationId, sectionKey, expectedVersion, html, text, actorId]
      )).rowCount > 0;
    if (!written) {
      refuse('camp_plan_version_conflict', HTTP_CONFLICT);
    }
    return (await listTemplates(db, organizationId)).find((template) => template.key === sectionKey);
  });
}

/**
 * Every section as the camp's plan reads it: the camp's own text, else, for a
 * stable section, its unit's template, else nothing to show yet.
 *
 * @param {Object[]} rows - The camp's camp_plan_sections rows
 * @param {Object[]} templates - listTemplates()
 * @returns {Object[]} Sections in plan order
 */
function resolveSections(rows, templates) {
  return ALL_SECTIONS.map((key) => {
    // A row with no text is an emptied section: it holds the version, not a text to show.
    const row = rows.find((candidate) => candidate.section_key === key);
    const own = row?.body_html ? row : null;
    const template = templates.find((candidate) => candidate.key === key);
    const unit = isUnitSection(key);
    let source = 'empty';
    if (own) {
      source = 'camp';
    } else if (unit && template?.body_html) {
      source = 'template';
    }
    const shown = source === 'camp' ? own : source === 'template' ? template : null;
    return {
      key,
      unit_section: unit,
      source,
      // Only a stable section can differ from its template.
      modified_for_camp: unit && source === 'camp',
      body_html: shown?.body_html ?? null,
      body_text: shown?.body_text ?? null,
      needs_review: Boolean(own?.needs_review),
      // The version of the camp's own text, emptied or not; 0 when it never had one.
      version: row?.version ?? 0,
      template_version: unit ? template?.version ?? 0 : null,
      template_html: unit ? template?.body_html ?? null : null,
      updated_at: own?.updated_at ?? null,
      updated_by_name: own?.updated_by_name ?? null,
    };
  });
}

/**
 * What the plan still lacks: sections with nothing to show, and no bad-weather game.
 *
 * @param {Object[]} sections - resolveSections()
 * @param {number} rainGames - How many games the camp kept for bad weather
 * @returns {{to_write: string[], to_review: string[]}}
 */
function planGaps(sections, rainGames) {
  const toWrite = sections.filter((section) => section.source === 'empty').map((section) => section.key);
  if (!rainGames) {
    toWrite.push('rain_games');
  }
  return { to_write: toWrite, to_review: sections.filter((section) => section.needs_review).map((section) => section.key) };
}

/**
 * The camp's bad-weather games, with what a leader needs to run them.
 * An activity the unit has since hidden stays listed, marked as such.
 */
async function rainGamesFor(db, organizationId, meetingId) {
  return (await db.query(
    `SELECT l.id, l.name, l.description, l.category, l.material, l.estimated_duration_min, l.estimated_duration_max,
            COALESCE(l.is_active, TRUE) AS is_active
       FROM camp_plan_rain_games g
       JOIN activity_library l ON l.id = g.activity_library_id AND l.organization_id = g.organization_id
      WHERE g.organization_id = $1 AND g.meeting_id = $2
      ORDER BY g.position, l.name, l.id`,
    [organizationId, meetingId]
  )).rows;
}

/**
 * What the unit already uses to motivate its youth, read from its point rules
 * rather than copied into the plan.
 */
async function motivationReminder(db, organizationId) {
  const rules = (await getPointSystemRules(db, organizationId)) || {};
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    attendance_present: number(rules.attendance?.present?.points),
    honor_award: number(rules.honors?.award),
    badge_earn: number(rules.badges?.earn),
    badge_level_up: number(rules.badges?.level_up),
  };
}

/**
 * One camp's written plan sections, its bad-weather games, the unit's
 * motivation rules, and what is still to write.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} meetingId
 * @returns {Promise<Object>} { camp, sections, rain_games, motivation, gaps }
 */
async function readCampPlan(db, organizationId, meetingId) {
  // One query at a time: inside a write, `db` is a single transaction client.
  const camp = await campFor(db, organizationId, meetingId);
  const rows = (await db.query(
    `SELECT s.section_key, s.body_html, s.body_text, s.needs_review, s.version, s.updated_at, u.full_name AS updated_by_name
       FROM camp_plan_sections s LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.organization_id = $1 AND s.meeting_id = $2`,
    [organizationId, meetingId]
  )).rows;
  const templates = await listTemplates(db, organizationId);
  const rainGames = await rainGamesFor(db, organizationId, meetingId);
  const motivation = await motivationReminder(db, organizationId);
  const sections = resolveSections(rows, templates);
  return { camp, sections, rain_games: rainGames, motivation, gaps: planGaps(sections, rainGames.length) };
}

/**
 * The plan's gaps alone, for the camp overview.
 *
 * @returns {Promise<{to_write: string[], to_review: string[], rain_games: number}>}
 */
async function campPlanGaps(db, organizationId, meetingId) {
  const result = (await db.query(
    `SELECT
       COALESCE((SELECT json_agg(json_build_object('section_key', s.section_key, 'needs_review', s.needs_review,
                                                     'body_html', s.body_html IS NOT NULL))
                   FROM camp_plan_sections s WHERE s.organization_id = $1 AND s.meeting_id = $2), '[]'::json) AS sections,
       COALESCE((SELECT json_agg(json_build_object('key', t.section_key, 'body_html', t.body_html))
                   FROM camp_plan_templates t WHERE t.organization_id = $1), '[]'::json) AS templates,
       (SELECT COUNT(*) FROM camp_plan_rain_games g WHERE g.organization_id = $1 AND g.meeting_id = $2)::int AS games`,
    [organizationId, meetingId]
  )).rows[0] || {};
  const games = Number(result.games) || 0;
  return { ...planGaps(resolveSections(result.sections || [], result.templates || []), games), rain_games: games };
}

/**
 * Write one section of a camp's plan. The camp is locked, its editor names the
 * version of the camp's text it loaded, and writing nothing empties the camp's
 * text: a camp section is then to write again, a stable section follows its
 * unit's template again. Saving clears "copied, to reread".
 *
 * @returns {Promise<Object>} The section as the plan now reads it
 */
function saveCampSection(pool, organizationId, actorId, meetingId, sectionKey, input) {
  if (!isSection(sectionKey)) {
    refuse('camp_plan_section_not_found', HTTP_NOT_FOUND);
  }
  const { html, text, expectedVersion } = readSectionInput(input);
  return transaction(pool, async (db) => {
    await campFor(db, organizationId, meetingId, { lock: true });
    const current = (await db.query(
      'SELECT version FROM camp_plan_sections WHERE organization_id = $1 AND meeting_id = $2 AND section_key = $3',
      [organizationId, meetingId, sectionKey]
    )).rows[0];
    if ((current?.version || 0) !== expectedVersion) {
      refuse('camp_plan_version_conflict', HTTP_CONFLICT);
    }
    // Emptying keeps the row with no text, so the version never goes back.
    await db.query(
      `INSERT INTO camp_plan_sections (organization_id, meeting_id, section_key, body_html, body_text, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, meeting_id, section_key) DO UPDATE SET
         body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, updated_by = EXCLUDED.updated_by,
         needs_review = FALSE, version = camp_plan_sections.version + 1, updated_at = NOW()`,
      [organizationId, meetingId, sectionKey, html, text, actorId]
    );
    const plan = await readCampPlan(db, organizationId, meetingId);
    return { section: plan.sections.find((section) => section.key === sectionKey), gaps: plan.gaps };
  });
}

/**
 * Check a list of activity ids, before any transaction opens.
 *
 * @param {Object} input - { activity_library_ids }
 * @returns {number[]} Ids, in the order sent
 */
function readRainGameIds(input) {
  const ids = input?.activity_library_ids;
  if (!Array.isArray(ids) || ids.length > RULES.RAIN_GAMES_MAX) {
    refuse('camp_plan_rain_games_invalid', HTTP_BAD_REQUEST, 'activity_library_ids');
  }
  if (ids.some((id) => !Number.isInteger(id) || id < 1 || id > MAX_ID) || new Set(ids).size !== ids.length) {
    refuse('camp_plan_rain_games_invalid', HTTP_BAD_REQUEST, 'activity_library_ids');
  }
  return ids;
}

/**
 * Replace a camp's bad-weather games with the list sent, in its order. Each must
 * be an activity of the unit's library, offered (active) or already the camp's.
 *
 * @returns {Promise<Object>} { rain_games, gaps }
 */
function saveRainGames(pool, organizationId, actorId, meetingId, input) {
  const ids = readRainGameIds(input);
  return transaction(pool, async (db) => {
    await campFor(db, organizationId, meetingId, { lock: true });
    if (ids.length) {
      const allowed = (await db.query(
        `SELECT l.id FROM activity_library l
          WHERE l.organization_id = $1 AND l.id = ANY($2::int[])
            AND (COALESCE(l.is_active, TRUE) OR EXISTS (
              SELECT 1 FROM camp_plan_rain_games g
               WHERE g.organization_id = l.organization_id AND g.meeting_id = $3 AND g.activity_library_id = l.id))`,
        [organizationId, ids, meetingId]
      )).rows.map((row) => row.id);
      if (allowed.length !== ids.length) {
        refuse('camp_plan_rain_game_unavailable', HTTP_BAD_REQUEST, 'activity_library_ids');
      }
    }
    await db.query(
      'DELETE FROM camp_plan_rain_games WHERE organization_id = $1 AND meeting_id = $2 AND NOT (activity_library_id = ANY($3::int[]))',
      [organizationId, meetingId, ids]
    );
    if (ids.length) {
      await db.query(
        `INSERT INTO camp_plan_rain_games (organization_id, meeting_id, activity_library_id, position, added_by)
         SELECT $1, $2, chosen.id, chosen.position - 1, $4
           FROM unnest($3::int[]) WITH ORDINALITY AS chosen(id, position)
         ON CONFLICT (organization_id, meeting_id, activity_library_id) DO UPDATE SET position = EXCLUDED.position`,
        [organizationId, meetingId, ids, actorId]
      );
    }
    const plan = await readCampPlan(db, organizationId, meetingId);
    return { rain_games: plan.rain_games, gaps: plan.gaps };
  });
}

/**
 * Copy an earlier camp's own plan sections, as drafts to reread, and its
 * bad-weather games still offered. Stable sections are not copied: the new camp
 * follows its unit's templates as they now are.
 *
 * @returns {Promise<{sections: number, rain_games: number}>}
 */
async function copyCampPlan(db, organizationId, actorId, targetMeetingId, sourceMeetingId) {
  const sections = await db.query(
    `INSERT INTO camp_plan_sections (organization_id, meeting_id, section_key, body_html, body_text, needs_review, updated_by)
     SELECT organization_id, $2, section_key, body_html, body_text, TRUE, $4
       FROM camp_plan_sections
      WHERE organization_id = $1 AND meeting_id = $3 AND section_key = ANY($5::text[]) AND body_html IS NOT NULL
     ON CONFLICT (organization_id, meeting_id, section_key) DO UPDATE SET
       body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, needs_review = TRUE,
       updated_by = EXCLUDED.updated_by, version = camp_plan_sections.version + 1, updated_at = NOW()`,
    [organizationId, targetMeetingId, sourceMeetingId, actorId, CAMP_SECTIONS]
  );
  const games = await db.query(
    `INSERT INTO camp_plan_rain_games (organization_id, meeting_id, activity_library_id, position, added_by)
     SELECT g.organization_id, $2, g.activity_library_id,
            (ROW_NUMBER() OVER (ORDER BY g.position, g.activity_library_id) - 1)::int, $4
       FROM camp_plan_rain_games g
       JOIN activity_library l ON l.id = g.activity_library_id AND l.organization_id = g.organization_id
      WHERE g.organization_id = $1 AND g.meeting_id = $3 AND COALESCE(l.is_active, TRUE)`,
    [organizationId, targetMeetingId, sourceMeetingId, actorId]
  );
  return { sections: sections.rowCount, rain_games: games.rowCount };
}

module.exports = {
  CampPlanError,
  RULES,
  CAMP_SECTIONS,
  UNIT_SECTIONS,
  ALL_SECTIONS,
  readSectionInput,
  readRainGameIds,
  resolveSections,
  planGaps,
  listTemplates,
  saveTemplate,
  readCampPlan,
  campPlanGaps,
  saveCampSection,
  saveRainGames,
  copyCampPlan,
};
