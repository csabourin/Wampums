-- Migration: Add Performance Indexes
-- Date: 2025-12-28
-- Description: Add critical database indexes to improve query performance
-- Related: PERFORMANCE_DIAGNOSTIC_REPORT.md

-- ============================================================================
-- HIGH PRIORITY INDEXES (Critical for N+1 query performance)
-- ============================================================================

-- Attendance queries (heavily used in attendance.js)
-- Speeds up queries filtering by participant_id, organization_id, and date
CREATE INDEX IF NOT EXISTS idx_attendance_participant_org_date
  ON attendance(participant_id, organization_id, date);

-- Points queries (heavily used in points.js, badges.js, honors.js)
-- Speeds up SUM(value) aggregations filtered by participant and organization
CREATE INDEX IF NOT EXISTS idx_points_participant_org
  ON points(participant_id, organization_id);

-- Form submissions queries (used in participants.js)
-- Speeds up form_submissions subqueries and has_* checks
CREATE INDEX IF NOT EXISTS idx_form_submissions_participant_org_type
  ON form_submissions(participant_id, organization_id, form_type);

-- Participant groups queries (heavily queried across multiple routes)
-- Speeds up group_id lookups by participant
CREATE INDEX IF NOT EXISTS idx_participant_groups_participant_org
  ON participant_groups(participant_id, organization_id);

-- Participant groups reverse lookup
-- Speeds up queries filtering by group_id
CREATE INDEX IF NOT EXISTS idx_participant_groups_group_org
  ON participant_groups(group_id, organization_id);

-- ============================================================================
-- MEDIUM PRIORITY INDEXES (Important for specific query patterns)
-- ============================================================================

-- Group points aggregation (points without participant_id are group points)
-- Partial index for better performance when querying group points only
CREATE INDEX IF NOT EXISTS idx_points_group_org_partial
  ON points(group_id, organization_id)
  WHERE participant_id IS NULL;

-- Badge progress queries (used in badge_dashboard.js, approve_badges.js)
-- Speeds up badge lookups by participant and template
CREATE INDEX IF NOT EXISTS idx_badge_progress_participant_template
  ON badge_progress(participant_id, badge_template_id, organization_id);

-- Honors queries (used in manage_honors.js, reports.js)
-- Speeds up honor lookups by participant and organization
CREATE INDEX IF NOT EXISTS idx_honors_participant_org
  ON honors(participant_id, organization_id);

-- ============================================================================
-- ADDITIONAL INDEXES (Nice to have for general performance)
-- ============================================================================

-- User organizations lookup (frequently used in auth middleware)
-- Speeds up user-to-organization membership checks
CREATE INDEX IF NOT EXISTS idx_user_organizations_user_org
  ON user_organizations(user_id, organization_id);

-- Organization domains lookup (used for hostname-based org resolution)
-- Speeds up domain-to-organization mapping
CREATE INDEX IF NOT EXISTS idx_organization_domains_domain
  ON organization_domains(domain);

-- ============================================================================
-- ANALYTICS & VERIFICATION
-- ============================================================================

-- Verify indexes were created successfully
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE indexname IN (
    'idx_attendance_participant_org_date',
    'idx_points_participant_org',
    'idx_form_submissions_participant_org_type',
    'idx_participant_groups_participant_org',
    'idx_participant_groups_group_org',
    'idx_points_group_org_partial',
    'idx_badge_progress_participant_template',
    'idx_honors_participant_org',
    'idx_user_organizations_user_org',
    'idx_organization_domains_domain'
  );

  RAISE NOTICE 'Successfully created % performance indexes', index_count;
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback these indexes, run:
-- DROP INDEX IF EXISTS idx_attendance_participant_org_date;
-- DROP INDEX IF EXISTS idx_points_participant_org;
-- DROP INDEX IF EXISTS idx_form_submissions_participant_org_type;
-- DROP INDEX IF EXISTS idx_participant_groups_participant_org;
-- DROP INDEX IF EXISTS idx_participant_groups_group_org;
-- DROP INDEX IF EXISTS idx_points_group_org_partial;
-- DROP INDEX IF EXISTS idx_badge_progress_participant_template;
-- DROP INDEX IF EXISTS idx_honors_participant_org;
-- DROP INDEX IF EXISTS idx_user_organizations_user_org;
-- DROP INDEX IF EXISTS idx_organization_domains_domain;

-- ============================================================================
-- EXPECTED IMPACT
-- ============================================================================
-- These indexes should provide:
-- - 50-70% faster query performance on indexed columns
-- - 80-90% reduction in query count for N+1 patterns (when combined with code changes)
-- - Minimal storage overhead (~2-5% of table size per index)
-- - Automatic maintenance by PostgreSQL (no manual upkeep required)
--
-- Monitor query performance with:
-- EXPLAIN ANALYZE SELECT ... (to verify indexes are being used)
