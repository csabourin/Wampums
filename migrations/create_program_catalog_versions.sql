-- Migration: create program_catalog_versions table for versioned catalog loads
-- Tracks applied catalog versions and checksum/source metadata for reproducibility.

CREATE TABLE IF NOT EXISTS program_catalog_versions (
  id BIGSERIAL PRIMARY KEY,
  program TEXT NOT NULL,
  version TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT NOT NULL,
  source_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_catalog_versions_program_version UNIQUE (program, version)
);

CREATE INDEX IF NOT EXISTS idx_program_catalog_versions_program
  ON program_catalog_versions (program);

CREATE INDEX IF NOT EXISTS idx_program_catalog_versions_applied_at
  ON program_catalog_versions (applied_at DESC);
