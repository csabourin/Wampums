-- Migration: create versioned program catalog runtime tables
-- Purpose: support multiple pedagogies (not only OAS) using program/version scoped records.

CREATE TABLE IF NOT EXISTS program_catalog_skills (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  version TEXT NOT NULL,
  official_key TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_catalog_skills UNIQUE (program, version, official_key),
  CONSTRAINT fk_program_catalog_skills_version
    FOREIGN KEY (program, version)
    REFERENCES program_catalog_versions (program, version)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS program_catalog_stages (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  version TEXT NOT NULL,
  stage_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_catalog_stages UNIQUE (program, version, stage_no),
  CONSTRAINT fk_program_catalog_stages_version
    FOREIGN KEY (program, version)
    REFERENCES program_catalog_versions (program, version)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS program_catalog_competencies (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  version TEXT NOT NULL,
  code TEXT NOT NULL,
  official_key TEXT NOT NULL,
  stage_no INTEGER NOT NULL,
  text_en TEXT NOT NULL,
  text_fr TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_catalog_competencies UNIQUE (program, version, code),
  CONSTRAINT fk_program_catalog_competencies_version
    FOREIGN KEY (program, version)
    REFERENCES program_catalog_versions (program, version)
    ON DELETE CASCADE,
  CONSTRAINT fk_program_catalog_competencies_skill
    FOREIGN KEY (program, version, official_key)
    REFERENCES program_catalog_skills (program, version, official_key)
    ON DELETE RESTRICT,
  CONSTRAINT fk_program_catalog_competencies_stage
    FOREIGN KEY (program, version, stage_no)
    REFERENCES program_catalog_stages (program, version, stage_no)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS program_catalog_rules (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  version TEXT NOT NULL,
  rules_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_catalog_rules UNIQUE (program, version),
  CONSTRAINT fk_program_catalog_rules_version
    FOREIGN KEY (program, version)
    REFERENCES program_catalog_versions (program, version)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_program_catalog_skills_program_version
  ON program_catalog_skills (program, version);

CREATE INDEX IF NOT EXISTS idx_program_catalog_stages_program_version
  ON program_catalog_stages (program, version);

CREATE INDEX IF NOT EXISTS idx_program_catalog_competencies_program_version
  ON program_catalog_competencies (program, version);

CREATE INDEX IF NOT EXISTS idx_program_catalog_rules_program_version
  ON program_catalog_rules (program, version);
