-- Migration: Add image support to badge_templates
-- Description: Adds image column to badge_templates table and populates existing badges with images
-- Author: Claude
-- Date: 2025-12-27

-- ==========================================
-- UP MIGRATION
-- ==========================================

-- Add image column to badge_templates
ALTER TABLE badge_templates
ADD COLUMN IF NOT EXISTS image VARCHAR(255);

-- Update existing badge templates with images based on their names
-- These map to the traditional "territoires" from the old system

-- Kaa (Débrouillard comme Kaa)
UPDATE badge_templates
SET image = 'kaa.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%kaa%'
    OR LOWER(template_key) LIKE '%kaa%'
    OR LOWER(translation_key) LIKE '%kaa%'
  );

-- Baloo (Vrai comme Baloo)
UPDATE badge_templates
SET image = 'baloo.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%baloo%'
    OR LOWER(template_key) LIKE '%baloo%'
    OR LOWER(translation_key) LIKE '%baloo%'
  );

-- Rikki Tikki Tavi (Respectueux comme Rikki Tikki Tavi)
UPDATE badge_templates
SET image = 'rikki.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%rikki%'
    OR LOWER(template_key) LIKE '%rikki%'
    OR LOWER(translation_key) LIKE '%rikki%'
  );

-- Bagheera (Dynamique comme Bagheera)
UPDATE badge_templates
SET image = 'bagheera.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%bagheera%'
    OR LOWER(template_key) LIKE '%bagheera%'
    OR LOWER(translation_key) LIKE '%bagheera%'
  );

-- Ferao (Heureux comme Ferao)
UPDATE badge_templates
SET image = 'ferao.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%ferao%'
    OR LOWER(template_key) LIKE '%ferao%'
    OR LOWER(translation_key) LIKE '%ferao%'
  );

-- Frère Gris (Solidaire comme Frère Gris)
UPDATE badge_templates
SET image = 'frereGris.webp'
WHERE image IS NULL
  AND (
    LOWER(name) LIKE '%frere%gris%'
    OR LOWER(name) LIKE '%frèregris%'
    OR LOWER(template_key) LIKE '%frere%gris%'
    OR LOWER(translation_key) LIKE '%frere%gris%'
  );

-- Add comment to the column for documentation
COMMENT ON COLUMN badge_templates.image IS 'Filename of badge image (stored in /images/ directory). Example: kaa.webp';

-- ==========================================
-- DOWN MIGRATION (for rollback)
-- ==========================================
-- Note: To rollback this migration, run:
-- ALTER TABLE badge_templates DROP COLUMN IF EXISTS image;
