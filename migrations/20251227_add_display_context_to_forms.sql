-- Migration: Add Display Context to Forms
-- Description: Adds display_context column to control where forms appear in the UI
-- Author: Claude
-- Date: 2025-12-27
--
-- This migration adds the ability to specify in which UI contexts a form should be displayed:
-- - 'participant': Forms that appear in participant-specific views (parent dashboard, participant profiles)
-- - 'organization': Organization-wide forms that appear in admin/settings areas only
-- - 'admin_panel': Forms that appear in general admin interfaces
-- - 'public': Forms available for public registration
-- - 'form_builder': Always visible in form builder (all forms have this by default)
--
-- Forms can have multiple contexts to appear in different areas of the application.

-- ==========================================
-- UP MIGRATION
-- ==========================================

-- Add display_context column as TEXT array
ALTER TABLE organization_form_formats
ADD COLUMN IF NOT EXISTS display_context TEXT[] DEFAULT ARRAY['participant'];

-- Add comment for documentation
COMMENT ON COLUMN organization_form_formats.display_context IS
'UI contexts where this form should be displayed. Values: participant, organization, admin_panel, public, form_builder';

-- ==========================================
-- Set appropriate contexts for existing forms
-- ==========================================

-- Organization-wide forms (admin/settings only)
-- These should NOT appear in participant views
UPDATE organization_form_formats
SET display_context = ARRAY['organization', 'admin_panel', 'form_builder']
WHERE form_type = 'organization_info';

-- Participant-specific forms (parent dashboard, participant profiles)
-- These are forms that relate to individual participants
UPDATE organization_form_formats
SET display_context = ARRAY['participant', 'admin_panel', 'form_builder']
WHERE form_type IN (
  'risk_acceptance',
  'fiche_sante',
  'participant_registration',
  'parent_guardian'
);

-- Badge-related forms (both participant and admin contexts)
UPDATE organization_form_formats
SET display_context = ARRAY['participant', 'admin_panel', 'form_builder']
WHERE form_type LIKE '%badge%';

-- Public forms (registration, signup)
-- These might be accessible without login in the future
UPDATE organization_form_formats
SET display_context = ARRAY['public', 'participant', 'form_builder']
WHERE form_type IN ('participant_registration', 'parent_guardian');

-- Default: Any forms not specifically categorized above
-- Keep as participant-accessible with form_builder access
UPDATE organization_form_formats
SET display_context = ARRAY['participant', 'admin_panel', 'form_builder']
WHERE display_context IS NULL OR display_context = ARRAY[]::TEXT[];

-- ==========================================
-- Create helper function to check if form has context
-- ==========================================
CREATE OR REPLACE FUNCTION form_has_context(
  p_form_id INTEGER,
  p_context TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_contexts TEXT[];
BEGIN
  SELECT display_context INTO v_contexts
  FROM organization_form_formats
  WHERE id = p_form_id;

  RETURN p_context = ANY(v_contexts);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION form_has_context IS
'Check if a form has a specific display context';

-- ==========================================
-- Create index for performance
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_form_formats_display_context
ON organization_form_formats USING GIN (display_context);

-- ==========================================
-- Add constraint to ensure valid contexts
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_display_contexts'
  ) THEN
    ALTER TABLE organization_form_formats
    ADD CONSTRAINT valid_display_contexts
    CHECK (
      display_context <@ ARRAY[
        'participant',
        'organization',
        'admin_panel',
        'public',
        'form_builder'
      ]::TEXT[]
    );
  END IF;
END $$;

-- ==========================================
-- DOWN MIGRATION (for rollback)
-- ==========================================
-- Note: To rollback this migration, run:
-- DROP INDEX IF EXISTS idx_form_formats_display_context;
-- DROP FUNCTION IF EXISTS form_has_context(INTEGER, TEXT);
-- ALTER TABLE organization_form_formats DROP CONSTRAINT IF EXISTS valid_display_contexts;
-- ALTER TABLE organization_form_formats DROP COLUMN IF EXISTS display_context;
