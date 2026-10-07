-- Restore seven migrations lost when migrations/ was reset.
--
-- On 2026-08-02 the merge of PR #981 (7ba3d0d) removed the migrations folder
-- and made attached_assets/Full_Database_schema.sql the baseline. Feature
-- branches still carried 28 migrations; the merges that followed kept the
-- deletion. Twenty-one are fully reflected in the baseline. These seven are
-- not, yet the code depends on them, so a database built from this
-- repository fails in alumni consent, unit transfers, erasure approvals,
-- camp days, meeting kinds, and the yearly planner's scout year:
--
--   add_alumni_consent.sql                    add_year_plan_meeting_kind.sql
--   add_transfer_provenance.sql               add_year_plans_scout_year.sql
--   add_participant_erasure_approvals.sql     add_guardians_emailed_to_permission_slips.sql
--   add_camp_day_schedule.sql
--
-- Their originals are in commit 42f4a56. A database that already ran them --
-- production, most likely -- must come out unchanged, so this file only
-- creates what is absent. Every backfill and seed runs only in the block that
-- has just created its column or permission, never against data that already
-- existed: re-running the meeting-kind backfill, for instance, would undo
-- meetings someone set back to 'regular', and re-seeding alumni.manage would
-- hand it back to a role it was taken from.

-- ---------------------------------------------------------------------------
-- add_alumni_consent.sql
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_organizations
  ADD COLUMN IF NOT EXISTS alumni_invited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS alumni_consent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS alumni_opted_out_at timestamptz;

COMMENT ON COLUMN public.user_organizations.alumni_invited_at IS
  'When the alumni opt-in email was sent. Set so a later transition does not ask a second time; a NULL here on an inactive membership is what makes it a candidate for the invitation.';
COMMENT ON COLUMN public.user_organizations.alumni_consent_at IS
  'When the person opted in, through the signed link in that email. Only a row with this set may carry status = ''alumni''.';
COMMENT ON COLUMN public.user_organizations.alumni_opted_out_at IS
  'When the person unsubscribed. The membership goes back to ''inactive''; the timestamp stays as the proof the request was honoured.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_organizations_alumni_requires_consent'
  ) THEN
    ALTER TABLE public.user_organizations
      ADD CONSTRAINT user_organizations_alumni_requires_consent
      CHECK (status <> 'alumni' OR alumni_consent_at IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS user_organizations_alumni_idx
  ON public.user_organizations (organization_id)
  WHERE status = 'alumni';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = 'alumni.manage') THEN
    -- The catalog was loaded with explicit ids; see 007_parent_invitation_onboarding.sql.
    PERFORM setval(
      pg_get_serial_sequence('public.permissions', 'id'),
      COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
      false
    );
    INSERT INTO public.permissions (permission_key, permission_name, category, description)
    VALUES ('alumni.manage', 'Manage Alumni', 'communication',
            'Invite departed families to become alumni and address the alumni audience.');
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
     CROSS JOIN public.permissions p
     WHERE p.permission_key = 'alumni.manage'
       AND r.role_name IN ('unitadmin', 'district', 'administration')
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END
$$;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'members';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_audience_check') THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_audience_check
      CHECK (audience IN ('members', 'alumni'));
  END IF;
END
$$;

COMMENT ON COLUMN public.announcements.audience IS
  'Who this announcement is for. ''members'' is the unit; ''alumni'' is the consented former families, who are never reached by a members send and never by group or role filters.';

-- ---------------------------------------------------------------------------
-- add_transfer_provenance.sql
-- ---------------------------------------------------------------------------

ALTER TABLE public.participant_enrollments
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS transferred_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.participant_enrollments.transferred_at IS
  'When the transfer was carried out. Distinct from ended_on, which is the date the enrollment stopped counting and may be back-dated to the year boundary.';
COMMENT ON COLUMN public.participant_enrollments.transferred_by IS
  'Who carried out the transfer. A transfer moves a file between two tenants, which is why it names a person rather than only a destination.';

CREATE INDEX IF NOT EXISTS participant_enrollments_transferred_idx
  ON public.participant_enrollments (transferred_to_organization_id)
  WHERE transferred_to_organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- add_participant_erasure_approvals.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.participant_erasure_approvals (
  participant_id integer NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS participant_erasure_approvals_org_idx
  ON public.participant_erasure_approvals (organization_id, approved_at DESC);

COMMENT ON TABLE public.participant_erasure_approvals IS
  'Per-organization approvals for erasing a participant whose global record is owned by multiple organizations. Rows disappear with the participant.';

-- ---------------------------------------------------------------------------
-- add_camp_day_schedule.sql
-- ---------------------------------------------------------------------------

ALTER TABLE public.year_plan_meeting_activities
  ADD COLUMN IF NOT EXISTS day_offset INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'year_plan_meeting_activities'
       AND c.conname = 'ypm_activities_day_offset_check'
  ) THEN
    ALTER TABLE public.year_plan_meeting_activities
      ADD CONSTRAINT ypm_activities_day_offset_check
      CHECK (day_offset >= 0 AND day_offset < 60);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ypm_activities_day
  ON public.year_plan_meeting_activities (meeting_id, day_offset, sort_order);

CREATE TABLE IF NOT EXISTS public.year_plan_meeting_days (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  meeting_id INTEGER NOT NULL REFERENCES public.year_plan_meetings(id) ON DELETE CASCADE,
  day_offset INTEGER NOT NULL DEFAULT 0 CHECK (day_offset >= 0 AND day_offset < 60),
  title VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (meeting_id, day_offset)
);

CREATE INDEX IF NOT EXISTS idx_ypm_days_org
  ON public.year_plan_meeting_days (organization_id, meeting_id);

-- ---------------------------------------------------------------------------
-- add_year_plan_meeting_kind.sql
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'year_plan_meetings' AND column_name = 'meeting_kind'
  ) THEN
    ALTER TABLE public.year_plan_meetings
      ADD COLUMN meeting_kind VARCHAR(20) NOT NULL DEFAULT 'regular';

    -- Classify existing meetings, only now that the column is new.
    UPDATE public.year_plan_meetings m
       SET meeting_kind = 'camp'
      FROM public.activities a
     WHERE m.activity_id = a.id
       AND m.meeting_kind = 'regular'
       AND COALESCE(a.activity_end_date, a.activity_start_date, a.activity_date)
           > COALESCE(a.activity_start_date, a.activity_date);

    UPDATE public.year_plan_meetings m
       SET meeting_kind = 'weekend'
      FROM public.activities a
     WHERE m.activity_id = a.id
       AND m.meeting_kind = 'regular'
       AND EXTRACT(ISODOW FROM m.meeting_date) IN (6, 7);

    UPDATE public.year_plan_meetings
       SET meeting_kind = 'special'
     WHERE meeting_kind = 'regular'
       AND metadata->>'special_date' = 'true';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'year_plan_meetings'
       AND c.conname = 'year_plan_meetings_kind_check'
  ) THEN
    ALTER TABLE public.year_plan_meetings
      ADD CONSTRAINT year_plan_meetings_kind_check
      CHECK (meeting_kind IN ('regular', 'weekend', 'camp', 'special'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ypm_activity_id
  ON public.year_plan_meetings (activity_id)
  WHERE activity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ypm_org_kind
  ON public.year_plan_meetings (organization_id, meeting_kind)
  WHERE meeting_kind <> 'regular';

-- ---------------------------------------------------------------------------
-- add_year_plans_scout_year.sql
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'year_plans' AND column_name = 'scout_year_id'
  ) THEN
    ALTER TABLE public.year_plans ADD COLUMN scout_year_id INTEGER;

    -- Attach existing plans to the scout year their start falls in, only now
    -- that the column is new.
    UPDATE public.year_plans plan
       SET scout_year_id = (
         SELECT year.id
           FROM public.scout_years year
          WHERE year.organization_id = plan.organization_id
            AND plan.start_date BETWEEN year.start_date AND year.end_date
          ORDER BY CASE year.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END,
                   year.start_date DESC
          LIMIT 1
       );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'year_plans_scout_year_id_fkey') THEN
    ALTER TABLE public.year_plans
      ADD CONSTRAINT year_plans_scout_year_id_fkey
      FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_year_plans_scout_year
  ON public.year_plans (organization_id, scout_year_id, start_date DESC);

-- ---------------------------------------------------------------------------
-- add_guardians_emailed_to_permission_slips.sql (the column survived; its index did not)
-- ---------------------------------------------------------------------------

ALTER TABLE public.permission_slips
  ADD COLUMN IF NOT EXISTS guardians_emailed JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_permission_slips_guardians_emailed
  ON public.permission_slips USING gin (guardians_emailed);
