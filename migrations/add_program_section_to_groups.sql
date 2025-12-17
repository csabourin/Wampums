BEGIN;

-- Store available program sections per organization
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

-- Seed default sections for all organizations (including templates)
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

-- Add program section to groups with default to the base section
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS program_section TEXT DEFAULT 'general';

UPDATE groups
SET program_section = 'general'
WHERE program_section IS NULL;

ALTER TABLE groups
  ALTER COLUMN program_section SET NOT NULL;

ALTER TABLE groups
  ADD CONSTRAINT groups_program_section_fk
    FOREIGN KEY (organization_id, program_section)
    REFERENCES organization_program_sections (organization_id, section_key)
    ON DELETE RESTRICT;

ALTER TABLE groups
  ADD CONSTRAINT groups_org_section_unique UNIQUE (id, organization_id, program_section);

-- Add program section to participant-group assignments and align with group data
ALTER TABLE participant_groups
  ADD COLUMN IF NOT EXISTS program_section TEXT;

UPDATE participant_groups pg
SET program_section = g.program_section
FROM groups g
WHERE pg.group_id = g.id
  AND pg.program_section IS NULL;

UPDATE participant_groups
SET program_section = 'general'
WHERE program_section IS NULL;

ALTER TABLE participant_groups
  ALTER COLUMN program_section SET NOT NULL;

ALTER TABLE participant_groups
  ADD CONSTRAINT participant_groups_program_section_fk
    FOREIGN KEY (organization_id, program_section)
    REFERENCES organization_program_sections (organization_id, section_key)
    ON DELETE RESTRICT;

ALTER TABLE participant_groups
  ADD CONSTRAINT participant_groups_group_section_fk
    FOREIGN KEY (group_id, organization_id, program_section)
    REFERENCES groups (id, organization_id, program_section)
    ON DELETE CASCADE;

COMMIT;
