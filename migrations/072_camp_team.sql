-- Camp lists (#1319, first slice): who leads a camp, who animates it, and who helps as a camp aide.
-- The camp permit lists the camp's team beside its youth. No such assignment existed: a unit's
-- leaders are not all at every camp. A manager of the camp (meetings.manage) names its members among
-- the unit's active members; volunteers holding a place on one of the camp's shifts are listed beside
-- them on their own.
--
-- A camp aide may be a minor. Accounts had no birth date, so one is added, optional: without it an
-- aide's age reads "not verified", never "adult". Only the date is kept, never a document.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN public.users.date_of_birth IS
  'Optional birth date of the member, used to tell whether a camp aide is a minor on the camp''s dates. NULL when unknown: the age then reads "not verified".';

CREATE TABLE IF NOT EXISTS public.camp_team_members (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_role VARCHAR(20) NOT NULL CHECK (team_role IN ('lead', 'leader', 'camp_aide')),
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, meeting_id, user_id),
  FOREIGN KEY (meeting_id, organization_id) REFERENCES public.year_plan_meetings(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS camp_team_members_by_user ON public.camp_team_members (organization_id, user_id);

COMMENT ON TABLE public.camp_team_members IS
  'Members of the unit named to one planned camp''s team (lead, leader, camp aide). Written through services/campRoster.js, which keeps every member inside the camp''s unit.';
