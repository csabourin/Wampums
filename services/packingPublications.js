/** Common publication snapshots only; never any child's packing state. */
async function readPublication(db, organizationId, key) {
  return (await db.query('SELECT content FROM packing_list_publications WHERE organization_id=$1 AND resource_key=$2', [organizationId, String(key)])).rows[0]?.content || null;
}

/**
 * When families last received this list, and which version they have, for the staff status line.
 * @returns {Promise<{published_at: string, version: number}|null>}
 */
async function readPublicationInfo(db, organizationId, key) {
  const row = (await db.query(`SELECT published_at, (content->'list'->>'version')::int AS version
    FROM packing_list_publications WHERE organization_id=$1 AND resource_key=$2`, [organizationId, String(key)])).rows[0];
  return row ? { published_at: row.published_at, version: row.version } : null;
}

/** A translation still waiting for some items or the instructions never reaches families. */
const isComplete = (content) => Boolean(content) && content.partial !== true;

/** Families only receive complete translations. */
function completeTranslations(translations = {}) {
  return Object.fromEntries(Object.entries(translations).filter(([, content]) => isComplete(content)));
}

async function publish(db, organizationId, key, list, translations) {
  await db.query(`INSERT INTO packing_list_publications (organization_id,resource_key,content,published_at) VALUES ($1,$2,$3,NOW())
    ON CONFLICT (organization_id,resource_key) DO UPDATE SET content=$3,published_at=NOW()`,
  [organizationId, String(key), JSON.stringify({ list, translations: completeTranslations(translations) })]);
}

const itemSource = (item) => JSON.stringify([item.label_fr, item.label_en]);
const notesSource = (list) => JSON.stringify([list?.notes_fr, list?.notes_en]);

/** Editing quantities or publication status does not invalidate unchanged translated text. */
function sameText(a, b) {
  const text = (list) => JSON.stringify([notesSource(list), list?.items?.map((item) => [item.key, itemSource(item)])]);
  return !!a && text(a) === text(b);
}

/**
 * What a translation of the previous version still says correctly about the saved one.
 *
 * An item whose source labels did not change keeps its translated (or hand-corrected)
 * label; a changed or new item, and changed instructions, are left for the next
 * translation, which then translates only those. Removed items are dropped.
 *
 * @param {Object} previous - The list as it was translated
 * @param {Object} saved - The list as just saved
 * @param {Object} content - The previous version's translation ({ notes, items, partial? })
 * @returns {Object|null} A complete translation, a partial one (`partial: true`, `notes: null`
 *   when the instructions need translating again), or null when nothing survives
 */
function carryTranslation(previous, saved, content) {
  if (!previous || !content || !Array.isArray(content.items)) { return null; }
  const before = new Map(previous.items.map((item) => [item.key, itemSource(item)]));
  const translated = new Map(content.items.map((item) => [item.key, item.label]));
  const items = saved.items
    .filter((item) => translated.has(item.key) && before.get(item.key) === itemSource(item))
    .map((item) => ({ key: item.key, label: translated.get(item.key) }));
  const notesKept = typeof content.notes === 'string' && notesSource(previous) === notesSource(saved);
  if (!items.length && !notesKept) { return null; }
  if (notesKept && items.length === saved.items.length) { return { notes: content.notes, items }; }
  return { notes: notesKept ? content.notes : null, items, partial: true };
}

/**
 * How much of a translation is missing: item keys still to translate, and whether the instructions are.
 * @returns {{items: string[], notes: boolean}}
 */
function missingFromTranslation(list, content) {
  const done = new Set((content?.items || []).map((item) => item.key));
  return { items: list.items.map((item) => item.key).filter((key) => !done.has(key)), notes: typeof content?.notes !== 'string' };
}

module.exports = { readPublication, readPublicationInfo, publish, sameText, carryTranslation, missingFromTranslation, isComplete, completeTranslations };
