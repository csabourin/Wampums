/** Published personal lists and common translations; checkmarks stay on the device; all writes are transactional. */
const RULES = require('../config/personal_equipment.json');
const { generateText } = require('./aiText');
const { listChildrenInYear } = require('./participantAccess');
const { getActivityParticipation } = require('./activityInvitations');
const transaction = require('../utils/transaction');
const { readPublication, publish, sameText } = require('./packingPublications');
const POSTGRES_INTEGER_MAX = 2147483647;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
class PersonalEquipmentError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST) { super(message); this.status = status; }
}
const refuse = (key, status) => { throw new PersonalEquipmentError(key, status); };
/** Refuse arrays, coercions, duplicate keys and incomplete bilingual items before opening a transaction. */
function readList(value) {
  const text = (v, max) => typeof v === 'string' && !v.includes('\0') && v.trim().length <= max;
  if (!value || !RULES.SEASONS.includes(value.season) || !RULES.STAY_TYPES.includes(value.stay_type)
    || !Number.isInteger(value.nights) || value.nights < 0 || value.nights > RULES.MAX_NIGHTS
    || (value.stay_type === 'day' ? value.nights !== 0 : value.nights < 1)
    || !Number.isInteger(value.expected_version) || value.expected_version < 0
    || typeof value.published !== 'boolean' || (value.published && value.reviewed !== true)
    || !text(value.notes_fr, RULES.NOTES_MAX) || !text(value.notes_en, RULES.NOTES_MAX)
    || !Array.isArray(value.items) || !value.items.length || value.items.length > RULES.MAX_ITEMS) { return null; }
  const keys = new Set();
  for (const item of value.items) {
    if (!item || typeof item.key !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(item.key) || keys.has(item.key)
      || !text(item.label_fr, RULES.LABEL_MAX) || !text(item.label_en, RULES.LABEL_MAX) || (!item.label_fr.trim() && !item.label_en.trim())
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > RULES.MAX_QUANTITY
      || (item.catalog_item_id !== null && item.catalog_item_id !== undefined && (!Number.isInteger(item.catalog_item_id) || item.catalog_item_id < 1 || item.catalog_item_id > POSTGRES_INTEGER_MAX))) { return null; }
    keys.add(item.key);
  }
  return value;
}
/** Lock the camp before its list, consistently for edits and family checks. */
async function campFor(db, organizationId, meetingId, lock = '') {
  const camp = (await db.query(`SELECT m.id, m.theme, m.activity_id, m.meeting_date::text, GREATEST(m.span_days-1,0) AS nights, m.is_cancelled
    FROM year_plan_meetings m WHERE m.organization_id=$1 AND m.id=$2 AND m.meeting_kind='camp'${lock}`,
  [organizationId, meetingId])).rows[0];
  if (!camp) { refuse('personal_equipment_not_found', HTTP_NOT_FOUND); }
  return camp;
}
async function listFor(db, organizationId, meetingId) {
  const list = (await db.query('SELECT * FROM personal_equipment_lists WHERE organization_id=$1 AND meeting_id=$2', [organizationId, meetingId])).rows[0];
  if (!list) { return null; }
  const items = (await db.query(`SELECT item_key AS key,label_fr,label_en,quantity,catalog_item_id FROM personal_equipment_items
    WHERE organization_id=$1 AND meeting_id=$2 AND active ORDER BY position,item_key`, [organizationId, meetingId])).rows;
  return { ...list, items };
}
/** Replacing text or quantities preserves item keys and every child's saved check. */
function saveList(pool, organizationId, actorId, meetingId, value, transactionDb = null) {
  const input = readList(value);
  if (!input) { refuse('personal_equipment_invalid'); }
  const work = async (db) => {
    const camp = await campFor(db, organizationId, meetingId, ' FOR UPDATE');
    if (camp.is_cancelled) { refuse('personal_equipment_cancelled', HTTP_CONFLICT); }
    const previous = await listFor(db, organizationId, meetingId);
    if ((previous?.version || 0) !== input.expected_version) { refuse('personal_equipment_conflict', HTTP_CONFLICT); }
    const catalogIds = input.items.map((item) => item.catalog_item_id).filter(Boolean);
    if (catalogIds.length) {
      const valid = (await db.query('SELECT id FROM equipment_catalog_items WHERE organization_id=$1 AND id=ANY($2::int[]) AND archived_at IS NULL', [organizationId, catalogIds])).rows;
      if (catalogIds.some((id) => !valid.some((item) => item.id === id))) { refuse('personal_equipment_invalid'); }
    }
    await db.query(`INSERT INTO personal_equipment_lists (organization_id,meeting_id,season,nights,stay_type,notes_fr,notes_en,published,reviewed_at,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN NOW() ELSE NULL END,$9)
      ON CONFLICT (organization_id,meeting_id) DO UPDATE SET season=$3,nights=$4,stay_type=$5,notes_fr=$6,notes_en=$7,published=$8,
        reviewed_at=CASE WHEN $8 THEN NOW() ELSE NULL END,updated_by=$9,version=personal_equipment_lists.version+1`,
    [organizationId, meetingId, input.season, input.nights, input.stay_type, input.notes_fr, input.notes_en, input.published, actorId]);
    await db.query('UPDATE personal_equipment_items SET active=FALSE WHERE organization_id=$1 AND meeting_id=$2', [organizationId, meetingId]);
    await Promise.all(input.items.map((item, position) => db.query(`INSERT INTO personal_equipment_items
      (organization_id,meeting_id,item_key,label_fr,label_en,quantity,catalog_item_id,position)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id,meeting_id,item_key) DO UPDATE SET
      label_fr=$4,label_en=$5,quantity=$6,catalog_item_id=$7,position=$8,active=TRUE`,
    [organizationId, meetingId, item.key, item.label_fr.trim(), item.label_en.trim(), item.quantity, item.catalog_item_id || null, position])));
    const saved = await listFor(db, organizationId, meetingId);
    if (sameText(previous, saved)) {
      await db.query(`INSERT INTO personal_equipment_translations (organization_id,meeting_id,version,language,content)
        SELECT organization_id,meeting_id,$3,language,content FROM personal_equipment_translations
        WHERE organization_id=$1 AND meeting_id=$2 AND version=$4 ON CONFLICT DO NOTHING`, [organizationId, meetingId, saved.version, previous.version]);
    }
    if (saved.published) { await publish(db, organizationId, meetingId, saved, await translationsFor(db, organizationId, meetingId, saved.version)); }
    return saved;
  };
  return transactionDb ? work(transactionDb) : transaction(pool, work);
}
/** The same invitation/decline rules used by activity rosters apply to personal lists. */
async function childrenFor(db, context, camp) {
  const children = await listChildrenInYear(db, context.organizationId, context.yearId, context.userId);
  if (!camp.activity_id) { return children; }
  const active = await db.query('SELECT id FROM activities WHERE organization_id=$1 AND id=$2 AND is_active=TRUE', [context.organizationId, camp.activity_id]);
  if (!active.rows.length) { return []; }
  const participation = await getActivityParticipation(db, camp.activity_id, context.organizationId);
  return children.filter((child) => (participation.invited_participant_ids === null || participation.invited_participant_ids.includes(child.id))
    && !participation.declined_participant_ids.includes(child.id));
}
/** Only the signed-in family's eligible children are ever returned to a parent. */
async function readFamilyList(db, context, meetingId) {
  const camp = await campFor(db, context.organizationId, meetingId);
  const publication = await readPublication(db, context.organizationId, meetingId);
  const list = publication?.list;
  if (!list || camp.is_cancelled) { refuse('personal_equipment_not_found', HTTP_NOT_FOUND); }
  const year = (await db.query('SELECT id FROM scout_years WHERE organization_id=$1 AND id=$2 AND $3::date BETWEEN start_date AND end_date',
    [context.organizationId, context.yearId, camp.meeting_date])).rows[0];
  const children = year ? await childrenFor(db, context, camp) : [];
  if (!children.length) { refuse('personal_equipment_not_found', HTTP_NOT_FOUND); }
  return { camp, list, children, translations: publication.translations };
}
/** Only the signed-in family's published lists in the selected roster year; no packing progress is queried. */
async function familyTasks(db, context) {
  const camps = (await db.query(`SELECT m.id,m.theme,m.meeting_date::text,m.activity_id FROM personal_equipment_lists l
    JOIN year_plan_meetings m ON m.id=l.meeting_id AND m.organization_id=l.organization_id
    JOIN scout_years sy ON sy.id=$2 AND sy.organization_id=l.organization_id
    WHERE l.organization_id=$1 AND EXISTS (SELECT 1 FROM packing_list_publications pub WHERE pub.organization_id=l.organization_id AND pub.resource_key=m.id::text) AND NOT m.is_cancelled AND m.meeting_date BETWEEN sy.start_date AND sy.end_date
    ORDER BY m.meeting_date,m.id`, [context.organizationId, context.yearId])).rows;
  const lists = await Promise.all(camps.map(async (camp) => {
    const children = await childrenFor(db, context, camp);
    const list = (await readPublication(db, context.organizationId, camp.id)).list;
    const data = { children, list };
    return data.children.map((child) => ({ meeting_id: camp.id, participant_id: child.id, title: camp.theme, date: camp.meeting_date,
      item_keys: data.list.items.map((item) => item.key) }));
  }));
  return lists.flat();
}
/** Strictly accept exactly one translated label for each stable item key. */
function readTranslation(value, items) {
  if (!value || typeof value.notes !== 'string' || value.notes.includes('\0') || value.notes.length > RULES.NOTES_MAX
    || !Array.isArray(value.items) || value.items.length !== items.length) { return null; }
  const keys = new Set(items.map((item) => item.key)); const seen = new Set();
  for (const item of value.items) {
    if (!item || !keys.has(item.key) || seen.has(item.key) || typeof item.label !== 'string' || item.label.includes('\0')
      || !item.label.trim() || item.label.length > RULES.LABEL_MAX) { return null; }
    seen.add(item.key);
  }
  return { notes: value.notes.trim(), items: value.items.map((item) => ({ key: item.key, label: item.label.trim() })) };
}

/** Shared text-only translation for camps and standalone activities. */
async function translateContent(list, language, context) {
  const completeNotes = Boolean(list[`notes_${language}`]?.trim()) || ![list.notes_fr, list.notes_en].some((notes) => notes?.trim());
  const direct = ['fr', 'en'].includes(language) && completeNotes && list.items.every((item) => item[`label_${language}`]);
  if (direct) { return { notes: list[`notes_${language}`], items: list.items.map((item) => ({ key: item.key, label: item[`label_${language}`] })) }; }
  const input = { targetLocale: language, notes: list.notes_fr || list.notes_en,
    items: list.items.map((item) => ({ key: item.key, label: item.label_fr || item.label_en })) };
  const generated = await generateText('packing_translate', input, { organizationId: context.organizationId, userId: context.userId });
  const translated = readTranslation(generated.data, list.items);
  if (!translated) { const err = new Error('Invalid list translation'); err.code = 'AI_INVALID_RESPONSE'; throw err; }
  return translated;
}

/** Staff see prepared versions; families receive only the last publication snapshot. */
async function translationsFor(db, organizationId, meetingId, version) {
  const rows = (await db.query('SELECT language,content FROM personal_equipment_translations WHERE organization_id=$1 AND meeting_id=$2 AND version=$3', [organizationId, meetingId, version])).rows;
  return Object.fromEntries(rows.map((row) => [row.language, row.content]));
}

/** A human correction is version-checked and never invokes an AI provider. */
function editTranslation(pool, context, meetingId, language, value, transactionDb = null) {
  const work = async (db) => {
    if (!RULES.TRANSLATION_LANGUAGES.includes(language)) { refuse('personal_equipment_invalid'); }
    const camp = await campFor(db, context.organizationId, meetingId, ' FOR UPDATE');
    const list = await listFor(db, context.organizationId, meetingId);
    if (!list || camp.is_cancelled) { refuse('personal_equipment_not_found', HTTP_NOT_FOUND); }
    if (value.expected_version !== list.version) { refuse('personal_equipment_conflict', HTTP_CONFLICT); }
    const existing = (await db.query('SELECT content FROM personal_equipment_translations WHERE organization_id=$1 AND meeting_id=$2 AND version=$3 AND language=$4', [context.organizationId, meetingId, list.version, language])).rows[0];
    if (!existing || JSON.stringify(readTranslation(existing.content, list.items)) !== JSON.stringify(readTranslation(value.expected_content, list.items))) { refuse('personal_equipment_conflict', HTTP_CONFLICT); }
    const content = readTranslation(value.content, list.items);
    if (!content) { refuse('personal_equipment_invalid'); }
    await db.query(`INSERT INTO personal_equipment_translations (organization_id,meeting_id,version,language,content) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (organization_id,meeting_id,version,language) DO UPDATE SET content=$5`, [context.organizationId, meetingId, list.version, language, JSON.stringify(content)]);
    await db.query('UPDATE personal_equipment_lists SET published=FALSE WHERE organization_id=$1 AND meeting_id=$2', [context.organizationId, meetingId]);
    return content;
  };
  return transactionDb ? work(transactionDb) : transaction(pool, work);
}

/** Translate only common list text, never a child's identity or packing state. */
function translateList(pool, context, meetingId, language) {
  if (!RULES.TRANSLATION_LANGUAGES.includes(language)) { refuse('personal_equipment_invalid'); }
  return transaction(pool, async (db) => {
    await campFor(db, context.organizationId, meetingId, ' FOR SHARE');
    const camp = await campFor(db, context.organizationId, meetingId);
    const list = await listFor(db, context.organizationId, meetingId);
    if (!list || camp.is_cancelled) { refuse('personal_equipment_not_found', HTTP_NOT_FOUND); }
    await db.query("SELECT pg_advisory_xact_lock(hashtext('personal-equipment'), hashtext($1))", [`${context.organizationId}:${meetingId}:${language}`]);
    const cached = (await db.query('SELECT content FROM personal_equipment_translations WHERE organization_id=$1 AND meeting_id=$2 AND version=$3 AND language=$4',
      [context.organizationId, meetingId, list.version, language])).rows[0];
    if (cached) { return cached.content; }
    const translated = await translateContent(list, language, context);
    await db.query('INSERT INTO personal_equipment_translations (organization_id,meeting_id,version,language,content) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [context.organizationId, meetingId, list.version, language, JSON.stringify(translated)]);
    await db.query('UPDATE personal_equipment_lists SET published=FALSE WHERE organization_id=$1 AND meeting_id=$2', [context.organizationId, meetingId]);
    return translated;
  });
}
module.exports = { editTranslation, translationsFor, childrenFor, translateContent, PersonalEquipmentError, readList, campFor, listFor, saveList, readFamilyList, familyTasks, translateList, readTranslation };
