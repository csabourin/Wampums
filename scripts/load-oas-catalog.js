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
 * Optional compatibility projection for deployments that still use OAS legacy tables.
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

  console.log('ℹ️ Legacy oas_* compatibility sync executed.');
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
