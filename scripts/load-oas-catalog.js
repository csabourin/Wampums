#!/usr/bin/env node
/**
 * Load a versioned program catalog into PostgreSQL.
 *
 * Usage examples:
 *   node scripts/load-oas-catalog.js --program oas --version v1
 *   node scripts/load-oas-catalog.js --program oas --version v1 --validate-only
 *
 * Requirements:
 *   - DATABASE_URL must be set unless --validate-only is used
 *   - Catalog files must live in catalog/<program>/<version>/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const REQUIRED_FILES = [
  'skills.json',
  'stages.json',
  'competencies.en.json',
  'competencies.fr.json',
  'program-rules.json'
];

function parseArgs(argv) {
  const args = {
    program: 'oas',
    version: 'v1',
    validateOnly: false,
    sourceRoot: 'catalog'
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--validate-only') {
      args.validateOnly = true;
    } else if (token === '--program' && argv[i + 1]) {
      args.program = argv[i + 1];
      i += 1;
    } else if (token === '--version' && argv[i + 1]) {
      args.version = argv[i + 1];
      i += 1;
    } else if (token === '--source-root' && argv[i + 1]) {
      args.sourceRoot = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensureString(value, fieldName, context) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}: expected non-empty string for "${fieldName}"`);
  }
}

function ensureInteger(value, fieldName, context) {
  if (!Number.isInteger(value)) {
    throw new Error(`${context}: expected integer for "${fieldName}"`);
  }
}

function ensureBoolean(value, fieldName, context) {
  if (typeof value !== 'boolean') {
    throw new Error(`${context}: expected boolean for "${fieldName}"`);
  }
}

/**
 * Validate catalog JSON schema and cross-file consistency.
 * @param {object} catalog - Parsed catalog.
 * @param {string} expectedProgram - Program argument passed to the loader.
 * @param {string} expectedVersion - Version argument passed to the loader.
 */
function validateCatalogShape(catalog, expectedProgram, expectedVersion) {
  if (!Array.isArray(catalog.skills) || catalog.skills.length === 0) {
    throw new Error('skills.json must be a non-empty array');
  }
  if (!Array.isArray(catalog.stages) || catalog.stages.length === 0) {
    throw new Error('stages.json must be a non-empty array');
  }
  if (!Array.isArray(catalog.competenciesEn) || !Array.isArray(catalog.competenciesFr)) {
    throw new Error('competencies.en.json and competencies.fr.json must both be arrays');
  }

  const skillKeys = new Set();
  for (const [idx, skill] of catalog.skills.entries()) {
    const context = `skills[${idx}]`;
    ensureString(skill.official_key, 'official_key', context);
    ensureString(skill.name, 'name', context);
    ensureInteger(skill.display_order, 'display_order', context);
    ensureBoolean(skill.is_active, 'is_active', context);

    if (skillKeys.has(skill.official_key)) {
      throw new Error(`${context}: duplicate official_key "${skill.official_key}"`);
    }
    skillKeys.add(skill.official_key);
  }

  const stageNos = new Set();
  for (const [idx, stage] of catalog.stages.entries()) {
    const context = `stages[${idx}]`;
    ensureInteger(stage.stage_no, 'stage_no', context);
    ensureString(stage.name, 'name', context);
    ensureString(stage.description, 'description', context);
    ensureInteger(stage.display_order, 'display_order', context);
    ensureBoolean(stage.is_active, 'is_active', context);

    if (stageNos.has(stage.stage_no)) {
      throw new Error(`${context}: duplicate stage_no "${stage.stage_no}"`);
    }
    stageNos.add(stage.stage_no);
  }

  const enByCode = new Map();
  const frByCode = new Map();

  for (const [idx, competency] of catalog.competenciesEn.entries()) {
    const context = `competencies.en[${idx}]`;
    ensureString(competency.code, 'code', context);
    ensureString(competency.official_key, 'official_key', context);
    ensureInteger(competency.stage_no, 'stage_no', context);
    ensureString(competency.text, 'text', context);
    ensureInteger(competency.display_order, 'display_order', context);
    ensureBoolean(competency.is_active, 'is_active', context);

    if (!skillKeys.has(competency.official_key)) {
      throw new Error(`${context}: unknown official_key "${competency.official_key}"`);
    }
    if (!stageNos.has(competency.stage_no)) {
      throw new Error(`${context}: unknown stage_no "${competency.stage_no}"`);
    }
    if (enByCode.has(competency.code)) {
      throw new Error(`${context}: duplicate code "${competency.code}" in English file`);
    }
    enByCode.set(competency.code, competency);
  }

  for (const [idx, competency] of catalog.competenciesFr.entries()) {
    const context = `competencies.fr[${idx}]`;
    ensureString(competency.code, 'code', context);
    ensureString(competency.official_key, 'official_key', context);
    ensureInteger(competency.stage_no, 'stage_no', context);
    ensureString(competency.text, 'text', context);
    ensureInteger(competency.display_order, 'display_order', context);
    ensureBoolean(competency.is_active, 'is_active', context);

    if (frByCode.has(competency.code)) {
      throw new Error(`${context}: duplicate code "${competency.code}" in French file`);
    }
    frByCode.set(competency.code, competency);
  }

  for (const code of enByCode.keys()) {
    if (!frByCode.has(code)) {
      throw new Error(`Bilingual completeness error: competency code "${code}" missing in competencies.fr.json`);
    }
  }
  for (const code of frByCode.keys()) {
    if (!enByCode.has(code)) {
      throw new Error(`Bilingual completeness error: competency code "${code}" missing in competencies.en.json`);
    }
  }

  for (const [code, enEntry] of enByCode.entries()) {
    const frEntry = frByCode.get(code);
    if (enEntry.official_key !== frEntry.official_key) {
      throw new Error(`Immutable key mismatch for code "${code}": official_key differs between EN and FR`);
    }
    if (enEntry.stage_no !== frEntry.stage_no) {
      throw new Error(`Immutable key mismatch for code "${code}": stage_no differs between EN and FR`);
    }
  }

  if (!catalog.programRules || typeof catalog.programRules !== 'object') {
    throw new Error('program-rules.json must be an object');
  }
  ensureString(catalog.programRules.program, 'program', 'program-rules');
  ensureString(catalog.programRules.version, 'version', 'program-rules');
  if (!catalog.programRules.rules || typeof catalog.programRules.rules !== 'object') {
    throw new Error('program-rules.rules must be an object');
  }

  if (catalog.programRules.program !== expectedProgram) {
    throw new Error(
      `program-rules.json program mismatch: expected "${expectedProgram}", got "${catalog.programRules.program}"`
    );
  }
  if (catalog.programRules.version !== expectedVersion) {
    throw new Error(
      `program-rules.json version mismatch: expected "${expectedVersion}", got "${catalog.programRules.version}"`
    );
  }
}

function calculateChecksum(files) {
  const hash = crypto.createHash('sha256');
  for (const filePath of files.sort()) {
    hash.update(filePath);
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest('hex');
}

async function legacyTableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS table_name', [tableName]);
  return Boolean(result.rows[0]?.table_name);
}

/**
 * Read a table's column names from the public schema.
 * @param {object} client - pg client
 * @param {string} tableName - table name in public schema
 * @returns {Promise<Set<string>>} lowercase column names
 */
async function getTableColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

/**
 * Compute missing required columns for a table.
 * @param {Set<string>} actualColumns - columns detected in DB table
 * @param {string[]} requiredColumns - required compatibility columns
 * @returns {string[]} missing columns
 */
function getMissingColumns(actualColumns, requiredColumns) {
  return requiredColumns.filter((columnName) => !actualColumns.has(columnName));
}

/**
 * Ensure catalog runtime tables exist so catalog:load works on fresh databases.
 * This complements SQL migrations and keeps loader idempotent.
 * @param {object} client - pg client
 */
async function ensureCatalogRuntimeTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS program_catalog_versions (
      id BIGSERIAL PRIMARY KEY,
      program VARCHAR(50) NOT NULL,
      version VARCHAR(50) NOT NULL,
      applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL,
      source_path TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_program_catalog_versions_program_version UNIQUE (program, version)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS program_catalog_skills (
      id BIGSERIAL PRIMARY KEY,
      program VARCHAR(50) NOT NULL,
      version VARCHAR(50) NOT NULL,
      official_key VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      display_order INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_program_catalog_skills UNIQUE (program, version, official_key),
      CONSTRAINT fk_program_catalog_skills_version
        FOREIGN KEY (program, version)
        REFERENCES program_catalog_versions (program, version)
        ON DELETE CASCADE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS program_catalog_stages (
      id BIGSERIAL PRIMARY KEY,
      program VARCHAR(50) NOT NULL,
      version VARCHAR(50) NOT NULL,
      stage_no INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_program_catalog_stages UNIQUE (program, version, stage_no),
      CONSTRAINT fk_program_catalog_stages_version
        FOREIGN KEY (program, version)
        REFERENCES program_catalog_versions (program, version)
        ON DELETE CASCADE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS program_catalog_competencies (
      id BIGSERIAL PRIMARY KEY,
      program VARCHAR(50) NOT NULL,
      version VARCHAR(50) NOT NULL,
      code VARCHAR(50) NOT NULL,
      official_key VARCHAR(100) NOT NULL,
      stage_no INTEGER NOT NULL,
      text_en TEXT NOT NULL,
      text_fr TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_program_catalog_competencies UNIQUE (program, version, code),
      CONSTRAINT fk_program_catalog_competencies_version
        FOREIGN KEY (program, version)
        REFERENCES program_catalog_versions (program, version)
        ON DELETE CASCADE,
      CONSTRAINT fk_program_catalog_competencies_skill
        FOREIGN KEY (program, version, official_key)
        REFERENCES program_catalog_skills (program, version, official_key)
        ON DELETE CASCADE,
      CONSTRAINT fk_program_catalog_competencies_stage
        FOREIGN KEY (program, version, stage_no)
        REFERENCES program_catalog_stages (program, version, stage_no)
        ON DELETE CASCADE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS program_catalog_rules (
      id BIGSERIAL PRIMARY KEY,
      program VARCHAR(50) NOT NULL,
      version VARCHAR(50) NOT NULL,
      rules_json JSONB NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_program_catalog_rules UNIQUE (program, version),
      CONSTRAINT fk_program_catalog_rules_version
        FOREIGN KEY (program, version)
        REFERENCES program_catalog_versions (program, version)
        ON DELETE CASCADE
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_versions_program ON program_catalog_versions (program)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_versions_applied_at ON program_catalog_versions (applied_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_skills_program_version ON program_catalog_skills (program, version)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_stages_program_version ON program_catalog_stages (program, version)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_competencies_program_version ON program_catalog_competencies (program, version)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_program_catalog_rules_program_version ON program_catalog_rules (program, version)');
}

/**
 * Sync catalog into legacy OAS tables that already use catalog-style columns.
 * @param {object} client - pg client
 * @param {object} catalog - parsed catalog
 */
async function syncCatalogCompatibleLegacyTables(client, catalog) {
  for (const skill of catalog.skills) {
    await client.query(
      `INSERT INTO oas_skills (official_key, name, display_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (official_key)
       DO UPDATE SET
         name = EXCLUDED.name,
         display_order = EXCLUDED.display_order,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [skill.official_key, skill.name, skill.display_order, skill.is_active]
    );
  }

  for (const stage of catalog.stages) {
    await client.query(
      `INSERT INTO oas_stages (stage_no, name, description, display_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (stage_no)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         display_order = EXCLUDED.display_order,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [stage.stage_no, stage.name, stage.description, stage.display_order, stage.is_active]
    );
  }

  const frByCode = new Map(catalog.competenciesFr.map((item) => [item.code, item]));
  for (const enComp of catalog.competenciesEn) {
    const frComp = frByCode.get(enComp.code);
    await client.query(
      `INSERT INTO oas_competencies (
        code,
        official_key,
        stage_no,
        text_en,
        text_fr,
        display_order,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (code)
      DO UPDATE SET
        official_key = EXCLUDED.official_key,
        stage_no = EXCLUDED.stage_no,
        text_en = EXCLUDED.text_en,
        text_fr = EXCLUDED.text_fr,
        display_order = EXCLUDED.display_order,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()`,
      [
        enComp.code,
        enComp.official_key,
        enComp.stage_no,
        enComp.text,
        frComp.text,
        enComp.display_order,
        enComp.is_active
      ]
    );
  }

  console.log('ℹ️ Legacy oas_* compatibility sync executed for catalog-compatible schema.');
}

/**
 * Sync catalog into tenant-scoped OAS tables introduced by program progress migrations.
 * @param {object} client - pg client
 * @param {object} catalog - parsed catalog
 */
async function syncTenantScopedLegacyTables(client, catalog) {
  const organizationsResult = await client.query('SELECT id FROM organizations');
  if (organizationsResult.rowCount === 0) {
    console.log('ℹ️ Skipping tenant-scoped legacy sync because no organizations were found.');
    return;
  }

  const skillIdsByOrgAndKey = new Map();
  const stageIdsByOrgAndStageNo = new Map();

  for (const org of organizationsResult.rows) {
    for (const skill of catalog.skills) {
      const skillResult = await client.query(
        `INSERT INTO oas_skills (organization_id, code, name, description, is_active, updated_at)
         VALUES ($1, $2, $3, NULL, $4, NOW())
         ON CONFLICT (organization_id, code)
         DO UPDATE SET
           name = EXCLUDED.name,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()
         RETURNING id`,
        [org.id, skill.official_key, skill.name, skill.is_active]
      );

      skillIdsByOrgAndKey.set(`${org.id}:${skill.official_key}`, skillResult.rows[0].id);
    }

    for (const skill of catalog.skills) {
      const skillId = skillIdsByOrgAndKey.get(`${org.id}:${skill.official_key}`);
      for (const stage of catalog.stages) {
        const stageResult = await client.query(
          `INSERT INTO oas_stages (organization_id, oas_skill_id, stage_order, name, description, is_active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (organization_id, oas_skill_id, stage_order)
           DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             is_active = EXCLUDED.is_active,
             updated_at = NOW()
           RETURNING id`,
          [org.id, skillId, stage.stage_no, stage.name, stage.description, stage.is_active]
        );

        stageIdsByOrgAndStageNo.set(`${org.id}:${skill.official_key}:${stage.stage_no}`, stageResult.rows[0].id);
      }
    }

    for (const competency of catalog.competenciesEn) {
      const mappedSkillId = skillIdsByOrgAndKey.get(`${org.id}:${competency.official_key}`);
      const mappedStageId = stageIdsByOrgAndStageNo.get(`${org.id}:${competency.official_key}:${competency.stage_no}`) || null;

      await client.query(
        `INSERT INTO oas_competencies (
          organization_id,
          oas_skill_id,
          oas_stage_id,
          code,
          name,
          description,
          competency_order,
          is_required,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6, TRUE, $7, NOW())
        ON CONFLICT (organization_id, code)
        DO UPDATE SET
          oas_skill_id = EXCLUDED.oas_skill_id,
          oas_stage_id = EXCLUDED.oas_stage_id,
          name = EXCLUDED.name,
          competency_order = EXCLUDED.competency_order,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()`,
        [
          org.id,
          mappedSkillId,
          mappedStageId,
          competency.code,
          competency.text,
          competency.display_order,
          competency.is_active
        ]
      );
    }
  }

  console.log('ℹ️ Legacy oas_* compatibility sync executed for tenant-scoped schema.');
}

/**
 * Sync runtime catalog into legacy OAS tables when compatible schemas are present.
 * Supports both catalog-style and tenant-scoped legacy table variants.
 * @param {object} client - pg client
 * @param {object} catalog - parsed catalog
 */
async function syncLegacyOasTables(client, catalog) {
  const hasSkills = await legacyTableExists(client, 'oas_skills');
  const hasStages = await legacyTableExists(client, 'oas_stages');
  const hasCompetencies = await legacyTableExists(client, 'oas_competencies');

  if (!(hasSkills && hasStages && hasCompetencies)) {
    return;
  }

  const [skillsColumns, stagesColumns, competenciesColumns] = await Promise.all([
    getTableColumns(client, 'oas_skills'),
    getTableColumns(client, 'oas_stages'),
    getTableColumns(client, 'oas_competencies')
  ]);

  const catalogCompatibleMissing = {
    oas_skills: getMissingColumns(skillsColumns, ['official_key', 'display_order', 'is_active']),
    oas_stages: getMissingColumns(stagesColumns, ['stage_no', 'display_order', 'is_active']),
    oas_competencies: getMissingColumns(competenciesColumns, ['official_key', 'stage_no', 'text_en', 'text_fr', 'display_order', 'is_active'])
  };

  const isCatalogCompatible = Object.values(catalogCompatibleMissing).every((columns) => columns.length === 0);
  if (isCatalogCompatible) {
    await syncCatalogCompatibleLegacyTables(client, catalog);
    return;
  }

  const tenantScopedMissing = {
    oas_skills: getMissingColumns(skillsColumns, ['organization_id', 'code', 'name', 'is_active']),
    oas_stages: getMissingColumns(stagesColumns, ['organization_id', 'oas_skill_id', 'stage_order', 'name', 'description', 'is_active']),
    oas_competencies: getMissingColumns(competenciesColumns, ['organization_id', 'oas_skill_id', 'oas_stage_id', 'code', 'name', 'competency_order', 'is_active'])
  };

  const isTenantScopedCompatible = Object.values(tenantScopedMissing).every((columns) => columns.length === 0);
  if (isTenantScopedCompatible) {
    await syncTenantScopedLegacyTables(client, catalog);
    return;
  }

  const detail = {
    oas_skills: [...new Set([...catalogCompatibleMissing.oas_skills, ...tenantScopedMissing.oas_skills])],
    oas_stages: [...new Set([...catalogCompatibleMissing.oas_stages, ...tenantScopedMissing.oas_stages])],
    oas_competencies: [...new Set([...catalogCompatibleMissing.oas_competencies, ...tenantScopedMissing.oas_competencies])]
  };

  const detailText = Object.entries(detail)
    .filter(([, columns]) => columns.length > 0)
    .map(([tableName, columns]) => `${tableName}: ${columns.join(', ')}`)
    .join(' | ');

  console.log(`⚠️ Skipping legacy oas_* compatibility sync because schema is not supported (${detailText}).`);
}

async function loadCatalog() {
  const args = parseArgs(process.argv);
  const versionPath = path.join(args.sourceRoot, args.program, args.version);

  const missingFiles = REQUIRED_FILES.filter((filename) => !fs.existsSync(path.join(versionPath, filename)));
  if (missingFiles.length > 0) {
    throw new Error(`Missing catalog files in ${versionPath}: ${missingFiles.join(', ')}`);
  }

  const filePaths = REQUIRED_FILES.map((filename) => path.join(versionPath, filename));
  const catalog = {
    skills: readJsonFile(path.join(versionPath, 'skills.json')),
    stages: readJsonFile(path.join(versionPath, 'stages.json')),
    competenciesEn: readJsonFile(path.join(versionPath, 'competencies.en.json')),
    competenciesFr: readJsonFile(path.join(versionPath, 'competencies.fr.json')),
    programRules: readJsonFile(path.join(versionPath, 'program-rules.json'))
  };

  validateCatalogShape(catalog, args.program, args.version);
  const checksum = calculateChecksum(filePaths);

  console.log(`✅ Catalog schema validation passed for ${versionPath}`);
  console.log(`ℹ️ Computed checksum: ${checksum}`);

  if (args.validateOnly) {
    console.log('✅ Validation-only mode complete (no database writes).');
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless --validate-only is used');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureCatalogRuntimeTables(client);

    await client.query(
      `INSERT INTO program_catalog_versions (program, version, applied_at, checksum, source_path)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (program, version)
       DO UPDATE SET
         applied_at = EXCLUDED.applied_at,
         checksum = EXCLUDED.checksum,
         source_path = EXCLUDED.source_path,
         updated_at = NOW()`,
      [args.program, args.version, checksum, versionPath]
    );

    await client.query('DELETE FROM program_catalog_competencies WHERE program = $1 AND version = $2', [
      args.program,
      args.version
    ]);
    await client.query('DELETE FROM program_catalog_skills WHERE program = $1 AND version = $2', [
      args.program,
      args.version
    ]);
    await client.query('DELETE FROM program_catalog_stages WHERE program = $1 AND version = $2', [
      args.program,
      args.version
    ]);

    for (const skill of catalog.skills) {
      await client.query(
        `INSERT INTO program_catalog_skills (
          program,
          version,
          official_key,
          name,
          display_order,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [args.program, args.version, skill.official_key, skill.name, skill.display_order, skill.is_active]
      );
    }

    for (const stage of catalog.stages) {
      await client.query(
        `INSERT INTO program_catalog_stages (
          program,
          version,
          stage_no,
          name,
          description,
          display_order,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          args.program,
          args.version,
          stage.stage_no,
          stage.name,
          stage.description,
          stage.display_order,
          stage.is_active
        ]
      );
    }

    const frByCode = new Map(catalog.competenciesFr.map((item) => [item.code, item]));

    for (const enComp of catalog.competenciesEn) {
      const frComp = frByCode.get(enComp.code);
      await client.query(
        `INSERT INTO program_catalog_competencies (
          program,
          version,
          code,
          official_key,
          stage_no,
          text_en,
          text_fr,
          display_order,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          args.program,
          args.version,
          enComp.code,
          enComp.official_key,
          enComp.stage_no,
          enComp.text,
          frComp.text,
          enComp.display_order,
          enComp.is_active
        ]
      );
    }

    await client.query(
      `INSERT INTO program_catalog_rules (program, version, rules_json, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (program, version)
       DO UPDATE SET
         rules_json = EXCLUDED.rules_json,
         updated_at = NOW()`,
      [args.program, args.version, JSON.stringify(catalog.programRules.rules)]
    );

    if (args.program === 'oas') {
      await syncLegacyOasTables(client, catalog);
    }

    await client.query('COMMIT');
    console.log(`✅ Catalog ${args.program}/${args.version} loaded successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

loadCatalog().catch((error) => {
  console.error(`❌ Catalog load failed: ${error.message}`);
  process.exit(1);
});
