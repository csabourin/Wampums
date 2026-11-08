-- Camp plan, slice 2 (#1417): the members in charge of a schedule line.
--
-- A line of a camp schedule names who leads it. Until now this was free text
-- (`year_plan_meeting_activities.responsable`), which stays as a fallback for a
-- person without an account. A line may now also name members of its unit,
-- whose roles reach beyond their own children, in the order chosen.
--
-- Each row belongs to the line's unit (composite foreign key), and goes with its
-- line. A member who leaves the unit stays named, so the plan keeps who led what;
-- the screen marks them. A deleted account removes its rows.

CREATE TABLE IF NOT EXISTS public.year_plan_meeting_activity_leaders (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_activity_id INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meeting_activity_id, user_id),
  FOREIGN KEY (meeting_activity_id, organization_id)
    REFERENCES public.year_plan_meeting_activities(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS year_plan_meeting_activity_leaders_user
  ON public.year_plan_meeting_activity_leaders (organization_id, user_id);

COMMENT ON TABLE public.year_plan_meeting_activity_leaders IS
  'Members of the unit in charge of one schedule line, in order (#1417). The line''s free-text responsable stays for a person without an account.';
COMMENT ON COLUMN public.year_plan_meeting_activities.description IS
  'Logistic notes of a schedule line: what to prepare, where, with whom (#1417). Plain text.';
