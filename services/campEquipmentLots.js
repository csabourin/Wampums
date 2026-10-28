'use strict';
const { createHash } = require('node:crypto');
const { buildCampMaterialList } = require('./campMaterialList');
const { readMaterialItems } = require('./equipmentCatalog');
const { saveTaskInTransaction, recordStatus, TaskError } = require('./activityTasks');
const { LOT_ROLES, LOT_TRANSITIONS } = require('../config/camp-equipment-lots');
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const QUANTITY_PRECISION = 100;

/** Known, translatable domain refusal. */
class CampLotError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST) {super(message); this.status = status;}
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = (item) => item.catalog_item_id ? `a${item.catalog_item_id}` : `e${item.equipment_item_id}`;

/** Every lot change, task change and receipt commits together. */
async function transaction(pool, mutate) {
  const db = await pool.connect();
  try {await db.query('BEGIN'); const result = await mutate(db); await db.query('COMMIT'); return result;}
  catch (err) {
    await db.query('ROLLBACK');
    if (err.code === '23505' && err.constraint === 'camp_equipment_lots_name') {throw new CampLotError('camp_lot_name_conflict', HTTP_CONFLICT);}
    if (err.code === '23505' && err.constraint === 'camp_equipment_lots_creation_key') {throw new CampLotError('camp_lot_creation_conflict', HTTP_CONFLICT);}
    throw err;
  } finally {db.release();}
}

/** Lock a writable camp before changing its allocations, serializing competing lots. */
async function campFor(db, organizationId, meetingId, writable = false) {
  const result = await db.query(
    `SELECT id, theme, meeting_date::text, activity_id, is_cancelled FROM year_plan_meetings
      WHERE organization_id = $1 AND id = $2 AND meeting_kind = 'camp'${writable ? ' FOR UPDATE' : ''}`,
    [organizationId, meetingId],
  );
  const camp = result.rows[0];
  if (!camp) {throw new CampLotError('camp_lot_not_found', HTTP_NOT_FOUND);}
  if (writable && camp.is_cancelled) {throw new CampLotError('camp_lot_cancelled', HTTP_CONFLICT);}
  return camp;
}

/** Read lot details, with shared tasks as the only assignment source. */
async function listLots(db, organizationId, meetingId = null, assigneeId = null) {
  if (meetingId) {await campFor(db, organizationId, meetingId);}
  const result = await db.query(
    `SELECT l.id, l.meeting_id, l.name, l.status, l.version, l.updated_at, m.theme AS camp_name, m.is_cancelled AS camp_cancelled,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key', i.item_key, 'name', i.name,
        'unit_of_measure', i.unit_of_measure, 'quantity', i.quantity) ORDER BY i.item_key)
        FROM camp_equipment_lot_items i WHERE i.lot_id = l.id AND i.organization_id = l.organization_id), '[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('role', r.role, 'task_id', t.id,
        'user_id', t.assignee_id, 'name', u.full_name, 'due_date', t.due_date::text, 'status', t.status) ORDER BY r.role)
        FROM camp_equipment_lot_roles r JOIN activity_tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
        JOIN users u ON u.id = t.assignee_id WHERE r.lot_id = l.id AND r.organization_id = l.organization_id), '[]'::jsonb) AS roles,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('version', h.version, 'action', h.action,
        'previous_status', h.previous_status, 'status', h.status, 'changed_at', h.changed_at,
        'changed_by_name', u.full_name) ORDER BY h.version)
        FROM camp_equipment_lot_history h LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.lot_id = l.id AND h.organization_id = l.organization_id), '[]'::jsonb) AS history
     FROM camp_equipment_lots l JOIN year_plan_meetings m ON m.id = l.meeting_id AND m.organization_id = l.organization_id
     WHERE l.organization_id = $1 AND ($2::int IS NULL OR l.meeting_id = $2)
       AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM camp_equipment_lot_roles own
         JOIN activity_tasks t ON t.id = own.task_id AND t.organization_id = own.organization_id
         WHERE own.lot_id = l.id AND own.organization_id = l.organization_id AND t.assignee_id = $3))
     ORDER BY l.meeting_id, l.name, l.id`, [organizationId, meetingId, assigneeId],
  );
  return result.rows;
}

/** Minimal packs of the planned camps linked to an outing, respecting personal ownership. */
async function activityPacks(db, organizationId, activityId, assigneeId = null) {
  const meetings = await db.query(`SELECT id FROM year_plan_meetings
    WHERE organization_id = $1 AND activity_id = $2 AND meeting_kind = 'camp' ORDER BY id`, [organizationId, activityId]);
  const packs = await Promise.all(meetings.rows.map(async (meeting) => ({
    meeting_id: meeting.id, own_only: Boolean(assigneeId),
    lots: await listLots(db, organizationId, meeting.id, assigneeId),
  })));
  return packs;
}

/** Current items and active members; no family, youth, health or account-email data. */
async function options(db, organizationId, meetingId) {
  await campFor(db, organizationId, meetingId);
  const list = await buildCampMaterialList(db, organizationId, meetingId);
  const members = await db.query(`SELECT u.id, u.full_name FROM user_organizations uo
    JOIN users u ON u.id = uo.user_id WHERE uo.organization_id = $1 AND uo.status = 'active' ORDER BY u.full_name, u.id`, [organizationId]);
  const allocations = await db.query(`SELECT i.item_key, SUM(i.quantity) AS quantity FROM camp_equipment_lot_items i
    JOIN camp_equipment_lots l ON l.id = i.lot_id AND l.organization_id = i.organization_id
    WHERE l.organization_id = $1 AND l.meeting_id = $2 GROUP BY i.item_key`, [organizationId, meetingId]);
  return { camp: list.camp, members: members.rows, items: list.items.map((item) => ({
    ...item, allocated: Number(allocations.rows.find((row) => row.item_key === item.key)?.quantity || 0),
  })) };
}

/** Reject duplicate roles rather than silently keeping one assignee. */
function readRoles(value) {
  if (!Array.isArray(value) || value.length > LOT_ROLES.length || !value.length) {return null;}
  const roles = value.map((role) => ({ role: role?.role, user_id: role?.user_id }));
  if (roles.some((row) => !LOT_ROLES.includes(row.role) || typeof row.user_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.user_id))
    // policy-allow role-names: equipment duties are domain roles, not authorization roles
    || new Set(roles.map((row) => row.role)).size !== roles.length || !roles.some((row) => row.role === 'prepare')) {return null;}
  return roles.sort((a, b) => a.role.localeCompare(b.role));
}

/** Append the actor and resulting version in the mutation's transaction. */
async function recordLot(db, organizationId, actorId, lot, action, previous = null) {
  await db.query(`INSERT INTO camp_equipment_lot_history (lot_id, organization_id, version, action, previous_status, status, changed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [lot.id, organizationId, lot.version, action, previous, lot.status, actorId]);
}

/** Validate camp-list quantities while the camp row holds competing allocations. */
async function validateItems(db, organizationId, meetingId, lotId, items, list) {
  const allocated = await db.query(`SELECT i.item_key, SUM(i.quantity) AS quantity FROM camp_equipment_lot_items i
    JOIN camp_equipment_lots l ON l.id = i.lot_id AND l.organization_id = i.organization_id
    WHERE l.organization_id = $1 AND l.meeting_id = $2 AND ($3::int IS NULL OR l.id <> $3)
    GROUP BY i.item_key`, [organizationId, meetingId, lotId]);
  return items.map((item) => {
    const key = keyOf(item);
    const source = list.items.find((entry) => entry.key === key && !entry.archived);
    const assigned = Number(allocated.rows.find((row) => row.item_key === key)?.quantity || 0);
    if (!source || Math.round((assigned + item.quantity) * QUANTITY_PRECISION) > Math.round(source.quantity * QUANTITY_PRECISION)) {
      throw new CampLotError('camp_lot_items_conflict', HTTP_CONFLICT);
    }
    return { ...source, quantity: item.quantity };
  });
}

/** Create/replace a lot with its items and shared role tasks, atomically. */
function saveLot(pool, organizationId, actorId, meetingId, input, lotId = null) {
  const items = readMaterialItems(input.items);
  const roles = readRoles(input.roles);
  if (!items?.length || !roles) {throw new CampLotError('camp_lot_invalid');}
  return transaction(pool, async (db) => {
    await campFor(db, organizationId, meetingId, true);
    const hash = digest({ meetingId, name: input.name, items: [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b))), roles });
    if (!lotId) {
      const replay = await db.query('SELECT id, creation_hash FROM camp_equipment_lots WHERE organization_id = $1 AND creation_key = $2', [organizationId, input.creation_key]);
      if (replay.rows.length) {
        if (replay.rows[0].creation_hash !== hash) {throw new CampLotError('camp_lot_creation_conflict', HTTP_CONFLICT);}
        return (await listLots(db, organizationId, meetingId)).find((lot) => lot.id === replay.rows[0].id);
      }
    } else {
      const found = await db.query('SELECT * FROM camp_equipment_lots WHERE organization_id = $1 AND meeting_id = $2 AND id = $3 FOR UPDATE', [organizationId, meetingId, lotId]);
      const previous = found.rows[0];
      if (!previous) {throw new CampLotError('camp_lot_not_found', HTTP_NOT_FOUND);}
      if (previous.version !== input.expected_version || previous.status !== 'to_prepare') {throw new CampLotError('camp_lot_version_conflict', HTTP_CONFLICT);}
    }
    const list = await buildCampMaterialList(db, organizationId, meetingId);
    const entries = await validateItems(db, organizationId, meetingId, lotId, items, list);
    const saved = lotId
      ? await db.query('UPDATE camp_equipment_lots SET name = $1, version = version + 1, updated_at = NOW() WHERE id = $2 AND organization_id = $3 RETURNING *', [input.name, lotId, organizationId])
      : await db.query(`INSERT INTO camp_equipment_lots (organization_id, meeting_id, name, creation_key, creation_hash, created_by)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [organizationId, meetingId, input.name, input.creation_key, hash, actorId]);
    const lot = saved.rows[0];
    await db.query('DELETE FROM camp_equipment_lot_items WHERE lot_id = $1 AND organization_id = $2', [lot.id, organizationId]);
    for (const item of entries) {
      // eslint-disable-next-line no-await-in-loop -- one client, one atomic replacement
      await db.query(`INSERT INTO camp_equipment_lot_items (lot_id, organization_id, item_key, name, unit_of_measure, quantity)
        VALUES ($1, $2, $3, $4, $5, $6)`, [lot.id, organizationId, item.key, item.name, item.unit_of_measure, item.quantity]);
    }
    const existingRoles = (await db.query('SELECT role, task_id FROM camp_equipment_lot_roles WHERE lot_id = $1 AND organization_id = $2', [lot.id, organizationId])).rows;
    for (const role of roles) {
      const taskId = existingRoles.find((row) => row.role === role.role)?.task_id;
      // eslint-disable-next-line no-await-in-loop -- the shared task validator locks the member in this same transaction
      const task = await saveTaskInTransaction(db, organizationId, actorId, {
        title: lot.name, meeting_id: meetingId, activity_id: null, assignee_id: role.user_id,
        // policy-allow role-names: a return duty uses the last camp date
        due_date: role.role === 'return' ? list.camp.date_to : list.camp.date_from,
      }, taskId);
      // eslint-disable-next-line no-await-in-loop -- unique role and task association committed with its task
      await db.query(`INSERT INTO camp_equipment_lot_roles (lot_id, organization_id, role, task_id) VALUES ($1, $2, $3, $4)
        ON CONFLICT (lot_id, role) DO UPDATE SET task_id = EXCLUDED.task_id`, [lot.id, organizationId, role.role, task.id]);
    }
    const removed = existingRoles.filter((row) => !roles.some((role) => role.role === row.role)).map((row) => row.task_id);
    if (removed.length) {await db.query('DELETE FROM activity_tasks WHERE organization_id = $1 AND id = ANY($2::int[])', [organizationId, removed]);}
    await recordLot(db, organizationId, actorId, lot, lotId ? 'edited' : 'created');
    return (await listLots(db, organizationId, meetingId)).find((row) => row.id === lot.id);
  });
}

/** Change state once, rejecting stale devices and atomically updating role tasks. */
function changeLotStatus(pool, { organizationId, actorId, ownOnly }, lotId, input) {
  return transaction(pool, async (db) => {
    const hash = digest({ lotId, status: input.status, version: input.expected_version, previous: input.previous_mutation_id || null });
    const initial = (await db.query('SELECT meeting_id FROM camp_equipment_lots WHERE organization_id = $1 AND id = $2', [organizationId, lotId])).rows[0];
    if (!initial) {throw new CampLotError('camp_lot_not_found', HTTP_NOT_FOUND);}
    await campFor(db, organizationId, initial.meeting_id, true);
    const lot = (await db.query('SELECT * FROM camp_equipment_lots WHERE organization_id = $1 AND id = $2 FOR UPDATE', [organizationId, lotId])).rows[0];
    if (!lot) {throw new CampLotError('camp_lot_not_found', HTTP_NOT_FOUND);}
    const roles = (await db.query(`SELECT r.role, t.* FROM camp_equipment_lot_roles r JOIN activity_tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
      WHERE r.lot_id = $1 AND r.organization_id = $2 ORDER BY r.role FOR UPDATE OF t`, [lotId, organizationId])).rows;
    if (ownOnly) {
      const role = input.status === 'returned' ? 'return' : 'transport';
      // policy-allow role-names: ownership of the equipment duty, after tasks.view authorization
      const assignee = roles.find((row) => row.role === role) || roles.find((row) => row.role === 'prepare');
      if (!assignee || assignee.assignee_id !== actorId || input.status === 'to_prepare') {
        throw new CampLotError('camp_lot_not_found', HTTP_NOT_FOUND);
      }
    }
    const claim = await db.query(`INSERT INTO camp_equipment_lot_receipts (organization_id, actor_id, mutation_id, request_hash)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING mutation_id`, [organizationId, actorId, input.mutation_id, hash]);
    if (!claim.rows.length) {
      const receipt = (await db.query('SELECT * FROM camp_equipment_lot_receipts WHERE organization_id = $1 AND actor_id = $2 AND mutation_id = $3', [organizationId, actorId, input.mutation_id])).rows[0];
      if (receipt.request_hash !== hash || !receipt.response_data) {throw new CampLotError('camp_lot_creation_conflict', HTTP_CONFLICT);}
      return receipt.response_data;
    }
    if (input.previous_mutation_id) {
      const previous = (await db.query(`SELECT response_data FROM camp_equipment_lot_receipts
        WHERE organization_id = $1 AND actor_id = $2 AND mutation_id = $3`,
      [organizationId, actorId, input.previous_mutation_id])).rows[0]?.response_data;
      if (previous?.id !== lotId || previous?.version !== input.expected_version) {
        throw new CampLotError('camp_lot_version_conflict', HTTP_CONFLICT);
      }
    }
    if (lot.version !== input.expected_version || !LOT_TRANSITIONS[lot.status].includes(input.status)) {throw new CampLotError('camp_lot_version_conflict', HTTP_CONFLICT);}
    const saved = (await db.query('UPDATE camp_equipment_lots SET status = $1, version = version + 1, updated_at = NOW() WHERE organization_id = $2 AND id = $3 RETURNING *', [input.status, organizationId, lotId])).rows[0];
    for (const task of roles) {
      // policy-allow role-names: derive progress for the equipment duty, not an authorization role
      const status = input.status === 'returned' || (input.status === 'loaded' && task.role !== 'return') ? 'done' : 'todo';
      if (task.status === status) {continue;}
      // eslint-disable-next-line no-await-in-loop -- keep task progress and lot progress indivisible
      const changed = (await db.query('UPDATE activity_tasks SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND id = $3 RETURNING *', [status, organizationId, task.id])).rows[0];
      // eslint-disable-next-line no-await-in-loop -- history belongs to the same transaction
      await recordStatus(db, organizationId, actorId, changed, task.status);
    }
    await recordLot(db, organizationId, actorId, saved, 'status', lot.status);
    const response = (await listLots(db, organizationId, lot.meeting_id)).find((row) => row.id === lotId);
    await db.query('UPDATE camp_equipment_lot_receipts SET response_data = $1 WHERE organization_id = $2 AND actor_id = $3 AND mutation_id = $4', [JSON.stringify(response), organizationId, actorId, input.mutation_id]);
    return response;
  });
}

module.exports = { CampLotError, TaskError, readRoles, listLots, activityPacks, options, saveLot, changeLotStatus };
