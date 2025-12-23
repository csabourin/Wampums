-- Migration: Enhance Custom Forms with Version Tracking and Audit Trail
-- Date: 2025-12-23
-- Description: Adds form versioning, audit trail, and workflow management to custom forms

-- ============================================================================
-- PART 1: Enhance organization_form_formats table
-- ============================================================================

-- Add new columns to organization_form_formats
ALTER TABLE organization_form_formats
ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS instructions TEXT,
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'
  CHECK (status IN ('draft', 'published', 'archived')),
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP,
ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP,
ADD COLUMN IF NOT EXISTS max_submissions_per_participant INTEGER,
ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS current_version_id INTEGER;

-- Create index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_org_form_formats_status ON organization_form_formats(status);
CREATE INDEX IF NOT EXISTS idx_org_form_formats_category ON organization_form_formats(category);
CREATE INDEX IF NOT EXISTS idx_org_form_formats_org_type ON organization_form_formats(organization_id, form_type);

-- Add comment
COMMENT ON COLUMN organization_form_formats.display_name IS 'Human-readable name for the form';
COMMENT ON COLUMN organization_form_formats.status IS 'Form lifecycle: draft, published, archived';
COMMENT ON COLUMN organization_form_formats.current_version_id IS 'Points to the currently active version';

-- ============================================================================
-- PART 2: Create form_format_versions table for version tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_format_versions (
  id SERIAL PRIMARY KEY,
  form_format_id INTEGER NOT NULL REFERENCES organization_form_formats(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  form_structure JSONB NOT NULL,
  display_name VARCHAR(255),
  change_description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT false,

  -- Ensure unique version numbers per form
  CONSTRAINT unique_form_version UNIQUE (form_format_id, version_number)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_form_versions_format_id ON form_format_versions(form_format_id);
CREATE INDEX IF NOT EXISTS idx_form_versions_active ON form_format_versions(form_format_id, is_active);
CREATE INDEX IF NOT EXISTS idx_form_versions_created_at ON form_format_versions(created_at DESC);

-- Add comments
COMMENT ON TABLE form_format_versions IS 'Stores all versions of form formats for audit and rollback';
COMMENT ON COLUMN form_format_versions.is_active IS 'Only one version should be active per form at a time';
COMMENT ON COLUMN form_format_versions.version_number IS 'Sequential version number starting at 1';

-- ============================================================================
-- PART 3: Add foreign key constraint after both tables exist
-- ============================================================================

-- Add foreign key from organization_form_formats to form_format_versions
-- This creates a circular reference that needs to be nullable
ALTER TABLE organization_form_formats
DROP CONSTRAINT IF EXISTS fk_current_version;

ALTER TABLE organization_form_formats
ADD CONSTRAINT fk_current_version
FOREIGN KEY (current_version_id)
REFERENCES form_format_versions(id)
ON DELETE SET NULL;

-- ============================================================================
-- PART 4: Enhance form_submissions table
-- ============================================================================

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS form_version_id INTEGER REFERENCES form_format_versions(id),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'submitted'
  CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS review_notes TEXT,
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Update existing submissions to have submitted status and timestamp
UPDATE form_submissions
SET status = 'submitted', submitted_at = created_at
WHERE status IS NULL AND submitted_at IS NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_form_submissions_version ON form_submissions(form_version_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status);
CREATE INDEX IF NOT EXISTS idx_form_submissions_participant ON form_submissions(participant_id, form_type);
CREATE INDEX IF NOT EXISTS idx_form_submissions_org_type ON form_submissions(organization_id, form_type);

-- Add comments
COMMENT ON COLUMN form_submissions.form_version_id IS 'Links submission to specific form version used';
COMMENT ON COLUMN form_submissions.status IS 'Submission workflow status';
COMMENT ON COLUMN form_submissions.user_id IS 'User who submitted the form (already exists)';

-- ============================================================================
-- PART 5: Create form_submission_history table for audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_submission_history (
  id SERIAL PRIMARY KEY,
  form_submission_id INTEGER NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  submission_data JSONB NOT NULL,
  status VARCHAR(20),
  edited_by UUID REFERENCES users(id),
  edited_at TIMESTAMP DEFAULT NOW(),
  change_reason TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,

  -- Store what changed
  changes_summary JSONB
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_submission_history_submission_id ON form_submission_history(form_submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_history_edited_by ON form_submission_history(edited_by);
CREATE INDEX IF NOT EXISTS idx_submission_history_edited_at ON form_submission_history(edited_at DESC);

-- Add comments
COMMENT ON TABLE form_submission_history IS 'Audit trail for all changes to form submissions';
COMMENT ON COLUMN form_submission_history.changes_summary IS 'JSONB object tracking what fields changed';

-- ============================================================================
-- PART 6: Create form_permissions table for access control
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_permissions (
  id SERIAL PRIMARY KEY,
  form_format_id INTEGER NOT NULL REFERENCES organization_form_formats(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT false,
  can_submit BOOLEAN DEFAULT false,
  can_edit BOOLEAN DEFAULT false,
  can_approve BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure unique permission per form-role combination
  CONSTRAINT unique_form_role_permission UNIQUE (form_format_id, role_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_form_permissions_form ON form_permissions(form_format_id);
CREATE INDEX IF NOT EXISTS idx_form_permissions_role ON form_permissions(role_id);

-- Add comments
COMMENT ON TABLE form_permissions IS 'Role-based access control for forms';

-- ============================================================================
-- PART 7: Create trigger functions for automatic audit trail
-- ============================================================================

-- Function to automatically create audit trail on submission update
CREATE OR REPLACE FUNCTION create_form_submission_audit_trail()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create audit entry if data actually changed
  IF OLD.submission_data IS DISTINCT FROM NEW.submission_data
     OR OLD.status IS DISTINCT FROM NEW.status THEN

    INSERT INTO form_submission_history (
      form_submission_id,
      submission_data,
      status,
      edited_by,
      edited_at,
      changes_summary
    ) VALUES (
      OLD.id,
      OLD.submission_data,
      OLD.status,
      NEW.user_id,  -- Track who made the change
      NOW(),
      jsonb_build_object(
        'status_changed', OLD.status != NEW.status,
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on form_submissions
DROP TRIGGER IF EXISTS form_submission_audit_trigger ON form_submissions;
CREATE TRIGGER form_submission_audit_trigger
  BEFORE UPDATE ON form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION create_form_submission_audit_trail();

-- ============================================================================
-- PART 8: Create helper function to publish a form version
-- ============================================================================

CREATE OR REPLACE FUNCTION publish_form_version(p_version_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_form_format_id INTEGER;
  v_version_number INTEGER;
BEGIN
  -- Get the form_format_id for this version
  SELECT form_format_id, version_number INTO v_form_format_id, v_version_number
  FROM form_format_versions
  WHERE id = p_version_id;

  IF v_form_format_id IS NULL THEN
    RAISE EXCEPTION 'Version ID % not found', p_version_id;
  END IF;

  -- Deactivate all other versions for this form
  UPDATE form_format_versions
  SET is_active = false
  WHERE form_format_id = v_form_format_id AND id != p_version_id;

  -- Activate this version
  UPDATE form_format_versions
  SET is_active = true
  WHERE id = p_version_id;

  -- Update the form format to point to this version and set as published
  UPDATE organization_form_formats
  SET current_version_id = p_version_id,
      status = 'published',
      published_at = CASE WHEN published_at IS NULL THEN NOW() ELSE published_at END,
      updated_at = NOW()
  WHERE id = v_form_format_id;

END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 9: Create helper function to create new form version
-- ============================================================================

CREATE OR REPLACE FUNCTION create_new_form_version(
  p_form_format_id INTEGER,
  p_form_structure JSONB,
  p_display_name VARCHAR,
  p_change_description TEXT,
  p_created_by UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_next_version INTEGER;
  v_new_version_id INTEGER;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM form_format_versions
  WHERE form_format_id = p_form_format_id;

  -- Insert new version
  INSERT INTO form_format_versions (
    form_format_id,
    version_number,
    form_structure,
    display_name,
    change_description,
    created_by,
    is_active
  ) VALUES (
    p_form_format_id,
    v_next_version,
    p_form_structure,
    p_display_name,
    p_change_description,
    p_created_by,
    false  -- New versions start as inactive
  ) RETURNING id INTO v_new_version_id;

  RETURN v_new_version_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 10: Data migration - Create initial versions for existing forms
-- ============================================================================

-- Create version 1 for all existing forms that don't have versions
INSERT INTO form_format_versions (
  form_format_id,
  version_number,
  form_structure,
  display_name,
  is_active,
  created_at,
  change_description
)
SELECT
  id,
  1,
  form_structure,
  form_type,  -- Use form_type as initial display name
  true,  -- Set as active
  created_at,
  'Initial version migrated from existing form'
FROM organization_form_formats
WHERE id NOT IN (SELECT DISTINCT form_format_id FROM form_format_versions)
ON CONFLICT (form_format_id, version_number) DO NOTHING;

-- Update organization_form_formats to point to their version 1
UPDATE organization_form_formats off
SET current_version_id = ffv.id,
    status = CASE
      WHEN off.display_type = 'public' THEN 'published'
      ELSE 'draft'
    END
FROM form_format_versions ffv
WHERE ffv.form_format_id = off.id
  AND ffv.version_number = 1
  AND off.current_version_id IS NULL;

-- ============================================================================
-- PART 11: Create views for easier querying
-- ============================================================================

-- View to get active forms with their current version
CREATE OR REPLACE VIEW v_active_forms AS
SELECT
  off.id,
  off.organization_id,
  off.form_type,
  off.display_name,
  off.description,
  off.category,
  off.status,
  off.display_order,
  ffv.id as version_id,
  ffv.version_number,
  ffv.form_structure,
  ffv.created_at as version_created_at,
  off.created_at,
  off.updated_at
FROM organization_form_formats off
LEFT JOIN form_format_versions ffv ON off.current_version_id = ffv.id
WHERE off.status = 'published';

-- View to get submission statistics
CREATE OR REPLACE VIEW v_form_submission_stats AS
SELECT
  fs.organization_id,
  fs.form_type,
  COUNT(*) as total_submissions,
  COUNT(DISTINCT fs.participant_id) as unique_participants,
  COUNT(CASE WHEN fs.status = 'draft' THEN 1 END) as drafts,
  COUNT(CASE WHEN fs.status = 'submitted' THEN 1 END) as submitted,
  COUNT(CASE WHEN fs.status = 'approved' THEN 1 END) as approved,
  COUNT(CASE WHEN fs.status = 'rejected' THEN 1 END) as rejected,
  MAX(fs.created_at) as last_submission_at
FROM form_submissions fs
GROUP BY fs.organization_id, fs.form_type;

-- ============================================================================
-- Completion message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Custom forms system now includes:';
  RAISE NOTICE '  ✓ Form version tracking';
  RAISE NOTICE '  ✓ Submission audit trail';
  RAISE NOTICE '  ✓ Workflow status management';
  RAISE NOTICE '  ✓ Role-based permissions';
  RAISE NOTICE '  ✓ Automatic triggers for audit logging';
  RAISE NOTICE '  ✓ Helper functions for version management';
  RAISE NOTICE '=================================================================';
END $$;
