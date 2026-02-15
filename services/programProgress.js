/**
 * Program Progress Service
 *
 * Centralizes progression recording in program-specific tables, then mirrors
 * issuance/presentation in badge_progress with source_type/source_id linkage.
 */

const PROGRAM_TABLE_CONFIG = {
  oas_competency: {
    table: 'participant_oas_competency',
    sourceType: 'participant_oas_competency',
    participantColumn: 'participant_id',
    allowedFields: ['oas_competency_id', 'status', 'achieved_at', 'notes', 'metadata']
  },
  oas_stage_award: {
    table: 'participant_oas_stage_award',
    sourceType: 'participant_oas_stage_award',
    participantColumn: 'participant_id',
    allowedFields: ['oas_stage_id', 'status', 'achieved_at', 'notes', 'metadata']
  },
  credential: {
    table: 'participant_credentials',
    sourceType: 'participant_credentials',
    participantColumn: 'participant_id',
    allowedFields: ['credential_key', 'status', 'issued_at', 'expires_at', 'notes', 'metadata']
  },
  pab_review: {
    table: 'pab_reviews',
    sourceType: 'pab_reviews',
    participantColumn: 'participant_id',
    allowedFields: ['pab_plan_id', 'review_date', 'rating', 'notes', 'next_steps']
  },
  top_award_progress: {
    table: 'participant_top_award_progress',
    sourceType: 'participant_top_award_progress',
    participantColumn: 'participant_id',
    allowedFields: ['top_award_id', 'status', 'started_at', 'target_date', 'completed_at', 'progress_percent', 'notes']
  },
  top_award_service: {
    table: 'top_award_service_logs',
    sourceType: 'top_award_service_logs',
    participantColumn: 'participant_id',
    allowedFields: ['participant_top_award_progress_id', 'service_date', 'hours', 'description', 'status']
  },
  top_award_project: {
    table: 'top_award_projects',
    sourceType: 'top_award_projects',
    participantColumn: 'participant_id',
    allowedFields: ['participant_top_award_progress_id', 'title', 'description', 'status', 'started_at', 'completed_at']
  },
  top_award_review: {
    table: 'top_award_reviews',
    sourceType: 'top_award_reviews',
    participantColumn: 'participant_id',
    allowedFields: ['participant_top_award_progress_id', 'review_date', 'outcome', 'notes']
  }
};

/**
 * Resolve optional user id from request context.
 * @param {Object} reqUser Authenticated user payload.
 * @returns {string|null}
 */
function resolveUserId(reqUser) {
  return reqUser?.id || null;
}

/**
 * Record program progression and optionally mirror a badge issuance.
 *
 * @param {Object} deps Dependencies.
 * @param {import('pg').Pool} deps.pool Database pool.
 * @param {number} deps.organizationId Organization identifier.
 * @param {string} deps.programType Program type key from PROGRAM_TABLE_CONFIG.
 * @param {number} deps.participantId Participant identifier.
 * @param {Object} deps.programData Program-specific payload.
 * @param {Object|null} deps.badgeData Optional badge mirror payload.
 * @param {Object|null} deps.user Authenticated user payload.
 * @returns {Promise<{programRecord: Object, badgeProgress: Object|null, sourceType: string}>}
 */
async function recordProgression({ pool, organizationId, programType, participantId, programData = {}, badgeData = null, user = null }) {
  const config = PROGRAM_TABLE_CONFIG[programType];
  if (!config) {
    throw new Error('Unsupported program_type');
  }

  const actorUserId = resolveUserId(user);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const participantOrgCheck = await client.query(
      'SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2',
      [participantId, organizationId]
    );

    if (participantOrgCheck.rowCount === 0) {
      throw new Error('Participant not found in organization');
    }

    const insertFields = ['organization_id', config.participantColumn];
    const insertValues = [organizationId, participantId];

    for (const field of config.allowedFields) {
      if (Object.prototype.hasOwnProperty.call(programData, field)) {
        insertFields.push(field);
        insertValues.push(programData[field]);
      }
    }

    if (insertFields.length <= 2) {
      throw new Error('No valid program data provided');
    }

    if (insertFields.includes('awarded_by') === false && config.allowedFields.includes('awarded_by') === false && actorUserId) {
      if (await columnExists(client, config.table, 'awarded_by')) {
        insertFields.push('awarded_by');
        insertValues.push(actorUserId);
      }
    }

    if (insertFields.includes('verified_by') === false && config.allowedFields.includes('verified_by') === false && actorUserId) {
      if (await columnExists(client, config.table, 'verified_by')) {
        insertFields.push('verified_by');
        insertValues.push(actorUserId);
      }
    }

    if (insertFields.includes('reviewer_user_id') === false && config.allowedFields.includes('reviewer_user_id') === false && actorUserId) {
      if (await columnExists(client, config.table, 'reviewer_user_id')) {
        insertFields.push('reviewer_user_id');
        insertValues.push(actorUserId);
      }
    }

    if (insertFields.includes('created_by') === false && config.allowedFields.includes('created_by') === false && actorUserId) {
      if (await columnExists(client, config.table, 'created_by')) {
        insertFields.push('created_by');
        insertValues.push(actorUserId);
      }
    }

    const placeholders = insertValues.map((_, idx) => `$${idx + 1}`).join(', ');
    const programInsertResult = await client.query(
      `INSERT INTO ${config.table} (${insertFields.join(', ')}) VALUES (${placeholders}) RETURNING *`
    );

    const programRecord = programInsertResult.rows[0];
    let badgeProgress = null;

    if (badgeData?.badge_template_id) {
      badgeProgress = await insertBadgeProgressMirror({
        client,
        organizationId,
        participantId,
        sourceType: config.sourceType,
        sourceId: programRecord.id,
        badgeData
      });
    }

    await client.query('COMMIT');

    return {
      sourceType: config.sourceType,
      programRecord,
      badgeProgress
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return result.rowCount > 0;
}

async function insertBadgeProgressMirror({ client, organizationId, participantId, sourceType, sourceId, badgeData }) {
  const templateResult = await client.query(
    `SELECT id, name, section
       FROM badge_templates
      WHERE id = $1 AND organization_id = $2`,
    [badgeData.badge_template_id, organizationId]
  );

  if (templateResult.rowCount === 0) {
    throw new Error('Badge template not found');
  }

  const template = templateResult.rows[0];
  const participantSectionResult = await client.query(
    `SELECT COALESCE(g.section, 'general') AS section
       FROM participant_groups pg
       JOIN groups g ON g.id = pg.group_id
      WHERE pg.participant_id = $1 AND pg.organization_id = $2
      LIMIT 1`,
    [participantId, organizationId]
  );

  const participantSection = participantSectionResult.rows[0]?.section || 'general';
  const achievedDate = badgeData.date_obtention || new Date().toISOString().slice(0, 10);
  const status = badgeData.status === 'approved' ? 'approved' : 'pending';

  const result = await client.query(
    `INSERT INTO badge_progress
      (participant_id, organization_id, badge_template_id, territoire_chasse, section,
       objectif, description, fierte, raison, date_obtention, etoiles, status, source_type, source_id)
     VALUES
      ($1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      participantId,
      organizationId,
      template.id,
      template.name,
      template.section || participantSection,
      badgeData.objectif || null,
      badgeData.description || null,
      badgeData.fierte || false,
      badgeData.raison || null,
      achievedDate,
      Number.isInteger(parseInt(badgeData.etoiles || badgeData.level, 10)) ? parseInt(badgeData.etoiles || badgeData.level, 10) : 1,
      status,
      sourceType,
      sourceId
    ]
  );

  return result.rows[0];
}

module.exports = {
  PROGRAM_TABLE_CONFIG,
  recordProgression
};
