-- Performance Optimization Indexes
-- Created: 2025-12-19
-- Purpose: Add indexes to improve query performance for commonly accessed data

-- Indexes for attendance queries (used in parent dashboard)
CREATE INDEX IF NOT EXISTS idx_attendance_participant_org_date
ON attendance(participant_id, organization_id, date DESC);

-- Indexes for points queries (used in parent dashboard)
CREATE INDEX IF NOT EXISTS idx_points_participant_org
ON points(participant_id, organization_id);

-- Indexes for honors queries (used in parent dashboard)
CREATE INDEX IF NOT EXISTS idx_honors_participant_org
ON honors(participant_id, organization_id);

-- Indexes for badge_progress queries (used in parent dashboard)
CREATE INDEX IF NOT EXISTS idx_badge_progress_participant_org_status
ON badge_progress(participant_id, organization_id, status);

CREATE INDEX IF NOT EXISTS idx_badge_progress_participant_date
ON badge_progress(participant_id, date_obtention DESC);

-- Indexes for form_submissions queries (used in parent dashboard)
CREATE INDEX IF NOT EXISTS idx_form_submissions_participant_org
ON form_submissions(participant_id, organization_id);

-- Indexes for participant lookups
CREATE INDEX IF NOT EXISTS idx_participants_first_last_name
ON participants(first_name, last_name);

-- Indexes for participant_organizations (used in most queries)
CREATE INDEX IF NOT EXISTS idx_participant_orgs_participant_org
ON participant_organizations(participant_id, organization_id);

-- Indexes for participant_groups (used in group filtering)
CREATE INDEX IF NOT EXISTS idx_participant_groups_participant_org
ON participant_groups(participant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_participant_groups_group_org
ON participant_groups(group_id, organization_id);

-- Indexes for user_participants (used for parent access)
CREATE INDEX IF NOT EXISTS idx_user_participants_user_participant
ON user_participants(user_id, participant_id);

-- Indexes for groups
CREATE INDEX IF NOT EXISTS idx_groups_organization
ON groups(organization_id);

-- Index for reunion_preparations (used for next meeting queries)
CREATE INDEX IF NOT EXISTS idx_reunion_prep_org_date
ON reunion_preparations(organization_id, date)
WHERE date >= CURRENT_DATE;

-- Composite index for participants with their organizations and groups
CREATE INDEX IF NOT EXISTS idx_participants_composite
ON participants(id)
INCLUDE (first_name, last_name, date_naissance);

-- Analyze tables to update statistics after creating indexes
ANALYZE attendance;
ANALYZE points;
ANALYZE honors;
ANALYZE badge_progress;
ANALYZE form_submissions;
ANALYZE participants;
ANALYZE participant_organizations;
ANALYZE participant_groups;
ANALYZE user_participants;
ANALYZE groups;
ANALYZE reunion_preparations;

-- Note: These indexes significantly improve query performance for:
-- 1. Parent dashboard data retrieval (5x batched queries instead of N+1)
-- 2. Participant listing and filtering
-- 3. Group-based queries
-- 4. Date-based attendance and badge queries
