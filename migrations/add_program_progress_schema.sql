-- Program Progress schema bundle
-- Adds OAS/PAB/Top Award progression tables and shared audit artifacts.

-- ============================================================
-- 0) Extend badge_progress to support source tracing
-- ============================================================
ALTER TABLE IF EXISTS public.badge_progress
  ADD COLUMN IF NOT EXISTS source_type varchar(100),
  ADD COLUMN IF NOT EXISTS source_id bigint;

CREATE INDEX IF NOT EXISTS idx_badge_progress_source
  ON public.badge_progress (organization_id, source_type, source_id);

-- ============================================================
-- 1) OAS catalog/progress tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oas_skills (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code varchar(100),
  name varchar(255) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.oas_stages (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  oas_skill_id bigint NOT NULL REFERENCES public.oas_skills(id) ON DELETE CASCADE,
  stage_order integer NOT NULL DEFAULT 1,
  name varchar(255) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, oas_skill_id, stage_order)
);

CREATE TABLE IF NOT EXISTS public.oas_competencies (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  oas_skill_id bigint NOT NULL REFERENCES public.oas_skills(id) ON DELETE CASCADE,
  oas_stage_id bigint REFERENCES public.oas_stages(id) ON DELETE SET NULL,
  code varchar(100),
  name varchar(255) NOT NULL,
  description text,
  competency_order integer NOT NULL DEFAULT 1,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.participant_oas_competency (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  oas_competency_id bigint NOT NULL REFERENCES public.oas_competencies(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL DEFAULT 'awarded' CHECK (status IN ('in_progress', 'awarded', 'revoked')),
  achieved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  awarded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, participant_id, oas_competency_id)
);

CREATE TABLE IF NOT EXISTS public.participant_oas_stage_award (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  oas_stage_id bigint NOT NULL REFERENCES public.oas_stages(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL DEFAULT 'awarded' CHECK (status IN ('in_progress', 'awarded', 'revoked')),
  achieved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  awarded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, participant_id, oas_stage_id)
);

-- ============================================================
-- 2) Shared prerequisites / permits
-- ============================================================
CREATE TABLE IF NOT EXISTS public.participant_credentials (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  credential_key varchar(150) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'pending')),
  issued_at timestamptz,
  expires_at timestamptz,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, participant_id, credential_key)
);

-- ============================================================
-- 3) PAB plan-do-review tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pab_themes (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code varchar(100),
  name varchar(255) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.pab_plans (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  pab_theme_id bigint REFERENCES public.pab_themes(id) ON DELETE SET NULL,
  title varchar(255) NOT NULL,
  objective text,
  status varchar(30) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  planned_start_date date,
  planned_end_date date,
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.pab_plan_items (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pab_plan_id bigint NOT NULL REFERENCES public.pab_plans(id) ON DELETE CASCADE,
  item_order integer NOT NULL DEFAULT 1,
  title varchar(255) NOT NULL,
  description text,
  status varchar(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),
  due_date date,
  completed_at timestamptz,
  evidence text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.pab_reviews (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pab_plan_id bigint NOT NULL REFERENCES public.pab_plans(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  notes text,
  next_steps text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4) Top Award aggregate tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.top_awards (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code varchar(100),
  name varchar(255) NOT NULL,
  description text,
  requirements jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.participant_top_award_progress (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  top_award_id bigint NOT NULL REFERENCES public.top_awards(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'approved', 'rejected', 'completed')),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  target_date date,
  completed_at timestamptz,
  progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, participant_id, top_award_id)
);

CREATE TABLE IF NOT EXISTS public.top_award_service_logs (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_top_award_progress_id bigint NOT NULL REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  hours numeric(6,2) NOT NULL DEFAULT 0,
  description text,
  status varchar(30) NOT NULL DEFAULT 'logged' CHECK (status IN ('logged', 'submitted', 'approved', 'rejected')),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.top_award_projects (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_top_award_progress_id bigint NOT NULL REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  description text,
  status varchar(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'approved', 'rejected', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.top_award_reviews (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_top_award_progress_id bigint NOT NULL REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  outcome varchar(30) NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'approved', 'rejected', 'revisions_required')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 5) Optional shared audit tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.progress_evidence (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer REFERENCES public.participants(id) ON DELETE SET NULL,
  source_type varchar(100) NOT NULL,
  source_id bigint NOT NULL,
  evidence_type varchar(50) NOT NULL DEFAULT 'note',
  evidence_url text,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.progress_approvals (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id integer REFERENCES public.participants(id) ON DELETE SET NULL,
  source_type varchar(100) NOT NULL,
  source_id bigint NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Shared indexes
CREATE INDEX IF NOT EXISTS idx_oas_skills_org ON public.oas_skills(organization_id);
CREATE INDEX IF NOT EXISTS idx_oas_stages_org_skill ON public.oas_stages(organization_id, oas_skill_id);
CREATE INDEX IF NOT EXISTS idx_oas_competencies_org_skill ON public.oas_competencies(organization_id, oas_skill_id);
CREATE INDEX IF NOT EXISTS idx_participant_oas_comp_org_participant ON public.participant_oas_competency(organization_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_oas_stage_org_participant ON public.participant_oas_stage_award(organization_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_credentials_org_participant ON public.participant_credentials(organization_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_pab_plans_org_participant ON public.pab_plans(organization_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_pab_plan_items_org_plan ON public.pab_plan_items(organization_id, pab_plan_id);
CREATE INDEX IF NOT EXISTS idx_pab_reviews_org_plan ON public.pab_reviews(organization_id, pab_plan_id);
CREATE INDEX IF NOT EXISTS idx_top_awards_org ON public.top_awards(organization_id);
CREATE INDEX IF NOT EXISTS idx_participant_top_award_org_participant ON public.participant_top_award_progress(organization_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_top_award_service_logs_org_progress ON public.top_award_service_logs(organization_id, participant_top_award_progress_id);
CREATE INDEX IF NOT EXISTS idx_top_award_projects_org_progress ON public.top_award_projects(organization_id, participant_top_award_progress_id);
CREATE INDEX IF NOT EXISTS idx_top_award_reviews_org_progress ON public.top_award_reviews(organization_id, participant_top_award_progress_id);
CREATE INDEX IF NOT EXISTS idx_progress_evidence_org_source ON public.progress_evidence(organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_progress_approvals_org_source ON public.progress_approvals(organization_id, source_type, source_id);
