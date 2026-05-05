-- Migration: Create Yearly Meeting Planner tables
-- Description: Adds tables for year plans, periods, objectives, activity library,
--              meeting activities, objective achievements, distribution rules, and reminders.

-- =============================================================================
-- 1. YEAR PLANS
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plans (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  default_location TEXT,
  recurrence_pattern VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK (recurrence_pattern IN ('weekly', 'biweekly')),
  blackout_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  anchors JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_year_plans_org ON year_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_year_plans_dates ON year_plans(organization_id, start_date, end_date);

-- =============================================================================
-- 2. PERIODS
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_periods (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year_plan_id INTEGER NOT NULL REFERENCES year_plans(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_year_plan_periods_plan ON year_plan_periods(year_plan_id);
CREATE INDEX IF NOT EXISTS idx_year_plan_periods_org ON year_plan_periods(organization_id);

-- =============================================================================
-- 3. OBJECTIVES
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_objectives (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year_plan_id INTEGER NOT NULL REFERENCES year_plans(id) ON DELETE CASCADE,
  period_id INTEGER REFERENCES year_plan_periods(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES year_plan_objectives(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  scope VARCHAR(20) NOT NULL DEFAULT 'unit' CHECK (scope IN ('unit', 'participant')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_year_plan_objectives_plan ON year_plan_objectives(year_plan_id);
CREATE INDEX IF NOT EXISTS idx_year_plan_objectives_period ON year_plan_objectives(period_id);
CREATE INDEX IF NOT EXISTS idx_year_plan_objectives_parent ON year_plan_objectives(parent_id);

-- =============================================================================
-- 4. ACTIVITY LIBRARY
-- =============================================================================
CREATE TABLE IF NOT EXISTS activity_library (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_duration_min INTEGER,
  estimated_duration_max INTEGER,
  material TEXT,
  objective_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  avg_rating NUMERIC(3,2),
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_activity_library_org ON activity_library(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_library_category ON activity_library(organization_id, category);

-- =============================================================================
-- 5. YEAR PLAN MEETINGS (links generated meetings to the plan)
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_meetings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year_plan_id INTEGER NOT NULL REFERENCES year_plans(id) ON DELETE CASCADE,
  period_id INTEGER REFERENCES year_plan_periods(id) ON DELETE SET NULL,
  meeting_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  duration_minutes INTEGER,
  location TEXT,
  theme VARCHAR(255),
  notes TEXT,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  anchor_id VARCHAR(100),
  reunion_preparation_id INTEGER REFERENCES reunion_preparations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, year_plan_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_year_plan_meetings_plan ON year_plan_meetings(year_plan_id);
CREATE INDEX IF NOT EXISTS idx_year_plan_meetings_date ON year_plan_meetings(organization_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_year_plan_meetings_period ON year_plan_meetings(period_id);

-- =============================================================================
-- 6. MEETING ACTIVITIES (instances of activities placed in meetings)
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_meeting_activities (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES year_plan_meetings(id) ON DELETE CASCADE,
  activity_library_id INTEGER REFERENCES activity_library(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  objective_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  series_id VARCHAR(100),
  series_occurrence INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ypm_activities_meeting ON year_plan_meeting_activities(meeting_id);
CREATE INDEX IF NOT EXISTS idx_ypm_activities_series ON year_plan_meeting_activities(series_id);

-- =============================================================================
-- 7. OBJECTIVE ACHIEVEMENTS (tracks participant progress on objectives)
-- =============================================================================
CREATE TABLE IF NOT EXISTS objective_achievements (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  objective_id INTEGER NOT NULL REFERENCES year_plan_objectives(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES year_plan_meetings(id) ON DELETE SET NULL,
  achieved_date DATE NOT NULL,
  attribution_source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (attribution_source IN ('auto', 'manual')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, objective_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_obj_achievements_obj ON objective_achievements(objective_id);
CREATE INDEX IF NOT EXISTS idx_obj_achievements_participant ON objective_achievements(participant_id);
CREATE INDEX IF NOT EXISTS idx_obj_achievements_meeting ON objective_achievements(meeting_id);

-- =============================================================================
-- 8. DISTRIBUTION RULES (for recurring activity placement)
-- =============================================================================
CREATE TABLE IF NOT EXISTS activity_distribution_rules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year_plan_id INTEGER NOT NULL REFERENCES year_plans(id) ON DELETE CASCADE,
  activity_library_id INTEGER REFERENCES activity_library(id) ON DELETE SET NULL,
  activity_name VARCHAR(255) NOT NULL,
  distribution_scope VARCHAR(20) NOT NULL DEFAULT 'period' CHECK (distribution_scope IN ('year', 'period', 'month')),
  placement_rule VARCHAR(30) NOT NULL DEFAULT 'near_end' CHECK (placement_rule IN ('near_start', 'near_end', 'evenly_spaced', 'manual')),
  occurrences_per_scope INTEGER NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dist_rules_plan ON activity_distribution_rules(year_plan_id);

-- =============================================================================
-- 9. MEETING REMINDERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS year_plan_reminders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES year_plan_meetings(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp', 'google')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  custom_message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_yp_reminders_meeting ON year_plan_reminders(meeting_id);
CREATE INDEX IF NOT EXISTS idx_yp_reminders_status ON year_plan_reminders(status, scheduled_at);

-- =============================================================================
-- 10. GRANT MEETING PERMISSIONS TO ROLES
-- =============================================================================

-- Grant meetings.view + meetings.manage to unitadmin, district, leader roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('unitadmin', 'district', 'leader')
  AND p.permission_key IN ('meetings.view', 'meetings.manage')
ON CONFLICT DO NOTHING;
