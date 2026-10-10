-- Who an activity is for.
--
-- Not every activity invites the whole unit: a fall camp may be offered only
-- to the children aged 10 and over who have never been. An activity either
-- invites everyone (the default, and what every existing activity keeps), or
-- only the participants listed in activity_invitees.
--
-- Only invited children appear in the activity's carpool lists, can be seated
-- in one of its cars, or receive one of its permission slips.

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS invites_everyone BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.activities.invites_everyone IS
  'TRUE when the whole unit is invited; FALSE when only the participants in activity_invitees are';

CREATE TABLE IF NOT EXISTS public.activity_invitees (
  activity_id INTEGER NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_invitees_participant
  ON public.activity_invitees (participant_id);

CREATE INDEX IF NOT EXISTS idx_activity_invitees_organization
  ON public.activity_invitees (organization_id);

COMMENT ON TABLE public.activity_invitees IS
  'Participants invited to an activity whose invites_everyone is FALSE';
