/**
 * Starter activities: the versioned bilingual catalogue
 * (config/activity_library_starter.json) and its copies in a unit's
 * activity_library.
 *
 * Manual imports from the yearly planner, unit creation and the seeded demo
 * unit all go through this module, so a unit never holds the same starter
 * activity twice:
 *
 * - A copy records its source in `metadata.starter_key`; a unique index
 *   (migration 053) keeps one per unit, hidden copies included.
 * - An older copy made by hand is recognised by an exact legacy name and
 *   adopted (the key is attached, its content left as the unit wrote it).
 *   Two candidates for one entry are reported, never guessed between.
 * - A copy is never rewritten when the catalogue changes. The unit owns it.
 * - Withdrawn entries (`retired_activities`) are never offered or copied, and
 *   a unit's existing copy of one is left alone.
 *
 * Every write runs in one transaction behind a per-unit advisory lock.
 *
 * @module services/activityLibraryStarter
 */

const catalogue = require('../config/activity_library_starter.json');
const interfaceLanguages = require('../config/interface_languages.json');

/** Languages the catalogue is written in. Optional languages use the unit's fallback. */
const STARTER_LANGUAGES = ['fr', 'en'];

/** Shape of a catalogue key; anything else is refused before it is looked up. */
const STARTER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,99}$/;

/** Most keys one request may name (duplicates included). */
const STARTER_IMPORT_MAX_KEYS = 200;

/** Second half of the per-unit advisory lock key. */
const STARTER_LOCK_NAME = 'activity_library_starter';

/** How a catalogue entry stands in one unit. */
const STARTER_STATUS = Object.freeze({
  AVAILABLE: 'available',
  PRESENT: 'present',
  HIDDEN: 'hidden',
  LEGACY_MATCH: 'legacy_match',
  AMBIGUOUS: 'ambiguous'
});

/** Program sections the catalogue has a branch for; others get the shared selection. */
const CATALOGUE_BRANCHES = Object.keys(catalogue.branches);

const ACTIVE_ENTRIES = catalogue.activities;
const ENTRIES_BY_KEY = new Map(ACTIVE_ENTRIES.map((entry) => [entry.key, entry]));
const RETIRED_KEYS = new Set((catalogue.retired_activities || []).map((entry) => entry.key));
const ALL_LEGACY_NAMES = ACTIVE_ENTRIES.flatMap((entry) => entry.legacy_names || []);

/**
 * Error for a selection the caller must correct.
 */
class StarterSelectionError extends Error {
  /**
   * @param {Array<{field: string, message: string, code: string, key?: string}>} errors - Problems found
   */
  constructor(errors) {
    super('Invalid starter activity selection');
    this.name = 'StarterSelectionError';
    this.errors = errors;
  }
}

/**
 * Read a JSONB setting that may come back parsed or as JSON text.
 *
 * @param {*} value - setting_value column
 * @returns {Object|null} Parsed object
 */
function parseSetting(value) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Language the catalogue text is copied in: the unit's own language when the
 * catalogue is written in it, otherwise the unit's configured fallback.
 *
 * @param {string|null|undefined} unitLanguage - organizations.default_language
 * @param {Object|null} languageSetting - The unit's `interface_languages` setting
 * @returns {'fr'|'en'} Catalogue language
 */
function chooseStarterLanguage(unitLanguage, languageSetting) {
  if (STARTER_LANGUAGES.includes(unitLanguage)) {
    return unitLanguage;
  }
  const fallback = languageSetting?.fallback;
  return STARTER_LANGUAGES.includes(fallback) ? fallback : interfaceLanguages.defaultFallback;
}

/**
 * The catalogue branch for a unit's program section, or null when the
 * catalogue has none (general, venturers, rovers).
 *
 * @param {string|null|undefined} programSection - organizations.program_section
 * @returns {string|null} Branch key
 */
function starterBranchForSection(programSection) {
  return CATALOGUE_BRANCHES.includes(programSection) ? programSection : null;
}

/**
 * Load what decides language and branch for a unit.
 *
 * @param {{query: Function}} db - Pool or client
 * @param {number} organizationId - Unit
 * @returns {Promise<{language: 'fr'|'en', branch: string|null}>} Unit context
 */
async function loadUnitContext(db, organizationId) {
  const result = await db.query(
    `SELECT o.default_language, o.program_section, languages.setting_value AS interface_languages
       FROM organizations o
       LEFT JOIN organization_settings languages
         ON languages.organization_id = o.id AND languages.setting_key = $2
      WHERE o.id = $1`,
    [organizationId, interfaceLanguages.settingKey]
  );
  const row = result.rows[0] || {};
  return {
    language: chooseStarterLanguage(row.default_language, parseSetting(row.interface_languages)),
    branch: starterBranchForSection(row.program_section)
  };
}

/**
 * Keys a unit receives automatically: activities for its branch that need
 * only standard supervision. A unit without a catalogue branch receives those
 * suited to every branch. Activities needing close supervision (knives, fire,
 * fishing, rockets…) are always a deliberate choice, never installed by default.
 * Meeting blocks suit every branch, so every unit receives them.
 *
 * @param {string|null} branch - Catalogue branch, or null
 * @returns {string[]} Catalogue keys, in catalogue order
 */
function selectDefaultStarterKeys(branch) {
  return ACTIVE_ENTRIES
    .filter((entry) => entry.supervision === 'standard')
    .filter((entry) => (branch
      ? entry.branches.includes(branch)
      : CATALOGUE_BRANCHES.every((key) => entry.branches.includes(key))))
    .map((entry) => entry.key);
}

/**
 * Check a requested selection.
 *
 * @param {*} keys - Request value
 * @returns {string[]} Distinct valid keys, in catalogue order
 * @throws {StarterSelectionError} When the value is malformed, or names an
 *   unknown or withdrawn activity
 */
function validateStarterSelection(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new StarterSelectionError([
      { field: 'keys', code: 'starter_selection_required', message: 'keys must be a non-empty array' }
    ]);
  }
  if (keys.length > STARTER_IMPORT_MAX_KEYS) {
    throw new StarterSelectionError([
      { field: 'keys', code: 'starter_selection_too_large', message: `At most ${STARTER_IMPORT_MAX_KEYS} keys` }
    ]);
  }

  const errors = [];
  keys.forEach((key) => {
    if (typeof key !== 'string' || !STARTER_KEY_PATTERN.test(key)) {
      errors.push({ field: 'keys', code: 'starter_key_malformed', message: 'Malformed starter activity key' });
    } else if (RETIRED_KEYS.has(key)) {
      errors.push({ field: 'keys', code: 'starter_activity_retired', key, message: `Withdrawn starter activity: ${key}` });
    } else if (!ENTRIES_BY_KEY.has(key)) {
      errors.push({ field: 'keys', code: 'starter_activity_unknown', key, message: `Unknown starter activity: ${key}` });
    }
  });
  if (errors.length > 0) {
    throw new StarterSelectionError(errors);
  }

  const requested = new Set(keys);
  return ACTIVE_ENTRIES.filter((entry) => requested.has(entry.key)).map((entry) => entry.key);
}

/**
 * The unit's activity_library row for a catalogue entry, in the unit's language.
 *
 * Steps, precautions and variants are kept in metadata, beside the structured
 * planning details, so a copy carries everything a leader needs to run it.
 *
 * @param {Object} entry - Catalogue entry
 * @param {'fr'|'en'} language - Copy language
 * @returns {{name: string, description: string, category: string, tags: string[],
 *   durationMin: number, durationMax: number, material: string|null, metadata: Object}} Row values
 */
function buildLibraryCopy(entry, language) {
  const text = entry[language];
  return {
    name: text.name,
    description: text.summary,
    category: entry.category,
    tags: entry.tags,
    durationMin: entry.duration.min,
    durationMax: entry.duration.max,
    material: text.material.length > 0 ? text.material.join('\n') : null,
    metadata: {
      starter_key: entry.key,
      starter_version: catalogue.version,
      starter_language: language,
      branches: entry.branches,
      seasons: entry.seasons,
      players_min: entry.players?.min ?? null,
      supervision: entry.supervision,
      steps: text.steps,
      safety: text.safety,
      variants: text.variants
    }
  };
}

/**
 * The unit's rows that can stand for a catalogue entry: copies carrying a key,
 * and unlinked rows named exactly like a legacy name.
 *
 * @param {{query: Function}} db - Pool or client
 * @param {number} organizationId - Unit
 * @returns {Promise<Array<{id: number, name: string, is_active: boolean, starter_key: string|null}>>} Rows
 */
async function loadUnitCandidates(db, organizationId) {
  const result = await db.query(
    `SELECT id, name, is_active, metadata ->> 'starter_key' AS starter_key
       FROM activity_library
      WHERE organization_id = $1
        AND (metadata ? 'starter_key' OR name = ANY($2::text[]))
      ORDER BY id`,
    [organizationId, ALL_LEGACY_NAMES]
  );
  return result.rows;
}

/**
 * How one catalogue entry stands in a unit, from its candidate rows.
 *
 * @param {Object} entry - Catalogue entry
 * @param {Array<Object>} rows - loadUnitCandidates() result
 * @returns {{status: string, row?: Object, rows?: Object[]}} Classification
 */
function classifyEntry(entry, rows) {
  const copy = rows.find((row) => row.starter_key === entry.key);
  if (copy) {
    return { status: copy.is_active === false ? STARTER_STATUS.HIDDEN : STARTER_STATUS.PRESENT, row: copy };
  }
  const legacyNames = entry.legacy_names || [];
  const matches = rows.filter((row) => !row.starter_key && legacyNames.includes(row.name));
  if (matches.length === 0) {
    return { status: STARTER_STATUS.AVAILABLE };
  }
  // A copy the unit deleted (is_active = FALSE) yields to one it still uses, so
  // deleting the extra copies settles an ambiguity. Two of the same standing
  // are never guessed between.
  const active = matches.filter((row) => row.is_active !== false);
  const pool = active.length > 0 ? active : matches;
  if (pool.length === 1) {
    return { status: STARTER_STATUS.LEGACY_MATCH, row: pool[0] };
  }
  return { status: STARTER_STATUS.AMBIGUOUS, rows: pool };
}

/**
 * The catalogue as one unit sees it: each active entry in the unit's
 * language, with whether the unit already holds it.
 *
 * @param {{query: Function}} db - Pool or client
 * @param {number} organizationId - Unit
 * @returns {Promise<{version: number, language: string, branch: string|null, activities: Object[]}>} Catalogue
 */
async function describeStarterCatalogue(db, organizationId) {
  const [context, rows] = await Promise.all([
    loadUnitContext(db, organizationId),
    loadUnitCandidates(db, organizationId)
  ]);

  const activities = ACTIVE_ENTRIES.map((entry) => {
    const text = entry[context.language];
    const standing = classifyEntry(entry, rows);
    return {
      key: entry.key,
      name: text.name,
      summary: text.summary,
      steps: text.steps,
      safety: text.safety,
      material: text.material,
      variants: text.variants,
      category: entry.category,
      branches: entry.branches,
      tags: entry.tags,
      seasons: entry.seasons,
      duration: entry.duration,
      players_min: entry.players?.min ?? null,
      supervision: entry.supervision,
      status: standing.status,
      library_id: standing.row?.id ?? null
    };
  });

  return {
    version: catalogue.version,
    language: context.language,
    branch: context.branch,
    default_keys: selectDefaultStarterKeys(context.branch),
    activities
  };
}

/**
 * Copy, adopt or restore catalogue entries inside the caller's transaction.
 *
 * @param {{query: Function}} client - Client inside an open transaction
 * @param {number} organizationId - Unit
 * @param {string} userId - Recorded as the copies' creator
 * @param {string[]} keys - Validated catalogue keys
 * @param {Object} [options]
 * @param {boolean} [options.restoreHidden=true] - A person asking for an entry
 *   they hid gets it back; automatic installation leaves it hidden
 * @returns {Promise<Object>} Outcome lists: created, already_present,
 *   reconciled, restored, hidden, ambiguous
 */
async function importStarterActivitiesInTransaction(client, organizationId, userId, keys, options = {}) {
  const restoreHidden = options.restoreHidden !== false;
  // Concurrent imports for the same unit take turns; other units are unaffected.
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [organizationId, STARTER_LOCK_NAME]);

  const { language } = await loadUnitContext(client, organizationId);
  const rows = await loadUnitCandidates(client, organizationId);
  const outcome = {
    language,
    created: [],
    already_present: [],
    reconciled: [],
    restored: [],
    hidden: [],
    ambiguous: []
  };

  // Sequential on purpose: one transaction, one connection.
  for (const key of keys) {
    const entry = ENTRIES_BY_KEY.get(key);
    const standing = classifyEntry(entry, rows);
    const summary = { key, name: entry[language].name };

    switch (standing.status) {
      case STARTER_STATUS.PRESENT:
        outcome.already_present.push({ ...summary, library_id: standing.row.id });
        break;
      case STARTER_STATUS.HIDDEN:
        if (restoreHidden) {
          // eslint-disable-next-line no-await-in-loop -- one transaction, in order
          await client.query(
            `UPDATE activity_library SET is_active = TRUE, updated_at = NOW()
              WHERE id = $1 AND organization_id = $2`,
            [standing.row.id, organizationId]
          );
          standing.row.is_active = true;
          outcome.restored.push({ ...summary, library_id: standing.row.id });
        } else {
          outcome.hidden.push({ ...summary, library_id: standing.row.id });
        }
        break;
      case STARTER_STATUS.LEGACY_MATCH: {
        // Adopt the unit's own copy: attach the key, keep its text as written.
        const reactivate = restoreHidden && standing.row.is_active === false;
        // eslint-disable-next-line no-await-in-loop -- one transaction, in order
        await client.query(
          `UPDATE activity_library
              SET metadata = metadata || jsonb_build_object('starter_key', $3::text, 'starter_version', $4::int),
                  is_active = CASE WHEN $5::boolean THEN TRUE ELSE is_active END,
                  updated_at = NOW()
            WHERE id = $1 AND organization_id = $2 AND NOT (metadata ? 'starter_key')`,
          [standing.row.id, organizationId, key, catalogue.version, reactivate]
        );
        standing.row.starter_key = key;
        outcome.reconciled.push({ ...summary, library_id: standing.row.id, local_name: standing.row.name });
        break;
      }
      case STARTER_STATUS.AMBIGUOUS:
        outcome.ambiguous.push({
          ...summary,
          candidates: standing.rows.map((row) => ({ library_id: row.id, local_name: row.name }))
        });
        break;
      default: {
        const copy = buildLibraryCopy(entry, language);
        // eslint-disable-next-line no-await-in-loop -- one transaction, in order
        const inserted = await client.query(
          `INSERT INTO activity_library
             (organization_id, name, description, category, tags,
              estimated_duration_min, estimated_duration_max, material, metadata, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
           ON CONFLICT (organization_id, (metadata ->> 'starter_key')) WHERE metadata ? 'starter_key'
           DO NOTHING
           RETURNING id`,
          [
            organizationId, copy.name, copy.description, copy.category, JSON.stringify(copy.tags),
            copy.durationMin, copy.durationMax, copy.material, JSON.stringify(copy.metadata), userId
          ]
        );
        if (inserted.rows.length > 0) {
          rows.push({ id: inserted.rows[0].id, name: copy.name, is_active: true, starter_key: key });
          outcome.created.push({ ...summary, library_id: inserted.rows[0].id });
        } else {
          outcome.already_present.push({ ...summary, library_id: null });
        }
      }
    }
  }

  return outcome;
}

/**
 * Copy the requested catalogue entries into a unit's library, in its own
 * transaction.
 *
 * @param {{connect: Function}} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {string} userId - The person importing
 * @param {*} keys - Requested keys (validated here)
 * @returns {Promise<Object>} importStarterActivitiesInTransaction() outcome
 * @throws {StarterSelectionError} For a malformed, unknown or withdrawn key
 */
async function importStarterActivities(pool, organizationId, userId, keys) {
  const selection = validateStarterSelection(keys);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await importStarterActivitiesInTransaction(client, organizationId, userId, selection);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Install the default selection for a unit, inside the caller's transaction
 * (unit creation, demo seeding). Safe to run again: it only adds what is
 * missing and never brings back an activity the unit hid.
 *
 * @param {{query: Function}} client - Client inside an open transaction
 * @param {number} organizationId - Unit
 * @param {string} userId - Recorded as the copies' creator
 * @returns {Promise<Object>} importStarterActivitiesInTransaction() outcome
 */
async function installDefaultStarterActivities(client, organizationId, userId) {
  const context = await loadUnitContext(client, organizationId);
  return importStarterActivitiesInTransaction(
    client,
    organizationId,
    userId,
    selectDefaultStarterKeys(context.branch),
    { restoreHidden: false }
  );
}

module.exports = {
  STARTER_LANGUAGES,
  STARTER_STATUS,
  STARTER_IMPORT_MAX_KEYS,
  StarterSelectionError,
  buildLibraryCopy,
  chooseStarterLanguage,
  describeStarterCatalogue,
  importStarterActivities,
  importStarterActivitiesInTransaction,
  installDefaultStarterActivities,
  selectDefaultStarterKeys,
  starterBranchForSection,
  validateStarterSelection
};
