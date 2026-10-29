/** Common publication snapshots only; never any child's packing state. */
async function readPublication(db, organizationId, key) {
  return (await db.query('SELECT content FROM packing_list_publications WHERE organization_id=$1 AND resource_key=$2', [organizationId, String(key)])).rows[0]?.content || null;
}
async function publish(db, organizationId, key, list, translations) {
  await db.query(`INSERT INTO packing_list_publications (organization_id,resource_key,content) VALUES ($1,$2,$3)
    ON CONFLICT (organization_id,resource_key) DO UPDATE SET content=$3`, [organizationId, String(key), JSON.stringify({ list, translations })]);
}
/** Editing quantities or publication status does not invalidate unchanged translated text. */
function sameText(a, b) {
  const text = (list) => JSON.stringify([list?.notes_fr, list?.notes_en, list?.items?.map((item) => [item.key, item.label_fr, item.label_en])]);
  return !!a && text(a) === text(b);
}
module.exports = { readPublication, publish, sameText };
