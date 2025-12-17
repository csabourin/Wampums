BEGIN;

-- This migration rolls back the incorrect assignment of program_section to groups
-- Program sections (age groups like Beavers, Cubs, Scouts) should be at the organization level,
-- not at the group level. Groups are subdivisions within an age group (e.g., Tannières).

-- Remove foreign key constraints
ALTER TABLE participant_groups
  DROP CONSTRAINT IF EXISTS participant_groups_group_section_fk;

ALTER TABLE participant_groups
  DROP CONSTRAINT IF EXISTS participant_groups_program_section_fk;

ALTER TABLE groups
  DROP CONSTRAINT IF EXISTS groups_org_section_unique;

ALTER TABLE groups
  DROP CONSTRAINT IF EXISTS groups_program_section_fk;

-- Remove program_section columns
ALTER TABLE participant_groups
  DROP COLUMN IF EXISTS program_section;

ALTER TABLE groups
  DROP COLUMN IF EXISTS program_section;

COMMIT;
