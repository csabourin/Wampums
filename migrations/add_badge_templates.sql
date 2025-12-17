-- Migration: Introduce badge templates with section-aware levels
-- Description: Adds badge_templates reference data, links badge_progress to templates,
-- enforces uniqueness by participant/template/level, and introduces section metadata on groups.

-- Create badge_templates catalog
CREATE TABLE IF NOT EXISTS badge_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  template_key VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  translation_key VARCHAR(255),
  section VARCHAR(255) NOT NULL DEFAULT 'general',
  level_count INTEGER NOT NULL DEFAULT 3,
  levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT badge_templates_org_key UNIQUE (organization_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_badge_templates_org_section
  ON badge_templates (organization_id, section);

-- Add section metadata to groups for section-aware badge selection
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS section VARCHAR(255);

UPDATE groups
SET section = COALESCE(section, 'general')
WHERE section IS NULL;

ALTER TABLE groups
  ALTER COLUMN section SET DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_groups_section
  ON groups (organization_id, section);

-- Link badge_progress entries to templates and section
ALTER TABLE badge_progress
  ADD COLUMN IF NOT EXISTS badge_template_id INTEGER REFERENCES badge_templates(id),
  ADD COLUMN IF NOT EXISTS section VARCHAR(255);

DO $$
DECLARE
  rec RECORD;
  template_id INTEGER;
  template_key TEXT;
  effective_org INTEGER;
  default_levels JSONB := jsonb_build_array(
    jsonb_build_object('level', 1, 'label_key', 'badge_level_1'),
    jsonb_build_object('level', 2, 'label_key', 'badge_level_2'),
    jsonb_build_object('level', 3, 'label_key', 'badge_level_3')
  );
BEGIN
  -- Ensure badge_progress rows have a section value
  UPDATE badge_progress
  SET section = COALESCE(section, 'general')
  WHERE section IS NULL;

  -- Create templates per organization/territory combination and backfill badge_progress
  FOR rec IN
    SELECT DISTINCT organization_id, territoire_chasse
    FROM badge_progress
    WHERE badge_template_id IS NULL
  LOOP
    effective_org := rec.organization_id;

    IF effective_org IS NULL THEN
      -- Derive organization from participant_organizations when missing
      SELECT po.organization_id
      INTO effective_org
      FROM badge_progress bp
      JOIN participant_organizations po ON bp.participant_id = po.participant_id
      WHERE bp.organization_id IS NULL AND bp.territoire_chasse = rec.territoire_chasse
      LIMIT 1;
    END IF;

    IF effective_org IS NULL THEN
      CONTINUE;
    END IF;

    template_key := lower(regexp_replace(COALESCE(rec.territoire_chasse, 'badge'), '[^a-z0-9]+', '_', 'g'));

    INSERT INTO badge_templates (organization_id, template_key, name, translation_key, section, level_count, levels)
    VALUES (
      effective_org,
      template_key,
      COALESCE(rec.territoire_chasse, 'Badge'),
      CONCAT('badge_template_', template_key),
      'general',
      3,
      default_levels
    )
    ON CONFLICT (organization_id, template_key) DO UPDATE
      SET name = EXCLUDED.name,
          translation_key = EXCLUDED.translation_key,
          updated_at = NOW()
    RETURNING id INTO template_id;

    UPDATE badge_progress
    SET badge_template_id = template_id,
        organization_id = effective_org,
        section = COALESCE(section, 'general')
    WHERE territoire_chasse IS NOT DISTINCT FROM rec.territoire_chasse
      AND (organization_id = rec.organization_id OR (organization_id IS NULL AND rec.organization_id IS NULL))
      AND badge_template_id IS NULL;
  END LOOP;
END $$;

-- Harden badge_progress constraints for template usage
ALTER TABLE badge_progress
  ALTER COLUMN badge_template_id SET NOT NULL,
  ALTER COLUMN section SET NOT NULL,
  ALTER COLUMN etoiles SET DEFAULT 1;

-- Replace the old uniqueness constraint based on territoire/etoiles with template/level
ALTER TABLE badge_progress DROP CONSTRAINT IF EXISTS unique_badge_progress;
DROP INDEX IF EXISTS idx_badge_progress_lookup;

ALTER TABLE badge_progress
  ADD CONSTRAINT unique_badge_progress_template UNIQUE (participant_id, badge_template_id, etoiles);

CREATE INDEX IF NOT EXISTS idx_badge_progress_template
  ON badge_progress (badge_template_id, participant_id);

CREATE INDEX IF NOT EXISTS idx_badge_progress_section
  ON badge_progress (section);
