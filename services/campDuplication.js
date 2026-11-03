'use strict';
/**
 * Duplicating an earlier camp (#1256): its schedule, personal packing list,
 * equipment lots and shared tasks, with dates shifted to the new camp.
 *
 * Only what the team prepared is copied. Nothing that belongs to the earlier
 * stay or to a person is: no lot or task progress, history, reminder delivery,
 * publication to families, invitation, authorization, packing check or
 * volunteer signup. Every part chosen is copied in one transaction, or none is.
 *
 * @module services/campDuplication
 */
const { createHash, randomUUID } = require('node:crypto');
const transaction = require('../utils/transaction');
const { copyActivityMaterialItems } = require('./equipmentCatalog');
const { buildCampMaterialList } = require('./campMaterialList');
const { saveTaskInTransaction } = require('./activityTasks');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const MS_PER_DAY = 86400000;
const QUANTITY_PRECISION = 100;
const MAX_SOURCES = 20;

const RULES = require('../config/camp_duplication.json');

/** What can be copied, in the order it is copied: lots read the schedule's material. */
const { PARTS } = RULES;

/** The rights each part takes, beyond meetings.manage: the same rights its own screen requires. */
const { PART_PERMISSIONS } = RULES;

/** A refusal whose message is a translation key the SPA knows. */
class CampDuplicationError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, errors = undefined) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

const refuse = (key, status, errors) => {
  throw new CampDuplicationError(key, status, errors);
};

/**
 * @param {*} value - Requested parts
 * @returns {string[]|null} Known parts in copy order, or null when malformed
 */
function readParts(value) {
  if (!Array.isArray(value) || !value.length || value.length > PARTS.length
    || value.some((part) => !PARTS.includes(part)) || new Set(value).size !== value.length) {
    return null;
  }
  return PARTS.filter((part) => value.includes(part));
}

/**
 * @param {string[]} parts - Parts already read by readParts
 * @returns {string[]} Every permission the duplication requires
 */
function permissionsFor(parts) {
  return [RULES.BASE_PERMISSION, ...new Set(parts.flatMap((part) => PART_PERMISSIONS[part] || []))];
}

/**
 * The unit's camps with what each one holds. One query serves the source
 * list and the target's check, so both count the same things.
 *
 * @param {Object} db - Pool or transaction client
 * @param {number} organizationId - Authenticated unit
 * @param {number[]|null} ids - Only these camps, or every camp of the unit
 * @returns {Promise<Object[]>} Camps, latest first
 */
async function campsWithContent(db, organizationId, ids = null) {
  const result = await db.query(
    `SELECT m.id, m.theme, m.meeting_date::text AS meeting_date, m.is_cancelled, m.activity_id,
            GREATEST(
              1,
              COALESCE(act.activity_end_date, act.activity_start_date, act.activity_date, m.meeting_date)
                - m.meeting_date + 1
            )::integer AS span_days,
            ((SELECT COUNT(*) FROM year_plan_meeting_days d
               WHERE d.meeting_id = m.id AND d.organization_id = m.organization_id)
             + (SELECT COUNT(*) FROM year_plan_meeting_activities a
               WHERE a.meeting_id = m.id AND a.organization_id = m.organization_id AND a.day_offset > 0))::integer AS schedule,
            CASE WHEN EXISTS (SELECT 1 FROM personal_equipment_lists pl
                               WHERE pl.organization_id = m.organization_id AND pl.meeting_id = m.id)
                 THEN GREATEST(1, (SELECT COUNT(*) FROM personal_equipment_items pi
                                    WHERE pi.organization_id = m.organization_id AND pi.meeting_id = m.id AND pi.active))
                 ELSE 0 END::integer AS packing_list,
            (SELECT COUNT(*) FROM camp_equipment_lots l
              WHERE l.organization_id = m.organization_id AND l.meeting_id = m.id)::integer AS lots,
            (SELECT COUNT(*) FROM activity_tasks t
              WHERE t.organization_id = m.organization_id
                AND (t.meeting_id = m.id OR (m.activity_id IS NOT NULL AND t.activity_id = m.activity_id))
                AND NOT EXISTS (SELECT 1 FROM camp_equipment_lot_roles r
                                 WHERE r.organization_id = t.organization_id AND r.task_id = t.id))::integer AS tasks
       FROM year_plan_meetings m
       LEFT JOIN activities act
              ON act.id = m.activity_id
             AND act.organization_id = m.organization_id
             AND act.is_active = TRUE
      WHERE m.organization_id = $1 AND m.meeting_kind = 'camp'
        AND ($2::int[] IS NULL OR m.id = ANY($2::int[]))
      ORDER BY m.meeting_date DESC, m.id DESC`,
    [organizationId, ids]
  );
  return result.rows.map((row) => ({
    ...row,
    span_days: Number(row.span_days),
    counts: Object.fromEntries(PARTS.map((part) => [part, Number(row[part]) || 0])),
  }));
}

/** @returns {Object} The public summary of one camp */
function describe(camp) {
  return {
    id: camp.id,
    theme: camp.theme,
    meeting_date: camp.meeting_date,
    span_days: camp.span_days,
    is_cancelled: camp.is_cancelled === true,
    counts: camp.counts,
  };
}

/**
 * The camp being prepared, what it already holds, and the earlier camps it
 * could take something from.
 *
 * @param {Object} db - pg pool
 * @param {number} organizationId - Authenticated unit
 * @param {number} targetId - The camp being prepared
 * @returns {Promise<{target: Object, sources: Object[]}>}
 */
async function listDuplicationSources(db, organizationId, targetId) {
  const camps = await campsWithContent(db, organizationId);
  const target = camps.find((camp) => camp.id === targetId);
  if (!target) {
    refuse('camp_duplicate_not_found', HTTP_NOT_FOUND);
  }
  const sources = camps
    .filter((camp) => camp.id !== targetId && PARTS.some((part) => camp.counts[part] > 0))
    .slice(0, MAX_SOURCES)
    .map((camp) => ({ ...describe(camp), fits_schedule: camp.span_days <= target.span_days }));
  return { target: describe(target), sources };
}

/** @returns {number} Whole days from one ISO date to another */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * How many headings and later-day lines a camp schedule holds. Day zero is
 * the meeting preparation's, and never copied.
 */
async function scheduleItemCount(db, organizationId, meetingId) {
  const occupied = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM year_plan_meeting_days
         WHERE meeting_id = $1 AND organization_id = $2)
       +
       (SELECT COUNT(*) FROM year_plan_meeting_activities
         WHERE meeting_id = $1 AND organization_id = $2 AND day_offset > 0)
       AS item_count`,
    [meetingId, organizationId]
  );
  return Number(occupied.rows[0]?.item_count) || 0;
}

/**
 * Copy a camp's day headings and later-day lines, with the catalogue articles
 * still active, inside the caller's transaction.
 *
 * @returns {Promise<{days: number, activities: number}>}
 */
async function copySchedule(db, organizationId, targetMeetingId, sourceMeetingId) {
  const copiedDays = await db.query(
    `INSERT INTO year_plan_meeting_days
       (organization_id, meeting_id, day_offset, title, notes)
     SELECT organization_id, $1, day_offset, title, notes
       FROM year_plan_meeting_days
      WHERE meeting_id = $2 AND organization_id = $3
      ORDER BY day_offset
     RETURNING *`,
    [targetMeetingId, sourceMeetingId, organizationId]
  );
  // Ids are drawn first so each copy's catalogue articles follow it.
  const pairs = await db.query(
    `SELECT id AS source_id,
            nextval(pg_get_serial_sequence('public.year_plan_meeting_activities', 'id'))::integer AS target_id
       FROM year_plan_meeting_activities
      WHERE meeting_id = $1 AND organization_id = $2 AND day_offset > 0
      ORDER BY day_offset, sort_order, id`,
    [sourceMeetingId, organizationId]
  );
  const sourceIds = pairs.rows.map((pair) => pair.source_id);
  const targetIds = pairs.rows.map((pair) => pair.target_id);
  const copiedActivities = await db.query(
    `INSERT INTO year_plan_meeting_activities
       (id, organization_id, meeting_id, activity_library_id, name, description,
        duration_minutes, sort_order, objective_ids, series_id, series_occurrence,
        metadata, start_time, activity_type, responsable, material, is_default,
        badge_template_id, processed, day_offset)
     SELECT pair.target_id, a.organization_id, $1, a.activity_library_id, a.name, a.description,
            a.duration_minutes, a.sort_order, a.objective_ids, a.series_id, a.series_occurrence,
            a.metadata, a.start_time, a.activity_type, a.responsable, a.material, a.is_default,
            a.badge_template_id, a.processed, a.day_offset
       FROM unnest($2::int[], $3::int[]) AS pair(source_id, target_id)
       JOIN year_plan_meeting_activities a
         ON a.id = pair.source_id AND a.organization_id = $4
     RETURNING *`,
    [targetMeetingId, sourceIds, targetIds, organizationId]
  );
  await copyActivityMaterialItems(db, organizationId, sourceIds, targetIds);
  return { days: copiedDays.rows.length, activities: copiedActivities.rows.length };
}

/**
 * Copy the personal packing list as an unreviewed draft: families see nothing
 * until the team reviews and publishes it for this camp. Archived articles
 * keep their text but lose their catalogue link. Translations of the common
 * text come along, keyed by the same items.
 *
 * @returns {Promise<number>} Items copied
 */
async function copyPackingList(db, organizationId, actorId, targetMeetingId, sourceMeetingId) {
  const list = await db.query(
    `INSERT INTO personal_equipment_lists
       (organization_id, meeting_id, season, nights, stay_type, notes_fr, notes_en, published, reviewed_at, updated_by)
     SELECT organization_id, $3, season, nights, stay_type, notes_fr, notes_en, FALSE, NULL, $4
       FROM personal_equipment_lists
      WHERE organization_id = $1 AND meeting_id = $2
     RETURNING version`,
    [organizationId, sourceMeetingId, targetMeetingId, actorId]
  );
  if (!list.rows.length) {
    return 0;
  }
  const items = await db.query(
    `INSERT INTO personal_equipment_items
       (organization_id, meeting_id, item_key, label_fr, label_en, quantity, catalog_item_id, position, category)
     SELECT i.organization_id, $3, i.item_key, i.label_fr, i.label_en, i.quantity,
            CASE WHEN c.id IS NOT NULL AND c.archived_at IS NULL THEN i.catalog_item_id END,
            i.position, i.category
       FROM personal_equipment_items i
       LEFT JOIN equipment_catalog_items c
              ON c.id = i.catalog_item_id AND c.organization_id = i.organization_id
      WHERE i.organization_id = $1 AND i.meeting_id = $2 AND i.active
     RETURNING item_key`,
    [organizationId, sourceMeetingId, targetMeetingId]
  );
  await db.query(
    `INSERT INTO personal_equipment_translations (organization_id, meeting_id, version, language, content)
     SELECT t.organization_id, $3, $4, t.language, t.content
       FROM personal_equipment_translations t
       JOIN personal_equipment_lists l
         ON l.organization_id = t.organization_id AND l.meeting_id = t.meeting_id AND l.version = t.version
      WHERE t.organization_id = $1 AND t.meeting_id = $2`,
    [organizationId, sourceMeetingId, targetMeetingId, list.rows[0].version]
  );
  return items.rows.length;
}

/** The member a copied duty goes to: its holder while still active here, else the person duplicating. */
function assigneeFor(row, actorId) {
  return row.assignee_active === true ? row.assignee_id : actorId;
}

/**
 * Copy the equipment lots, each one to prepare, against the new camp's own
 * material list: an article it does not list is left out, and no lot takes
 * more than the list still has. A lot left with nothing is reported, not made.
 *
 * @returns {Promise<{copied: number, skipped: string[], reassigned: number}>}
 */
async function copyLots(db, organizationId, actorId, targetMeetingId, sourceMeetingId) {
  const lots = (await db.query(
    `SELECT l.id, l.name,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('key', i.item_key, 'quantity', i.quantity) ORDER BY i.item_key)
                        FROM camp_equipment_lot_items i
                       WHERE i.lot_id = l.id AND i.organization_id = l.organization_id), '[]'::jsonb) AS items,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('role', r.role, 'assignee_id', t.assignee_id,
                               'assignee_active', COALESCE(uo.status = 'active', FALSE)) ORDER BY r.role)
                        FROM camp_equipment_lot_roles r
                        JOIN activity_tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
                        LEFT JOIN user_organizations uo
                               ON uo.user_id = t.assignee_id AND uo.organization_id = t.organization_id
                       WHERE r.lot_id = l.id AND r.organization_id = l.organization_id), '[]'::jsonb) AS roles
       FROM camp_equipment_lots l
      WHERE l.organization_id = $1 AND l.meeting_id = $2
      ORDER BY l.name, l.id`,
    [organizationId, sourceMeetingId]
  )).rows;
  const outcome = { copied: 0, skipped: [], reassigned: 0 };
  if (!lots.length) {
    return outcome;
  }
  const list = await buildCampMaterialList(db, organizationId, targetMeetingId);
  const left = new Map((list?.items || [])
    .filter((item) => !item.archived)
    .map((item) => [item.key, { ...item, cents: Math.round(Number(item.quantity) * QUANTITY_PRECISION) }]));

  for (const lot of lots) {
    const items = lot.items.map((item) => {
      const entry = left.get(item.key);
      const cents = Math.min(Math.round(Number(item.quantity) * QUANTITY_PRECISION), entry?.cents || 0);
      if (!entry || cents <= 0) {
        return null;
      }
      entry.cents -= cents;
      return { key: item.key, name: entry.name, unit_of_measure: entry.unit_of_measure, quantity: cents / QUANTITY_PRECISION };
    }).filter(Boolean);
    // policy-allow role-names: equipment duties are domain roles, not authorization roles
    if (!items.length || !lot.roles.some((role) => role.role === 'prepare')) {
      outcome.skipped.push(lot.name);
      continue;
    }
    const hash = createHash('sha256')
      .update(JSON.stringify({ meetingId: targetMeetingId, name: lot.name, duplicatedFrom: lot.id, items }))
      .digest('hex');
    // eslint-disable-next-line no-await-in-loop -- one client, one atomic copy
    const saved = (await db.query(
      `INSERT INTO camp_equipment_lots (organization_id, meeting_id, name, creation_key, creation_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [organizationId, targetMeetingId, lot.name, randomUUID(), hash, actorId]
    )).rows[0];
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop -- one client, one atomic copy
      await db.query(
        `INSERT INTO camp_equipment_lot_items (lot_id, organization_id, item_key, name, unit_of_measure, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [saved.id, organizationId, item.key, item.name, item.unit_of_measure, item.quantity]
      );
    }
    for (const role of lot.roles) {
      if (role.assignee_active !== true) {
        outcome.reassigned += 1;
      }
      // eslint-disable-next-line no-await-in-loop -- the shared task validator locks the member in this transaction
      const task = await saveTaskInTransaction(db, organizationId, actorId, {
        title: lot.name, meeting_id: targetMeetingId, activity_id: null, assignee_id: assigneeFor(role, actorId),
        // policy-allow role-names: a return duty falls on the last camp date, as when a lot is saved
        due_date: role.role === 'return' ? list.camp.date_to : list.camp.date_from,
      });
      // eslint-disable-next-line no-await-in-loop -- the duty and its task commit together
      await db.query(
        'INSERT INTO camp_equipment_lot_roles (lot_id, organization_id, role, task_id) VALUES ($1, $2, $3, $4)',
        [saved.id, organizationId, role.role, task.id]
      );
    }
    // eslint-disable-next-line no-await-in-loop -- the lot's first history entry belongs to its creation
    await db.query(
      `INSERT INTO camp_equipment_lot_history (lot_id, organization_id, version, action, previous_status, status, changed_by)
       VALUES ($1, $2, $3, 'created', NULL, $4, $5)`,
      [saved.id, organizationId, saved.version, saved.status, actorId]
    );
    outcome.copied += 1;
  }
  return outcome;
}

/**
 * Copy the camp's own tasks, each one to do, due as many days after the new
 * camp's start as it was after the earlier one's. A material reminder keeps
 * its text and timing and waits to be sent again.
 *
 * @returns {Promise<{copied: number, reassigned: number}>}
 */
async function copyTasks(db, organizationId, actorId, target, source, offsetDays) {
  const tasks = (await db.query(
    `SELECT t.id, t.title, t.assignee_id, t.activity_id, (t.due_date + $3::integer)::text AS due_date,
            COALESCE(uo.status = 'active', FALSE) AS assignee_active,
            er.materials, er.lead_days, er.repeat_hours
       FROM activity_tasks t
       LEFT JOIN user_organizations uo
              ON uo.user_id = t.assignee_id AND uo.organization_id = t.organization_id
       LEFT JOIN task_equipment_reminders er
              ON er.task_id = t.id AND er.organization_id = t.organization_id
      WHERE t.organization_id = $1
        AND (t.meeting_id = $2 OR ($4::integer IS NOT NULL AND t.activity_id = $4))
        AND NOT EXISTS (SELECT 1 FROM camp_equipment_lot_roles r
                         WHERE r.organization_id = t.organization_id AND r.task_id = t.id)
      ORDER BY t.due_date, t.id`,
    [organizationId, source.id, offsetDays, source.activity_id || null]
  )).rows;
  const outcome = { copied: 0, reassigned: 0 };
  for (const task of tasks) {
    if (task.assignee_active !== true) {
      outcome.reassigned += 1;
    }
    const onActivity = Boolean(task.activity_id && target.activity_id);
    // eslint-disable-next-line no-await-in-loop -- the shared task validator locks the member in this transaction
    const saved = await saveTaskInTransaction(db, organizationId, actorId, {
      title: task.title,
      activity_id: onActivity ? target.activity_id : null,
      meeting_id: onActivity ? null : target.id,
      assignee_id: assigneeFor(task, actorId),
      due_date: task.due_date,
    });
    if (task.materials) {
      // eslint-disable-next-line no-await-in-loop -- the reminder commits with its task
      await db.query(
        `INSERT INTO task_equipment_reminders (organization_id, task_id, materials, lead_days, repeat_hours)
         VALUES ($1, $2, $3, $4, $5)`,
        [organizationId, saved.id, task.materials, task.lead_days, task.repeat_hours]
      );
    }
    outcome.copied += 1;
  }
  return outcome;
}

/**
 * Copy the chosen parts of an earlier camp into a camp being prepared.
 * Each chosen part must still be empty in the new camp, so nothing the team
 * already wrote is replaced or doubled.
 *
 * @param {Object} pool - pg pool
 * @param {{organizationId: number, actorId: string}} context - Authenticated unit and member
 * @param {number} targetId - The camp being prepared
 * @param {number} sourceId - The earlier camp
 * @param {string[]} parts - Parts read by readParts
 * @returns {Promise<Object>} What was copied, left out, or handed to the caller
 */
function duplicateCamp(pool, { organizationId, actorId }, targetId, sourceId, parts) {
  if (targetId === sourceId) {
    refuse('camp_duplicate_same_camp', HTTP_BAD_REQUEST);
  }
  return transaction(pool, async (db) => {
    // The camp is locked first, as a lot or packing-list write locks it, so two copies cannot both find it empty.
    const locked = await db.query(
      `SELECT id FROM year_plan_meetings
        WHERE organization_id = $1 AND id = $2 AND meeting_kind = 'camp' FOR UPDATE`,
      [organizationId, targetId]
    );
    const camps = locked.rows.length ? await campsWithContent(db, organizationId, [targetId, sourceId]) : [];
    const target = camps.find((camp) => camp.id === targetId);
    const source = camps.find((camp) => camp.id === sourceId);
    if (!target || !source) {
      refuse('camp_duplicate_not_found', HTTP_NOT_FOUND);
    }
    if (target.is_cancelled) {
      refuse('camp_duplicate_cancelled', HTTP_CONFLICT);
    }
    if (parts.includes('schedule') && target.span_days < source.span_days) {
      refuse('camp_duplicate_too_short', HTTP_CONFLICT, [{
        field: 'parts',
        part: 'schedule',
        dropped_days: Array.from({ length: source.span_days - target.span_days }, (_, index) => target.span_days + index),
      }]);
    }
    const filled = parts.filter((part) => target.counts[part] > 0);
    if (filled.length) {
      refuse('camp_duplicate_target_not_empty', HTTP_CONFLICT, filled.map((part) => ({ field: 'parts', part })));
    }

    const offsetDays = daysBetween(source.meeting_date, target.meeting_date);
    const result = {
      source_meeting_id: sourceId,
      target_meeting_id: targetId,
      offset_days: offsetDays,
      parts,
      copied: {},
      skipped_lots: [],
      reassigned_tasks: 0,
    };
    if (parts.includes('schedule')) {
      const copied = await copySchedule(db, organizationId, targetId, sourceId);
      result.copied.schedule_days = copied.days;
      result.copied.schedule_activities = copied.activities;
    }
    if (parts.includes('packing_list')) {
      result.copied.packing_items = await copyPackingList(db, organizationId, actorId, targetId, sourceId);
    }
    if (parts.includes('lots')) {
      const copied = await copyLots(db, organizationId, actorId, targetId, sourceId);
      result.copied.lots = copied.copied;
      result.skipped_lots = copied.skipped;
      result.reassigned_tasks += copied.reassigned;
    }
    if (parts.includes('tasks')) {
      const copied = await copyTasks(db, organizationId, actorId, target, source, offsetDays);
      result.copied.tasks = copied.copied;
      result.reassigned_tasks += copied.reassigned;
    }
    return result;
  });
}

module.exports = {
  CampDuplicationError,
  PARTS,
  PART_PERMISSIONS,
  readParts,
  permissionsFor,
  listDuplicationSources,
  duplicateCamp,
  scheduleItemCount,
  copySchedule,
};
