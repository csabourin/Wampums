/**
 * Program Progress Routes
 *
 * Records progression in program tables first, then mirrors badge presentation
 * into badge_progress via source_type/source_id.
 */

const express = require('express');
const router = express.Router();

const {
  authenticate,
  blockDemoRoles,
  requirePermission,
  getOrganizationId,
  getUserDataScope
} = require('../middleware/auth');
const { asyncHandler, success, error: errorResponse } = require('../middleware/response');
const { recordProgression, PROGRAM_TABLE_CONFIG } = require('../services/programProgress');

const STREAM_SOURCES = [
  { key: 'badge_presentation', table: 'badge_progress', sourceType: 'badge_progress' },
  { key: 'oas_competency', table: 'participant_oas_competency', sourceType: 'participant_oas_competency' },
  { key: 'oas_stage_award', table: 'participant_oas_stage_award', sourceType: 'participant_oas_stage_award' },
  { key: 'credential', table: 'participant_credentials', sourceType: 'participant_credentials' },
  { key: 'pab_plan', table: 'pab_plans', sourceType: 'pab_plans' },
  { key: 'pab_review', table: 'pab_reviews', sourceType: 'pab_reviews' },
  { key: 'top_award_progress', table: 'participant_top_award_progress', sourceType: 'participant_top_award_progress' },
  { key: 'top_award_service', table: 'top_award_service_logs', sourceType: 'top_award_service_logs' },
  { key: 'top_award_project', table: 'top_award_projects', sourceType: 'top_award_projects' },
  { key: 'top_award_review', table: 'top_award_reviews', sourceType: 'top_award_reviews' }
];

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function pickFirstAvailable(columns, candidates) {
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function fetchSourceRows({ client, source, organizationId, participantId, userId, dataScope, limit }) {
  const columns = await getTableColumns(client, source.table);
  if (!columns.has('organization_id') || !columns.has('participant_id') || !columns.has('id')) {
    return [];
  }

  const statusColumn = pickFirstAvailable(columns, ['status', 'decision', 'outcome', 'review_type']);
  const dateColumn = pickFirstAvailable(columns, [
    'occurred_at',
    'approved_at',
    'awarded_at',
    'completed_at',
    'reviewed_at',
    'service_date',
    'demonstrated_at',
    'achieved_at',
    'issued_at',
    'created_at',
    'date_obtention'
  ]);
  const titleColumn = pickFirstAvailable(columns, [
    'title',
    'name',
    'credential_key',
    'description',
    'notes',
    'territoire_chasse',
    'objective',
    'objectif'
  ]);

  const selectParts = ['id', 'participant_id', 'organization_id'];
  if (statusColumn) selectParts.push(`${statusColumn} AS status`);
  if (dateColumn) selectParts.push(`${dateColumn} AS event_at`);
  if (titleColumn) selectParts.push(`${titleColumn} AS title`);

  const params = [organizationId];
  let where = 'organization_id = $1';

  if (participantId) {
    params.push(participantId);
    where += ` AND participant_id = $${params.length}`;
  }

  if (dataScope === 'linked') {
    params.push(userId);
    where += ` AND EXISTS (
      SELECT 1 FROM user_participants up
       WHERE up.participant_id = ${source.table}.participant_id
         AND up.user_id = $${params.length}
    )`;
  }

  params.push(limit);

  const result = await client.query(
    `SELECT ${selectParts.join(', ')}
       FROM ${source.table}
      WHERE ${where}
      ORDER BY ${dateColumn || 'id'} DESC
      LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => ({
    source_key: source.key,
    source_type: source.sourceType,
    source_table: source.table,
    source_id: row.id,
    participant_id: row.participant_id,
    status: row.status || 'recorded',
    title: row.title || source.key,
    event_at: row.event_at || null
  }));
}

module.exports = (pool, logger) => {
  /**
   * GET /api/v1/program-progress/stream
   *
   * Returns a unified progression stream for dashboard use.
   * Parents (linked scope) only see participants linked to their account.
   */
  router.get('/stream', authenticate, requirePermission('participants.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const dataScope = await getUserDataScope(req, pool);
    const userId = req.user?.id;
    const participantId = req.query.participant_id ? parseInt(req.query.participant_id, 10) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 250, 500);

    if (req.query.participant_id && (!participantId || participantId <= 0)) {
      return errorResponse(res, 'participant_id must be a positive integer', 400);
    }

    const client = await pool.connect();
    try {
      const streamRows = [];

      for (const source of STREAM_SOURCES) {
        const rows = await fetchSourceRows({
          client,
          source,
          organizationId,
          participantId,
          userId,
          dataScope,
          limit
        });
        streamRows.push(...rows);
      }

      const participantRows = await client.query(
        `SELECT p.id, p.first_name, p.last_name
           FROM participants p
           JOIN participant_organizations po ON po.participant_id = p.id
          WHERE po.organization_id = $1
            ${dataScope === 'linked' ? 'AND EXISTS (SELECT 1 FROM user_participants up WHERE up.participant_id = p.id AND up.user_id = $2)' : ''}
          ORDER BY p.first_name, p.last_name`,
        dataScope === 'linked' ? [organizationId, userId] : [organizationId]
      );

      const participants = participantRows.rows;
      const participantMap = new Map(participants.map((row) => [row.id, row]));
      const items = streamRows
        .filter((row) => participantMap.has(row.participant_id))
        .map((row) => {
          const participant = participantMap.get(row.participant_id);
          return {
            ...row,
            participant_name: `${participant.first_name} ${participant.last_name}`
          };
        })
        .sort((a, b) => {
          const firstDate = a.event_at ? new Date(a.event_at).getTime() : 0;
          const secondDate = b.event_at ? new Date(b.event_at).getTime() : 0;
          return secondDate - firstDate;
        })
        .slice(0, limit);

      const summary = items.reduce((acc, item) => {
        acc.total += 1;
        acc.by_source[item.source_key] = (acc.by_source[item.source_key] || 0) + 1;
        return acc;
      }, { total: 0, by_source: {} });

      return success(res, { items, participants, summary });
    } finally {
      client.release();
    }
  }));

  /**
   * POST /api/v1/program-progress/award
   *
   * Body:
   * - program_type (required): one of PROGRAM_TABLE_CONFIG keys
   * - participant_id (required)
   * - program_data (required): table-specific payload
   * - badge_data (optional): mirrored insert into badge_progress
   */
  router.post('/award', authenticate, blockDemoRoles, requirePermission('badges.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const programType = req.body.program_type;
    const participantId = parseInt(req.body.participant_id, 10);
    const programData = req.body.program_data || {};
    const badgeData = req.body.badge_data || null;

    if (!programType || !PROGRAM_TABLE_CONFIG[programType]) {
      return errorResponse(res, 'program_type is required and must be supported', 400);
    }

    if (!Number.isInteger(participantId) || participantId <= 0) {
      return errorResponse(res, 'participant_id must be a valid integer', 400);
    }

    if (!programData || typeof programData !== 'object' || Array.isArray(programData)) {
      return errorResponse(res, 'program_data must be an object', 400);
    }

    try {
      const result = await recordProgression({
        pool,
        organizationId,
        programType,
        participantId,
        programData,
        badgeData,
        user: req.user
      });

      return success(res, result, 'Program progression recorded', 201);
    } catch (err) {
      if (err.message === 'Participant not found in organization') {
        return errorResponse(res, err.message, 404);
      }
      if (err.message === 'Unsupported program_type' || err.message === 'No valid program data provided' || err.message === 'Badge template not found') {
        return errorResponse(res, err.message, 400);
      }

      logger.error('Failed to record program progression', {
        organizationId,
        participantId,
        programType,
        error: err.message
      });

      return errorResponse(res, 'Failed to record program progression', 500);
    }
  }));

  return router;
};
