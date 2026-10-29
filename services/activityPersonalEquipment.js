/** Activity entry point; planner camps retain their existing list and local check keys. */
const legacy = require('./personalEquipment');
const transaction = require('../utils/transaction');
const { readPublication, publish, sameText } = require('./packingPublications');
const RULES = require('../config/personal_equipment.json');
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const fail = (key, status = HTTP_NOT_FOUND) => { throw new legacy.PersonalEquipmentError(key, status); };
/** Lock the activity first, then use its planner camp when one exists. */
async function activityFor(db, context, id, lock = '') {
  const activity = (await db.query(`SELECT id, name AS theme, id AS activity_id,
    COALESCE(activity_start_date,activity_date)::text AS meeting_date, NOT is_active AS is_cancelled
    FROM activities WHERE organization_id=$1 AND id=$2${lock}`, [context.organizationId, id])).rows[0];
  if (!activity) { fail('personal_equipment_not_found'); }
  const direct = (await db.query('SELECT activity_id FROM activity_personal_equipment_lists WHERE organization_id=$1 AND activity_id=$2', [context.organizationId, id])).rows[0];
  if (direct) { return { activity }; }
  const camp = (await db.query("SELECT id FROM year_plan_meetings WHERE organization_id=$1 AND activity_id=$2 AND meeting_kind='camp' ORDER BY id LIMIT 1", [context.organizationId, id])).rows[0];
  return { activity, meetingId: camp?.id };
}
async function listFor(db, context, id) {
  const row = (await db.query('SELECT content,version FROM activity_personal_equipment_lists WHERE organization_id=$1 AND activity_id=$2', [context.organizationId, id])).rows[0];
  return row ? { ...row.content, version: row.version } : null;
}
/** Both staff and families resolve the same canonical list. */
async function read(db, context, id, manage = false) {
  const { activity, meetingId } = await activityFor(db, context, id);
  if (meetingId) {
    if (!manage) { return { ...await legacy.readFamilyList(db, context, meetingId), packing_id: meetingId }; }
    return { camp: await legacy.campFor(db, context.organizationId, meetingId), list: await legacy.listFor(db, context.organizationId, meetingId), translations: await legacy.translationsFor(db, context.organizationId, meetingId, (await legacy.listFor(db, context.organizationId, meetingId))?.version || 0), packing_id: meetingId };
  }
  const list = await listFor(db, context, id);
  const result = { camp: activity, list, packing_id: `activity-${id}` };
  if (manage) { return { ...result, translations: await translationsFor(db, context, id, list?.version || 0) }; }
  const publication = await readPublication(db, context.organizationId, `activity-${id}`);
  result.list = publication?.list;
  result.translations = publication?.translations || {};
  const year = (await db.query('SELECT id FROM scout_years WHERE organization_id=$1 AND id=$2 AND $3::date BETWEEN start_date AND end_date', [context.organizationId, context.yearId, activity.meeting_date])).rows[0];
  if (!result.list || activity.is_cancelled || !year) { fail('personal_equipment_not_found'); }
  const children = await legacy.childrenFor(db, context, activity);
  if (!children.length) { fail('personal_equipment_not_found'); }
  return { ...result, children };
}
/** Store whitelisted common content only; serialize concurrent writes on the activity. */
function save(pool, context, id, value) {
  if (!legacy.readList(value)) { fail('personal_equipment_invalid', HTTP_BAD_REQUEST); }
  return transaction(pool, async (db) => {
    const { activity, meetingId } = await activityFor(db, context, id, ' FOR UPDATE');
    if (activity.is_cancelled) { fail('personal_equipment_cancelled', HTTP_CONFLICT); }
    if (meetingId) { return legacy.saveList(pool, context.organizationId, context.userId, meetingId, value, db); }
    const previous = await listFor(db, context, id);
    if ((previous?.version || 0) !== value.expected_version) { fail('personal_equipment_conflict', HTTP_CONFLICT); }
    const ids = value.items.map((item) => item.catalog_item_id).filter(Boolean);
    const valid = ids.length ? (await db.query('SELECT id FROM equipment_catalog_items WHERE organization_id=$1 AND id=ANY($2::int[]) AND archived_at IS NULL', [context.organizationId, ids])).rows : [];
    if (ids.some((key) => !valid.some((item) => item.id === key))) { fail('personal_equipment_invalid', HTTP_BAD_REQUEST); }
    const content = Object.fromEntries(['season','nights','stay_type','notes_fr','notes_en','published','reviewed'].map((key) => [key, value[key]]));
    content.notes_fr = content.notes_fr.trim(); content.notes_en = content.notes_en.trim();
    content.items = value.items.map((item) => ({ key: item.key, label_fr: item.label_fr.trim(), label_en: item.label_en.trim(), quantity: item.quantity, catalog_item_id: item.catalog_item_id || null }));
    await db.query(`INSERT INTO activity_personal_equipment_lists (organization_id,activity_id,content) VALUES ($1,$2,$3)
      ON CONFLICT (organization_id,activity_id) DO UPDATE SET content=$3,version=activity_personal_equipment_lists.version+1`, [context.organizationId, id, JSON.stringify(content)]);
    const saved = await listFor(db, context, id);
    if (sameText(previous, saved)) {
      await db.query(`INSERT INTO activity_personal_equipment_translations (organization_id,activity_id,version,language,content)
        SELECT organization_id,activity_id,$3,language,content FROM activity_personal_equipment_translations
        WHERE organization_id=$1 AND activity_id=$2 AND version=$4 ON CONFLICT DO NOTHING`, [context.organizationId, id, saved.version, previous.version]);
    }
    if (saved.published) { await publish(db, context.organizationId, `activity-${id}`, saved, await translationsFor(db, context, id, saved.version)); }
    return saved;
  });
}
async function tasks(db, context) {
  const activities = (await db.query(`SELECT l.activity_id FROM activity_personal_equipment_lists l
    JOIN activities a ON a.id=l.activity_id AND a.organization_id=l.organization_id
    JOIN scout_years sy ON sy.id=$2 AND sy.organization_id=l.organization_id
    WHERE l.organization_id=$1 AND EXISTS (SELECT 1 FROM packing_list_publications pub WHERE pub.organization_id=l.organization_id AND pub.resource_key='activity-'||l.activity_id) AND a.is_active=TRUE
    AND COALESCE(a.activity_start_date,a.activity_date) BETWEEN sy.start_date AND sy.end_date`, [context.organizationId, context.yearId])).rows;
  const results = await Promise.all(activities.map(async ({ activity_id: id }) => {
    const rows = [];
    try {
      const data = await read(db, context, id);
      if (data.packing_id !== `activity-${id}`) { return rows; }
      for (const child of data.children) { rows.push({ meeting_id: data.packing_id, participant_id: child.id, title: data.camp.theme, date: data.camp.meeting_date, item_keys: data.list.items.map((item) => item.key) }); }
    } catch (error) { if (!(error instanceof legacy.PersonalEquipmentError) || error.status !== HTTP_NOT_FOUND) { throw error; } }
    return rows;
  }));
  return results.flat();
}
async function translationsFor(db, context, id, version) {
  const rows = (await db.query('SELECT language,content FROM activity_personal_equipment_translations WHERE organization_id=$1 AND activity_id=$2 AND version=$3', [context.organizationId, id, version])).rows;
  return Object.fromEntries(rows.map((row) => [row.language, row.content]));
}
function editTranslation(pool, context, id, language, value) {
  return transaction(pool, async (db) => {
    if (!RULES.TRANSLATION_LANGUAGES.includes(language)) { fail('personal_equipment_invalid', HTTP_BAD_REQUEST); }
    const { activity, meetingId } = await activityFor(db, context, id, ' FOR UPDATE');
    if (meetingId) { return legacy.editTranslation(pool, context, meetingId, language, value, db); }
    const list = await listFor(db, context, id);
    if (!list || activity.is_cancelled) { fail('personal_equipment_not_found'); }
    if (value.expected_version !== list.version) { fail('personal_equipment_conflict', HTTP_CONFLICT); }
    const existing = (await db.query('SELECT content FROM activity_personal_equipment_translations WHERE organization_id=$1 AND activity_id=$2 AND version=$3 AND language=$4', [context.organizationId, id, list.version, language])).rows[0];
    if (!existing || JSON.stringify(legacy.readTranslation(existing.content, list.items)) !== JSON.stringify(legacy.readTranslation(value.expected_content, list.items))) { fail('personal_equipment_conflict', HTTP_CONFLICT); }
    const content = legacy.readTranslation(value.content, list.items);
    if (!content) { fail('personal_equipment_invalid', HTTP_BAD_REQUEST); }
    await db.query(`INSERT INTO activity_personal_equipment_translations (organization_id,activity_id,version,language,content) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (organization_id,activity_id,version,language) DO UPDATE SET content=$5`, [context.organizationId, id, list.version, language, JSON.stringify(content)]);
    await db.query("UPDATE activity_personal_equipment_lists SET content=jsonb_set(content,'{published}','false'::jsonb) WHERE organization_id=$1 AND activity_id=$2", [context.organizationId, id]);
    return content;
  });
}
async function translate(pool, context, id, language) {
  if (!RULES.TRANSLATION_LANGUAGES.includes(language)) { fail('personal_equipment_invalid', HTTP_BAD_REQUEST); }
  const target = await activityFor(pool, context, id);
  if (target.meetingId) { return legacy.translateList(pool, context, target.meetingId, language); }
  return transaction(pool, async (db) => {
    await activityFor(db, context, id, ' FOR SHARE');
    const { list, camp } = await read(db, context, id, true);
    if (!list || camp.is_cancelled) { fail('personal_equipment_not_found'); }
    await db.query("SELECT pg_advisory_xact_lock(hashtext('activity-equipment'),hashtext($1))", [`${context.organizationId}:${id}:${language}`]);
    const cached = (await db.query('SELECT content FROM activity_personal_equipment_translations WHERE organization_id=$1 AND activity_id=$2 AND version=$3 AND language=$4', [context.organizationId, id, list.version, language])).rows[0];
    if (cached) { return cached.content; }
    const translated = await legacy.translateContent(list, language, context);
    await db.query('INSERT INTO activity_personal_equipment_translations (organization_id,activity_id,version,language,content) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [context.organizationId, id, list.version, language, JSON.stringify(translated)]);
    await db.query("UPDATE activity_personal_equipment_lists SET content=jsonb_set(content,'{published}','false'::jsonb) WHERE organization_id=$1 AND activity_id=$2", [context.organizationId, id]);
    return translated;
  });
}
module.exports = { editTranslation, read, save, tasks, translate };
