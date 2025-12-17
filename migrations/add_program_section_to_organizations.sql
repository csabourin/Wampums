BEGIN;

-- Add program_section (age group) to organizations table
-- This is the correct location for age group designation since one organization
-- represents one age group (e.g., "1st Cubs", "2nd Scouts")
-- Groups within an organization are subdivisions (e.g., Tannières, Patrouilles)

-- Ensure the organization_program_sections table exists (should already exist from previous migration)
CREATE TABLE IF NOT EXISTS organization_program_sections (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT organization_program_sections_pkey PRIMARY KEY (organization_id, section_key),
  CONSTRAINT organization_program_sections_key_not_empty CHECK (length(btrim(section_key)) > 0),
  CONSTRAINT organization_program_sections_label_not_empty CHECK (length(btrim(display_name)) > 0)
);

-- Seed default sections for all organizations if not already present
WITH default_sections AS (
  SELECT * FROM (
    VALUES
      ('general', 'General'),
      ('beavers', 'Beavers'),
      ('cubs', 'Cubs'),
      ('scouts', 'Scouts'),
      ('pioneers', 'Venturers'),
      ('rovers', 'Rovers')
  ) AS s(section_key, display_name)
)
INSERT INTO organization_program_sections (organization_id, section_key, display_name)
SELECT org.id, ds.section_key, ds.display_name
FROM organizations org
CROSS JOIN default_sections ds
ON CONFLICT (organization_id, section_key) DO NOTHING;

-- Ensure organization settings expose the available sections for clients
WITH default_sections AS (
  SELECT * FROM (
    VALUES
      ('general', 'General'),
      ('beavers', 'Beavers'),
      ('cubs', 'Cubs'),
      ('scouts', 'Scouts'),
      ('pioneers', 'Venturers'),
      ('rovers', 'Rovers')
  ) AS s(section_key, display_name)
),
section_payload AS (
  SELECT json_agg(json_build_object('key', section_key, 'label', display_name) ORDER BY section_key) AS value
  FROM default_sections
)
INSERT INTO organization_settings (organization_id, setting_key, setting_value)
SELECT org.id, 'program_sections', section_payload.value::text
FROM organizations org
CROSS JOIN section_payload
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings s
  WHERE s.organization_id = org.id AND s.setting_key = 'program_sections'
);

-- Add program_section to organizations table with default to 'general'
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS program_section TEXT DEFAULT 'general';

-- Set all existing organizations to 'general' if NULL
UPDATE organizations
SET program_section = 'general'
WHERE program_section IS NULL;

-- Make it NOT NULL
ALTER TABLE organizations
  ALTER COLUMN program_section SET NOT NULL;

-- Add foreign key constraint to ensure valid program section
ALTER TABLE organizations
  ADD CONSTRAINT organizations_program_section_fk
    FOREIGN KEY (id, program_section)
    REFERENCES organization_program_sections (organization_id, section_key)
    ON DELETE RESTRICT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_organizations_program_section
  ON organizations(program_section);

COMMIT;
